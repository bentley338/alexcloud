const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { ensureAuthenticated } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

// Helper: get plans from DB
function getPlans() {
  return db.get('plans').value();
}

// Homepage
router.get('/', (req, res) => {
  const games = db.get('games').value();
  const popularGames = games.filter(g => g.popular).slice(0, 8);
  const trendingGames = games.filter(g => g.rating >= 4.8).slice(0, 6);
  const testimonials = db.get('testimonials').filter({ approved: true }).value();
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
  const games = db.get('games').value();
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
router.get('/api/games/search', (req, res) => {
  const q = req.query.q ? req.query.q.toLowerCase() : '';
  if (!q) return res.json([]);
  const games = db.get('games').value();
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
  const games = db.get('games').value();
  let pool = genre ? games.filter(g => g.genre.toLowerCase().includes(genre.toLowerCase())) : games;
  if (pool.length < 3) pool = games;
  const sorted = pool.sort((a, b) => b.rating - a.rating).slice(0, 4);
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
  const testimonials = db.get('testimonials').filter({ approved: true }).value();
  res.render('testimonials', {
    title: 'Testimoni - AlexCloud',
    user: req.user || null,
    testimonials
  });
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

  const games = db.get('games').value();
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
    qrisImage: process.env.QRIS_IMAGE,
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
  const { planId, promoCode, promoId } = req.body;
  const plans = getPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return res.redirect('/pricing');

  let actualPrice = plan.price;
  let appliedPromo = null;
  let discount = 0;

  // Validate promo if provided
  if (promoCode && promoId) {
    const promo = db.get('promoCodes').find({ id: promoId, code: promoCode.toUpperCase(), isActive: true }).value();
    if (promo && !(promo.expiresAt && new Date(promo.expiresAt) < new Date()) && !(promo.maxUses && promo.usedCount >= promo.maxUses)) {
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

  // ===== FR3 NEWERA Payment Gateway =====
  const FR3_API_KEY = process.env.FR3_API_KEY || 'FR3_shact6823052026ehmlukrxggvoax';
  const FR3_BASE    = 'https://fr3newera.com/api/v1';

  let fr3Data = null;
  let fr3Error = null;

  try {
    const https = require('https');
    const payload = JSON.stringify({ apikey: FR3_API_KEY, nominal: actualPrice });

    fr3Data = await new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'AlexCloud/1.0 (+https://alexcloud.app)'
        }
      };
      const req2 = https.request(`${FR3_BASE}/topup`, options, (r) => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Invalid JSON from FR3')); }
        });
      });
      req2.on('error', reject);
      req2.setTimeout(15000, () => { req2.destroy(); reject(new Error('FR3 timeout')); });
      req2.write(payload);
      req2.end();
    });
  } catch (e) {
    fr3Error = e.message;
    console.error('[FR3] Create topup error:', e.message);
  }

  // Save order
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
    createdAt: new Date().toISOString(),
    paidAt: null,
    activatedAt: null,
    // FR3 data
    fr3TrxId: fr3Data?.data?.trxId || null,
    fr3QrString: fr3Data?.data?.qr_string || null,
    fr3TotalTransfer: fr3Data?.data?.totalTransfer || actualPrice,
    fr3UniqueCode: fr3Data?.data?.uniqueCode || 0,
    fr3Expiry: fr3Data?.data?.expiry || null,
    fr3Error: fr3Error || null,
    paymentMethod: fr3Data?.data?.trxId ? 'fr3_qris' : 'manual'
  };

  db.get('orders').push(order).write();

  const priceDisplay = 'Rp ' + actualPrice.toLocaleString('id-ID');
  const totalDisplay = 'Rp ' + (order.fr3TotalTransfer).toLocaleString('id-ID');

  res.render('payment', {
    title: 'Pembayaran - AlexCloud',
    user: req.user,
    order,
    plan,
    priceDisplay,
    totalDisplay,
    discount,
    fr3Success: !!fr3Data?.data?.trxId,
    fr3Error,
    qrisImage: process.env.QRIS_IMAGE,
    waNumber: process.env.WA_NUMBER || '82328437656'
  });
});

// =====================
// FR3 Payment Status API (polling)
// =====================
router.get('/api/payment/status/:orderId', ensureAuthenticated, async (req, res) => {
  const order = db.get('orders').find({ orderId: req.params.orderId, userId: req.user.id }).value();
  if (!order) return res.json({ error: 'Order tidak ditemukan' });
  if (!order.fr3TrxId) return res.json({ status: order.status, method: 'manual' });

  const FR3_API_KEY = process.env.FR3_API_KEY || 'FR3_shact6823052026ehmlukrxggvoax';
  const FR3_BASE    = 'https://fr3newera.com/api/v1';

  try {
    const https = require('https');
    const fr3Status = await new Promise((resolve, reject) => {
      const url = `${FR3_BASE}/check-status?apikey=${encodeURIComponent(FR3_API_KEY)}&idTransaksi=${encodeURIComponent(order.fr3TrxId)}`;
      const r = https.get(url, {
        headers: { 'User-Agent': 'AlexCloud/1.0 (+https://alexcloud.app)' },
        timeout: 10000
      }, (resp) => {
        let body = '';
        resp.on('data', d => body += d);
        resp.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Invalid JSON')); }
        });
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    });

    const fr3St = (fr3Status?.data?.status || 'PENDING').toUpperCase();

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

      // Trigger WhatsApp Notification for Admin
      const { sendWhatsAppNotification } = require('../utils/whatsapp');
      const formattedPrice = 'Rp ' + order.price.toLocaleString('id-ID');
      const waMsg = `🎉 *PEMBAYARAN QRIS SUKSES*\n\n📋 Order ID: *#${order.orderId}*\n👤 Pembeli: ${order.userName} (${order.userEmail})\n📦 Paket: *${order.planName}*\n💰 Jumlah Bayar: ${formattedPrice}\n⚙️ Status: Aktif Otomatis\n\nSilakan cek admin panel untuk proses akun.`;
      sendWhatsAppNotification(waMsg).catch(err => {
        console.error('[WA NOTIF] Notification send error:', err.message);
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

  // Coba cancel ke FR3 jika ada trxId
  if (order.fr3TrxId) {
    try {
      const https = require('https');
      const FR3_API_KEY = process.env.FR3_API_KEY || 'FR3_shact6823052026ehmlukrxggvoax';
      const payload = JSON.stringify({ apikey: FR3_API_KEY, trxId: order.fr3TrxId });
      
      const fr3Result = await new Promise((resolve) => {
        const options = {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Content-Length': Buffer.byteLength(payload), 
            'User-Agent': 'AlexCloud/1.0' 
          }
        };
        const r = https.request('https://fr3newera.com/api/v1/topup/cancel', options, (resp) => {
          let body = '';
          resp.on('data', d => body += d);
          resp.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              resolve({ status: 500, message: 'Invalid JSON response from FR3 Gateway' });
            }
          });
        });
        r.on('error', (err) => resolve({ status: 500, message: `Koneksi error: ${err.message}` }));
        r.setTimeout(10000, () => { 
          r.destroy(); 
          resolve({ status: 500, message: 'FR3 Gateway timeout' }); 
        });
        r.write(payload);
        r.end();
      });

      console.log('[FR3] Cancel response:', fr3Result);

      // Jika FR3 mengembalikan status selain 200, gagalkan pembatalan dan infokan error-nya!
      if (fr3Result && fr3Result.status !== 200) {
        return res.json({ 
          error: fr3Result.message || 'Gagal membatalkan transaksi di Payment Gateway.' 
        });
      }
    } catch (e) {
      console.error('[FR3] Cancel error:', e.message);
      return res.json({ error: `Gagal menghubungi server payment: ${e.message}` });
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

// Sitemap.xml & Robots.txt routes for robust SEO and Google Search Console indexing
router.get('/sitemap.xml', (req, res) => {
  const path = require('path');
  res.header('Content-Type', 'application/xml');
  res.sendFile(path.join(__dirname, '../public/sitemap.xml'));
});

router.get('/robots.txt', (req, res) => {
  const path = require('path');
  res.header('Content-Type', 'text/plain');
  res.sendFile(path.join(__dirname, '../public/robots.txt'));
});

module.exports = { router, getPlans };
