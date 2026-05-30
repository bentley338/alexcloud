const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { ensureAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// =====================
// MULTER STORAGE SETUP — Memory Storage (Converts images to Base64 for database persistence)
// =====================
const testiStorage = multer.memoryStorage();

const testiUpload = multer({
  storage: testiStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar (PNG, JPG, WEBP, GIF) yang diizinkan.'));
    }
  }
});

function getPlans() {
  return db.get('plans').value();
}

// =====================
// ADMIN DASHBOARD
// =====================
router.get('/', ensureAdmin, (req, res) => {
  const users = db.get('users').value();
  const orders = db.get('orders').value();
  const subscriptions = db.get('subscriptions').value();
  const games = db.get('games').value();
  const promoCodes = db.get('promoCodes').value();
  const testimonials = db.get('testimonials').value();

  const stats = {
    totalUsers: users.filter(u => u.role !== 'admin').length,
    totalOrders: orders.length,
    pendingOrders: orders.filter(o => o.status === 'pending').length,
    activeSubscriptions: subscriptions.filter(s => s.status === 'active').length,
    totalRevenue: orders.filter(o => o.status === 'confirmed').reduce((sum, o) => sum + o.price, 0),
    totalGames: games.length,
    activePromos: promoCodes.filter(p => p.isActive).length,
    totalTestimonials: testimonials.length
  };

  const recentOrders = db.get('orders').sortBy('createdAt').reverse().take(10).value();

  res.render('admin/dashboard', {
    title: 'Admin Dashboard - AlexCloud',
    user: req.user,
    stats,
    recentOrders,
    moment
  });
});

// =====================
// ORDERS
// =====================
router.get('/orders', ensureAdmin, (req, res) => {
  const ordersRaw = db.get('orders').sortBy('createdAt').reverse().value();
  const users = db.get('users').value();
  const orders = ordersRaw.map(o => ({ ...o, user: users.find(u => u.id === o.userId) }));
  res.render('admin/orders', {
    title: 'Kelola Order - AlexCloud Admin',
    user: req.user, orders, moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

router.post('/orders/:id/confirm', ensureAdmin, (req, res) => {
  const order = db.get('orders').find({ id: req.params.id }).value();
  if (!order) { req.flash('error', 'Order tidak ditemukan.'); return res.redirect('/admin/orders'); }
  const plans = getPlans();
  const plan = plans.find(p => p.id === order.planId);
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + (plan ? plan.duration : 30));
  db.get('orders').find({ id: order.id }).assign({
    status: 'confirmed', paidAt: now.toISOString(), activatedAt: now.toISOString()
  }).write();
  const existingSub = db.get('subscriptions').find({ userId: order.userId, status: 'active' }).value();
  if (existingSub) {
    db.get('subscriptions').find({ id: existingSub.id }).assign({
      status: 'expired', expiredAt: now.toISOString()
    }).write();
  }
  db.get('subscriptions').push({
    id: uuidv4(), userId: order.userId, orderId: order.id,
    planId: order.planId, planName: plan ? plan.name : order.planName,
    status: 'active', startedAt: now.toISOString(), expiresAt: expiresAt.toISOString()
  }).write();
  db.get('users').find({ id: order.userId }).assign({ isActive: true }).write();
  req.flash('success', `Order #${order.orderId} dikonfirmasi. Subscription aktif sampai ${moment(expiresAt).format('DD MMM YYYY')}.`);
  res.redirect('/admin/orders');
});

router.post('/orders/:id/reject', ensureAdmin, (req, res) => {
  db.get('orders').find({ id: req.params.id }).assign({ status: 'rejected' }).write();
  req.flash('success', 'Order ditolak.');
  res.redirect('/admin/orders');
});

// =====================
// USERS
// =====================
router.get('/users', ensureAdmin, (req, res) => {
  const users = db.get('users').sortBy('createdAt').reverse().value();
  res.render('admin/users', {
    title: 'Kelola User - AlexCloud Admin',
    user: req.user, users, moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

router.post('/users/:id/toggle', ensureAdmin, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) { req.flash('error', 'User tidak ditemukan.'); return res.redirect('/admin/users'); }
  db.get('users').find({ id: target.id }).assign({ isActive: !target.isActive }).write();
  req.flash('success', `User ${target.name} ${!target.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`);
  res.redirect('/admin/users');
});

router.post('/users/:id/ban', ensureAdmin, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) { req.flash('error', 'User tidak ditemukan.'); return res.redirect('/admin/users'); }
  db.get('users').find({ id: target.id }).assign({ isBanned: true, isActive: false }).write();
  req.flash('success', `User ${target.name} berhasil di-ban.`);
  res.redirect('/admin/users');
});

router.post('/users/:id/unban', ensureAdmin, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) { req.flash('error', 'User tidak ditemukan.'); return res.redirect('/admin/users'); }
  db.get('users').find({ id: target.id }).assign({ isBanned: false }).write();
  req.flash('success', `User ${target.name} berhasil di-unban.`);
  res.redirect('/admin/users');
});

router.post('/users/:id/reset-password', ensureAdmin, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) { req.flash('error', 'User tidak ditemukan.'); return res.redirect('/admin/users'); }
  if (target.googleId && !target.password) {
    req.flash('error', 'User ini login via Google, tidak bisa reset password manual.');
    return res.redirect('/admin/users');
  }
  const newPass = 'Alex' + Math.random().toString(36).slice(-6).toUpperCase();
  const hashed = bcrypt.hashSync(newPass, 10);
  db.get('users').find({ id: target.id }).assign({ password: hashed }).write();
  req.flash('success', `🔑 Password ${target.name} direset → <strong>${newPass}</strong> (sampaikan ke user via WA)`);
  res.redirect('/admin/users');
});

// =====================
// GAMES MANAGEMENT (dengan halaman produk lengkap)
// =====================
router.get('/games', ensureAdmin, (req, res) => {
  const games = db.get('games').value();
  res.render('admin/games', {
    title: 'Kelola Game - AlexCloud Admin',
    user: req.user, games,
    success: req.flash('success'), error: req.flash('error')
  });
});

// GET — halaman detail/edit game (produk)
router.get('/games/:id/edit', ensureAdmin, (req, res) => {
  const game = db.get('games').find({ id: req.params.id }).value();
  if (!game) { req.flash('error', 'Game tidak ditemukan.'); return res.redirect('/admin/games'); }
  res.render('admin/game-edit', {
    title: `Edit: ${game.name} - AlexCloud Admin`,
    user: req.user, game,
    success: req.flash('success'), error: req.flash('error')
  });
});

// Add game
router.post('/games', ensureAdmin, (req, res) => {
  const { name, genre, description, image, rating, tag, popular, developer, releaseYear, platform, detailDesc, minRequirements } = req.body;
  if (!name || !genre) { req.flash('error', 'Nama dan genre wajib diisi.'); return res.redirect('/admin/games'); }
  db.get('games').push({
    id: uuidv4(),
    name, genre,
    description: description || '',
    detailDesc: detailDesc || '',
    image: image || `https://placehold.co/600x340/0d1428/00d4ff?text=${encodeURIComponent(name)}&font=montserrat`,
    screenshots: [],
    rating: parseFloat(rating) || 4.5,
    popular: popular === 'on',
    new: true,
    tag: tag || 'NEW',
    developer: developer || 'Unknown Developer',
    releaseYear: releaseYear || new Date().getFullYear().toString(),
    platform: platform || 'Cloud Gaming',
    minRequirements: minRequirements || 'Browser modern + koneksi 10 Mbps',
    createdAt: new Date().toISOString()
  }).write();
  req.flash('success', `Game "${name}" berhasil ditambahkan.`);
  res.redirect('/admin/games');
});

// Edit game — dari tabel (quick edit)
router.post('/games/:id/edit', ensureAdmin, (req, res) => {
  const { name, genre, description, image, rating, tag, popular,
    developer, releaseYear, platform, detailDesc, minRequirements,
    screenshotUrls } = req.body;
  const game = db.get('games').find({ id: req.params.id }).value();
  if (!game) { req.flash('error', 'Game tidak ditemukan.'); return res.redirect('/admin/games'); }

  // Handle multiple screenshot URLs
  let screenshots = game.screenshots || [];
  if (screenshotUrls) {
    const urls = Array.isArray(screenshotUrls)
      ? screenshotUrls.filter(u => u.trim())
      : [screenshotUrls].filter(u => u.trim());
    if (urls.length > 0) screenshots = urls;
  }

  db.get('games').find({ id: req.params.id }).assign({
    name: name || game.name,
    genre: genre || game.genre,
    description: description !== undefined ? description : game.description,
    detailDesc: detailDesc !== undefined ? detailDesc : (game.detailDesc || ''),
    image: image || game.image,
    screenshots,
    rating: parseFloat(rating) || game.rating,
    tag: tag || game.tag,
    popular: popular === 'on',
    developer: developer || game.developer || '',
    releaseYear: releaseYear || game.releaseYear || '',
    platform: platform || game.platform || '',
    minRequirements: minRequirements || game.minRequirements || ''
  }).write();
  req.flash('success', `Game "${name || game.name}" berhasil diperbarui.`);

  // Redirect back ke halaman edit jika dari sana, ke /admin/games jika dari modal
  const referer = req.get('Referer') || '';
  if (referer.includes('/edit')) {
    return res.redirect(`/admin/games/${req.params.id}/edit`);
  }
  res.redirect('/admin/games');
});

// Delete game
router.post('/games/:id/delete', ensureAdmin, (req, res) => {
  db.get('games').remove({ id: req.params.id }).write();
  req.flash('success', 'Game berhasil dihapus.');
  res.redirect('/admin/games');
});

// =====================
// SUBSCRIPTIONS
// =====================
router.get('/subscriptions', ensureAdmin, (req, res) => {
  const subs = db.get('subscriptions').sortBy('startedAt').reverse().value();
  const users = db.get('users').value();
  const subsWithUser = subs.map(s => ({ ...s, user: users.find(u => u.id === s.userId) }));
  res.render('admin/subscriptions', {
    title: 'Subscriptions - AlexCloud Admin',
    user: req.user, subscriptions: subsWithUser, moment
  });
});

// =====================
// PROMO CODES
// =====================
router.get('/promo', ensureAdmin, (req, res) => {
  const promoCodes = db.get('promoCodes').sortBy('createdAt').reverse().value();
  res.render('admin/promo', {
    title: 'Kelola Promo - AlexCloud Admin',
    user: req.user, promoCodes, moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

router.post('/promo', ensureAdmin, (req, res) => {
  const { code, discountType, discountValue, maxUses, expiresAt, description } = req.body;
  if (!code || !discountType || !discountValue) {
    req.flash('error', 'Kode, tipe, dan nilai diskon wajib diisi.');
    return res.redirect('/admin/promo');
  }
  const existing = db.get('promoCodes').find({ code: code.toUpperCase() }).value();
  if (existing) { req.flash('error', 'Kode promo sudah ada.'); return res.redirect('/admin/promo'); }
  db.get('promoCodes').push({
    id: uuidv4(),
    code: code.toUpperCase(),
    discountType, discountValue: parseFloat(discountValue),
    maxUses: maxUses ? parseInt(maxUses) : null,
    usedCount: 0,
    expiresAt: expiresAt || null,
    description: description || '',
    isActive: true,
    createdAt: new Date().toISOString()
  }).write();
  req.flash('success', `Kode promo "${code.toUpperCase()}" berhasil dibuat!`);
  res.redirect('/admin/promo');
});

router.post('/promo/:id/toggle', ensureAdmin, (req, res) => {
  const promo = db.get('promoCodes').find({ id: req.params.id }).value();
  if (!promo) { req.flash('error', 'Promo tidak ditemukan.'); return res.redirect('/admin/promo'); }
  db.get('promoCodes').find({ id: req.params.id }).assign({ isActive: !promo.isActive }).write();
  req.flash('success', `Promo "${promo.code}" ${!promo.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`);
  res.redirect('/admin/promo');
});

router.post('/promo/:id/delete', ensureAdmin, (req, res) => {
  db.get('promoCodes').remove({ id: req.params.id }).write();
  req.flash('success', 'Promo berhasil dihapus.');
  res.redirect('/admin/promo');
});

// =====================
// PLANS / HARGA
// =====================
router.get('/plans', ensureAdmin, (req, res) => {
  const plans = db.get('plans').value();
  res.render('admin/plans', {
    title: 'Kelola Harga Paket - AlexCloud Admin',
    user: req.user, plans,
    success: req.flash('success'), error: req.flash('error')
  });
});

router.post('/plans/:id/edit', ensureAdmin, (req, res) => {
  const { name, price, duration, popular } = req.body;
  const plan = db.get('plans').find({ id: req.params.id }).value();
  if (!plan) { req.flash('error', 'Paket tidak ditemukan.'); return res.redirect('/admin/plans'); }
  const priceNum = parseInt(price) || plan.price;
  db.get('plans').find({ id: req.params.id }).assign({
    name: name || plan.name,
    price: priceNum,
    priceDisplay: 'Rp ' + priceNum.toLocaleString('id-ID'),
    duration: parseInt(duration) || plan.duration,
    popular: popular === 'on'
  }).write();
  req.flash('success', `Paket "${name}" berhasil diperbarui.`);
  res.redirect('/admin/plans');
});

// =====================
// TESTIMONIALS — dengan upload PNG langsung
// =====================
router.get('/testimonials', ensureAdmin, (req, res) => {
  const testimonials = db.get('testimonials').sortBy('createdAt').reverse().value();
  res.render('admin/testimonials', {
    title: 'Kelola Testimoni - AlexCloud Admin',
    user: req.user, testimonials, moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

// POST tambah testimoni — support upload PNG atau URL
router.post('/testimonials', ensureAdmin, (req, res) => {
  testiUpload.single('imageFile')(req, res, function (err) {
    if (err) {
      console.error('[Upload Error]', err);
      let msg = err.message || 'Terjadi kesalahan saat mengunggah';
      if (msg.includes('unauthorized') || msg.includes('Access Denied')) {
        msg = 'Akses Ditolak ke Cloudinary. Silakan periksa apakah CLOUDINARY_URL Anda sudah benar.';
      }
      req.flash('error', `Gagal mengunggah gambar: ${msg}`);
      return res.redirect('/admin/testimonials');
    }

    const { name, role, text, rating, imageUrl, avatar } = req.body;
    if (!name || !text) {
      req.flash('error', 'Nama dan teks testimoni wajib diisi.');
      return res.redirect('/admin/testimonials');
    }

    // Prioritas: file upload > URL manual
    let finalImage = null;
    if (req.file) {
      finalImage = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    } else if (imageUrl && imageUrl.trim()) {
      finalImage = imageUrl.trim();
    }

    db.get('testimonials').push({
      id: uuidv4(),
      name,
      role: role || 'Gamer',
      text,
      rating: parseInt(rating) || 5,
      image: finalImage,
      avatar: avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
      createdAt: new Date().toISOString(),
      approved: true
    }).write();
    req.flash('success', `Testimoni dari "${name}" berhasil ditambahkan!`);
    res.redirect('/admin/testimonials');
  });
});

// Toggle testimoni tampil/hidden
router.post('/testimonials/:id/toggle', ensureAdmin, (req, res) => {
  const testi = db.get('testimonials').find({ id: req.params.id }).value();
  if (!testi) { req.flash('error', 'Testimoni tidak ditemukan.'); return res.redirect('/admin/testimonials'); }
  db.get('testimonials').find({ id: req.params.id }).assign({ approved: !testi.approved }).write();
  req.flash('success', `Testimoni ${!testi.approved ? 'ditampilkan' : 'disembunyikan'}.`);
  res.redirect('/admin/testimonials');
});

// Hapus testimoni + hapus file upload jika ada
router.post('/testimonials/:id/delete', ensureAdmin, (req, res) => {
  const testi = db.get('testimonials').find({ id: req.params.id }).value();
  if (testi && testi.image && testi.image.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '../public', testi.image);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
    }
  }
  db.get('testimonials').remove({ id: req.params.id }).write();
  req.flash('success', 'Testimoni berhasil dihapus.');
  res.redirect('/admin/testimonials');
});

// Edit testimoni — tampilkan form
router.get('/testimonials/:id/edit', ensureAdmin, (req, res) => {
  const testi = db.get('testimonials').find({ id: req.params.id }).value();
  if (!testi) { req.flash('error', 'Testimoni tidak ditemukan.'); return res.redirect('/admin/testimonials'); }
  res.render('admin/testimonials-edit', {
    title: 'Edit Testimoni - AlexCloud Admin',
    user: req.user, testi,
    success: req.flash('success'), error: req.flash('error')
  });
});

// Edit testimoni — simpan perubahan
router.post('/testimonials/:id/edit', ensureAdmin, (req, res) => {
  const testi = db.get('testimonials').find({ id: req.params.id }).value();
  if (!testi) { req.flash('error', 'Testimoni tidak ditemukan.'); return res.redirect('/admin/testimonials'); }

  testiUpload.single('imageFile')(req, res, function (err) {
    if (err) {
      console.error('[Upload Edit Error]', err);
      let msg = err.message || 'Terjadi kesalahan saat mengunggah';
      if (msg.includes('unauthorized') || msg.includes('Access Denied')) {
        msg = 'Akses Ditolak ke Cloudinary. Silakan periksa apakah CLOUDINARY_URL Anda sudah benar.';
      }
      req.flash('error', `Gagal mengunggah gambar: ${msg}`);
      return res.redirect(`/admin/testimonials/${req.params.id}/edit`);
    }

    const { name, role, text, rating, imageUrl, avatar } = req.body;
    if (!name || !text) {
      req.flash('error', 'Nama dan teks testimoni wajib diisi.');
      return res.redirect(`/admin/testimonials/${req.params.id}/edit`);
    }

    // Gambar: file baru > URL baru > gambar lama
    let finalImage = testi.image;
    if (req.file) {
      // Hapus file lama jika ada
      if (testi.image && testi.image.startsWith('/uploads/')) {
        const oldPath = path.join(__dirname, '../public', testi.image);
        try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (e) {}
      }
      finalImage = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    } else if (imageUrl && imageUrl.trim()) {
      finalImage = imageUrl.trim();
    }

    db.get('testimonials').find({ id: req.params.id }).assign({
      name: name.trim(),
      role: role || 'Gamer',
      text: text.trim(),
      rating: parseInt(rating) || 5,
      image: finalImage,
      avatar: avatar || testi.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
      updatedAt: new Date().toISOString()
    }).write();

    req.flash('success', `Testimoni dari "${name}" berhasil diperbarui!`);
    res.redirect('/admin/testimonials');
  });
});

module.exports = router;
