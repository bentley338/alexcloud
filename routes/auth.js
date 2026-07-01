const express = require('express');
const router = express.Router();
const passport = require('../middleware/passport');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/db');
const { ensureGuest, ensureAuthenticated } = require('../middleware/auth');
const { ensureReferralCode, attachReferralOnRegister } = require('../utils/referral');

// ─── Rate limit untuk login/register (cegah brute-force kredensial) ──────────
// Per-IP, redirect dengan flash agar UX tetap konsisten (bukan JSON mentah).
function authRateLimiter({ windowMs, maxAttempts, redirectTo }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of hits) if (now - e.start > windowMs) hits.delete(k);
  }, 60000).unref();
  return function (req, res, next) {
    const key = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    const now = Date.now();
    let e = hits.get(key);
    if (!e || now - e.start > windowMs) {
      hits.set(key, { count: 1, start: now });
      return next();
    }
    e.count++;
    if (e.count > maxAttempts) {
      req.flash('error', 'Terlalu banyak percobaan. Silakan coba lagi dalam beberapa menit.');
      return res.redirect(redirectTo);
    }
    next();
  };
}

const loginLimiter = authRateLimiter({ windowMs: 60000, maxAttempts: 10, redirectTo: '/login' });
const registerLimiter = authRateLimiter({ windowMs: 60000, maxAttempts: 5, redirectTo: '/register' });

// Login page
router.get('/login', ensureGuest, (req, res) => {
  res.render('auth/login', {
    title: 'Login - AlexCloud',
    error: req.flash('error'),
    success: req.flash('success'),
    user: null
  });
});

// Register page
router.get('/register', ensureGuest, (req, res) => {
  // Tangkap kode referral dari link (?ref=KODE) → simpan di sesi + prefill form.
  const refCode = (req.query.ref || '').toString().trim().toUpperCase();
  if (refCode) req.session.pendingRef = refCode;
  res.render('auth/register', {
    title: 'Daftar - AlexCloud',
    error: req.flash('error'),
    refCode: refCode || req.session.pendingRef || '',
    user: null
  });
});

// Register POST
router.post('/register', ensureGuest, registerLimiter, (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  if (!name || !email || !password) {
    req.flash('error', 'Semua field wajib diisi.');
    return res.redirect('/register');
  }
  if (password !== confirmPassword) {
    req.flash('error', 'Password tidak cocok.');
    return res.redirect('/register');
  }
  if (password.length < 6) {
    req.flash('error', 'Password minimal 6 karakter.');
    return res.redirect('/register');
  }
  const existing = db.get('users').find({ email: email.toLowerCase() }).value();
  if (existing) {
    req.flash('error', 'Email sudah terdaftar.');
    return res.redirect('/register');
  }
  const hashedPw = bcrypt.hashSync(password, 10);
  const newUser = {
    id: uuidv4(),
    name: name.trim(),
    email: email.toLowerCase(),
    password: hashedPw,
    role: 'user',
    avatar: null,
    googleId: null,
    createdAt: new Date().toISOString(),
    signupIp: req.ip,
    referralCode: null,
    referredBy: null,
    isActive: true,
    isBanned: false
  };
  db.get('users').push(newUser).write();

  // Referral: beri kode sendiri + proses kode pengajak (dengan anti-abuse).
  ensureReferralCode(newUser);
  const refResult = attachReferralOnRegister(req, res, newUser, req.body.refCode || req.session.pendingRef);
  delete req.session.pendingRef;

  // Send WhatsApp Notification to Owner
  try {
    const { sendWhatsAppNotification } = require('../utils/whatsapp');
    const notifMsg = `🔔 *NOTIFIKASI PENDAFTARAN BARU* 🔔\n\n` +
      `👤 *Nama:* ${name.trim()}\n` +
      `📧 *Email:* ${email.toLowerCase()}\n` +
      `📅 *Waktu:* ${new Date().toLocaleString('id-ID')}\n\n` +
      `Pengguna baru telah berhasil mendaftar di website AlexCloud.`;
    sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF ERROR]', err.message));
  } catch (err) {
    console.error('[WA NOTIF REGISTRATION ERROR]', err.message);
  }

  if (refResult && refResult.status === 'pending' && refResult.welcomeCode) {
    req.flash('success', `Akun berhasil dibuat! 🎁 Kamu dapat diskon welcome — cek kode di Dashboard. Silakan login.`);
  } else {
    req.flash('success', 'Akun berhasil dibuat! Silakan login.');
  }
  res.redirect('/login');
});

// Login POST — cek isBanned + Remember Me
router.post('/login', ensureGuest, loginLimiter, (req, res, next) => {
  const rememberMe = req.body.rememberMe === 'on';
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', info && info.message ? info.message : 'Email atau password salah.');
      return res.redirect('/login');
    }
    if (user.isBanned) {
      req.flash('error', 'Akun kamu telah dibanned oleh admin. Hubungi support untuk informasi lebih lanjut.');
      return res.redirect('/login');
    }
    req.logIn(user, (err) => {
      if (err) return next(err);
      // Extend cookie jika Remember Me dicentang
      if (rememberMe) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 hari
      } else {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;  // 7 hari default
      }
      req.session.rememberMe = rememberMe;
      res.redirect('/');
    });
  })(req, res, next);
});

// Google OAuth
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login', failureFlash: true }),
  (req, res) => {
    if (req.user && req.user.isBanned) {
      req.logout(() => {});
      req.flash('error', 'Akun kamu telah dibanned oleh admin.');
      return res.redirect('/login');
    }
    // Google login selalu persistent 30 hari
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    req.session.rememberMe = true;
    res.redirect('/');
  }
);

// Logout
router.get('/logout', ensureAuthenticated, (req, res) => {
  req.logout(() => {
    req.flash('success', 'Berhasil logout.');
    res.redirect('/login');
  });
});

module.exports = router;
