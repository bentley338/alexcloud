const express = require('express');
const router = express.Router();
const https = require('https');
const path = require('path');
const fs = require('fs');
const { db, getPlans, getGames, invalidateGamesCache } = require('../database/db');
const { ensureAuthenticated } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const { sharedHttpsAgent, fr3Request, sayabayarRequest, mustikapayRequest, createRateLimiter, BROWSER_UA, normalizeTestimonial } = require('../utils/helpers');

// ─── MustikaPay metode & opsi (dipakai selector di payment.ejs) ──────────────
// VA: subset bank populer yang didukung MustikaPay (BCA, BNI, BRI, dst).
const MP_BANKS = [
  { code: 'BCA', name: 'BCA' },
  { code: 'BNI', name: 'BNI' },
  { code: 'BRI', name: 'BRI' },
  { code: 'MANDIRI', name: 'Mandiri' },
  { code: 'PERMATA', name: 'Permata' },
  { code: 'CIMB', name: 'CIMB Niaga' },
  { code: 'DANAMON', name: 'Danamon' },
  { code: 'BSI', name: 'BSI' }
];
// E-Money: peta provider -> product_code MustikaPay.
const MP_EWALLETS = [
  { code: 'PAYDANA', name: 'DANA' },
  { code: 'PAYSHOPEE', name: 'ShopeePay' },
  { code: 'PAYOVO', name: 'OVO' },
  { code: 'PAYLINK', name: 'LinkAja' }
];
// Batas nominal minimum per metode (IDR) menurut dokumentasi MustikaPay.
const MP_MIN_AMOUNT = { qris: 1000, va: 10000, emoney: 1000, retail: 15000 };
const MP_MAX_AMOUNT = { retail: 5000000 };

// Rate limiters for API endpoints
const chatRateLimit = createRateLimiter({ windowMs: 60000, maxRequests: 15 });   // 15 msgs/min
const searchRateLimit = createRateLimiter({ windowMs: 60000, maxRequests: 60 }); // 60 searches/min

// Helper to filter out missing testimonial images and return dynamic URL for clean UI & high PageSpeed
function getCleanTestimonials() {
  const testimonials = (db.get('testimonials').filter({ approved: true }).value() || [])
    // Clean the WA-bot command + "Name | Message | Rating" formatting so it never shows raw.
    .map(normalizeTestimonial)
    // Only drop entries with literally no text left — never hide a real testimonial.
    .filter(t => t.name && t.name.trim() && t.text && t.text.trim());
  return testimonials.map(t => {
    if (t.image && typeof t.image === 'string') {
      const trimmed = t.image.trim();
      if (trimmed.startsWith('/uploads/')) {
        // Physical file on disk — if it exists, serve via endpoint, otherwise hide it
        const filePath = path.join(__dirname, '..', 'public', trimmed);
        if (fs.existsSync(filePath)) {
          return { ...t, image: `/api/testimonials/${t.id}/image` };
        }
      } else if (trimmed.startsWith('data:image/')) {
        // Base64 image — serve via persistent binary endpoint
        return { ...t, image: `/api/testimonials/${t.id}/image` };
      } else if (trimmed.startsWith('http')) {
        // External URL — serve directly
        return { ...t, image: trimmed };
      }
    }
    return { ...t, image: null };
  });
}

// Dynamic binary testimonial image API endpoint (solves ephemeral filesystem deletes & preserves PageSpeed score)
router.get('/api/testimonials/:id/image', (req, res) => {
  const testi = db.get('testimonials').find({ id: req.params.id }).value();
  if (!testi || !testi.image || typeof testi.image !== 'string') {
    return res.status(404).send('Image Not Found');
  }

  const trimmed = testi.image.trim();
  if (trimmed.startsWith('data:image/')) {
    const match = trimmed.match(/^data:image\/(\w+);base64,(.+)$/);
    if (match) {
      const contentType = `image/${match[1]}`;
      const buffer = Buffer.from(match[2], 'base64');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
      return res.send(buffer);
    }
  } else if (trimmed.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '..', 'public', trimmed);
    if (fs.existsSync(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(filePath);
    }
  } else if (trimmed.startsWith('http')) {
    return res.redirect(trimmed);
  }

  return res.status(404).send('Image Not Found');
});

// Homepage
router.get('/', (req, res) => {
  const games = getGames();
  const popularGames = games.filter(g => g.popular).slice(0, 8);
  const trendingGames = games.filter(g => g.rating >= 4.8).slice(0, 6);
  const testimonials = getCleanTestimonials();
  const plans = getPlans();
  res.render('index', {
    title: 'AlexCloud - Premium Cloud Gaming',
    user: req.user || null,
    games: popularGames,
    allGames: games,
    trendingGames,
    plans,
    testimonials
  });
});

// Games page — AI smart search
router.get('/games', (req, res) => {
  const games = getGames();
  const genre = req.query.genre;
  const search = req.query.q ? req.query.q.toLowerCase() : null;
  let filtered = genre ? games.filter(g => g.genre === genre) : games;
  if (search) {
    filtered = filtered.filter(g =>
      g.name.toLowerCase().includes(search) ||
      g.genre.toLowerCase().includes(search) ||
      (g.description && g.description.toLowerCase().includes(search))
    );
  }
  const genres = [...new Set(games.map(g => g.genre))];
  res.render('games', {
    title: 'Game Library - AlexCloud',
    user: req.user || null,
    games: filtered,
    genres,
    activeGenre: genre || 'all',
    searchQuery: req.query.q || ''
  });
});

// AI Game Search API (JSON)
router.get('/api/games/search', searchRateLimit, (req, res) => {
  const q = req.query.q ? req.query.q.toLowerCase() : '';
  if (!q) return res.json([]);
  const games = getGames();
  const results = games.filter(g =>
    g.name.toLowerCase().includes(q) ||
    g.genre.toLowerCase().includes(q)
  ).slice(0, 6).map(g => ({
    id: g.id, name: g.name, genre: g.genre, image: g.image, rating: g.rating, tag: g.tag
  }));
  res.json(results);
});

// AI Recommendations API (JSON)
router.get('/api/games/recommendations', (req, res) => {
  const genre = req.query.genre || '';
  const games = getGames();
  let pool = genre ? games.filter(g => g.genre.toLowerCase().includes(genre.toLowerCase())) : games;
  if (pool.length < 3) pool = games;
  const sorted = [...pool].sort((a, b) => b.rating - a.rating).slice(0, 4);
  res.json(sorted.map(g => ({ id: g.id, name: g.name, genre: g.genre, image: g.image, rating: g.rating, tag: g.tag })));
});

// Pricing page
router.get('/pricing', (req, res) => {
  const plans = getPlans();
  res.render('pricing', {
    title: 'Harga - AlexCloud',
    user: req.user || null,
    plans
  });
});

// Testimonials page
router.get('/testimonials', (req, res) => {
  const testimonials = getCleanTestimonials();
  res.render('testimonials', {
    title: 'Testimoni - AlexCloud',
    user: req.user || null,
    testimonials
  });
});

// ─── Global Community Chat ──────────────────────────────────────────────────
const chatPostRateLimit = createRateLimiter({ windowMs: 60000, maxRequests: 12 }); // 12 pesan/menit
const MAX_CHAT_MESSAGES = 500; // simpan hanya 500 pesan terakhir (hindari blob backup membengkak)
const MAX_CHAT_LEN = 500;

function publicMessage(m) {
  return {
    id: m.id,
    userId: m.userId,
    userName: m.userName,
    userAvatar: m.userAvatar || null,
    role: m.role,
    text: m.text,
    createdAt: m.createdAt
  };
}

// Halaman chat komunitas (wajib login)
router.get('/community', ensureAuthenticated, (req, res) => {
  res.render('community', {
    title: 'Komunitas - AlexCloud',
    user: req.user || null
  });
});

// Ambil pesan (semua / hanya yang lebih baru dari ?after=ISO timestamp untuk polling)
router.get('/api/community/messages', ensureAuthenticated, (req, res) => {
  let messages = db.get('chatMessages').value() || [];
  const after = req.query.after;
  if (after) {
    messages = messages.filter(m => m.createdAt > after);
  } else {
    messages = messages.slice(-100); // initial load: 100 terakhir
  }
  res.json({ messages: messages.map(publicMessage), serverTime: new Date().toISOString() });
});

// Kirim pesan
router.post('/api/community/messages', ensureAuthenticated, chatPostRateLimit, (req, res) => {
  let text = (req.body.text || '').toString().replace(/\s+$/, '').replace(/^\s+/, '');
  if (!text) return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
  if (text.length > MAX_CHAT_LEN) text = text.slice(0, MAX_CHAT_LEN);

  const msg = {
    id: uuidv4(),
    userId: req.user.id,
    userName: req.user.name || 'User',
    userAvatar: req.user.avatar || null,
    role: req.user.role === 'admin' ? 'admin' : 'user',
    text,
    createdAt: new Date().toISOString()
  };

  const coll = db.get('chatMessages');
  coll.push(msg).write();

  const all = coll.value();
  if (all.length > MAX_CHAT_MESSAGES) {
    db.set('chatMessages', all.slice(-MAX_CHAT_MESSAGES)).write();
  }

  res.json({ message: publicMessage(msg) });
});

// Hapus pesan (admin: pesan siapa pun, user: hanya miliknya) — permanen
router.post('/api/community/messages/:id/delete', ensureAuthenticated, (req, res) => {
  const id = req.params.id;
  const msg = db.get('chatMessages').find({ id }).value();
  if (!msg) return res.status(404).json({ error: 'Pesan tidak ditemukan.' });
  const isAdmin = req.user.role === 'admin';
  const isOwner = msg.userId === req.user.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Kamu tidak boleh menghapus pesan ini.' });
  db.get('chatMessages').remove({ id }).write();
  res.json({ ok: true });
});

// Dashboard
router.get('/dashboard', ensureAuthenticated, (req, res) => {
  const orders = db.get('orders').filter({ userId: req.user.id }).sortBy('createdAt').reverse().value();
  const activeSub = db.get('subscriptions').find({
    userId: req.user.id,
    status: 'active'
  }).value();

  let subInfo = null;
  if (activeSub) {
    const expiry = moment(activeSub.expiresAt);
    const now = moment();
    const daysLeft = expiry.diff(now, 'days');
    subInfo = { ...activeSub, daysLeft, expiryFormatted: expiry.format('DD MMMM YYYY') };
    if (daysLeft < 0) {
      db.get('subscriptions').find({ id: activeSub.id }).assign({ status: 'expired' }).write();
      subInfo = null;
    }
  }

  const games = getGames();
  const plans = getPlans();

  res.render('dashboard', {
    title: 'Dashboard - AlexCloud',
    user: req.user,
    orders,
    subscription: subInfo,
    plans,
    games,
    moment,
    rememberMe: req.session.rememberMe || false
  });
});

// Order page
router.get('/order/:planId', ensureAuthenticated, (req, res) => {
  const plans = getPlans();
  const plan = plans.find(p => p.id === req.params.planId);
  if (!plan) return res.redirect('/pricing');
  const promoCodes = db.get('promoCodes').filter({ isActive: true }).value();
  res.render('order', {
    title: `Order ${plan.name} - AlexCloud`,
    user: req.user,
    plan,
    qrisImage: process.env.QRIS_IMAGE || 'https://img1.pixhost.to/images/5339/592942381_rizzhosting.jpg',
    waNumber: process.env.WA_NUMBER
  });
});

// Validate promo code API
router.post('/api/promo/validate', ensureAuthenticated, (req, res) => {
  const { code, planId } = req.body;
  if (!code) return res.json({ valid: false, message: 'Kode promo tidak boleh kosong.' });

  const plans = getPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return res.json({ valid: false, message: 'Paket tidak ditemukan.' });

  const promo = db.get('promoCodes').find({ code: code.toUpperCase(), isActive: true }).value();
  if (!promo) return res.json({ valid: false, message: 'Kode promo tidak valid atau sudah tidak aktif.' });

  // Check expiry
  if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
    return res.json({ valid: false, message: 'Kode promo sudah kadaluarsa.' });
  }

  // Check usage limit
  if (promo.maxUses && promo.usedCount >= promo.maxUses) {
    return res.json({ valid: false, message: 'Kode promo sudah mencapai batas penggunaan.' });
  }

  // Check minimum purchase
  if (promo.minPurchase && plan.price < promo.minPurchase) {
    return res.json({ valid: false, message: `Promo ini hanya berlaku untuk pembelian min. Rp ${promo.minPurchase.toLocaleString('id-ID')}.` });
  }

  const originalPrice = plan.price;
  let discount = 0;
  let finalPrice = originalPrice;

  if (promo.discountType === 'percent') {
    discount = Math.round(originalPrice * promo.discountValue / 100);
  } else {
    discount = Math.min(promo.discountValue, originalPrice);
  }
  finalPrice = originalPrice - discount;

  return res.json({
    valid: true,
    message: `Promo berhasil! Hemat ${promo.discountType === 'percent' ? promo.discountValue + '%' : 'Rp ' + discount.toLocaleString('id-ID')}`,
    discount,
    finalPrice,
    finalPriceDisplay: 'Rp ' + finalPrice.toLocaleString('id-ID'),
    promoCode: promo.code,
    promoId: promo.id
  });
});

// Create order POST — FR3 NEWERA Payment Gateway
router.post('/order', ensureAuthenticated, async (req, res) => {
  const { planId, promoCode, promoId, paymentMethod } = req.body;
  const plans = getPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return res.redirect('/pricing');

  let actualPrice = plan.price;
  let appliedPromo = null;
  let discount = 0;

  // Validate promo if provided
  if (promoCode && promoId) {
    const promo = db.get('promoCodes').find({ id: promoId, code: promoCode.toUpperCase(), isActive: true }).value();
    if (promo && !(promo.expiresAt && new Date(promo.expiresAt) < new Date()) && !(promo.maxUses && promo.usedCount >= promo.maxUses) && !(promo.minPurchase && plan.price < promo.minPurchase)) {
      if (promo.discountType === 'percent') {
        discount = Math.round(plan.price * promo.discountValue / 100);
      } else {
        discount = Math.min(promo.discountValue, plan.price);
      }
      actualPrice = plan.price - discount;
      appliedPromo = promo;
      db.get('promoCodes').find({ id: promo.id }).assign({ usedCount: (promo.usedCount || 0) + 1 }).write();
    }
  }

  const orderId = 'AC' + Date.now().toString().slice(-8).toUpperCase();

  // ===== MustikaPay multi-metode =====
  // Pembeli memilih metode (QRIS / VA / E-Wallet / Retail) di halaman pembayaran.
  // Order dibuat dulu dalam status 'awaiting_method' (belum ada instrumen bayar);
  // instrumen di-generate on-demand lewat POST /api/payment/create saat metode dipilih.
  const order = {
    id: uuidv4(),
    orderId,
    userId: req.user.id,
    userName: req.user.name,
    userEmail: req.user.email,
    planId: plan.id,
    planName: plan.name,
    price: actualPrice,
    originalPrice: plan.price,
    discount,
    promoCode: appliedPromo ? appliedPromo.code : null,
    status: 'pending',
    qrisStatus: 'awaiting_method', // belum ada instrumen bayar
    payMethodType: null,           // 'qris' | 'va' | 'emoney' | 'retail'
    gateway: null,                 // 'mustikapay' | 'sayabayar' | 'fr3'
    nominal: actualPrice,
    createdAt: new Date().toISOString(),
    paidAt: null,
    activatedAt: null,
    // Instrumen bayar — diisi oleh /api/payment/create. fr3* dipertahankan sebagai
    // field generik (dipakai payment.ejs) terlepas dari gateway/metode mana yang menang.
    fr3TrxId: null,        // ref_no / id transaksi untuk polling status
    fr3QrString: null,     // payload QRIS (metode qris)
    fr3TotalTransfer: actualPrice,
    fr3UniqueCode: 0,
    fr3Expiry: null,
    fr3Error: null,
    // MustikaPay — extra per metode
    mpPaymentLink: null,   // link checkout / deep-link e-wallet
    mpVaNumber: null, mpVaName: null, mpBankCode: null,
    mpPaymentCode: null, mpRetailOutlet: null,
    mpEwalletProvider: null,
    paymentMethod: null
  };

  db.get('orders').push(order).write();

  // PRG pattern: redirect ke GET payment page (selector metode) supaya aman di-reload.
  res.redirect('/payment/' + order.orderId);
});

// URL redirect dikirim ke gateway agar pembeli kembali ke halaman pembayaran
// kita setelah menyelesaikan pembayaran di app e-wallet / halaman hosted.
function paymentRedirectUrl(order) {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/payment/${order.orderId}` : undefined;
}

// Ambil payload QRIS dari qr_url MustikaPay (format: .../api/qr?data=00020101...&ref_no=...).
function extractMpQrString(qrUrl) {
  if (!qrUrl) return null;
  try { return new URL(qrUrl).searchParams.get('data'); } catch { return null; }
}

function mpProductName(order) {
  return order && order.planName ? `AlexCloud - ${order.planName}` : 'AlexCloud Order';
}

function ensureMpKey() {
  if (!process.env.MUSTIKAPAY_API_KEY) {
    throw new Error('MUSTIKAPAY_API_KEY belum di-set di .env server');
  }
}

// ─── MustikaPay: QRIS ────────────────────────────────────────────────────────
async function tryMustikapayQris(orderInternalId, actualPrice, order) {
  ensureMpKey();
  if (actualPrice < MP_MIN_AMOUNT.qris) {
    throw new Error(`Nominal Rp${actualPrice} di bawah minimum QRIS (Rp${MP_MIN_AMOUNT.qris.toLocaleString('id-ID')})`);
  }
  const r = await mustikapayRequest('POST', '/api/v1/create/qris', {
    amount: actualPrice,
    product_name: mpProductName(order),
    customer_name: order?.userName || 'Pelanggan AlexCloud',
    expiry: 10,
    redirect_url: paymentRedirectUrl(order)
  }, 15000);
  if (!r || r.status !== 'success' || !r.ref_no) {
    throw new Error(r?.message || 'MustikaPay tidak membuat transaksi QRIS');
  }
  const qrString = extractMpQrString(r.qr_url);
  if (!qrString) throw new Error('MustikaPay QRIS dibuat tapi payload QR tidak ditemukan');
  db.get('orders').find({ id: orderInternalId }).assign({
    qrisStatus: 'ready', gateway: 'mustikapay', payMethodType: 'qris',
    fr3TrxId: r.ref_no, fr3QrString: qrString,
    fr3TotalTransfer: r.amount || actualPrice, fr3UniqueCode: 0,
    fr3Expiry: Date.now() + 10 * 60 * 1000,
    mpPaymentLink: r.payment_link || null,
    paymentMethod: 'mustikapay_qris', fr3Error: null
  }).write();
}

// ─── MustikaPay: Virtual Account ──────────────────────────────────────────────
async function tryMustikapayVa(orderInternalId, actualPrice, order, bankCode) {
  ensureMpKey();
  if (!bankCode || !MP_BANKS.some(b => b.code === bankCode)) throw new Error('Bank tidak valid');
  if (actualPrice < MP_MIN_AMOUNT.va) {
    throw new Error(`Nominal Rp${actualPrice} di bawah minimum VA (Rp${MP_MIN_AMOUNT.va.toLocaleString('id-ID')})`);
  }
  const r = await mustikapayRequest('POST', '/api/v1/create/va', {
    amount: actualPrice, bank_code: bankCode,
    name: order?.userName || 'Pelanggan AlexCloud',
    phone: undefined,
    product_name: mpProductName(order),
    expiry: 1440,
    redirect_url: paymentRedirectUrl(order)
  }, 15000);
  const d = r && r.data;
  if (!r || r.status !== 'success' || !r.ref_no || !d || !d.virtualAccountNo) {
    throw new Error(r?.message || 'MustikaPay tidak membuat Virtual Account');
  }
  db.get('orders').find({ id: orderInternalId }).assign({
    qrisStatus: 'ready', gateway: 'mustikapay', payMethodType: 'va',
    fr3TrxId: r.ref_no, fr3QrString: null,
    fr3TotalTransfer: actualPrice, fr3UniqueCode: 0,
    fr3Expiry: Date.now() + 1440 * 60 * 1000,
    mpVaNumber: d.virtualAccountNo, mpVaName: d.virtualAccountName || null, mpBankCode: bankCode,
    mpPaymentLink: r.payment_link || null,
    paymentMethod: 'mustikapay_va', fr3Error: null
  }).write();
}

// ─── MustikaPay: E-Money (DANA / ShopeePay / OVO / LinkAja) ───────────────────
async function tryMustikapayEmoney(orderInternalId, actualPrice, order, productCode, phone) {
  ensureMpKey();
  if (!productCode || !MP_EWALLETS.some(e => e.code === productCode)) throw new Error('Provider e-wallet tidak valid');
  if (!phone || !/^0\d{8,14}$/.test(phone)) throw new Error('Nomor HP e-wallet tidak valid (contoh: 081234567890)');
  if (actualPrice < MP_MIN_AMOUNT.emoney) {
    throw new Error(`Nominal Rp${actualPrice} di bawah minimum E-Money (Rp${MP_MIN_AMOUNT.emoney.toLocaleString('id-ID')})`);
  }
  const r = await mustikapayRequest('POST', '/api/v1/create/emoney', {
    amount: actualPrice, product_code: productCode, phone,
    name: order?.userName || 'Pelanggan AlexCloud',
    product_name: mpProductName(order),
    order_id: order.orderId,
    expiry: 15,
    redirect_url: paymentRedirectUrl(order)
  }, 15000);
  if (!r || r.status !== 'success' || !r.ref_no) {
    throw new Error(r?.message || 'MustikaPay tidak membuat transaksi E-Money');
  }
  const link = r.payment_link || (r.data && r.data.urlPayment) || null;
  const provider = (MP_EWALLETS.find(e => e.code === productCode) || {}).name || productCode;
  db.get('orders').find({ id: orderInternalId }).assign({
    qrisStatus: 'ready', gateway: 'mustikapay', payMethodType: 'emoney',
    fr3TrxId: r.ref_no, fr3QrString: null,
    fr3TotalTransfer: actualPrice, fr3UniqueCode: 0,
    fr3Expiry: Date.now() + 15 * 60 * 1000,
    mpPaymentLink: link, mpEwalletProvider: provider,
    paymentMethod: 'mustikapay_emoney', fr3Error: null
  }).write();
}

// ─── MustikaPay: Retail (Alfamart / Indomaret) ────────────────────────────────
async function tryMustikapayRetail(orderInternalId, actualPrice, order, outlet, phone) {
  ensureMpKey();
  if (!['ALFAMART', 'INDOMARET'].includes(outlet)) throw new Error('Gerai retail tidak valid');
  if (actualPrice < MP_MIN_AMOUNT.retail) {
    throw new Error(`Nominal Rp${actualPrice} di bawah minimum Retail (Rp${MP_MIN_AMOUNT.retail.toLocaleString('id-ID')})`);
  }
  if (actualPrice > MP_MAX_AMOUNT.retail) {
    throw new Error(`Nominal Rp${actualPrice} melebihi maksimum Retail (Rp${MP_MAX_AMOUNT.retail.toLocaleString('id-ID')})`);
  }
  const r = await mustikapayRequest('POST', '/api/v1/create/retail', {
    amount: actualPrice, retail_outlet: outlet,
    name: order?.userName || 'Pelanggan AlexCloud',
    phone: phone || undefined,
    product_name: mpProductName(order),
    expiry: 4320,
    redirect_url: paymentRedirectUrl(order)
  }, 15000);
  const d = r && r.data;
  if (!r || r.status !== 'success' || !r.ref_no || !d || !d.paymentCode) {
    throw new Error(r?.message || 'MustikaPay tidak membuat pembayaran Retail');
  }
  db.get('orders').find({ id: orderInternalId }).assign({
    qrisStatus: 'ready', gateway: 'mustikapay', payMethodType: 'retail',
    fr3TrxId: r.ref_no, fr3QrString: null,
    fr3TotalTransfer: actualPrice, fr3UniqueCode: 0,
    fr3Expiry: Date.now() + 4320 * 60 * 1000,
    mpPaymentCode: d.paymentCode, mpRetailOutlet: outlet,
    mpPaymentLink: r.payment_link || null,
    paymentMethod: 'mustikapay_retail', fr3Error: null
  }).write();
}

// Generate a QRIS via FR3 — throws on any failure, marks the order 'ready' on success.
async function tryFr3Gateway(orderInternalId, actualPrice, fr3Nominal) {
  // 3 percobaan: Cloudflare/stall FR3 sering hanya intermittent, beri beberapa kesempatan.
  const fr3Data = await fr3Request('/topup', 'POST', { nominal: fr3Nominal }, 25000, 3);
  if (!fr3Data || !fr3Data.data || !fr3Data.data.trxId) {
    throw new Error(fr3Data?.message || 'API did not return a transaction ID');
  }
  const d = fr3Data.data;
  const totalTransfer = d.totalTransfer || fr3Nominal;
  db.get('orders').find({ id: orderInternalId }).assign({
    qrisStatus: 'ready',
    gateway: 'fr3',
    payMethodType: 'qris',
    fr3TrxId: d.trxId,
    fr3QrString: d.qr_string || null,
    fr3TotalTransfer: totalTransfer,
    fr3UniqueCode: totalTransfer - actualPrice,
    fr3Expiry: d.expiry || null,
    paymentMethod: 'fr3_qris',
    fr3Error: null
  }).write();
}

// Pull the QRIS string out of a SayaBayar invoice object (create OR detail response).
function extractSbQris(sd) {
  return sd && sd.payment_channel && sd.payment_channel.qris_string;
}

// Generate a QRIS via SayaBayar — throws on any failure, marks the order 'ready' on success.
// SayaBayar adds its own unique code, so we send the base price (not the FR3 nominal).
async function trySayabayarGateway(orderInternalId, actualPrice) {
  const order = db.get('orders').find({ id: orderInternalId }).value();
  // Penyebab umum di server: .env tidak memuat SAYABAYAR_API_KEY (file .env tidak
  // ikut git). Beri pesan eksplisit alih-alih meneruskan "Token/API key diperlukan".
  if (!process.env.SAYABAYAR_API_KEY) {
    throw new Error('SAYABAYAR_API_KEY belum di-set di .env server');
  }
  // SayaBayar menolak amount < 100 (VALIDATION_ERROR "must be >= 100"). Tangkap lebih
  // awal dengan pesan jelas agar tidak tampak seperti gateway "gagal merespons".
  if (!Number.isFinite(actualPrice) || actualPrice < 100) {
    throw new Error(`Nominal Rp${actualPrice} tidak valid (min SayaBayar Rp100)`);
  }
  const sb = await sayabayarRequest('POST', '/invoices', {
    customer_name: order?.userName || 'Pelanggan AlexCloud',
    customer_email: order?.userEmail || undefined,
    amount: actualPrice,
    description: order?.planName ? `AlexCloud - ${order.planName}` : 'AlexCloud Order',
    payment_method: 'qris'
  }, 20000);

  let sd = sb && sb.data;
  // The invoice must have been created (success + an id). If it was created but the
  // create response didn't inline the QRIS string yet (SayaBayar populates the
  // payment_channel a beat later), fetch it from the invoice-detail endpoint, which
  // reliably carries payment_channel.qris_string. This is the common failure that
  // previously dropped every order to manual even though the invoice DID exist.
  if (!sb || !sb.success || !sd || !sd.id) {
    throw new Error(sb?.error?.message || 'SayaBayar did not create an invoice');
  }
  let qrString = extractSbQris(sd);
  for (let i = 0; i < 4 && !qrString; i++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const detail = await sayabayarRequest('GET', `/invoices/${sd.id}`, null, 10000);
      if (detail && detail.success && detail.data) {
        sd = detail.data;
        qrString = extractSbQris(sd);
      }
    } catch (e) {
      console.warn(`[SayaBayar] detail poll ${i + 1}/4 gagal: ${e.message}`);
    }
  }
  if (!qrString) {
    throw new Error('SayaBayar invoice created but QRIS string never appeared');
  }
  const totalTransfer = sd.amount_unique || sd.amount_to_pay ||
    (sd.payment_channel && sd.payment_channel.amount_to_pay) || actualPrice;
  db.get('orders').find({ id: orderInternalId }).assign({
    qrisStatus: 'ready',
    gateway: 'sayabayar',
    payMethodType: 'qris',
    fr3TrxId: sd.id, // reused as the reference id for status polling
    sbInvoiceNumber: sd.invoice_number || null,
    sbPaymentUrl: sd.payment_url || null, // hosted-checkout fallback link
    fr3QrString: qrString,
    fr3TotalTransfer: totalTransfer,
    fr3UniqueCode: sd.unique_code || (totalTransfer - actualPrice),
    fr3Expiry: (sd.payment_channel && sd.payment_channel.expired_at) || sd.expired_at || null,
    paymentMethod: 'sayabayar_qris',
    fr3Error: null
  }).write();
}

// Generate QRIS dengan fallback berurutan: MustikaPay → SayaBayar → FR3.
// Hanya QRIS yang punya fallback (ketiga gateway mendukung QRIS); VA/E-Money/Retail
// eksklusif MustikaPay. Urutan diawali PAYMENT_PRIMARY. Throws kalau semua gagal.
async function generateQris(orderInternalId, actualPrice, order) {
  const primary = (process.env.PAYMENT_PRIMARY || 'mustikapay').toLowerCase();
  const all = ['mustikapay', 'sayabayar', 'fr3'];
  const sequence = [primary, ...all.filter(g => g !== primary)];

  const errors = {};
  for (const gw of sequence) {
    try {
      if (gw === 'mustikapay') await tryMustikapayQris(orderInternalId, actualPrice, order);
      else if (gw === 'sayabayar') await trySayabayarGateway(orderInternalId, actualPrice);
      else {
        // FR3 butuh kode unik tertanam di nominal QR untuk pencocokan pembayaran.
        const uniq = (actualPrice % 100 === 0) ? (Math.floor(Math.random() * 90) + 10) : 0;
        await tryFr3Gateway(orderInternalId, actualPrice, actualPrice + uniq);
      }
      return; // sukses — order kini 'ready'
    } catch (e) {
      errors[gw] = e.message;
      console.warn(`[PAY] QRIS ${gw} gagal:`, e.message);
    }
  }
  throw new Error(`MustikaPay: ${errors.mustikapay || '-'} | SayaBayar: ${errors.sayabayar || '-'} | FR3: ${errors.fr3 || '-'}`);
}

// Payment page (GET) — selector metode / instrumen-siap / manual untuk satu order.
router.get('/payment/:orderId', ensureAuthenticated, (req, res) => {
  const order = db.get('orders').find({ orderId: req.params.orderId, userId: req.user.id }).value();
  if (!order) return res.redirect('/dashboard');

  const plans = getPlans();
  const plan = plans.find(p => p.id === order.planId) ||
    { id: order.planId, name: order.planName, price: order.originalPrice };

  const priceDisplay = 'Rp ' + order.price.toLocaleString('id-ID');
  const totalDisplay = 'Rp ' + (order.fr3TotalTransfer || order.price).toLocaleString('id-ID');

  // Tiga state halaman:
  //  - 'instrument' : instrumen bayar sudah dibuat (render QR/VA/e-wallet/retail + polling)
  //  - 'manual'     : semua gateway gagal → fallback transfer manual via WA
  //  - 'select'     : belum memilih metode → tampilkan selector
  let payState = 'select';
  if (order.qrisStatus === 'ready' && order.payMethodType) payState = 'instrument';
  else if (order.qrisStatus === 'failed') payState = 'manual';

  res.render('payment', {
    title: 'Pembayaran - AlexCloud',
    user: req.user,
    order,
    plan,
    priceDisplay,
    totalDisplay,
    discount: order.discount || 0,
    payState,
    methodType: order.payMethodType || null,
    fr3Error: order.fr3Error,
    banks: MP_BANKS,
    ewallets: MP_EWALLETS,
    minAmount: MP_MIN_AMOUNT,
    maxAmount: MP_MAX_AMOUNT,
    qrisImage: process.env.QRIS_IMAGE || 'https://img1.pixhost.to/images/5339/592942381_rizzhosting.jpg',
    waNumber: process.env.WA_NUMBER || '82328437656'
  });
});

// Buat instrumen pembayaran on-demand sesuai metode yang dipilih pembeli.
// QRIS: MustikaPay → SayaBayar → FR3 (fallback). VA/E-Money/Retail: MustikaPay saja.
router.post('/api/payment/create/:orderId', ensureAuthenticated, async (req, res) => {
  const order = db.get('orders').find({ orderId: req.params.orderId, userId: req.user.id }).value();
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
  if (order.status !== 'pending') return res.status(400).json({ error: `Order sudah ${order.status}` });

  const { method, bank_code, product_code, phone, retail_outlet } = req.body || {};
  const amount = order.price;

  try {
    if (method === 'qris') {
      await generateQris(order.id, amount, order);
    } else if (method === 'va') {
      await tryMustikapayVa(order.id, amount, order, String(bank_code || '').toUpperCase());
    } else if (method === 'emoney') {
      await tryMustikapayEmoney(order.id, amount, order, String(product_code || '').toUpperCase(), String(phone || '').trim());
    } else if (method === 'retail') {
      await tryMustikapayRetail(order.id, amount, order, String(retail_outlet || '').toUpperCase(), String(phone || '').trim());
    } else {
      return res.status(400).json({ error: 'Metode pembayaran tidak valid' });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.warn(`[PAY] create ${method} gagal:`, e.message);
    return res.status(502).json({ error: e.message });
  }
});

// Reset instrumen — kembali ke selector metode (mis. mau ganti metode, atau buat ulang
// setelah QRIS gagal/expired). Tidak menyentuh order yang sudah dibayar/aktif.
router.post('/payment/:orderId/reset', ensureAuthenticated, (req, res) => {
  const order = db.get('orders').find({ orderId: req.params.orderId, userId: req.user.id }).value();
  if (!order) return res.redirect('/dashboard');
  if (order.status === 'confirmed' || order.status === 'paid' || order.status === 'active') {
    return res.redirect('/payment/' + order.orderId);
  }
  db.get('orders').find({ id: order.id }).assign({
    qrisStatus: 'awaiting_method',
    payMethodType: null,
    gateway: null,
    fr3Error: null,
    fr3TrxId: null,
    fr3QrString: null,
    fr3TotalTransfer: order.price,
    fr3UniqueCode: 0,
    fr3Expiry: null,
    mpPaymentLink: null,
    mpVaNumber: null, mpVaName: null, mpBankCode: null,
    mpPaymentCode: null, mpRetailOutlet: null,
    mpEwalletProvider: null,
    paymentMethod: null
  }).write();
  res.redirect('/payment/' + order.orderId);
});

// =====================
// Payment Status API (polling) — MustikaPay / SayaBayar / FR3
// =====================
router.get('/api/payment/status/:orderId', ensureAuthenticated, async (req, res) => {
  const order = db.get('orders').find({ orderId: req.params.orderId, userId: req.user.id }).value();
  if (!order) return res.json({ error: 'Order tidak ditemukan' });
  if (!order.fr3TrxId) return res.json({ status: order.status, method: 'manual' });

  try {
    // Normalized status across gateways: SUCCESS | PENDING | EXPIRED
    let fr3St = 'PENDING';

    if (order.gateway === 'mustikapay') {
      // MustikaPay: GET /api/v1/check/{qris|emoney|va|retail}?ref_no=... → status pending|success|expired
      const type = order.payMethodType || 'qris';
      const mp = await mustikapayRequest('GET', `/api/v1/check/${type}`, { ref_no: order.fr3TrxId }, 12000);
      const mpStatus = (mp?.status || 'pending').toLowerCase();
      fr3St = mpStatus === 'success' ? 'SUCCESS'
        : (mpStatus === 'expired' || mpStatus === 'cancelled' || mpStatus === 'failed') ? 'EXPIRED'
        : 'PENDING';
    } else if (order.gateway === 'sayabayar') {
      // SayaBayar: GET /invoices/:id → data.status = pending | paid | expired | cancelled
      const sb = await sayabayarRequest('GET', `/invoices/${encodeURIComponent(order.fr3TrxId)}`, null, 12000);
      const sbStatus = (sb?.data?.status || 'pending').toLowerCase();
      fr3St = sbStatus === 'paid' ? 'SUCCESS'
        : (sbStatus === 'expired' || sbStatus === 'cancelled') ? 'EXPIRED'
        : 'PENDING';
    } else {
      // FR3: GET /check-status?apikey=...&idTransaksi=...
      const FR3_API_KEY = process.env.FR3_API_KEY;
      const statusEndpoint = `/check-status?apikey=${encodeURIComponent(FR3_API_KEY)}&idTransaksi=${encodeURIComponent(order.fr3TrxId)}`;
      const FR3_BASE = 'https://fr3newera.com/api/v1';
      const urlObj = new URL(`${FR3_BASE}${statusEndpoint}`);

      const fr3Status = await new Promise((resolve, reject) => {
        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          agent: sharedHttpsAgent,
          headers: { 'User-Agent': BROWSER_UA },
          timeout: 12000 // FR3 status checks observed taking ~7s+; give headroom
        };
        const r = https.request(options, (resp) => {
          let body = '';
          resp.on('data', d => body += d);
          resp.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error('Invalid JSON')); }
          });
        });
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
        r.end();
      });

      fr3St = (fr3Status?.data?.status || 'PENDING').toUpperCase();
    }

    // Auto-confirm jika SUCCESS atau PAID
    if ((fr3St === 'SUCCESS' || fr3St === 'PAID' || fr3St === 'SETTLED') && order.status === 'pending') {
      db.get('orders').find({ id: order.id }).assign({
        status: 'confirmed',
        paidAt: new Date().toISOString()
      }).write();

      // Auto-activate subscription
      const plans = getPlans();
      const plan = plans.find(p => p.id === order.planId);
      if (plan) {
        const expiresAt = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000).toISOString();
        db.get('subscriptions').remove({ userId: req.user.id, status: 'active' }).write();
        db.get('subscriptions').push({
          id: uuidv4(),
          userId: req.user.id,
          orderId: order.orderId,
          planId: plan.id,
          planName: plan.name,
          status: 'active',
          createdAt: new Date().toISOString(),
          expiresAt
        }).write();
        db.get('orders').find({ id: order.id }).assign({ activatedAt: new Date().toISOString() }).write();
      }

      // Trigger Notifications for Admin
      const methodLabels = { qris: 'QRIS', va: 'Virtual Account', emoney: 'E-Wallet', retail: 'Retail' };
      const methodLabel = methodLabels[order.payMethodType] || 'QRIS';
      const formattedPrice = 'Rp ' + order.price.toLocaleString('id-ID');
      const textMsg = `🎉 *PEMBAYARAN SUKSES (${methodLabel})*\n\n📋 Order ID: *#${order.orderId}*\n👤 Pembeli: ${order.userName} (${order.userEmail})\n📦 Paket: *${order.planName}*\n💰 Jumlah Bayar: ${formattedPrice}\n⚙️ Status: Aktif Otomatis\n\nSilakan cek admin panel untuk proses akun.`;
      
      // WhatsApp
      const { sendWhatsAppNotification } = require('../utils/whatsapp');
      sendWhatsAppNotification(textMsg).catch(err => {
        console.error('[WA NOTIF] Notification send error:', err.message);
      });

      // Telegram
      const { sendTelegramNotification } = require('../utils/telegram');
      sendTelegramNotification(textMsg).catch(err => {
        console.error('[TG NOTIF] Notification send error:', err.message);
      });
    }

    if (fr3St === 'EXPIRED' && order.status === 'pending') {
      db.get('orders').find({ id: order.id }).assign({ status: 'expired' }).write();
    }

    return res.json({
      fr3Status: fr3St,
      status: db.get('orders').find({ id: order.id }).value().status,
      trxId: order.fr3TrxId,
      amount: order.price,
      totalTransfer: order.fr3TotalTransfer
    });

  } catch (e) {
    console.error('[FR3] Check status error:', e.message);
    return res.json({ error: e.message, status: order.status });
  }
});

// =====================
// FR3 Cancel Payment
// =====================
router.post('/api/payment/cancel/:orderId', ensureAuthenticated, async (req, res) => {
  const order = db.get('orders').find({ orderId: req.params.orderId, userId: req.user.id }).value();
  if (!order) return res.json({ error: 'Order tidak ditemukan' });
  if (order.status === 'confirmed' || order.status === 'cancelled') {
    return res.json({ error: `Order sudah ${order.status}, tidak bisa dibatalkan` });
  }

  // Hanya FR3 yang punya endpoint cancel; MustikaPay & SayaBayar cukup dibatalkan lokal.
  if (order.fr3TrxId && order.gateway === 'fr3') {
    try {
      const fr3Result = await fr3Request('/topup/cancel', 'POST', { trxId: order.fr3TrxId }, 12000);
      console.log('[FR3] Cancel response:', fr3Result);

      // Jika FR3 mengembalikan status selain 200, kita log warning saja dan biarkan local DB membatalkan pesanan.
      if (fr3Result && fr3Result.status !== 200) {
        console.warn('[FR3] Cancel payment returned non-200 status on gateway, proceeding with local cancellation:', fr3Result);
      }
    } catch (e) {
      console.error('[FR3] Cancel error (proceeding with local cancellation):', e.message);
    }
  }

  // Jika berhasil cancel di FR3 (atau tidak pakai QRIS), cancel di DB lokal
  db.get('orders').find({ id: order.id }).assign({
    status: 'cancelled',
    cancelledAt: new Date().toISOString()
  }).write();

  return res.json({ success: true, message: 'Pesanan berhasil dibatalkan' });
});

// Profile
router.get('/profile', ensureAuthenticated, (req, res) => {
  res.render('profile', {
    title: 'Profil - AlexCloud',
    user: req.user,
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// Update profile
router.post('/profile', ensureAuthenticated, (req, res) => {
  const { name } = req.body;
  if (!name) { req.flash('error', 'Nama tidak boleh kosong.'); return res.redirect('/profile'); }
  db.get('users').find({ id: req.user.id }).assign({ name: name.trim() }).write();
  req.flash('success', 'Profil berhasil diperbarui.');
  res.redirect('/profile');
});

// =====================
// FAQ Page
// =====================
router.get('/faq', (req, res) => {
  res.render('faq', {
    title: 'FAQ - Pertanyaan Umum AlexCloud',
    user: req.user || null
  });
});

// =====================
// Legal & Company Pages (Tentang Kami, Syarat, Privasi, Refund)
// =====================
const LEGAL_LAST_UPDATED = '22 Juni 2026';

router.get('/about', (req, res) => {
  res.render('about', {
    title: 'Tentang Kami - AlexCloud',
    user: req.user || null
  });
});

router.get('/terms', (req, res) => {
  res.render('terms', {
    title: 'Syarat & Ketentuan - AlexCloud',
    user: req.user || null,
    lastUpdated: LEGAL_LAST_UPDATED
  });
});

router.get('/privacy', (req, res) => {
  res.render('privacy', {
    title: 'Kebijakan Privasi - AlexCloud',
    user: req.user || null,
    lastUpdated: LEGAL_LAST_UPDATED
  });
});

router.get('/refund', (req, res) => {
  res.render('refund', {
    title: 'Kebijakan Refund - AlexCloud',
    user: req.user || null,
    lastUpdated: LEGAL_LAST_UPDATED
  });
});

// =====================
// Network Speed Test Page
// =====================
router.get('/network-test', (req, res) => {
  res.render('network-test', {
    title: 'Network Speed Test - AlexCloud',
    user: req.user || null
  });
});

// Ping endpoint for latency measurement
router.get('/api/ping', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.json({ pong: true, ts: Date.now() });
});

// AI Chatbot API endpoint utilizing OpenAI (gpt-4o-mini)
router.post('/api/chat', chatRateLimit, async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!openaiKey && !geminiKey) {
    console.error('[CHAT ERROR] Neither OPENAI_API_KEY nor GEMINI_API_KEY is defined');
    return res.status(500).json({ error: 'AI Service configuration error' });
  }

  const systemInstructionText = `Kamu adalah AlexBot 🤖, asisten AI pintar untuk platform cloud gaming AlexCloud.
Tugas kamu adalah membantu pengguna dengan ramah, menjelaskan layanan AlexCloud, membantu transaksi, pendaftaran, rekomendasi game, dan troubleshooting ringan.

Berikut adalah informasi detail tentang AlexCloud yang wajib kamu gunakan untuk menjawab pertanyaan:
- Harga Paket: 1 Minggu Rp 40.000, 1 Bulan Rp 60.000 (Paling populer), 2 Bulan Rp 100.000, 3 Bulan Rp 150.000. Semua akses ke 100+ game premium, streaming 4K/60fps, cloud save.
- Pembayaran & Transaksi (TRX): QRIS Otomatis (DANA, GoPay, OVO, ShopeePay, LinkAja, Mobile Banking). Jika pembayaran sukses, akun aktif instan. Jika ada kendala transaksi/checking, bantu arahkan untuk konfirmasi ke admin via WhatsApp dengan ramah.
- Game Tersedia (contoh): GTA VI, GTA V, Cyberpunk 2077, Spider-Man 2, God of War Ragnarök, Elden Ring, Hogwarts Legacy, The Witcher 3, Red Dead Redemption 2, COD Black Ops 6, Battlefield 2042, EA FC 26, EA FC 25, MotoGP 25, MotoGP 24, Alan Wake 2.
- Fitur Unggulan: Streaming 4K / 60fps, Latency rendah <30ms (server Jakarta), Cloud Save otomatis, Login aman Google OAuth, Live chat support 24/7.
- Kebutuhan Internet: Minimum 5 Mbps (720p), Standar 10 Mbps (1080p/60fps), HD 15 Mbps, Ultra 4K 25 Mbps. WiFi 5GHz atau kabel LAN direkomendasikan.
- Perangkat Kompatibel: Laptop/PC (Windows, Mac, Linux), Smartphone Android & iOS, Smart TV (dengan browser), Tablet. Hanya butuh browser modern.
- Keunggulan vs PC: 10x lebih hemat (hanya Rp 60rb/bulan dibanding beli PC Rp 15-50 juta), tidak perlu maintenance/upgrade hardware, portable bisa main di mana saja.
- Kontrol: Keyboard+Mouse, Controller (Xbox, PS4/PS5, generic USB), Touch Screen di HP.

Panduan Batasan & Topik:
1. Kamu sangat terbuka menjawab semua hal seputar cloud gaming, game (rekomendasi, rilis, cara main), teknologi cloud, spesifikasi PC/HP untuk main game, detail paket, promo/voucher, cara daftar, serta transaksi (TRX) & pembayaran di AlexCloud.
2. Jika pengguna menanyakan hal yang sama sekali di luar topik gaming / AlexCloud (seperti matematika, pelajaran sekolah, resep masakan, politik, sejarah umum, coding, dll), JANGAN menjawab dengan kaku seperti robot terkunci. Jawablah dengan santai dan ramah, boleh berikan jawaban singkat jika kamu tahu secara umum, lalu alihkan percakapan kembali dengan asyik ke topik game atau layanan AlexCloud. Contoh: "Wah kalau soal resep nasi goreng aku kurang jago masak nih kak, tapi kalau racik server cloud gaming buat main GTA VI lancar jaya, aku jagonya! Mau nanya seputar paket gaming kita? 😉"

Gaya Komunikasi:
Jawab dalam Bahasa Indonesia dengan nada santai, ramah, dan seru khas gamer. Sering gunakan emoji yang sesuai. Gunakan sapaan 'kak' atau 'kamu'. Jawablah secara ringkas, asyik, dan informatif.
JANGAN pernah gunakan format tulisan markdown seperti tanda bintang (* atau **) untuk mempertebal atau memiringkan kata, karena chat website kami tidak mendukung rendering markdown dan akan menampilkan tanda bintang tersebut secara mentah. Gunakan teks biasa saja atau gunakan tag HTML langsung seperti <b>teks</b> atau <i>teks</i> jika diperlukan agar tampilan teks sangat rapi.`;

  // ==========================================
  // 1. Try OpenAI Chat completions (gpt-4o-mini)
  // ==========================================
  if (openaiKey) {
    try {
      console.log('[AI CHAT] Contacting OpenAI API (gpt-4o-mini)...');
      
      const openaiMessages = [{ role: 'system', content: systemInstructionText }];
      if (req.body.history && Array.isArray(req.body.history)) {
        req.body.history.forEach(turn => {
          if (turn.role && turn.content) {
            openaiMessages.push({
              role: turn.role === 'assistant' ? 'assistant' : 'user',
              content: turn.content
            });
          }
        });
      } else {
        openaiMessages.push({ role: 'user', content: message });
      }

      const payload = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: openaiMessages
      });

      const responseBody = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.openai.com',
          path: '/v1/chat/completions',
          method: 'POST',
          agent: sharedHttpsAgent,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Length': Buffer.byteLength(payload)
          }
        };
        const req2 = https.request(options, (res2) => {
          let body = '';
          res2.on('data', chunk => body += chunk);
          res2.on('end', () => {
            if (res2.statusCode !== 200) {
              reject(new Error(`OpenAI status ${res2.statusCode}: ${body}`));
            } else {
              resolve(body);
            }
          });
        });
        
        req2.on('error', reject);
        req2.setTimeout(15000, () => {
          req2.destroy();
          reject(new Error('OpenAI Timeout (15s)'));
        });
        
        req2.write(payload);
        req2.end();
      });

      const parsed = JSON.parse(responseBody);
      const textResponse = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
      if (textResponse) {
        console.log('[AI CHAT] Success response generated via OpenAI!');
        return res.json({ response: textResponse });
      }
    } catch (err) {
      console.warn('[AI CHAT] OpenAI failed, dropping to Gemini:', err.message);
    }
  }

  // ==========================================
  // 2. Fallback to Gemini (gemini-3.1-flash-lite, etc.)
  // ==========================================
  if (geminiKey) {
    const models = [
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-flash-latest',
      'gemini-pro-latest'
    ];

    let geminiContents = [];
    if (req.body.history && Array.isArray(req.body.history)) {
      req.body.history.forEach(turn => {
        if (turn.role && turn.content) {
          geminiContents.push({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: turn.content }]
          });
        }
      });
    } else {
      geminiContents = [{ role: 'user', parts: [{ text: message }] }];
    }

    for (const model of models) {
      try {
        console.log(`[AI CHAT] Contacting Gemini API with model: ${model}`);
        const payload = JSON.stringify({
          contents: geminiContents,
          systemInstruction: {
            parts: [{ text: systemInstructionText }]
          }
        });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

        const responseBody = await new Promise((resolve, reject) => {
          const options = {
            method: 'POST',
            agent: sharedHttpsAgent,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          };
          const req3 = https.request(url, options, (res3) => {
            let body = '';
            res3.on('data', chunk => body += chunk);
            res3.on('end', () => {
              if (res3.statusCode !== 200) {
                reject(new Error(`Status ${res3.statusCode}: ${body}`));
              } else {
                resolve(body);
              }
            });
          });
          
          req3.on('error', reject);
          req3.setTimeout(15000, () => {
            req3.destroy();
            reject(new Error('Request Timeout (15s)'));
          });
          
          req3.write(payload);
          req3.end();
        });

        const parsed = JSON.parse(responseBody);
        const textResponse = parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts && parsed.candidates[0].content.parts[0] && parsed.candidates[0].content.parts[0].text;
        
        if (textResponse) {
          console.log(`[AI CHAT] Success response generated via Gemini model: ${model}`);
          return res.json({ response: textResponse });
        }
      } catch (err) {
        console.warn(`[AI CHAT] Gemini Model ${model} failed:`, err.message);
      }
    }
  }

  console.error('[CHAT ERROR] OpenAI failed to respond.');
  return res.status(500).json({ error: 'AI Service currently unavailable' });
});

// Secure endpoint to add testimonial from Bot
router.post('/api/testimonials', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.apikey;
  const expectedApiKey = process.env.FR3_API_KEY;
  
  if (!apiKey || apiKey !== expectedApiKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API key' });
  }

  const { name, role, text, rating, image, avatar } = req.body;
  if (!name || !text) {
    return res.status(400).json({ success: false, error: 'Name and text are required' });
  }

  // Clean the WA-bot command token (".uptesti") + "Name | Message | Rating" formatting
  // before saving, so the website never displays the raw command text. The upload ALWAYS
  // goes through — if cleaning somehow empties the text, we fall back to the raw values so
  // a real testimonial is never silently dropped.
  const norm = normalizeTestimonial({ name, text, rating });
  const finalName = (norm.name || '').trim() || name.trim();
  const finalText = (norm.text || '').trim() || text.trim();

  try {
    db.get('testimonials').push({
      id: uuidv4(),
      name: finalName,
      role: role || 'Gamer',
      text: finalText,
      rating: parseInt(norm.rating) || parseInt(rating) || 5,
      image: image || null,
      avatar: avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(finalName)}`,
      createdAt: new Date().toISOString(),
      approved: true
    }).write();

    console.log(`[BOT API] Testimonial from ${finalName} successfully added!`);
    return res.json({ success: true, message: 'Testimonial successfully added!' });
  } catch (err) {
    console.error('[BOT API Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Sitemap.xml & Robots.txt routes for robust SEO and Google Search Console indexing
router.get('/sitemap.xml', (req, res) => {
  res.header('Content-Type', 'application/xml');
  res.sendFile(path.join(__dirname, '../public/sitemap.xml'));
});

router.get('/robots.txt', (req, res) => {
  res.header('Content-Type', 'text/plain');
  res.sendFile(path.join(__dirname, '../public/robots.txt'));
});

module.exports = { router, getPlans };
