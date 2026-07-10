process.env.TZ = 'Asia/Jakarta';
// Muat .env dari folder file ini (bukan CWD) agar tetap terbaca walau server
// dijalankan dari direktori lain (pm2/systemd/cron) — penyebab umum env kosong.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const { cleanEnvVar } = require('./utils/helpers');

// Fix common copy-paste and quote wrapping mistakes for env vars
cleanEnvVar('CLOUDINARY_URL');
cleanEnvVar('FR3_API_KEY');
cleanEnvVar('SAYABAYAR_API_KEY');
cleanEnvVar('MUSTIKAPAY_API_KEY');
cleanEnvVar('GOOGLE_CLIENT_ID');
cleanEnvVar('GOOGLE_CLIENT_SECRET');
cleanEnvVar('GOOGLE_CALLBACK_URL');
cleanEnvVar('DATABASE_URL');
cleanEnvVar('ADMIN_PASSWORD');
cleanEnvVar('BOT_SHARED_SECRET');
cleanEnvVar('TESTIMONIAL_API_KEY');

// Peringatan boot yang jelas kalau gateway pembayaran utama tak akan jalan.
if (!process.env.MUSTIKAPAY_API_KEY) {
  console.warn('[BOOT] ⚠️  MUSTIKAPAY_API_KEY KOSONG — gateway utama (QRIS/VA/E-Money/Retail) akan gagal. Set di .env server lalu restart.');
}
// Tanpa BOT_SHARED_SECRET, semua endpoint /api/bot/* akan menolak (fail-closed) dan
// notifikasi WA via bot tak terkirim. Peringatkan jelas saat boot.
if (!process.env.BOT_SHARED_SECRET) {
  console.warn('[BOOT] ⚠️  BOT_SHARED_SECRET KOSONG — endpoint /api/bot/* akan menolak semua request & notif WA via bot gagal. Set di .env (nilai sama dengan WA bot) lalu restart.');
}

const express = require('express');
const session = require('express-session');
const flash = require('express-flash');
const methodOverride = require('method-override');
const compression = require('compression');
const { runMinifier } = require('./utils/minifier');

// Jalankan minifier aset statis otomatis
runMinifier();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Di belakang reverse proxy (Cloudflare/nginx/pm2): percayai 1 hop proxy agar
// req.ip benar (rate limiter) dan cookie `secure` berfungsi di balik TLS proxy.
app.set('trust proxy', 1);



// ─── Auto-convert game images to WebP if sharp is available ──────────────────
async function autoConvertGameImagesToWebP() {
  let sharp;
  try { sharp = require('sharp'); } catch (e) {
    console.log('[WEBP] sharp not installed — skipping game image conversion. Install with: npm install sharp');
    return;
  }
  const imagesDir = path.join(__dirname, 'public', 'images', 'games');
  if (!fs.existsSync(imagesDir)) return;

  const legacyFiles = fs.readdirSync(imagesDir).filter(f =>
    /\.(png|jpg|jpeg)$/i.test(f) && !f.endsWith('.webp')
  );
  if (legacyFiles.length === 0) return;

  console.log(`[WEBP] Converting ${legacyFiles.length} game image(s) to WebP...`);
  for (const file of legacyFiles) {
    const inputPath = path.join(imagesDir, file);
    const baseName = path.basename(file, path.extname(file));
    const outputPath = path.join(imagesDir, `${baseName}.webp`);
    if (fs.existsSync(outputPath)) continue; // Already converted
    try {
      await sharp(inputPath).webp({ quality: 82, effort: 4 }).toFile(outputPath);
      console.log(`[WEBP] Converted ${file} -> ${baseName}.webp`);
    } catch (e) {
      console.warn(`[WEBP] Failed to convert ${file}:`, e.message);
    }
  }
}
autoConvertGameImagesToWebP();

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

// ── WebP fallback: if .webp not found, serve original .png/.jpg ──────────────
app.use('/images/games', (req, res, next) => {
  if (req.path.endsWith('.webp')) {
    const webpPath = path.join(__dirname, 'public', 'images', 'games', path.basename(req.path));
    if (!fs.existsSync(webpPath)) {
      const base = path.basename(req.path, '.webp');
      const fallbacks = [`${base}.jpg`, `${base}.png`, `${base}.jpeg`];
      for (const fb of fallbacks) {
        const fbPath = path.join(__dirname, 'public', 'images', 'games', fb);
        if (fs.existsSync(fbPath)) {
          return res.sendFile(fbPath);
        }
      }
    }
  }
  next();
});

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

// Body parsing — limit 15mb agar base64 image dari WA Bot bisa diterima
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(express.json({ limit: '15mb' }));

// Method override
app.use(methodOverride('_method'));

const { sessionStore, db } = require('./database/db');

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
    sameSite: 'lax',
    // Kirim cookie sesi hanya via HTTPS bila situs berjalan di HTTPS (cegah pencurian
    // sesi saat downgrade). Aktif jika NODE_ENV=production ATAU BASE_URL sudah https,
    // sehingga tetap aman walau NODE_ENV lupa di-set di server produksi.
    secure: IS_PROD || (process.env.BASE_URL || '').startsWith('https://')
  }
}));

// Flash messages
app.use(flash());

// Passport
const passport = require('./middleware/passport');
app.use(passport.initialize());
app.use(passport.session());

// CSRF protection — sesudah session+passport (butuh req.session), sebelum route.
// Menyetel res.locals.csrfToken & memvalidasi semua request yang mengubah state.
const { csrfProtection } = require('./middleware/csrf');
app.use(csrfProtection);

// Global locals and tracking
app.use((req, res, next) => {
  // 1. Recover tracking data from cookie if session is fresh
  if (!req.session.tracking && req.headers.cookie) {
    const rawCookies = req.headers.cookie.split(';');
    const trackingCookie = rawCookies.find(c => c.trim().startsWith('ac_tracking='));
    if (trackingCookie) {
      try {
        const val = decodeURIComponent(trackingCookie.split('=')[1]);
        req.session.tracking = JSON.parse(val);
      } catch (e) {
        // ignore malformed cookie
      }
    }
  }

  // 2. Capture new tracking parameters
  const trackingKeys = [
    'ref', 'ref_', 'ref_id', 'utm_source', 'utm_medium', 'utm_campaign', 
    'utm_term', 'utm_content', 'source', 'src', 'from', 'origin', 'via', 
    'gclid', 'fbclid', 'ttclid', 'click_id', 'aff'
  ];
  
  let hasNewTracking = false;
  const currentTracking = req.session.tracking || {};
  
  for (const key of trackingKeys) {
    if (req.query[key]) {
      currentTracking[key] = String(req.query[key]).trim();
      hasNewTracking = true;
    }
  }
  
  if (hasNewTracking) {
    req.session.tracking = currentTracking;
    res.cookie('ac_tracking', JSON.stringify(currentTracking), {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 hari
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD || (process.env.BASE_URL || '').startsWith('https://')
    });
  }

  res.locals.user = req.user || null;
  res.locals.process = process;

  // Site-wide announcement banner (managed from the admin panel)
  try {
    const settings = db.get('settings').value() || {};
    const ann = settings.announcement;
    res.locals.announcement = (ann && ann.enabled && ann.text) ? ann : null;
  } catch (e) {
    res.locals.announcement = null;
  }

  // Dynamic canonical URL & OG URL for SEO indexing
  const host = req.get('host') || 'alexcloud.my.id';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  let cleanPath = req.originalUrl.split('?')[0];
  // Remove trailing slash for sub-pages to prevent duplicate crawl issues
  if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
    cleanPath = cleanPath.slice(0, -1);
  }
  res.locals.canonicalUrl = `${protocol}://${host}${cleanPath}`;
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
    console.log('╚══════════════════════════════════════╝');
    console.log('');
  });
}

// ─── Graceful Shutdown (drain connections, flush DB backup) ──────────────────
async function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] ${signal} received. Closing server gracefully...`);
  
  // Kirim notifikasi server offline sebelum dimatikan
  try {
    const { sendWhatsAppNotification } = require('./utils/whatsapp');
    const notifMsg = `⚠️ *SERVER ALEXCLOUD OFFLINE (SHUTDOWN)* ⚠️\n\n` +
      `🖥️ *Server:* VPS AlexCloud\n` +
      `⚙️ *Sinyal:* ${signal}\n` +
      `📅 *Waktu:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
      `Server sedang dimatikan secara tertib (misal karena restart, redeploy, atau shutdown manual).`;
    await sendWhatsAppNotification(notifMsg);
  } catch (err) {
    console.error('[WA NOTIF SHUTDOWN ERROR]', err.message);
  }

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

// Scheduler Analitik Proaktif AI
function startProactiveAIAnalyst() {
  console.log('[PROACTIVE AI] Scheduler initialized (running every 12 hours)...');
  const { runProactiveAnalysis } = require('./utils/helpers');
  // Loop setiap 12 jam (tidak perlu dijalankan instan setiap restart agar owner tidak terganggu spam)
  setInterval(() => {
    runProactiveAnalysis().catch(err => console.error('[PROACTIVE AI CRON RUN ERROR]', err.message));
  }, 12 * 60 * 60 * 1000);
}

// Scheduler Follow-Up Pesanan Pending/Expired — jalan setiap 1 jam
function startPendingOrderFollowUp() {
  console.log('[FOLLOWUP] Scheduler initialized (running every 1 hour)...');
  const { runPendingOrderFollowUp } = require('./utils/followup');

  // Delay 5 menit dari boot agar DB sudah terbaca semua dari Postgres
  setTimeout(() => {
    // Jalankan langsung sekali
    runPendingOrderFollowUp().then(r =>
      console.log(`[FOLLOWUP] Initial run done: sent=${r.sent}, skipped=${r.skipped}`)
    ).catch(err => console.error('[FOLLOWUP INIT ERROR]', err.message));

    // Lalu setiap 1 jam
    setInterval(() => {
      runPendingOrderFollowUp().catch(err =>
        console.error('[FOLLOWUP CRON ERROR]', err.message)
      );
    }, 60 * 60 * 1000);
  }, 5 * 60 * 1000);
}

startServer().then(() => {
  startProactiveAIAnalyst();
  startPendingOrderFollowUp();
}).catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
