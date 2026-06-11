require('dotenv').config();

const { cleanEnvVar } = require('./utils/helpers');

// Fix common copy-paste and quote wrapping mistakes for env vars
cleanEnvVar('CLOUDINARY_URL');
cleanEnvVar('FR3_API_KEY');

const express = require('express');
const session = require('express-session');
const flash = require('express-flash');
const methodOverride = require('method-override');
const path = require('path');
const compression = require('compression');
const { runMinifier } = require('./utils/minifier');

// Jalankan minifier aset statis otomatis
runMinifier();

const app = express();
const PORT = process.env.PORT || 3000;

// ── Gzip/Brotli Compression (reduces transfer size ~70%) ──────────────────────
app.use(compression({ level: 6 }));

// ── Security Headers (applied to all responses) ─────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Static files dengan aggressive caching ───────────────────────────────────
// CSS/JS/images: cache 1 tahun (immutable untuk file yang di-hash), revalidate dengan ETag
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '365d',        // cache 1 tahun di browser
  etag: true,            // ETag untuk conditional requests
  lastModified: true,    // Last-Modified header
  setHeaders: (res, filePath) => {
    // CSS dan JS: cache 1 tahun
    if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable, stale-while-revalidate=604800');
    }
    // Images: cache 1 tahun
    if (/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable, stale-while-revalidate=604800');
    }
  }
}));

// Body parsing — limit 10mb agar base64 image dari WA Bot bisa diterima
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Method override
app.use(methodOverride('_method'));

const { sessionStore } = require('./database/db');

// Session — persisted in PostgreSQL via custom lowdb store
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'alexcloud_secret_2024_persist',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Flash messages
app.use(flash());

// Passport
const passport = require('./middleware/passport');
app.use(passport.initialize());
app.use(passport.session());

// Global locals
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.process = process;
  next();
});

// Routes
const authRouter = require('./routes/auth');
const { router: mainRouter } = require('./routes/main');
const adminRouter = require('./routes/admin');

app.use('/', authRouter);
app.use('/', mainRouter);
app.use('/admin', adminRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    message: 'Halaman tidak ditemukan (404)',
    user: req.user || null
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(500).render('error', {
    message: 'Terjadi kesalahan server. Silakan coba lagi.',
    user: req.user || null
  });
});

// ─── Start: restore from MongoDB first, then seed, then listen ─────────────────
const { initDB, restoreFromMongoDB } = require('./database/db');

let server = null;

async function startServer() {
  await restoreFromMongoDB();
  initDB();

  server = app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║     ⚡  ALEXCLOUD SERVER READY  ⚡    ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  URL    : http://localhost:${PORT}       ║`);
    console.log(`║  Admin  : admin@alexcloud.com         ║`);
    console.log(`║  Pass   : Admin@123                   ║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('');
  });
}

// ─── Graceful Shutdown (drain connections, flush DB backup) ──────────────────
function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] ${signal} received. Closing server gracefully...`);
  if (server) {
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
      process.exit(0);
    });
    // Force close after 10s if connections don't drain
    setTimeout(() => {
      console.error('[SHUTDOWN] Forcing exit after 10s timeout.');
      process.exit(1);
    }, 10000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
