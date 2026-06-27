const crypto = require('crypto');

// ─── CSRF Protection (synchronizer token, disimpan di session) ────────────────
// Token dibuat per-session lalu disuntik ke setiap <form> & request fetch/XHR oleh
// skrip kecil di header partial (lihat views/partials/header.ejs & admin/layout-header.ejs).
// Validasi menerima token dari salah satu sumber:
//   - header  x-csrf-token / x-xsrf-token  (fetch/XHR)
//   - body    _csrf                         (form urlencoded)
//   - query   _csrf                         (form multipart/upload — body belum diparse
//                                            saat middleware ini jalan, jadi pakai query)
//
// Endpoint yang TIDAK boleh kena CSRF (bukan dari browser kita / punya auth sendiri)
// didaftarkan di CSRF_EXEMPT. Cocokkan secara prefix path.
const CSRF_EXEMPT = [
  '/api/testimonials', // dipanggil WA Bot eksternal, diautentikasi via header x-api-key
  '/api/chat',         // chatbot publik untuk pengunjung anonim (belum tentu punya session)
  '/api/bot/mustikapay', // dipanggil WA Bot eksternal untuk integrasi payment
  '/api/bot/testimonials' // dipanggil WA Bot untuk ambil testi
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isExempt(reqPath) {
  return CSRF_EXEMPT.some(p => reqPath === p || reqPath.startsWith(p + '/'));
}

function tokensMatch(sent, expected) {
  if (typeof sent !== 'string' || typeof expected !== 'string') return false;
  if (sent.length !== expected.length || sent.length === 0) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  } catch (e) {
    return false;
  }
}

function csrfProtection(req, res, next) {
  // Pastikan ada token di session & ekspos ke view (header partial menanamkannya).
  if (!req.session) return next(); // session belum siap (mis. aset statis) — lewati
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();
  if (isExempt(req.path)) return next();

  const sent =
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token') ||
    (req.body && req.body._csrf) ||
    (req.query && req.query._csrf);

  if (tokensMatch(sent, req.session.csrfToken)) return next();

  // Token hilang/salah → tolak. Balas JSON untuk request API, redirect+flash untuk form.
  const wantsJson = req.path.startsWith('/api/') ||
    (req.get('accept') || '').includes('application/json') ||
    req.xhr;
  if (wantsJson) {
    return res.status(403).json({ error: 'Token keamanan (CSRF) tidak valid. Muat ulang halaman.' });
  }
  if (req.flash) req.flash('error', 'Sesi keamanan kedaluwarsa. Silakan muat ulang halaman lalu coba lagi.');
  return res.redirect(req.get('Referer') || '/');
}

module.exports = { csrfProtection };
