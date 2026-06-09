const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { ensureAuthenticated } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const https = require('https');

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

  // Generate a local unique code (10-99) if price is a multiple of 100 (round number)
  // to force the gateway to generate a unique QRIS and avoid payment matching failures.
  const localUniqueCode = actualPrice % 100 === 0 ? (Math.floor(Math.random() * 90) + 10) : 0;
  const nominal = actualPrice + localUniqueCode;

  try {
    const https = require('https');
    const payload = JSON.stringify({ apikey: FR3_API_KEY, nominal: nominal });

    fr3Data = await new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        family: 4, // Force IPv4 resolution to prevent Cloudflare/IPv6 connection hangs on cloud hosts
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
      req2.setTimeout(20000, () => { req2.destroy(); reject(new Error('FR3 Gateway Timeout (20s)')); }); // 20s timeout
      req2.write(payload);
      req2.end();
    });

    if (!fr3Data || !fr3Data.data || !fr3Data.data.trxId) {
      throw new Error(fr3Data?.message || 'API did not return a transaction ID');
    }
  } catch (e) {
    fr3Error = e.message;
    console.error('[FR3] Create topup error:', e.message);
  }

  // Check if API returned an error JSON instead of throwing a connection error
  if (!fr3Error && fr3Data && (!fr3Data.data || !fr3Data.data.trxId)) {
    fr3Error = fr3Data.message || 'API Gateway did not return transaction ID';
    console.warn('[FR3] Create topup API warning:', fr3Error);
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
    fr3TotalTransfer: fr3Data?.data?.totalTransfer || nominal,
    fr3UniqueCode: fr3Data?.data?.totalTransfer ? (fr3Data.data.totalTransfer - actualPrice) : localUniqueCode,
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
    qrisImage: process.env.QRIS_IMAGE || 'https://img1.pixhost.to/images/5339/592942381_rizzhosting.jpg',
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
        family: 4, // Force IPv4 resolution to prevent Cloudflare/IPv6 connection hangs on cloud hosts
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
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

      // Trigger Notifications for Admin
      const formattedPrice = 'Rp ' + order.price.toLocaleString('id-ID');
      const textMsg = `🎉 *PEMBAYARAN QRIS SUKSES*\n\n📋 Order ID: *#${order.orderId}*\n👤 Pembeli: ${order.userName} (${order.userEmail})\n📦 Paket: *${order.planName}*\n💰 Jumlah Bayar: ${formattedPrice}\n⚙️ Status: Aktif Otomatis\n\nSilakan cek admin panel untuk proses akun.`;
      
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

  // Coba cancel ke FR3 jika ada trxId
  if (order.fr3TrxId) {
    try {
      const https = require('https');
      const FR3_API_KEY = process.env.FR3_API_KEY || 'FR3_shact6823052026ehmlukrxggvoax';
      const payload = JSON.stringify({ apikey: FR3_API_KEY, trxId: order.fr3TrxId });
      
      const fr3Result = await new Promise((resolve) => {
        const options = {
          method: 'POST',
          family: 4, // Force IPv4 resolution to prevent Cloudflare/IPv6 connection hangs on cloud hosts
          headers: { 
            'Content-Type': 'application/json', 
            'Content-Length': Buffer.byteLength(payload), 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
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

// AI Chatbot API endpoint utilizing Gemini 2.5 Flash
router.post('/api/chat', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[CHAT ERROR] GEMINI_API_KEY is not defined in environment');
    return res.status(500).json({ error: 'AI Service configuration error' });
  }

  const systemInstructionText = `Kamu adalah AlexBot 🤖, asisten AI pintar untuk platform cloud gaming AlexCloud.
Tugas kamu adalah membantu pengguna dengan ramah, explaining services of AlexCloud.

Berikut adalah informasi detail tentang AlexCloud yang wajib kamu gunakan untuk menjawab pertanyaan:
- Harga Paket: 1 Minggu Rp 40.000, 1 Bulan Rp 60.000 (Paling populer), 2 Bulan Rp 100.000, 3 Bulan Rp 150.000. Semua akses ke 100+ game premium, streaming 4K/60fps, cloud save.
- Pembayaran: Scan QRIS via GoPay, OVO, DANA, ShopeePay, LinkAja, Mobile Banking. Setelah transfer, kirim bukti screenshot ke WhatsApp admin. Akun aktif 1-15 menit.
- Game Tersedia (contoh): GTA VI, GTA V, Cyberpunk 2077, Spider-Man 2, God of War Ragnarök, Elden Ring, Hogwarts Legacy, The Witcher 3, Red Dead Redemption 2, COD Black Ops 6, Battlefield 2042, EA FC 26, EA FC 25, MotoGP 25, MotoGP 24, Alan Wake 2.
- Fitur Unggulan: Streaming 4K / 60fps, Latency rendah <30ms (server Jakarta), Cloud Save otomatis, Login aman Google OAuth, Live chat support 24/7.
- Kebutuhan Internet: Minimum 5 Mbps (720p), Standar 10 Mbps (1080p/60fps), HD 15 Mbps, Ultra 4K 25 Mbps. WiFi 5GHz atau kabel LAN direkomendasikan.
- Perangkat Kompatibel: Laptop/PC (Windows, Mac, Linux), Smartphone Android & iOS, Smart TV (dengan browser), Tablet. Hanya butuh browser modern.
- Keunggulan vs PC: 10x lebih hemat (hanya Rp 60rb/bulan dibanding beli PC Rp 15-50 juta), tidak perlu maintenance/upgrade hardware, portable bisa main di mana saja.
- Kontrol: Keyboard+Mouse, Controller (Xbox, PS4/PS5, generic USB), Touch Screen di HP.

Batasan Penting Kamu:
Kamu HANYA boleh menjawab pertanyaan seputar cloud gaming, game, teknologi cloud, dan layanan AlexCloud.
Jika pengguna menanyakan hal lain yang tidak ada hubungannya dengan cloud gaming atau AlexCloud (misalnya resep makanan, matematika, politik, sejarah, coding umum, gosip artis, menyanyi, dll), kamu HARUS menjawab secara sopan dan ramah bahwa kamu adalah asisten virtual khusus AlexCloud dan memiliki batasan untuk hanya menjawab seputar cloud gaming dan layanan AlexCloud.

Gaya Komunikasi:
Jawab dalam Bahasa Indonesia dengan nada santai, ramah, dan seru khas gamer. Sering gunakan emoji yang sesuai. Gunakan sapaan 'kak' atau 'kamu'. Jawablah secara ringkas dan informatif.`;

  const payload = JSON.stringify({
    contents: [
      {
        parts: [
          {
            text: message
          }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: systemInstructionText
        }
      ]
    }
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const geminiReq = https.request(url, options, (geminiRes) => {
    let body = '';
    geminiRes.on('data', chunk => body += chunk);
    geminiRes.on('end', () => {
      try {
        if (geminiRes.statusCode !== 200) {
          console.error(`[CHAT ERROR] Gemini API returned status ${geminiRes.statusCode}:`, body);
          return res.status(500).json({ error: 'Error communicating with AI service' });
        }
        const parsed = JSON.parse(body);
        const textResponse = parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts && parsed.candidates[0].content.parts[0] && parsed.candidates[0].content.parts[0].text;
        if (textResponse) {
          return res.json({ response: textResponse });
        } else {
          console.error('[CHAT ERROR] Empty response or invalid structure from Gemini API:', parsed);
          return res.status(500).json({ error: 'Invalid response structure from AI service' });
        }
      } catch (e) {
        console.error('[CHAT ERROR] Exception parsing response:', e, body);
        return res.status(500).json({ error: 'Error parsing AI response' });
      }
    });
  });

  geminiReq.on('error', (err) => {
    console.error('[CHAT ERROR] Request error:', err);
    return res.status(500).json({ error: 'Network error calling AI service' });
  });

  geminiReq.write(payload);
  geminiReq.end();
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
