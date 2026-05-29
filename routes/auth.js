const express = require('express');
const router = express.Router();
const passport = require('../middleware/passport');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/db');
const { ensureGuest, ensureAuthenticated } = require('../middleware/auth');

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
  res.render('auth/register', {
    title: 'Daftar - AlexCloud',
    error: req.flash('error'),
    user: null
  });
});

// Register POST
router.post('/register', ensureGuest, (req, res) => {
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
  db.get('users').push({
    id: uuidv4(),
    name: name.trim(),
    email: email.toLowerCase(),
    password: hashedPw,
    role: 'user',
    avatar: null,
    googleId: null,
    createdAt: new Date().toISOString(),
    isActive: true,
    isBanned: false
  }).write();
  req.flash('success', 'Akun berhasil dibuat! Silakan login.');
  res.redirect('/login');
});

// Login POST — cek isBanned + Remember Me
router.post('/login', ensureGuest, (req, res, next) => {
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
      res.redirect('/dashboard');
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
    res.redirect('/dashboard');
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
