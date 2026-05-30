require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('express-flash');
const methodOverride = require('method-override');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Method override
app.use(methodOverride('_method'));

// Session — MongoDB store jika MONGODB_URI ada, fallback ke file store
let sessionStore;
if (process.env.MONGODB_URI) {
  const MongoStore = require('connect-mongo');
  sessionStore = MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    dbName: 'alexcloud',
    collectionName: 'sessions',
    ttl: 30 * 24 * 60 * 60, // 30 hari
    autoRemove: 'native'
  });
  console.log('[Session] Using MongoDB session store');
} else {
  const FileStore = require('session-file-store')(session);
  sessionStore = new FileStore({
    path: './sessions',
    ttl: 30 * 24 * 60 * 60,
    retries: 1,
    logFn: () => {}
  });
  console.log('[Session] Using file session store (dev mode)');
}

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

// Passport — loaded after session
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

// ─── Start server after restoring DB from MongoDB ──────────────────────────────
const { initDB, restoreFromMongoDB } = require('./database/db');

async function startServer() {
  // 1. Restore data dari MongoDB Atlas dulu
  await restoreFromMongoDB();

  // 2. Seed data default (hanya jika belum ada)
  initDB();

  // 3. Start listening
  app.listen(PORT, () => {
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

startServer().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
