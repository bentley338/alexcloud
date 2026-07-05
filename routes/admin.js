const express = require('express');
const router = express.Router();
const { db, getPlans, getGames, invalidatePlansCache, invalidateGamesCache,
  getWallet, getBalance, getWalletConfig, applyWalletTx, getUserWalletTx, fulfillTopupOrder } = require('../database/db');
const { ensureAdmin } = require('../middleware/auth');
const { isJunkTestimonial, normalizeTestimonial } = require('../utils/helpers');
const { rewardReferrerOnFirstOrder, getReferralConfig, setReferralConfig } = require('../utils/referral');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// =====================
// MULTER STORAGE SETUP — Disk Storage (saves images as physical files, not base64)
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

// =====================
// ADMIN DASHBOARD
// =====================
router.get('/', ensureAdmin, (req, res) => {
  const users = db.get('users').value();
  const orders = db.get('orders').value();
  const subscriptions = db.get('subscriptions').value();
  const games = getGames();
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
// SIMULATE ORDER
// =====================
router.get('/simulate-order', ensureAdmin, (req, res) => {
  const users = db.get('users').value().filter(u => u.role !== 'admin');
  const plans = getPlans();
  res.render('admin/simulate-order', {
    title: 'Simulasi Order - AlexCloud',
    user: req.user,
    users,
    plans
  });
});

router.post('/simulate-order', ensureAdmin, (req, res) => {
  const { userId, planId } = req.body;
  const targetUser = db.get('users').find({ id: userId }).value();
  if (!targetUser) { req.flash('error', 'User tidak ditemukan.'); return res.redirect('/admin/simulate-order'); }
  
  const plans = getPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) { req.flash('error', 'Paket tidak valid.'); return res.redirect('/admin/simulate-order'); }

  const orderId = 'AC-SIM-' + Date.now().toString().slice(-8).toUpperCase();
  const actualPrice = plan.price;
  const now = new Date();

  // Save order directly as confirmed
  const order = {
    id: uuidv4(),
    orderId,
    userId: targetUser.id,
    userName: targetUser.name,
    userEmail: targetUser.email,
    planId: plan.id,
    planName: plan.name,
    price: actualPrice,
    originalPrice: plan.price,
    discount: 0,
    promoCode: null,
    status: 'confirmed',
    createdAt: now.toISOString(),
    paidAt: now.toISOString(),
    activatedAt: now.toISOString(),
    paymentMethod: 'manual_simulasi'
  };

  db.get('orders').push(order).write();

  // Create or Update Subscription
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + (plan.duration || 30));

  const existingSub = db.get('subscriptions').find({ userId: targetUser.id, status: 'active' }).value();
  if (existingSub) {
    db.get('subscriptions').find({ id: existingSub.id }).assign({
      status: 'expired', expiredAt: now.toISOString()
    }).write();
  }
  db.get('subscriptions').push({
    id: uuidv4(), userId: targetUser.id, orderId: order.id,
    planId: plan.id, planName: plan.name,
    status: 'active', startedAt: now.toISOString(), expiresAt: expiresAt.toISOString()
  }).write();

  db.get('users').find({ id: targetUser.id }).assign({ isActive: true }).write();

  // Confirm hook referral (idempoten): simulasi = order pertama yang confirmed juga cairkan reward.
  const reward = rewardReferrerOnFirstOrder(order);

  let msg = `Simulasi Order #${orderId} berhasil untuk user ${targetUser.name}.`;
  if (reward) {
    msg += ` 🎁 Reward referral untuk ${reward.referrerName} diterbitkan (Saldo Rp ${reward.bonusAmount.toLocaleString('id-ID')}).`;
  }
  req.flash('success', msg);
  res.redirect('/admin/orders');
});

// =====================
// ORDER MANAGEMENT
// =====================
router.get('/orders', ensureAdmin, (req, res) => {
  const ordersRaw = db.get('orders').sortBy('createdAt').reverse().value();
  const users = db.get('users').value();
  // Build a user lookup map for O(1) access instead of O(n) .find() per order
  const userMap = new Map(users.map(u => [u.id, u]));
  const orders = ordersRaw.map(o => ({ ...o, user: userMap.get(o.userId) }));
  res.render('admin/orders', {
    title: 'Kelola Order - AlexCloud Admin',
    user: req.user, orders, moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

router.post('/orders/:id/confirm', ensureAdmin, (req, res) => {
  const order = db.get('orders').find({ id: req.params.id }).value();
  if (!order) { req.flash('error', 'Order tidak ditemukan.'); return res.redirect('/admin/orders'); }
  if (order.status !== 'pending') { req.flash('error', 'Order sudah diproses.'); return res.redirect('/admin/orders'); }

  // ─── Order TOP-UP: kreditkan saldo, JANGAN buat subscription ────────────────
  if ((order.orderType || 'subscription') === 'topup') {
    const now = new Date();
    db.get('orders').find({ id: order.id }).assign({
      status: 'confirmed', paidAt: now.toISOString(), activatedAt: now.toISOString()
    }).write();
    const result = fulfillTopupOrder(order.id, { createdBy: 'admin:' + req.user.name });

    let msg = `Top-up #${order.orderId} dikonfirmasi.`;
    if (result.credited) {
      msg += ` Saldo masuk Rp ${((result.amount || 0) + (result.bonus || 0)).toLocaleString('id-ID')}` +
             (result.bonus ? ` (termasuk bonus Rp ${result.bonus.toLocaleString('id-ID')})` : '') +
             `. Saldo user sekarang Rp ${(result.balanceAfter || 0).toLocaleString('id-ID')}.`;
    } else {
      msg += ` (Saldo tidak dikreditkan: ${result.reason}).`;
    }
    try {
      const { sendWhatsAppNotification } = require('../utils/whatsapp');
      sendWhatsAppNotification(
        `✅ *TOP-UP DIKONFIRMASI ADMIN*\n\n📋 #${order.orderId}\n👤 ${order.userName} (${order.userEmail})\n` +
        `💰 Nominal: Rp ${(order.topupAmount || order.price).toLocaleString('id-ID')}` +
        (result.bonus ? `\n🎁 Bonus: Rp ${result.bonus.toLocaleString('id-ID')}` : '') +
        `\n🏦 Saldo Sekarang: Rp ${(result.balanceAfter || 0).toLocaleString('id-ID')}`
      ).catch(err => console.error('[WA NOTIF TOPUP CONFIRM]', err.message));
    } catch (err) { console.error('[WA NOTIF TOPUP CONFIRM EX]', err.message); }

    req.flash('success', msg);
    return res.redirect('/admin/orders');
  }

  const plans = getPlans();
  const plan = plans.find(p => p.id === order.planId);
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + (plan ? plan.duration : 30));
  db.get('orders').find({ id: order.id }).assign({
    status: 'confirmed', paidAt: now.toISOString(), activatedAt: now.toISOString()
  }).write();

  // Burn promo code
  if (order.promoCode) {
    const promo = db.get('promoCodes').find({ code: order.promoCode.toUpperCase() }).value();
    if (promo) {
      db.get('promoCodes').find({ id: promo.id }).assign({ usedCount: (promo.usedCount || 0) + 1 }).write();
    }
  }
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

  // Order "saldo + kurang top-up": potong saldo yang dipakai (sekali saja) saat dikonfirmasi.
  if (order.walletApplied > 0 && !order.walletDebited) {
    try {
      db.get('orders').find({ id: order.id }).assign({ walletDebited: true }).write();
      applyWalletTx(order.userId, {
        type: 'purchase', amount: order.walletApplied, refType: 'order', refId: order.orderId,
        note: `Potong saldo untuk paket ${order.planName} #${order.orderId}`,
        createdBy: 'admin:' + req.user.name, allowNegative: true
      });
    } catch (e) { console.error('[WALLET DEBIT ON ADMIN CONFIRM]', e.message); }
  }

  // Confirm hook referral: order pertama yang di-confirm → cairkan reward pengajak (idempoten).
  const reward = rewardReferrerOnFirstOrder(order);

  let msg = `Order #${order.orderId} dikonfirmasi. Subscription aktif sampai ${moment(expiresAt).format('DD MMM YYYY')}.`;
  if (reward) {
    msg += ` 🎁 Reward referral untuk ${reward.referrerName} diterbitkan (Saldo Rp ${reward.bonusAmount.toLocaleString('id-ID')}).`;
  }

  // Kirim notifikasi ke owner via WhatsApp
  try {
    const { sendWhatsAppNotification } = require('../utils/whatsapp');
    let notifMsg = `✅ *MANUAL ORDER DIKONFIRMASI OLEH ADMIN* ✅\n\n` +
      `📋 Order ID: *#${order.orderId}*\n` +
      `👤 Pembeli: ${order.userName} (${order.userEmail})\n` +
      `📦 Paket: *${plan ? plan.name : order.planName}*\n` +
      `💰 Nominal: Rp ${order.price.toLocaleString('id-ID')}\n` +
      `📅 Expired: ${moment(expiresAt).format('DD MMM YYYY')}`;
    
    if (reward) {
      notifMsg += `\n\n🎁 *Referral Reward Cair!* Pengajak (${reward.referrerName}) mendapat tambahan saldo Rp ${reward.bonusAmount.toLocaleString('id-ID')}.`;
    }
    
    sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF CONFIRM ERROR]', err.message));
  } catch (err) {
    console.error('[WA NOTIF CONFIRM EXCEPTION]', err.message);
  }

  req.flash('success', msg);
  res.redirect('/admin/orders');
});

router.post('/orders/:id/reject', ensureAdmin, (req, res) => {
  const order = db.get('orders').find({ id: req.params.id }).value();
  db.get('orders').find({ id: req.params.id }).assign({ status: 'rejected' }).write();

  // Kirim notifikasi ke owner via WhatsApp
  if (order) {
    try {
      const { sendWhatsAppNotification } = require('../utils/whatsapp');
      const notifMsg = `❌ *MANUAL ORDER DITOLAK OLEH ADMIN* ❌\n\n` +
        `📋 Order ID: *#${order.orderId}*\n` +
        `👤 Pembeli: ${order.userName} (${order.userEmail})\n` +
        `📦 Paket: *${order.planName}*\n` +
        `💰 Nominal: Rp ${order.price.toLocaleString('id-ID')}`;
      sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF REJECT ERROR]', err.message));
    } catch (err) {
      console.error('[WA NOTIF REJECT EXCEPTION]', err.message);
    }
  }

  req.flash('success', 'Order ditolak.');
  res.redirect('/admin/orders');
});

// =====================
// SIMULASI REFERRAL > 100K
// =====================
router.get('/simulate-referral', ensureAdmin, (req, res) => {
  const admin = req.user;
  if (!admin.referralCode) {
    admin.referralCode = 'SIMULASI123';
  }

  const { v4: uuidv4 } = require('uuid');
  const friendId = uuidv4();
  db.get('users').push({
    id: friendId,
    name: 'Teman Simulasi',
    email: 'teman_simulasi@example.com',
    password: 'xxx',
    role: 'user',
    isActive: true,
    referredBy: admin.id,
    signupIp: '192.168.9.9'
  }).write();

  const refId = uuidv4();
  db.get('referrals').push({
    id: refId,
    referrerId: admin.id,
    referredUserId: friendId,
    referredName: 'Teman Simulasi',
    signupIp: '192.168.9.9',
    orderId: null,
    status: 'pending',
    reason: null,
    welcomeCode: 'WELCOME-SIMU',
    rewardCode: null,
    createdAt: new Date().toISOString(),
    rewardedAt: null
  }).write();

  const orderId = 'AC' + Date.now().toString().slice(-8).toUpperCase();
  db.get('orders').push({
    id: uuidv4(),
    orderId: orderId,
    userId: friendId,
    userName: 'Teman Simulasi',
    userEmail: 'teman_simulasi@example.com',
    planId: 'monthly_1',
    planName: 'Cloud PC Bulanan (Simulasi > 100k)',
    price: 125000,
    originalPrice: 125000,
    discount: 0,
    status: 'pending',
    qrisStatus: 'awaiting_method',
    payMethodType: 'qris',
    gateway: 'mustikapay',
    createdAt: new Date().toISOString()
  }).write();

  req.flash('success', 'Order simulasi (Rp 125.000) dari Teman Simulasi berhasil dibuat! Silakan cari order ' + orderId + ' di bawah ini dan klik Confirm untuk memicu bonus referral.');
  res.redirect('/admin/orders');
});

// =====================
// SITE ANNOUNCEMENT BANNER
// =====================
router.get('/announcement', ensureAdmin, (req, res) => {
  const settings = db.get('settings').value() || {};
  res.render('admin/announcement', {
    title: 'Pengumuman Situs - AlexCloud Admin',
    user: req.user,
    announcement: settings.announcement || {},
    success: req.flash('success'), error: req.flash('error')
  });
});

router.post('/announcement', ensureAdmin, (req, res) => {
  const { enabled, type, text, link, linkText } = req.body;
  const cleanText = (text || '').trim();

  if (enabled && !cleanText) {
    req.flash('error', 'Teks pengumuman wajib diisi jika ingin diaktifkan.');
    return res.redirect('/admin/announcement');
  }

  db.get('settings').assign({
    announcement: {
      enabled: !!enabled,
      type: ['info', 'promo', 'warn'].includes(type) ? type : 'info',
      text: cleanText,
      link: (link || '').trim(),
      linkText: (linkText || '').trim(),
      // Bump the id on every save so dismissed banners reappear for users when content changes
      id: 'ann' + Date.now().toString(36),
      updatedAt: new Date().toISOString()
    }
  }).write();

  req.flash('success', `Pengumuman berhasil ${enabled ? 'diaktifkan' : 'disimpan & dinonaktifkan'}.`);
  res.redirect('/admin/announcement');
});

// =====================
// WHATSAPP NOTIFICATION SETTINGS
// =====================
router.get('/settings/whatsapp', ensureAdmin, (req, res) => {
  const settings = db.get('settings').value() || {};
  res.render('admin/settings-whatsapp', {
    title: 'Setelan WhatsApp - AlexCloud Admin',
    user: req.user,
    settings,
    success: req.flash('success'),
    error: req.flash('error')
  });
});

router.post('/settings/whatsapp', ensureAdmin, (req, res) => {
  const { whatsappEnabled, whatsappProvider, whatsappPhone, whatsappApiKey, twilioAccountSid, twilioAuthToken, twilioSandboxNumber, botWaUrl } = req.body;
  
  db.get('settings').assign({
    whatsappEnabled: !!whatsappEnabled,
    whatsappProvider: whatsappProvider || 'callmebot',
    whatsappPhone: whatsappPhone ? whatsappPhone.trim() : '',
    whatsappApiKey: whatsappApiKey ? whatsappApiKey.trim() : '',
    twilioAccountSid: twilioAccountSid ? twilioAccountSid.trim() : '',
    twilioAuthToken: twilioAuthToken ? twilioAuthToken.trim() : '',
    twilioSandboxNumber: twilioSandboxNumber ? twilioSandboxNumber.trim() : '',
    botWaUrl: botWaUrl ? botWaUrl.trim() : ''
  }).write();
  
  req.flash('success', 'Setelan notifikasi WhatsApp berhasil disimpan.');
  res.redirect('/admin/settings/whatsapp');
});

router.post('/settings/test-whatsapp', ensureAdmin, async (req, res) => {
  const { testMessage } = req.body;
  const { sendWhatsAppNotification } = require('../utils/whatsapp');
  
  try {
    const result = await sendWhatsAppNotification(testMessage, true);
    if (result.success) {
      req.flash('success', 'Pesan tes WhatsApp berhasil terkirim ke nomor Anda!');
    } else {
      req.flash('error', `Gagal mengirim pesan tes: ${result.reason || result.body || 'Unknown error'}`);
    }
  } catch (err) {
    req.flash('error', `Terjadi kesalahan saat memanggil API: ${err.message}`);
  }
  
  res.redirect('/admin/settings/whatsapp');
});

router.post('/settings/telegram', ensureAdmin, (req, res) => {
  const { telegramEnabled, telegramBotToken, telegramChatId } = req.body;
  
  db.get('settings').assign({
    telegramEnabled: !!telegramEnabled,
    telegramBotToken: telegramBotToken ? telegramBotToken.trim() : '',
    telegramChatId: telegramChatId ? telegramChatId.trim() : ''
  }).write();
  
  req.flash('success', 'Setelan notifikasi Telegram berhasil disimpan.');
  res.redirect('/admin/settings/whatsapp');
});

router.post('/settings/test-telegram', ensureAdmin, async (req, res) => {
  const { testMessage } = req.body;
  const { sendTelegramNotification } = require('../utils/telegram');
  
  try {
    const result = await sendTelegramNotification(testMessage);
    if (result.success) {
      req.flash('success', 'Pesan tes Telegram berhasil terkirim ke bot Anda!');
    } else {
      req.flash('error', `Gagal mengirim pesan tes Telegram: ${result.reason || result.body || 'Unknown error'}`);
    }
  } catch (err) {
    req.flash('error', `Terjadi kesalahan saat memanggil API Telegram: ${err.message}`);
  }
  
  res.redirect('/admin/settings/whatsapp');
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
  req.flash('success', `🔑 Password ${target.name} direset → ${newPass} (sampaikan ke user via WA)`);
  res.redirect('/admin/users');
});

// =====================
// GAMES MANAGEMENT (dengan halaman produk lengkap)
// =====================
router.get('/games', ensureAdmin, (req, res) => {
  const games = getGames();
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
function optimizeImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http')) return trimmed; // Base64 or local path, leave it

  // If already optimized by Cloudinary or weserv, don't wrap it again
  if (trimmed.includes('res.cloudinary.com') || trimmed.includes('wsrv.nl')) {
    return trimmed;
  }

  // Check if Cloudinary is configured
  let cloudName = null;
  if (process.env.CLOUDINARY_URL) {
    const match = process.env.CLOUDINARY_URL.trim().match(/@([^@/]+)$/);
    if (match) cloudName = match[1];
  }

  if (cloudName) {
    // Cloudinary Fetch API with auto quality, format, and max width 800px
    return `https://res.cloudinary.com/${cloudName}/image/fetch/q_auto,f_auto,w_800,c_limit/${trimmed}`;
  } else {
    // Highly reliable, free, open-source image CDN (wsrv.nl) with WebP output, 75% quality, 800px width
    return `https://wsrv.nl/?url=${encodeURIComponent(trimmed)}&w=800&output=webp&q=75`;
  }
}

router.post('/games', ensureAdmin, (req, res) => {
  const { name, genre, description, image, rating, tag, popular, developer, releaseYear, platform, detailDesc, minRequirements } = req.body;
  if (!name || !genre) { req.flash('error', 'Nama dan genre wajib diisi.'); return res.redirect('/admin/games'); }

  let finalImage = image ? image.trim() : '';
  if (finalImage) {
    finalImage = optimizeImageUrl(finalImage);
  } else {
    finalImage = `https://placehold.co/600x900/0d1428/00d4ff?text=${encodeURIComponent(name)}&font=montserrat`;
  }

  db.get('games').push({
    id: uuidv4(),
    name, genre,
    description: description || '',
    detailDesc: detailDesc || '',
    image: finalImage,
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
  invalidateGamesCache();
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
    if (urls.length > 0) screenshots = urls.map(optimizeImageUrl);
  }

  let finalImage = image ? image.trim() : '';
  if (finalImage) {
    finalImage = optimizeImageUrl(finalImage);
  } else {
    finalImage = game.image;
  }

  db.get('games').find({ id: req.params.id }).assign({
    name: name || game.name,
    genre: genre || game.genre,
    description: description !== undefined ? description : game.description,
    detailDesc: detailDesc !== undefined ? detailDesc : (game.detailDesc || ''),
    image: finalImage,
    screenshots,
    rating: parseFloat(rating) || game.rating,
    tag: tag || game.tag,
    popular: popular === 'on',
    developer: developer || game.developer || '',
    releaseYear: releaseYear || game.releaseYear || '',
    platform: platform || game.platform || '',
    minRequirements: minRequirements || game.minRequirements || ''
  }).write();
  invalidateGamesCache();
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
  invalidateGamesCache();
  req.flash('success', 'Game berhasil dihapus.');
  res.redirect('/admin/games');
});

// =====================
// SUBSCRIPTIONS
// =====================
router.get('/subscriptions', ensureAdmin, (req, res) => {
  const subs = db.get('subscriptions').sortBy('startedAt').reverse().value();
  const users = db.get('users').value();
  // Build a user lookup map for O(1) access instead of O(n) .find() per subscription
  const userMap = new Map(users.map(u => [u.id, u]));
  const subsWithUser = subs.map(s => ({ ...s, user: userMap.get(s.userId) }));
  res.render('admin/subscriptions', {
    title: 'Subscriptions - AlexCloud Admin',
    user: req.user, subscriptions: subsWithUser, moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

// Perpanjang (atau aktifkan kembali) subscription sebanyak N hari
router.post('/subscriptions/:id/extend', ensureAdmin, (req, res) => {
  const sub = db.get('subscriptions').find({ id: req.params.id }).value();
  if (!sub) { req.flash('error', 'Subscription tidak ditemukan.'); return res.redirect('/admin/subscriptions'); }

  const days = parseInt(req.body.days, 10);
  if (!days || days <= 0) { req.flash('error', 'Jumlah hari tidak valid.'); return res.redirect('/admin/subscriptions'); }

  // Perpanjang dari tanggal berakhir saat ini, atau dari sekarang jika sudah lewat
  const now = new Date();
  const base = new Date(sub.expiresAt) > now ? new Date(sub.expiresAt) : now;
  base.setDate(base.getDate() + days);

  db.get('subscriptions').find({ id: sub.id }).assign({
    expiresAt: base.toISOString(),
    status: 'active'
  }).write();
  db.get('users').find({ id: sub.userId }).assign({ isActive: true }).write();

  req.flash('success', `Subscription diperpanjang ${days} hari → berakhir ${moment(base).format('DD MMM YYYY')}.`);
  res.redirect('/admin/subscriptions');
});

// Cabut / nonaktifkan subscription
router.post('/subscriptions/:id/revoke', ensureAdmin, (req, res) => {
  const sub = db.get('subscriptions').find({ id: req.params.id }).value();
  if (!sub) { req.flash('error', 'Subscription tidak ditemukan.'); return res.redirect('/admin/subscriptions'); }

  db.get('subscriptions').find({ id: sub.id }).assign({
    status: 'expired',
    expiredAt: new Date().toISOString()
  }).write();

  // Nonaktifkan user hanya jika tidak punya subscription aktif lain
  const stillActive = db.get('subscriptions').find({ userId: sub.userId, status: 'active' }).value();
  if (!stillActive) {
    db.get('users').find({ id: sub.userId }).assign({ isActive: false }).write();
  }

  req.flash('success', 'Subscription berhasil dicabut.');
  res.redirect('/admin/subscriptions');
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
  const { code, discountType, discountValue, maxUses, minPurchase, expiresAt, description } = req.body;
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
    minPurchase: minPurchase ? parseInt(minPurchase) : null,
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
  db.get('promoCodes').find({ id: promo.id }).assign({ isActive: !promo.isActive }).write();
  req.flash('success', `Promo "${promo.code}" ${!promo.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`);
  res.redirect('/admin/promo');
});

router.post('/promo/:id/delete', ensureAdmin, (req, res) => {
  db.get('promoCodes').remove({ id: req.params.id }).write();
  req.flash('success', 'Promo berhasil dihapus.');
  res.redirect('/admin/promo');
});

// =====================
// REFERRAL / AFFILIATE
// =====================
router.get('/referrals', ensureAdmin, (req, res) => {
  const cfg = getReferralConfig();
  const users = db.get('users').value();
  const userMap = new Map(users.map(u => [u.id, u]));

  const referrals = db.get('referrals').sortBy('createdAt').reverse().value().map(r => {
    const referrer = userMap.get(r.referrerId);
    return {
      ...r,
      referrerName: referrer ? referrer.name : '(user terhapus)',
      referrerCode: referrer ? referrer.referralCode : null
    };
  });

  const stats = {
    total: referrals.length,
    pending: referrals.filter(r => r.status === 'pending').length,
    rewarded: referrals.filter(r => r.status === 'rewarded').length,
    blocked: referrals.filter(r => r.status === 'blocked').length
  };

  res.render('admin/referral', {
    title: 'Kelola Referral - AlexCloud Admin',
    user: req.user, cfg, referrals, stats, moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

router.post('/referrals/settings', ensureAdmin, (req, res) => {
  const { enabled, welcomeDiscount, referrerReward } = req.body;
  const welcome = parseInt(welcomeDiscount, 10);
  const reward = parseInt(referrerReward, 10);

  if (isNaN(welcome) || welcome < 0 || isNaN(reward) || reward < 0) {
    req.flash('error', 'Nilai diskon welcome & reward harus angka ≥ 0.');
    return res.redirect('/admin/referrals');
  }

  setReferralConfig({
    enabled: !!enabled,
    welcomeDiscount: welcome,
    referrerReward: reward
  });

  req.flash('success', `Setelan referral disimpan${enabled ? ' & program aktif' : ' (program dinonaktifkan)'}.`);
  res.redirect('/admin/referrals');
});

// =====================
// PLANS / HARGA
// =====================
router.get('/plans', ensureAdmin, (req, res) => {
  const plans = getPlans();
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
  invalidatePlansCache();
  req.flash('success', `Paket "${name}" berhasil diperbarui.`);
  res.redirect('/admin/plans');
});

// =====================
// TESTIMONIALS — dengan upload PNG langsung
// =====================
router.get('/testimonials', ensureAdmin, (req, res) => {
  const testimonials = db.get('testimonials').sortBy('createdAt').reverse().value()
    // Show the cleaned version (command + "Name | Msg | Rating" stripped) and flag any
    // that have no real content left so the admin can clean them up.
    .map(t => ({ ...normalizeTestimonial(t), isJunk: isJunkTestimonial(t) }));
  const junkCount = testimonials.filter(t => t.isJunk).length;
  res.render('admin/testimonials', {
    title: 'Kelola Testimoni - AlexCloud Admin',
    user: req.user, testimonials, junkCount, moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

// Bulk cleanup — permanently remove all testimonials detected as raw bot/command junk
router.post('/testimonials/cleanup-junk', ensureAdmin, (req, res) => {
  const all = db.get('testimonials').value() || [];
  const junkIds = all.filter(t => isJunkTestimonial(t)).map(t => t.id);
  if (junkIds.length === 0) {
    req.flash('error', 'Tidak ada testimoni sampah yang terdeteksi.');
    return res.redirect('/admin/testimonials');
  }
  db.get('testimonials').remove(t => junkIds.includes(t.id)).write();
  req.flash('success', `${junkIds.length} testimoni sampah (data mentah bot) berhasil dibersihkan.`);
  res.redirect('/admin/testimonials');
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
      // Save as base64 data URL in memory database
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
  db.get('testimonials').find({ id: testi.id }).assign({ approved: !testi.approved }).write();
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
      // Save as base64 data URL in memory database
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

// ─── Moderasi Chat Komunitas ────────────────────────────────────────────────
router.get('/community', ensureAdmin, (req, res) => {
  const messages = (db.get('chatMessages').value() || []).slice(-150).reverse();
  res.render('admin/community', {
    title: 'Moderasi Komunitas - AlexCloud Admin',
    user: req.user, messages, moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

// Hapus pesan (permanen)
router.post('/community/:id/delete', ensureAdmin, (req, res) => {
  const msg = db.get('chatMessages').find({ id: req.params.id }).value();
  if (msg) {
    db.get('chatMessages').remove({ id: req.params.id }).write();
    req.flash('success', `Pesan dari "${msg.userName}" berhasil dihapus permanen.`);
  } else {
    req.flash('error', 'Pesan tidak ditemukan.');
  }
  res.redirect('/admin/community');
});

// Bersihkan SEMUA pesan (nuke) — untuk situasi darurat
router.post('/community/clear-all', ensureAdmin, (req, res) => {
  db.set('chatMessages', []).write();
  req.flash('success', 'Semua pesan komunitas telah dibersihkan.');
  res.redirect('/admin/community');
});

// =====================
// FOMO WELCOME CAMPAIGN — trigger manual dari admin
// =====================
router.post('/marketing/fomo-welcome', ensureAdmin, async (req, res) => {
  try {
    const { promoCode, discount, expiryHours } = req.body;
    const { runFomoWelcome } = require('../utils/fomowelcome');
    const result = await runFomoWelcome({
      promoCode: (promoCode || '').trim().toUpperCase() || undefined,
      discount: parseInt(discount || '5000', 10),
      expiryHours: parseInt(expiryHours || '12', 10)
    });
    if (result.error) {
      req.flash('error', `FOMO Campaign error: ${result.error}`);
    } else {
      req.flash('success',
        `✅ FOMO Welcome Campaign selesai! ` +
        `Terkirim: ${result.sent} | Gagal: ${result.skipped} | Kode Promo: ${result.promoCode}`
      );
    }
  } catch (err) {
    req.flash('error', `FOMO Campaign gagal: ${err.message}`);
  }
  res.redirect('/admin/marketing');
});

// =====================
// MANUAL FOLLOW-UP TRIGGER — cek & kirim follow-up sekarang
// =====================
router.post('/marketing/trigger-followup', ensureAdmin, async (req, res) => {
  try {
    const { runPendingOrderFollowUp } = require('../utils/followup');
    const result = await runPendingOrderFollowUp();
    if (result.error) {
      req.flash('error', `Follow-up error: ${result.error}`);
    } else {
      req.flash('success',
        `✅ Follow-up selesai! Terkirim: ${result.sent} | Tidak ada delivery: ${result.skipped}`
      );
    }
  } catch (err) {
    req.flash('error', `Follow-up gagal: ${err.message}`);
  }
  res.redirect('/admin/marketing');
});

// =====================
// MARKETING PAGE — halaman untuk trigger campaign
// =====================
router.get('/marketing', ensureAdmin, (req, res) => {
  const orders = db.get('orders').value() || [];
  const users  = db.get('users').value() || [];
  const now    = Date.now();
  const h24ago = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const h1ago  = new Date(now - 60 * 60 * 1000).toISOString();

  const pendingExpired = orders.filter(o =>
    ['pending','expired'].includes(o.status) &&
    (o.followUpCount || 0) < 2 &&
    o.createdAt < h1ago
  );
  const newUsers = users.filter(u =>
    u.role !== 'admin' &&
    u.createdAt >= h24ago &&
    !u.fomoWelcomeSentAt
  );

  res.render('admin/marketing', {
    title: 'Marketing & Campaign - AlexCloud',
    user: req.user,
    currentPage: 'marketing',
    pendingExpiredCount: pendingExpired.length,
    newUsersCount: newUsers.length,
    success: req.flash('success'),
    error: req.flash('error')
  });
});

// =====================
// WALLET / SALDO — Manajemen lengkap saldo user
// =====================

// Dashboard saldo: ringkasan liabilitas, daftar dompet user, mutasi terbaru.
router.get('/wallet', ensureAdmin, (req, res) => {
  const users = db.get('users').value() || [];
  const userMap = new Map(users.map(u => [u.id, u]));
  const walletsRaw = db.get('wallets').value() || [];
  const allTx = db.get('walletTx').value() || [];
  const orders = db.get('orders').value() || [];

  const wallets = walletsRaw
    .map(w => ({ ...w, user: userMap.get(w.userId) }))
    .filter(w => w.user)                       // sembunyikan dompet yatim (user terhapus)
    .sort((a, b) => (b.balance || 0) - (a.balance || 0));

  const topupOrders = orders.filter(o => o.orderType === 'topup');
  const stats = {
    totalLiability: wallets.reduce((s, w) => s + (w.balance || 0), 0),
    totalToppedUp: wallets.reduce((s, w) => s + (w.totalToppedUp || 0), 0),
    activeWallets: wallets.filter(w => (w.balance || 0) > 0).length,
    totalWallets: wallets.length,
    topupConfirmed: topupOrders.filter(o => o.status === 'confirmed').length,
    topupPending: topupOrders.filter(o => o.status === 'pending').length,
    topupRevenue: topupOrders.filter(o => o.status === 'confirmed').reduce((s, o) => s + (o.topupAmount || o.price || 0), 0),
    txCount: allTx.length
  };

  const recentTx = allTx.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 12)
    .map(t => ({ ...t, user: userMap.get(t.userId) }));

  res.render('admin/wallet', {
    title: 'Kelola Saldo - AlexCloud Admin',
    user: req.user, wallets, stats, recentTx, config: getWalletConfig(), moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

// Ledger lengkap semua mutasi saldo, dengan filter tipe & pencarian user.
router.get('/wallet/tx', ensureAdmin, (req, res) => {
  const users = db.get('users').value() || [];
  const userMap = new Map(users.map(u => [u.id, u]));
  const type = (req.query.type || 'all').toString();
  const q = (req.query.q || '').toString().trim().toLowerCase();

  let list = (db.get('walletTx').value() || [])
    .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(t => ({ ...t, user: userMap.get(t.userId) }));

  if (type !== 'all') list = list.filter(t => t.type === type);
  if (q) list = list.filter(t => {
    const u = t.user;
    return (u && ((u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)))
      || (t.refId && String(t.refId).toLowerCase().includes(q));
  });

  const total = list.length;
  list = list.slice(0, 300); // batasi tampilan agar ringan

  res.render('admin/wallet-tx', {
    title: 'Mutasi Saldo - AlexCloud Admin',
    user: req.user, txList: list, total, filterType: type, query: req.query.q || '', moment,
    success: req.flash('success'), error: req.flash('error')
  });
});

// Setelan dompet: aktif/nonaktif, min/maks, tier bonus.
router.get('/wallet/settings', ensureAdmin, (req, res) => {
  res.render('admin/wallet-settings', {
    title: 'Setelan Saldo - AlexCloud Admin',
    user: req.user, config: getWalletConfig(),
    success: req.flash('success'), error: req.flash('error')
  });
});

router.post('/wallet/settings', ensureAdmin, (req, res) => {
  const { enabled, minTopup, maxTopup,
    tier1Min, tier1Percent, tier2Min, tier2Percent } = req.body;

  const min = parseInt(minTopup, 10);
  const max = parseInt(maxTopup, 10);
  if (isNaN(min) || isNaN(max) || min < 1000 || max <= min) {
    req.flash('error', 'Nominal min/maks tidak valid (maks harus lebih besar dari min, min ≥ 1000).');
    return res.redirect('/admin/wallet/settings');
  }

  // Bangun tier bonus dari input (abaikan baris kosong / tidak valid).
  const tiers = [];
  [[tier1Min, tier1Percent], [tier2Min, tier2Percent]].forEach(([m, p]) => {
    const mm = parseInt(m, 10), pp = parseFloat(p);
    if (!isNaN(mm) && mm > 0 && !isNaN(pp) && pp > 0) tiers.push({ min: mm, percent: pp });
  });
  tiers.sort((a, b) => a.min - b.min);

  db.get('settings').assign({
    wallet: { enabled: !!enabled, minTopup: min, maxTopup: max, bonusTiers: tiers }
  }).write();

  req.flash('success', `Setelan saldo disimpan${enabled ? ' & top-up aktif' : ' (top-up dinonaktifkan)'}.`);
  res.redirect('/admin/wallet/settings');
});

// Penyesuaian manual saldo user (kredit/debit) — mis. kompensasi, koreksi, refund.
router.post('/wallet/:userId/adjust', ensureAdmin, (req, res) => {
  const target = db.get('users').find({ id: req.params.userId }).value();
  if (!target) { req.flash('error', 'User tidak ditemukan.'); return res.redirect('/admin/wallet'); }

  const direction = req.body.direction === 'debit' ? 'debit' : 'credit';
  const amount = Math.round(Number(req.body.amount) || 0);
  const note = (req.body.note || '').toString().trim() || (direction === 'credit' ? 'Penyesuaian saldo (kredit)' : 'Penyesuaian saldo (debit)');
  if (!Number.isFinite(amount) || amount <= 0) {
    req.flash('error', 'Nominal penyesuaian tidak valid.');
    return res.redirect('/admin/wallet');
  }

  try {
    const tx = applyWalletTx(target.id, {
      type: direction === 'credit' ? 'admin_credit' : 'admin_debit',
      amount, refType: 'admin', refId: null, note,
      createdBy: 'admin:' + req.user.name
    });
    req.flash('success',
      `Saldo ${target.name} ${direction === 'credit' ? 'ditambah' : 'dikurangi'} Rp ${amount.toLocaleString('id-ID')}. ` +
      `Saldo sekarang Rp ${tx.balanceAfter.toLocaleString('id-ID')}.`);
  } catch (e) {
    req.flash('error', `Gagal menyesuaikan saldo: ${e.message}`);
  }
  res.redirect('/admin/wallet');
});

module.exports = router;
