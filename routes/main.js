const express = require('express');
const router = express.Router();
const https = require('https');
const path = require('path');
const fs = require('fs');
const { db, getPlans, getGames, invalidateGamesCache, getWallet, getBalance, getWalletConfig, calcTopupBonus, applyWalletTx, getUserWalletTx, fulfillTopupOrder, activateUserSubscription } = require('../database/db');
const { ensureAuthenticated } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const { sharedHttpsAgent, fr3Request, sayabayarRequest, mustikapayRequest, createRateLimiter, BROWSER_UA, normalizeTestimonial, safeEqual, getBotSecret } = require('../utils/helpers');
const { ensureReferralCode, attachReferralOnRegister, getReferralConfig } = require('../utils/referral');

// --- BOT PROXY ENDPOINT ---
// Digunakan oleh botwa untuk melakukan request ke MustikaPay menggunakan server/proxy alexcloud
router.post('/api/bot/mustikapay', express.json(), async (req, res) => {
    try {
        const { secret, method, endpoint, payload } = req.body;
        // Auth via shared secret (env, dibandingkan timing-safe). Set BOT_SHARED_SECRET di .env.
        if (!safeEqual(secret, getBotSecret())) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const responseData = await mustikapayRequest(method, endpoint, payload, 15000, 3);
        res.json(responseData);
    } catch (err) {
        console.error("[BOT PROXY] Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint untuk botwa mengambil daftar testimoni terbaru untuk disajikan ke chat
router.post('/api/bot/testimonials', express.json(), (req, res) => {
    try {
        const { secret } = req.body;
        if (!safeEqual(secret, getBotSecret())) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const testimonials = getCleanTestimonials();
        // Ambil 5 testimoni acak atau terbaru yang memiliki rating tinggi (4 atau 5)
        const filtered = testimonials
            .filter(t => t.rating >= 4)
            .slice(-10); // ambil 10 terbaru
        res.json(filtered);
    } catch (err) {
        console.error("[BOT TESTIMONIALS] Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Secure endpoint untuk botwa AI Agent mengeksekusi perintah database/sistem secara aman (Owner Only)
router.post('/api/bot/agent-execute', express.json(), async (req, res) => {
    try {
        const { secret, code } = req.body;
        if (!safeEqual(secret, getBotSecret())) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        // Set env vars agar execSync bisa memanggil pm2 dengan benar tanpa error daemon
        process.env.PM2_HOME = '/home/ubuntu/.pm2';
        process.env.HOME = '/home/ubuntu';

        const dbHelpers = require('../database/db');
        const db = dbHelpers.db;
        const getPlans = dbHelpers.getPlans;
        const getGames = dbHelpers.getGames;
        const invalidatePlansCache = dbHelpers.invalidatePlansCache;
        const invalidateGamesCache = dbHelpers.invalidateGamesCache;

        // Jalankan kode secara dinamis (Hanya jika terautentikasi oleh bot secret yang aman)
        const executeFn = new Function('db', 'getPlans', 'getGames', 'invalidatePlansCache', 'invalidateGamesCache', 'require', `
            return (async () => {
                ${code}
            })();
        `);
        
        const result = await executeFn(db, getPlans, getGames, invalidatePlansCache, invalidateGamesCache, require);
        res.json({ success: true, result });
    } catch (err) {
        console.error("[BOT AGENT EXECUTE] Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Secure endpoint untuk men-trigger laporan analitik bisnis proaktif AI secara manual
router.post('/api/bot/proactive-report', express.json(), async (req, res) => {
    try {
        const { secret } = req.body;
        if (!safeEqual(secret, getBotSecret())) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const { runProactiveAnalysis } = require('../utils/helpers');
        const report = await runProactiveAnalysis(true); // Ambil teks mentah laporan
        res.json({ success: true, report });
    } catch (err) {
        console.error("[BOT PROACTIVE REPORT] Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint untuk menyimpan session botwa ke database website
router.post('/api/bot/save-session', express.json({ limit: '15mb' }), (req, res) => {
    try {
        const { secret, sessionData } = req.body;
        if (!safeEqual(secret, getBotSecret())) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        db.set('botSession', sessionData || {}).write();
        res.json({ success: true });
    } catch (err) {
        console.error("[BOT SAVE SESSION] Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint untuk memuat session botwa dari database website
router.post('/api/bot/load-session', express.json(), (req, res) => {
    try {
        const { secret } = req.body;
        if (!safeEqual(secret, getBotSecret())) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const sessionData = db.get('botSession').value() || {};
        res.json({ success: true, sessionData });
    } catch (err) {
        console.error("[BOT LOAD SESSION] Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});
// --------------------------

// ─── MustikaPay metode & opsi (dipakai selector di payment.ejs) ──────────────
// VA: kode bank MustikaPay = kode numerik Bank Indonesia (BUKAN singkatan —
// "BCA" ditolak, harus "014"). Diverifikasi langsung ke API.
const MP_BANKS = [
  { code: '014', name: 'BCA' },
  { code: '009', name: 'BNI' },
  { code: '002', name: 'BRI' },
  { code: '008', name: 'Mandiri' },
  { code: '013', name: 'Permata' },
  { code: '022', name: 'CIMB Niaga' },
  { code: '011', name: 'Danamon' },
  { code: '451', name: 'BSI' }
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
    // Cegah open redirect: hanya teruskan ke host gambar tepercaya via HTTPS.
    // (Halaman menyajikan URL http(s) langsung; endpoint ini hanya jalur cadangan.)
    const ALLOWED_IMAGE_HOSTS = [
      'res.cloudinary.com', 'wsrv.nl', 'api.dicebear.com',
      'placehold.co', 'pixhost.to', 'imgur.com', 'ibb.co'
    ];
    try {
      const u = new URL(trimmed);
      const host = u.hostname.toLowerCase();
      const ok = u.protocol === 'https:' &&
        ALLOWED_IMAGE_HOSTS.some(h => host === h || host.endsWith('.' + h));
      if (ok) return res.redirect(trimmed);
    } catch (e) { /* URL rusak → jatuh ke 404 */ }
  }

  return res.status(404).send('Image Not Found');
});

// Homepage
router.get('/', (req, res) => {
  // Tangkap kode referral kalau share link mendarat di homepage (?ref=KODE).
  if (req.query.ref) req.session.pendingRef = req.query.ref.toString().trim().toUpperCase();
  const games = getGames();
  const popularGames = games.filter(g => g.popular).slice(0, 8);
  const trendingGames = games.filter(g => g.rating >= 4.8).slice(0, 6);
  const testimonials = getCleanTestimonials();
  const plans = getPlans();
  let balance = 0;
  let lastDailyLogin = null;
  let loginStreak = 0;
  if (req.user) {
    const w = getWallet(req.user.id);
    balance = w.balance || 0;
    lastDailyLogin = w.lastDailyLogin || null;
    loginStreak = w.loginStreak || 0;
  }

  res.render('index', {
    title: 'AlexCloud - Premium Cloud Gaming',
    user: req.user || null,
    balance,
    lastDailyLogin,
    loginStreak,
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

// Review form — user writes testimonial after admin allows it
router.get('/review/:token', (req, res) => {
  const { token } = req.params;
  const order = db.get('orders').find({ reviewToken: token }).value();

  if (!order || !order.reviewAllowed) {
    return res.render('error', { title: 'Link Tidak Valid', message: 'Link ulasan tidak ditemukan atau sudah tidak berlaku.', user: req.user || null });
  }
  if (order.reviewedAt) {
    return res.render('error', { title: 'Sudah Diulas', message: 'Kamu sudah mengisi ulasan untuk order ini. Terima kasih! 🙏', user: req.user || null });
  }

  res.render('review', {
    title: 'Tulis Ulasan — AlexCloud',
    user: req.user || null,
    order,
    token,
    error: req.flash('error'),
    success: req.flash('success')
  });
});

const reviewUpload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/review/:token', reviewUpload.single('reviewImage'), async (req, res) => {
  const { token } = req.params;
  const order = db.get('orders').find({ reviewToken: token }).value();

  if (!order || !order.reviewAllowed) {
    return res.render('error', { title: 'Link Tidak Valid', message: 'Link ulasan tidak ditemukan atau sudah tidak berlaku.', user: req.user || null });
  }
  if (order.reviewedAt) {
    return res.render('error', { title: 'Sudah Diulas', message: 'Kamu sudah mengisi ulasan untuk order ini. Terima kasih! 🙏', user: req.user || null });
  }

  const { reviewerName, reviewText, reviewRating } = req.body;
  if (!reviewerName || !reviewText || !reviewRating) {
    req.flash('error', 'Nama, ulasan, dan rating wajib diisi.');
    return res.redirect(`/review/${token}`);
  }

  const rating = parseInt(reviewRating, 10);
  if (isNaN(rating) || rating < 1 || rating > 5) {
    req.flash('error', 'Rating tidak valid.');
    return res.redirect(`/review/${token}`);
  }

  let imageBase64 = null;
  if (req.file) {
    imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  }

  const { normalizeTestimonial } = require('../utils/helpers');
  const norm = normalizeTestimonial({ name: reviewerName, text: reviewText, rating });
  const finalName = (norm.name || '').trim() || reviewerName.trim();
  const finalText = (norm.text || '').trim() || reviewText.trim();

  const newTestimonial = {
    id: uuidv4(),
    name: finalName,
    role: `Pelanggan AlexCloud (${order.planName})`,
    text: finalText,
    rating,
    image: imageBase64 || null,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(finalName)}`,
    createdAt: new Date().toISOString(),
    approved: true,
    orderId: order.orderId,
    source: 'web-review'
  };

  db.get('testimonials').push(newTestimonial).write();

  // Mark order as reviewed
  db.get('orders').find({ reviewToken: token }).assign({
    reviewedAt: new Date().toISOString()
  }).write();

  console.log(`[REVIEW] Testimonial dari ${finalName} untuk order #${order.orderId} berhasil disimpan.`);

  // Trigger Poster generation, Instagram Story posting, and WhatsApp media alert asynchronously
  try {
    const { handleNewTestimonialAutoPublish } = require('../utils/instagram');
    handleNewTestimonialAutoPublish(newTestimonial).catch(err => console.error('[TESTIMONIAL AUTOPOST TRIGGER] Error:', err.message));
  } catch (err) {
    console.error('[TESTIMONIAL AUTOPOST TRIGGER EX] Error:', err.message);
  }

  return res.redirect(`/review/${token}/sukses`);
});

router.get('/review/:token/sukses', (req, res) => {
  const order = db.get('orders').find({ reviewToken: req.params.token }).value();
  res.render('review-success', {
    title: 'Ulasan Terkirim — AlexCloud',
    user: req.user || null,
    order: order || {}
  });
});

// Testimonials page
router.get('/testimonials', (req, res) => {
  const testimonials = getCleanTestimonials();

  // Check if logged-in user has pending review invitations & fetch their orders
  let pendingReviews = [];
  let userOrderIds = [];
  if (req.user) {
    const userOrders = db.get('orders').filter({ userId: req.user.id }).value() || [];
    userOrderIds = userOrders.map(o => o.orderId);
    pendingReviews = userOrders.filter(o => o.reviewAllowed && !o.reviewedAt);
  }

  const testimonialsWithOwn = testimonials.map(t => {
    const isOwn = (t.orderId && userOrderIds.includes(t.orderId)) ||
                  (req.user && t.name && t.name.toLowerCase() === req.user.name.toLowerCase());
    return { ...t, isOwn: !!isOwn };
  });

  res.render('testimonials', {
    title: 'Testimoni Pelanggan - AlexCloud',
    user: req.user || null,
    testimonials: testimonialsWithOwn,
    pendingReviews
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

// Redeem Referral (Dashboard)
router.post('/api/referral/redeem', ensureAuthenticated, express.json(), (req, res) => {
  const user = req.user;
  if (user.referredBy) {
    return res.json({ success: false, message: 'Anda sudah pernah menggunakan kode referral.' });
  }
  const refCodeRaw = req.body.refCode;
  if (!refCodeRaw) {
    return res.json({ success: false, message: 'Kode referral kosong.' });
  }

  // Ensure signupIp exists for anti-abuse tracking
  if (!user.signupIp) {
    user.signupIp = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || req.ip;
    db.get('users').find({ id: user.id }).assign({ signupIp: user.signupIp }).write();
  }

  const result = attachReferralOnRegister(req, res, user, refCodeRaw);

  if (result.status === 'none') return res.json({ success: false, message: 'Kode referral tidak ditemukan.' });
  if (result.status === 'self') return res.json({ success: false, message: 'Tidak bisa menggunakan kode milik sendiri.' });
  if (result.status === 'already') return res.json({ success: false, message: 'Anda sudah pernah menggunakan kode referral.' });
  if (result.status === 'blocked') {
    let reasonText = 'device ini sudah mencapai batas max 1 referral';
    if (result.reason === 'same_ip') reasonText = 'tidak bisa mereferralkan perangkat sendiri / IP yang sama';
    else if (result.reason === 'cookie') reasonText = 'perangkat ini sudah pernah menggunakan kode referral sebelumnya';

    // Kirim notifikasi perilaku tidak wajar (abuse referral) ke owner
    try {
      const { sendWhatsAppNotification } = require('../utils/whatsapp');
      const ip = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || req.ip;
      const notifMsg = `🚨 *PERINGATAN DETEKSI ABUSE REFERRAL* 🚨\n\n` +
        `👤 *Pengguna:* ${user.name} (${user.email})\n` +
        `🔑 *Kode:* ${refCodeRaw.toUpperCase()}\n` +
        `⚠️ *Jenis Abuse:* ${reasonText}\n` +
        `🌐 *IP Address:* ${ip}\n` +
        `📅 *Waktu:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
        `Sistem berhasil memblokir upaya klaim diskon referral ini karena terindikasi tidak wajar.`;
      sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF ABUSE ERROR]', err.message));
    } catch (err) {
      console.error('[WA NOTIF ABUSE EXCEPTION]', err.message);
    }

    return res.json({ success: false, message: `Gagal! Terindikasi abuse (${reasonText}).` });
  }

  // Kirim notifikasi ke owner via WhatsApp
  try {
    const { sendWhatsAppNotification } = require('../utils/whatsapp');
    const notifMsg = `🎁 *PENGGUNA KLAIM REFERRAL* 🎁\n\n` +
      `👤 *Pengguna:* ${user.name} (${user.email})\n` +
      `🔑 *Kode:* ${refCodeRaw.toUpperCase()}\n` +
      `⚙️ *Status:* Sukses diklaim\n\n` +
      `Diskon welcome telah ditambahkan ke kupon pengguna.`;
    sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF REFERRAL ERROR]', err.message));
  } catch (err) {
    console.error('[WA NOTIF REFERRAL EXCEPTION]', err.message);
  }

  return res.json({ success: true, message: 'Kode berhasil digunakan! Cek bagian kupon Anda.' });
});

// Dashboard
router.get('/dashboard', ensureAuthenticated, (req, res) => {
  const orders = db.get('orders').filter({ userId: req.user.id }).sortBy('createdAt').reverse().value();
  const activeSub = db.get('subscriptions').value().find(sub => 
    sub.userId === req.user.id && 
    sub.status === 'active' && 
    sub.planId !== 'royal_access'
  );

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

  // ─── Referral ─────────────────────────────────────────────────────────────
  const referralCode = ensureReferralCode(req.user);
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const referralLink = `${baseUrl}/register?ref=${referralCode}`;
  const myReferrals = db.get('referrals').filter({ referrerId: req.user.id }).value();
  const refCfg = getReferralConfig();
  const referral = {
    code: referralCode,
    link: referralLink,
    welcomeDiscount: refCfg.welcomeDiscount || 0,
    referrerReward: refCfg.referrerReward || 0,
    invitedCount: myReferrals.length,
    rewardedCount: myReferrals.filter(r => r.status === 'rewarded').length,
    // Kode diskon pribadi milik user yang masih bisa dipakai
    myCoupons: db.get('promoCodes').value()
      .filter(p => p.ownerUserId === req.user.id && p.isActive && (!p.maxUses || (p.usedCount || 0) < p.maxUses))
      .map(p => ({ code: p.code, value: p.discountValue, kind: p.kind, description: p.description }))
  };

  res.render('dashboard', {
    title: 'Dashboard - AlexCloud',
    user: req.user,
    orders,
    subscription: subInfo,
    plans,
    games,
    referral,
    balance: getBalance(req.user.id),
    moment,
    rememberMe: req.session.rememberMe || false
  });
});

// API: Claim Royal Daily Coins
router.post('/api/royal/claim-daily', ensureAuthenticated, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user || !user.isRoyal) {
    return res.json({ success: false, message: 'Anda bukan anggota Royal Club.' });
  }

  // Check last claim
  const now = new Date();
  if (user.lastRoyalClaim) {
    const lastClaim = new Date(user.lastRoyalClaim);
    const diffTime = Math.abs(now - lastClaim);
    const diffHours = diffTime / (1000 * 60 * 60);
    if (diffHours < 24) {
      const hoursLeft = Math.ceil(24 - diffHours);
      return res.json({ success: false, message: `Anda sudah mengklaim hari ini. Silakan coba lagi dalam ${hoursLeft} jam.` });
    }
  }

  // Update user last claim time
  db.get('users')
    .find({ id: user.id })
    .assign({ 
      lastRoyalClaim: now.toISOString()
    })
    .write();

  // Add 500 to wallet balance via applyWalletTx
  applyWalletTx(req.user.id, {
    type: 'credit',
    amount: 500,
    refType: 'royal_daily_claim',
    refId: 'CLAIM_' + Date.now(),
    note: 'Klaim Harian Royal Club'
  });

  return res.json({ success: true, message: 'Berhasil mengklaim Rp 500!' });
});

// API: Save Royal Settings
router.post('/api/royal/settings', ensureAuthenticated, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user || !user.isRoyal) {
    return res.json({ success: false, message: 'Anda bukan anggota Royal Club.' });
  }

  const { key, value } = req.body;
  if (key === 'bitrate') {
    const bitrate = Math.min(100, Math.max(10, parseInt(value) || 50));
    db.get('users').find({ id: user.id }).assign({ royalBitrate: bitrate }).write();
  } else if (key === 'controller') {
    const preset = value || 'default';
    db.get('users').find({ id: user.id }).assign({ royalController: preset }).write();
  } else {
    return res.json({ success: false, message: 'Pengaturan tidak dikenal.' });
  }

  return res.json({ success: true });
});

// API: Submit Game Request
router.post('/api/royal/game-request', ensureAuthenticated, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user || !user.isRoyal) {
    return res.json({ success: false, message: 'Anda bukan anggota Royal Club.' });
  }

  const { title } = req.body;
  if (!title || !title.trim()) {
    return res.json({ success: false, message: 'Nama game tidak boleh kosong.' });
  }

  const cleanTitle = title.trim();
  const request = {
    id: 'REQ_' + Date.now(),
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    title: cleanTitle,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  db.get('gameRequests').push(request).write();
  return res.json({ success: true });
});

// Order page
router.get('/order/:planId', ensureAuthenticated, (req, res) => {
  const plans = getPlans();
  let plan = plans.find(p => p.id === req.params.planId);
  if (!plan) return res.redirect('/pricing');
  if (plan.royalOnly && !req.user.isRoyal) {
    req.flash('error', 'Opsi harian hanya untuk member Royal Club. Silakan beli Royal Club Access terlebih dahulu!');
    return res.redirect('/pricing');
  }

  if (plan.id === 'custom_royal') {
    const days = Math.min(6, Math.max(1, parseInt(req.query.days) || 1));
    plan = {
      ...plan,
      name: `Sewa Harian (${days} Hari)`,
      duration: days,
      price: days * 7000,
      priceDisplay: 'Rp ' + (days * 7000).toLocaleString('id-ID')
    };
  }
  const promoCodes = db.get('promoCodes').filter({ isActive: true }).value();
  res.render('order', {
    title: `Order ${plan.name} - AlexCloud`,
    user: req.user,
    plan,
    balance: getBalance(req.user.id),
    qrisImage: process.env.QRIS_IMAGE || 'https://img1.pixhost.to/images/5339/592942381_rizzhosting.jpg',
    waNumber: process.env.WA_NUMBER
  });
});

// Anti-abuse: satu user tidak boleh memakai kode promo yang sama lebih dari sekali.
// Mencegah user "memfarming" diskon kode publik lewat banyak order. Order yang sudah
// batal/ditolak/kadaluarsa tidak dihitung, jadi user tetap bisa coba ulang setelah gagal.
function userAlreadyUsedPromo(userId, code) {
  if (!code) return false;
  const up = String(code).toUpperCase();
  return (db.get('orders').value() || []).some(o =>
    o.userId === userId &&
    o.promoCode && o.promoCode.toUpperCase() === up &&
    !['cancelled', 'rejected', 'expired'].includes(o.status)
  );
}

// Validate promo code API
router.post('/api/promo/validate', ensureAuthenticated, (req, res) => {
  const { code, planId } = req.body;
  if (!code) return res.json({ valid: false, message: 'Kode promo tidak boleh kosong.' });

  const plans = getPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return res.json({ valid: false, message: 'Paket tidak ditemukan.' });

  const promo = db.get('promoCodes').find({ code: code.toUpperCase(), isActive: true }).value();
  if (!promo) return res.json({ valid: false, message: 'Kode promo tidak valid atau sudah tidak aktif.' });

  // Personal code (referral/welcome) hanya bisa dipakai pemiliknya
  if (promo.ownerUserId && promo.ownerUserId !== req.user.id) {
    return res.json({ valid: false, message: 'Kode ini hanya bisa dipakai oleh pemilik akunnya.' });
  }

  // Check expiry
  if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
    return res.json({ valid: false, message: 'Kode promo sudah kadaluarsa.' });
  }

  // Check usage limit
  if (promo.maxUses && promo.usedCount >= promo.maxUses) {
    return res.json({ valid: false, message: 'Kode promo sudah mencapai batas penggunaan.' });
  }

  // Anti-abuse: cegah user memakai ulang kode yang sama
  if (userAlreadyUsedPromo(req.user.id, promo.code)) {
    return res.json({ valid: false, message: 'Kamu sudah pernah memakai kode promo ini.' });
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
  const { planId, promoCode, promoId, paymentMethod, customDays } = req.body;
  const plans = getPlans();
  let plan = plans.find(p => p.id === planId);
  if (!plan) return res.redirect('/pricing');
  if (plan.royalOnly && !req.user.isRoyal) {
    req.flash('error', 'Opsi harian hanya untuk member Royal Club. Silakan beli Royal Club Access terlebih dahulu!');
    return res.redirect('/pricing');
  }

  let selectedDuration = plan.duration;
  let selectedPlanName = plan.name;
  if (plan.id === 'custom_royal') {
    const days = Math.min(6, Math.max(1, parseInt(customDays) || 1));
    selectedDuration = days;
    selectedPlanName = `Sewa Harian (${days} Hari)`;
    plan = {
      ...plan,
      duration: days,
      price: days * 7000
    };
  }

  let actualPrice = plan.price;
  let appliedPromo = null;
  let discount = 0;

  // Validate promo if provided
  if (promoCode && promoId) {
    const promo = db.get('promoCodes').find({ id: promoId, code: promoCode.toUpperCase(), isActive: true }).value();
    if (promo && !(promo.ownerUserId && promo.ownerUserId !== req.user.id) && !(promo.expiresAt && new Date(promo.expiresAt) < new Date()) && !(promo.maxUses && promo.usedCount >= promo.maxUses) && !(promo.minPurchase && plan.price < promo.minPurchase) && !userAlreadyUsedPromo(req.user.id, promo.code)) {
      if (promo.discountType === 'percent') {
        discount = Math.round(plan.price * promo.discountValue / 100);
      } else {
        discount = Math.min(promo.discountValue, plan.price);
      }
      actualPrice = Math.max(0, plan.price - discount);
      appliedPromo = promo;
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
    orderType: 'subscription', // 'subscription' | 'topup'
    planId: plan.id,
    planName: selectedPlanName,
    duration: selectedDuration,
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
    paymentMethod: null,
    tracking: req.session.tracking || null
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

// Generate QRIS dengan fallback berurutan: MustikaPay → FR3 (SayaBayar dinonaktifkan).
// Hanya QRIS yang punya fallback; VA/E-Money/Retail eksklusif MustikaPay.
async function generateQris(orderInternalId, actualPrice, order) {
  const sequence = ['mustikapay', 'fr3'];

  const errors = {};
  for (const gw of sequence) {
    try {
      if (gw === 'mustikapay') await tryMustikapayQris(orderInternalId, actualPrice, order);
      else if (gw === 'fr3') {
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
  throw new Error(`MustikaPay: ${errors.mustikapay || '-'} | FR3: ${errors.fr3 || '-'}`);
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

  // Empat state halaman:
  //  - 'success'    : order sudah lunas / sukses
  //  - 'instrument' : instrumen bayar sudah dibuat (render QR/VA/e-wallet/retail + polling)
  //  - 'manual'     : semua gateway gagal → fallback transfer manual via WA
  //  - 'select'     : belum memilih metode → tampilkan selector
  let payState = 'select';
  if (order.status === 'confirmed' || order.status === 'completed' || order.status === 'active') payState = 'success';
  else if (order.payMethodType === 'bonus_referral') payState = 'bonus';
  else if (order.qrisStatus === 'ready' && order.payMethodType) payState = 'instrument';
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
    
    // Kirim notifikasi ke owner via WhatsApp
    try {
      const { sendWhatsAppNotification } = require('../utils/whatsapp');
      const cleanMethod = method.toUpperCase() + (
        method === 'va' ? ` (${bank_code})` :
        method === 'emoney' ? ` (${product_code})` :
        method === 'retail' ? ` (${retail_outlet})` : ''
      );
      let trackingInfo = '';
      if (order.tracking && Object.keys(order.tracking).length > 0) {
        trackingInfo = `📍 *Tracking:* ${Object.entries(order.tracking).map(([k,v]) => `${k}=${v}`).join(', ')}\n`;
      }
      const notifMsg = `🔔 *NOTIFIKASI PEMBAYARAN BARU DI GENERATE* 🔔\n\n` +
        `👤 *Pengguna:* ${order.userName} (${order.userEmail})\n` +
        `📦 *Paket:* ${order.planName}\n` +
        `💰 *Total Nominal:* Rp ${order.price.toLocaleString('id-ID')}\n` +
        `💳 *Metode:* ${cleanMethod}\n` +
        `📝 *ID Order:* ${order.orderId}\n` +
        `${trackingInfo}\n` +
        `Silakan pantau status pembayaran di dashboard admin.`;
      
      sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF GENERATE ERROR]', err.message));
    } catch (err) {
      console.error('[WA NOTIF GENERATE EXCEPTION]', err.message);
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

    // Re-fetch order from DB to prevent TOC-TOU race condition
    const currentOrder = db.get('orders').find({ id: order.id }).value();
    if (!currentOrder) return res.json({ status: 'error', message: 'Order hilang' });

    // Auto-confirm jika SUCCESS atau PAID
    if ((fr3St === 'SUCCESS' || fr3St === 'PAID' || fr3St === 'SETTLED') && currentOrder.status === 'pending') {
      db.get('orders').find({ id: order.id }).assign({
        status: 'confirmed',
        paidAt: new Date().toISOString()
      }).write();

      // ─── Cabang TOP-UP: kreditkan saldo (bukan aktivasi subscription) ─────────
      if ((currentOrder.orderType || 'subscription') === 'topup') {
        const result = fulfillTopupOrder(order.id, { createdBy: 'gateway' });
        db.get('orders').find({ id: order.id }).assign({ activatedAt: new Date().toISOString() }).write();

        const totalCredit = (result.amount || 0) + (result.bonus || 0);
        const topupMsg = `💰 *TOP-UP SALDO SUKSES*\n\n` +
          `📋 Order ID: *#${order.orderId}*\n` +
          `👤 User: ${order.userName} (${order.userEmail})\n` +
          `💵 Nominal: Rp ${(result.amount || order.price).toLocaleString('id-ID')}` +
          (result.bonus ? `\n🎁 Bonus: Rp ${result.bonus.toLocaleString('id-ID')}` : '') +
          `\n💳 Saldo Masuk: Rp ${totalCredit.toLocaleString('id-ID')}` +
          `\n🏦 Saldo Sekarang: Rp ${(result.balanceAfter || 0).toLocaleString('id-ID')}`;
        try {
          const { sendWhatsAppNotification } = require('../utils/whatsapp');
          sendWhatsAppNotification(topupMsg).catch(err => console.error('[WA NOTIF TOPUP]', err.message));
        } catch (e) { console.error('[WA NOTIF TOPUP EX]', e.message); }
        try {
          const { sendTelegramNotification } = require('../utils/telegram');
          sendTelegramNotification(topupMsg).catch(err => console.error('[TG NOTIF TOPUP]', err.message));
        } catch (e) { console.error('[TG NOTIF TOPUP EX]', e.message); }

        return res.json({
          fr3Status: fr3St,
          status: 'confirmed',
          orderType: 'topup',
          redirectUrl: '/wallet',
          trxId: order.fr3TrxId,
          amount: order.price
        });
      }

      // Mode "saldo + kurang top-up": potong saldo yang dipakai di paket ini (sekali saja).
      if (currentOrder.walletApplied > 0 && !currentOrder.walletDebited) {
        try {
          db.get('orders').find({ id: order.id }).assign({ walletDebited: true }).write();
          applyWalletTx(currentOrder.userId, {
            type: 'purchase', amount: currentOrder.walletApplied, refType: 'order', refId: currentOrder.orderId,
            note: `Potong saldo untuk paket ${currentOrder.planName} #${currentOrder.orderId}`, createdBy: 'gateway',
            allowNegative: true
          });
        } catch (e) { console.error('[WALLET DEBIT ON PAID]', e.message); }
      }

      // Burn promo code
      if (currentOrder.promoCode) {
        const promo = db.get('promoCodes').find({ code: currentOrder.promoCode.toUpperCase() }).value();
        if (promo) {
          db.get('promoCodes').find({ id: promo.id }).assign({ usedCount: (promo.usedCount || 0) + 1 }).write();
        }
      }

      // Auto-activate subscription
      const plans = getPlans();
      const plan = plans.find(p => p.id === currentOrder.planId);
      if (plan) {
        activateUserSubscription(currentOrder.userId, plan.id, order.orderId);
        db.get('orders').find({ id: order.id }).assign({ activatedAt: new Date().toISOString() }).write();
      }

      // Trigger Referral Hook
      const { rewardReferrerOnFirstOrder } = require('../utils/referral');
      const reward = rewardReferrerOnFirstOrder(currentOrder);

      // Trigger Notifications for Admin
      const methodLabels = { qris: 'QRIS', va: 'Virtual Account', emoney: 'E-Wallet', retail: 'Retail' };
      const methodLabel = methodLabels[order.payMethodType] || 'QRIS';
      const formattedPrice = 'Rp ' + order.price.toLocaleString('id-ID');
      let textMsg = `🎉 *PEMBAYARAN SUKSES (${methodLabel})*\n\n📋 Order ID: *#${order.orderId}*\n👤 Pembeli: ${order.userName} (${order.userEmail})\n📦 Paket: *${order.planName}*\n💰 Jumlah Bayar: ${formattedPrice}\n⚙️ Status: Aktif Otomatis\n\nSilakan cek admin panel untuk proses akun.`;
      
      if (reward) {
        textMsg += `\n\n🎁 *Referral Reward Cair!* Pengajak (${reward.referrerName}) mendapat kode ${reward.rewardCode}`;
        if (reward.bonusDays) textMsg += ` + Gratis langganan ${reward.bonusDays} hari (Invoice Rp0 #${reward.bonusOrderId})!`;
      }

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

  // Re-fetch order from DB to prevent TOC-TOU race condition
  const currentOrder = db.get('orders').find({ id: order.id }).value();
  if (currentOrder && (currentOrder.status === 'confirmed' || currentOrder.status === 'cancelled')) {
    return res.json({ error: `Order sudah ${currentOrder.status}, pembatalan gagal` });
  }

  // Jika berhasil cancel di FR3 (atau tidak pakai QRIS), cancel di DB lokal
  db.get('orders').find({ id: order.id }).assign({
    status: 'cancelled',
    cancelledAt: new Date().toISOString()
  }).write();

  // Kirim notifikasi ke owner via WhatsApp
  try {
    const { sendWhatsAppNotification } = require('../utils/whatsapp');
    const notifMsg = `❌ *ORDER DIBATALKAN OLEH PENGGUNA* ❌\n\n` +
      `👤 *Pengguna:* ${order.userName} (${order.userEmail})\n` +
      `📦 *Paket:* ${order.planName}\n` +
      `💰 *Nominal:* Rp ${order.price.toLocaleString('id-ID')}\n` +
      `📝 *ID Order:* ${order.orderId}\n\n` +
      `Pesanan ini telah dibatalkan oleh pengguna.`;
    sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF CANCEL ERROR]', err.message));
  } catch (err) {
    console.error('[WA NOTIF CANCEL EXCEPTION]', err.message);
  }

  return res.json({ success: true, message: 'Pesanan berhasil dibatalkan' });
});


// ═══════════════════════════════════════════════════════════════════════════
//  WALLET / SALDO
// ═══════════════════════════════════════════════════════════════════════════

// Halaman dompet: saldo, top-up (preset + custom), info bonus, riwayat mutasi.
router.get('/wallet', ensureAuthenticated, (req, res) => {
  const cfg = getWalletConfig();
  const wallet = getWallet(req.user.id);
  const tx = getUserWalletTx(req.user.id);
  // Nominal preset yang lazim dipakai untuk top-up.
  const presets = [10000, 25000, 50000, 100000, 200000, 500000].filter(n => n >= cfg.minTopup && n <= cfg.maxTopup);
  res.render('wallet', {
    title: 'Saldo & Top-up - AlexCloud',
    user: req.user,
    wallet,
    balance: wallet.balance || 0,
    tx,
    config: cfg,
    presets,
    moment,
    success: req.flash('success'),
    error: req.flash('error')
  });
});

// Buat order top-up → arahkan ke halaman pembayaran (reuse selector metode + gateway).
router.post('/wallet/topup', ensureAuthenticated, (req, res) => {
  const cfg = getWalletConfig();
  if (!cfg.enabled) {
    req.flash('error', 'Fitur top-up sedang dinonaktifkan.');
    return res.redirect('/wallet');
  }
  const amount = Math.round(Number(req.body.amount) || 0);
  if (!Number.isFinite(amount) || amount < cfg.minTopup) {
    req.flash('error', `Nominal minimal top-up Rp ${cfg.minTopup.toLocaleString('id-ID')}.`);
    return res.redirect('/wallet');
  }
  if (amount > cfg.maxTopup) {
    req.flash('error', `Nominal maksimal top-up Rp ${cfg.maxTopup.toLocaleString('id-ID')}.`);
    return res.redirect('/wallet');
  }

  const bonus = calcTopupBonus(amount);
  const orderId = 'TP' + Date.now().toString().slice(-8).toUpperCase();
  const order = {
    id: uuidv4(),
    orderId,
    userId: req.user.id,
    userName: req.user.name,
    userEmail: req.user.email,
    orderType: 'topup',
    planId: 'topup',
    planName: `Top-up Saldo Rp ${amount.toLocaleString('id-ID')}`,
    price: amount,
    originalPrice: amount,
    discount: 0,
    promoCode: null,
    topupAmount: amount,
    topupBonus: bonus,
    walletCredited: false,
    status: 'pending',
    qrisStatus: 'awaiting_method',
    payMethodType: null,
    gateway: null,
    nominal: amount,
    createdAt: new Date().toISOString(),
    paidAt: null,
    activatedAt: null,
    fr3TrxId: null,
    fr3QrString: null,
    fr3TotalTransfer: amount,
    fr3UniqueCode: 0,
    fr3Expiry: null,
    fr3Error: null,
    mpPaymentLink: null,
    mpVaNumber: null, mpVaName: null, mpBankCode: null,
    mpPaymentCode: null, mpRetailOutlet: null,
    mpEwalletProvider: null,
    paymentMethod: null,
    tracking: req.session.tracking || null
  };
  db.get('orders').push(order).write();
  res.redirect('/payment/' + order.orderId);
});

// Bayar paket memakai saldo. Jika saldo cukup → langsung aktif. Jika kurang →
// buat order paket dengan sebagian dibayar saldo, sisanya via gateway.
router.post('/wallet/pay-plan', ensureAuthenticated, (req, res) => {
  const { planId, promoCode, promoId, customDays } = req.body;
  const plans = getPlans();
  let plan = plans.find(p => p.id === planId);
  if (!plan) { req.flash('error', 'Paket tidak ditemukan.'); return res.redirect('/pricing'); }
  if (plan.royalOnly && !req.user.isRoyal) {
    req.flash('error', 'Opsi harian hanya untuk member Royal Club. Silakan beli Royal Club Access terlebih dahulu!');
    return res.redirect('/pricing');
  }

  let selectedDuration = plan.duration;
  let selectedPlanName = plan.name;
  if (plan.id === 'custom_royal') {
    const days = Math.min(6, Math.max(1, parseInt(customDays) || 1));
    selectedDuration = days;
    selectedPlanName = `Sewa Harian (${days} Hari)`;
    plan = {
      ...plan,
      duration: days,
      price: days * 7000
    };
  }

  // Terapkan promo (jika valid) — logika sama dengan POST /order.
  let actualPrice = plan.price;
  let appliedPromo = null;
  let discount = 0;
  if (promoCode && promoId) {
    const promo = db.get('promoCodes').find({ id: promoId, code: String(promoCode).toUpperCase(), isActive: true }).value();
    if (promo && !(promo.ownerUserId && promo.ownerUserId !== req.user.id) && !(promo.expiresAt && new Date(promo.expiresAt) < new Date()) && !(promo.maxUses && promo.usedCount >= promo.maxUses) && !(promo.minPurchase && plan.price < promo.minPurchase) && !userAlreadyUsedPromo(req.user.id, promo.code)) {
      discount = promo.discountType === 'percent'
        ? Math.round(plan.price * promo.discountValue / 100)
        : Math.min(promo.discountValue, plan.price);
      actualPrice = Math.max(0, plan.price - discount);
      appliedPromo = promo;
    }
  }

  const balance = getBalance(req.user.id);
  const orderId = 'AC' + Date.now().toString().slice(-8).toUpperCase();

  // ─── Saldo cukup: aktivasi instan ───────────────────────────────────────────
  if (balance >= actualPrice) {
    const now = new Date().toISOString();
    const order = {
      id: uuidv4(), orderId,
      userId: req.user.id, userName: req.user.name, userEmail: req.user.email,
      orderType: 'subscription',
      planId: plan.id, planName: selectedPlanName,
      duration: selectedDuration,
      price: actualPrice, originalPrice: plan.price, discount,
      promoCode: appliedPromo ? appliedPromo.code : null,
      status: 'confirmed', qrisStatus: 'success',
      payMethodType: 'wallet', gateway: 'wallet', nominal: actualPrice,
      walletApplied: actualPrice, walletDebited: true,
      createdAt: now, paidAt: now, activatedAt: now,
      fr3TotalTransfer: actualPrice, fr3UniqueCode: 0,
      paymentMethod: 'wallet',
      tracking: req.session.tracking || null
    };
    db.get('orders').push(order).write();

    // Potong saldo.
    applyWalletTx(req.user.id, {
      type: 'purchase', amount: actualPrice, refType: 'order', refId: orderId,
      note: `Beli paket ${plan.name} #${orderId}`, createdBy: 'user'
    });

    // Burn promo.
    if (appliedPromo) {
      db.get('promoCodes').find({ id: appliedPromo.id }).assign({ usedCount: (appliedPromo.usedCount || 0) + 1 }).write();
    }

    // Aktivasi subscription
    activateUserSubscription(req.user.id, plan.id, orderId, selectedDuration);

    // Referral hook + notifikasi.
    try {
      const { rewardReferrerOnFirstOrder } = require('../utils/referral');
      const reward = rewardReferrerOnFirstOrder(order);
      const { sendWhatsAppNotification } = require('../utils/whatsapp');
      const { sendTelegramNotification } = require('../utils/telegram');
      let msg = `🎉 *PEMBELIAN PAKET via SALDO*\n\n📋 Order: *#${orderId}*\n👤 ${order.userName} (${order.userEmail})\n📦 Paket: *${plan.name}*\n💳 Potong Saldo: Rp ${actualPrice.toLocaleString('id-ID')}\n🏦 Sisa Saldo: Rp ${getBalance(req.user.id).toLocaleString('id-ID')}\n⚙️ Status: Aktif Otomatis`;
      if (order.tracking && Object.keys(order.tracking).length > 0) {
        msg += `\n📍 *Tracking:* ${Object.entries(order.tracking).map(([k,v]) => `${k}=${v}`).join(', ')}`;
      }
      if (reward) msg += `\n\n🎁 Referral reward cair untuk ${reward.referrerName} (${reward.rewardCode})`;
      sendWhatsAppNotification(msg).catch(() => {});
      sendTelegramNotification(msg).catch(() => {});
    } catch (e) { console.error('[WALLET PAY NOTIF]', e.message); }

    req.flash('success', `Paket ${plan.name} berhasil dibeli dengan saldo! Akun langsung aktif.`);
    return res.redirect('/dashboard');
  }

  // ─── Saldo kurang: sebagian saldo + sisa via gateway ────────────────────────
  let walletApplied = balance;
  let remainder = actualPrice - walletApplied;
  const GATEWAY_MIN = 1000; // minimum QRIS MustikaPay
  if (remainder > 0 && remainder < GATEWAY_MIN) {
    // Sisakan tepat GATEWAY_MIN agar diterima gateway (saldo terpakai sedikit lebih kecil).
    walletApplied = Math.max(0, actualPrice - GATEWAY_MIN);
    remainder = actualPrice - walletApplied;
  }

  const order = {
    id: uuidv4(), orderId,
    userId: req.user.id, userName: req.user.name, userEmail: req.user.email,
    orderType: 'subscription',
    planId: plan.id, planName: selectedPlanName,
    duration: selectedDuration,
    price: remainder,           // yang ditagih gateway
    originalPrice: plan.price, discount,
    promoCode: appliedPromo ? appliedPromo.code : null,
    walletApplied,              // dipotong saat pembayaran gateway sukses
    walletDebited: false,
    status: 'pending', qrisStatus: 'awaiting_method',
    payMethodType: null, gateway: null, nominal: remainder,
    createdAt: new Date().toISOString(), paidAt: null, activatedAt: null,
    fr3TrxId: null, fr3QrString: null, fr3TotalTransfer: remainder, fr3UniqueCode: 0,
    fr3Expiry: null, fr3Error: null,
    mpPaymentLink: null, mpVaNumber: null, mpVaName: null, mpBankCode: null,
    mpPaymentCode: null, mpRetailOutlet: null, mpEwalletProvider: null, paymentMethod: null,
    tracking: req.session.tracking || null
  };
  db.get('orders').push(order).write();
  req.flash('success', `Saldo Rp ${walletApplied.toLocaleString('id-ID')} dipakai. Sisa Rp ${remainder.toLocaleString('id-ID')} bayar via pembayaran di bawah.`);
  res.redirect('/payment/' + order.orderId);
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
  const { name, phone } = req.body;
  if (!name) { req.flash('error', 'Nama tidak boleh kosong.'); return res.redirect('/profile'); }

  // Sanitize phone: keep digits only, ensure starts with 62 (Indonesia)
  let cleanPhone = null;
  if (phone) {
    cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
    if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.slice(1);
    if (cleanPhone.length < 9 || cleanPhone.length > 15) cleanPhone = null;
  }

  const updates = { name: name.trim() };
  if (cleanPhone !== null) updates.phone = cleanPhone;

  db.get('users').find({ id: req.user.id }).assign(updates).write();
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
      'gemini-3.5-flash',
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
  // Gunakan secret di body request — tidak perlu sync env var ke botwa.
  // BOT_SHARED_SECRET di .env alexcloud, fallback ke hardcoded default yang sama di botwa.
  const { secret } = req.body;
  const BOT_SECRET = process.env.BOT_SHARED_SECRET || 'alexcloud-botwa-secret-2026';

  if (!secret || !safeEqual(secret, BOT_SECRET)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
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

    // Kirim notifikasi ke owner via WhatsApp
    try {
      const { sendWhatsAppNotification } = require('../utils/whatsapp');
      const stars = '⭐'.repeat(parseInt(norm.rating) || parseInt(rating) || 5);
      const notifMsg = `📝 *TESTIMONI BARU DITERIMA* 📝\n\n` +
        `👤 *Pengirim:* ${finalName}\n` +
        `⭐ *Rating:* ${stars}\n` +
        `💬 *Ulasan:* "${finalText}"\n\n` +
        `Ulasan baru telah otomatis masuk dan ditampilkan di website.`;
      sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF TESTI ERROR]', err.message));
    } catch (err) {
      console.error('[WA NOTIF TESTI EXCEPTION]', err.message);
    }

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

// --- API Daily Login Reward ---
router.post('/api/claim-daily-login', ensureAuthenticated, (req, res) => {
  try {
    const userId = req.user.id;
    const w = getWallet(userId);
    
    // Gunakan UTC agar pergantian hari serentak
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    let lastClaimDate = null;
    if (w.lastDailyLogin) {
      lastClaimDate = new Date(w.lastDailyLogin);
      lastClaimDate.setUTCHours(0, 0, 0, 0);
    }

    if (w.lastDailyLogin === todayStr) {
      return res.json({ success: false, message: 'Sudah diklaim hari ini' });
    }

    let streak = w.loginStreak || 0;
    let penaltyApplied = false;
    let penaltyAmount = 0;

    if (lastClaimDate) {
      const diffTime = today.getTime() - lastClaimDate.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        // Lanjut streak
        streak += 1;
        if (streak > 7) streak = 1;
      } else if (diffDays > 1) {
        // Bolong! Penalti dan reset
        streak = 1;
        const accumulatedBonus = w.dailyLoginAccumulated || 0;
        const currentBalance = w.balance || 0;
        // Hanya potong maksimal 5000, ATAU maksimal sisa bonus yang didapat, ATAU saldo saat ini
        penaltyAmount = Math.min(5000, accumulatedBonus, currentBalance);
        
        if (penaltyAmount > 0) {
          applyWalletTx(userId, {
            type: 'admin_debit',
            amount: penaltyAmount,
            note: 'Penalti Miss Daily Login',
            allowNegative: false
          });
          penaltyApplied = true;
        }
      }
    } else {
      streak = 1;
    }

    // Tentukan hadiah berdasarkan hari
    const rewards = {
      1: 1000, 2: 2000, 3: 3000, 4: 4000, 5: 5000, 6: 7000, 7: 10000
    };
    let reward = rewards[streak] || 1000;
    if (req.user && req.user.isRoyal) {
      reward += 500; // Extra bonus for Royal Members
    }

    db.get('wallets')
      .find({ userId })
      .assign({ 
        lastDailyLogin: todayStr, 
        loginStreak: streak,
        dailyLoginAccumulated: (w.dailyLoginAccumulated || 0) - penaltyAmount + reward,
        updatedAt: new Date().toISOString() 
      })
      .write();

    applyWalletTx(userId, {
      type: 'bonus',
      amount: reward,
      note: `Bonus Login Harian (Hari ${streak})`,
      allowNegative: false
    });

    return res.json({ 
      success: true, 
      amount: reward, 
      streak,
      penaltyApplied,
      penaltyAmount
    });
  } catch (err) {
    console.error('Error claiming daily login:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem' });
  }
});

module.exports = { router, getPlans };
