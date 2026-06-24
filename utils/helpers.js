const https = require('https');
const path = require('path');

// ─── Shared HTTP Agent (connection pooling for all outbound HTTPS calls) ──────
// Keeps TCP connections alive across requests to FR3, OpenAI, Gemini, Telegram, CallMeBot, Twilio
const sharedHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 4,
  timeout: 20000,
  freeSocketTimeout: 30000,
  family: 4 // Force IPv4 to prevent Cloudflare/IPv6 connection hangs on cloud hosts
});

// ─── Env Var Cleaner (DRY — used by server.js) ──────────────────────────────
function cleanEnvVar(varName) {
  let value = process.env[varName];
  if (!value) return;
  value = value.trim();
  // Strip wrapping quotes (common copy-paste issue)
  if ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  }
  // Strip accidental prefix like "CLOUDINARY_URL=cloudinary://..."
  if (value.startsWith(varName + '=')) {
    value = value.replace(varName + '=', '');
  }
  process.env[varName] = value.trim();
}

// ─── Cached Getter (avoids repeated lowdb .value() calls for static-ish data) ─
function createCachedGetter(getterFn, ttlMs) {
  let cache = null;
  let lastFetch = 0;
  const ttl = ttlMs || 5000; // default 5s cache
  return function () {
    const now = Date.now();
    if (!cache || now - lastFetch > ttl) {
      cache = getterFn();
      lastFetch = now;
    }
    return cache;
  };
}

// ─── Simple In-Memory Rate Limiter ──────────────────────────────────────────
function createRateLimiter({ windowMs, maxRequests }) {
  const hits = new Map();

  // Cleanup expired entries every 60s
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(key);
    }
  }, 60000).unref();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || now - entry.start > windowMs) {
      entry = { count: 1, start: now };
      hits.set(key, entry);
      return next();
    }

    entry.count++;
    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Silakan coba lagi nanti.' });
    }
    next();
  };
}

// ─── FR3 API Helper (centralized HTTP call to FR3 NewEra gateway) ───────────
// Single HTTP attempt to the FR3 gateway. Resolves with parsed JSON, or rejects
// on a network-level failure (timeout / connection reset / unparseable body).
function fr3RequestOnce(endpoint, method, payload, timeoutMs) {
  const FR3_API_KEY = process.env.FR3_API_KEY;
  const FR3_BASE = 'https://fr3newera.com/api/v1';

  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify({ apikey: FR3_API_KEY, ...payload }) : null;
    const urlObj = new URL(`${FR3_BASE}${endpoint}`);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method || 'POST',
      agent: sharedHttpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // Header browser lengkap menurunkan kemungkinan kena Cloudflare bot-challenge.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Origin': 'https://fr3newera.com',
        'Referer': 'https://fr3newera.com/'
      }
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const trimmed = (data || '').trim();
        try { resolve(JSON.parse(trimmed)); return; }
        catch { /* bukan JSON — diagnosa di bawah */ }
        // FR3 di belakang Cloudflare: kalau diblok, body-nya halaman HTML challenge,
        // bukan JSON. Beri pesan jelas (status + indikasi Cloudflare) supaya admin
        // tahu ini blokir Cloudflare, bukan sekadar "Invalid JSON".
        const isHtml = /^\s*</.test(trimmed) || /<html|just a moment|cloudflare/i.test(trimmed);
        const status = res.statusCode;
        if (isHtml || status === 403 || status === 503) {
          reject(new Error(`FR3 diblok Cloudflare (HTTP ${status}) — IP server tidak lolos challenge`));
        } else {
          reject(new Error(`FR3 balas non-JSON (HTTP ${status}): ${trimmed.slice(0, 80)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs || 8000, () => {
      // Destroy so the (possibly dead) keep-alive socket is dropped from the pool
      // and the next attempt opens a fresh connection.
      req.destroy(new Error(`FR3 Gateway Timeout (${(timeoutMs || 8000) / 1000}s)`));
    });

    if (body) req.write(body);
    req.end();
  });
}

// FR3's backend (behind Cloudflare) intermittently accepts the TCP+TLS connection
// but never sends a response, so requests hang until they time out. DNS/TCP/TLS all
// succeed in <100ms — the stall is purely the upstream not replying. A short
// per-attempt timeout + a couple of retries gives each order several chances to
// catch a moment the gateway is responsive before we fall back to manual payment.
async function fr3Request(endpoint, method, payload, timeoutMs, maxAttempts) {
  const perAttempt = timeoutMs || 8000;
  const attempts = maxAttempts || 1;
  let lastErr;

  for (let i = 1; i <= attempts; i++) {
    try {
      // If the gateway answers at all (even an error JSON), that's a real response — return it.
      return await fr3RequestOnce(endpoint, method, payload, perAttempt);
    } catch (e) {
      lastErr = e;
      if (i < attempts) {
        console.warn(`[FR3] Attempt ${i}/${attempts} failed (${e.message}) — retrying ${endpoint}`);
        await new Promise(r => setTimeout(r, 300)); // brief backoff before the next try
      }
    }
  }
  throw lastErr;
}

// ─── SayaBayar API Helper (backup gateway — https://api.sayabayar.com/v1) ────
// Auth via X-API-Key header. Resolves parsed JSON, rejects on network failure.
function sayabayarRequest(method, endpoint, payload, timeoutMs) {
  const KEY = process.env.SAYABAYAR_API_KEY;
  const BASE = 'https://api.sayabayar.com/v1';

  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const urlObj = new URL(`${BASE}${endpoint}`);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method || 'GET',
      agent: sharedHttpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': KEY || ''
      }
    };

    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from SayaBayar')); }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs || 15000, () => {
      req.destroy(new Error(`SayaBayar Timeout (${(timeoutMs || 15000) / 1000}s)`));
    });

    if (body) req.write(body);
    req.end();
  });
}

// ─── MustikaPay API Helper (primary gateway — https://mustikapayment.com) ────
// Auth via X-Api-Key header. Endpoint POST "classic" memakai
// application/x-www-form-urlencoded; endpoint GET (check status) memakai query
// string. Resolves parsed JSON, rejects on network failure / non-JSON body.
function mustikapayRequestOnce(method, endpoint, payload, timeoutMs) {
  const KEY = process.env.MUSTIKAPAY_API_KEY;
  const BASE = 'https://mustikapayment.com';
  const m = (method || 'GET').toUpperCase();

  return new Promise((resolve, reject) => {
    let bodyStr = null;
    let urlStr = `${BASE}${endpoint}`;

    if (payload) {
      // Buang field kosong supaya param opsional tidak terkirim sebagai "undefined".
      const clean = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined && v !== null && v !== '') clean[k] = v;
      }
      const encoded = new URLSearchParams(clean).toString();
      if (m === 'GET') urlStr += (endpoint.includes('?') ? '&' : '?') + encoded;
      else bodyStr = encoded;
    }

    const urlObj = new URL(urlStr);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: m,
      agent: sharedHttpsAgent,
      headers: {
        'Accept': 'application/json',
        'X-Api-Key': KEY || '',
        // MustikaPay di belakang Cloudflare: request tanpa header browser (terutama
        // User-Agent) kena bot-challenge (HTTP 403 halaman HTML "just a moment"),
        // mis. pada endpoint e-money. Header browser lengkap menurunkan kemungkinan diblok.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Origin': 'https://mustikapayment.com',
        'Referer': 'https://mustikapayment.com/'
      }
    };

    if (bodyStr) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const trimmed = (data || '').trim();
        try { resolve(JSON.parse(trimmed)); }
        catch {
          reject(new Error(`MustikaPay balas non-JSON (HTTP ${res.statusCode}): ${trimmed.slice(0, 80)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs || 15000, () => {
      req.destroy(new Error(`MustikaPay Timeout (${(timeoutMs || 15000) / 1000}s)`));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Cloudflare di depan MustikaPay kadang melempar bot-challenge (HTTP 403 halaman
// HTML "just a moment") secara intermiten — edge node lain di percobaan berikutnya
// sering lolos. Jadi ulangi beberapa kali khusus untuk kegagalan bertipe challenge
// (403 / balasan HTML), bukan untuk error bisnis (JSON valid yang resolve normal).
async function mustikapayRequest(method, endpoint, payload, timeoutMs, maxAttempts) {
  const attempts = maxAttempts || 3;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await mustikapayRequestOnce(method, endpoint, payload, timeoutMs);
    } catch (e) {
      lastErr = e;
      // Hanya retry kalau ini indikasi challenge/transport (403, non-JSON, timeout),
      // bukan kalau MustikaPay sudah membalas JSON (itu sudah resolve, tak masuk sini).
      const retryable = /HTTP 403|non-JSON|Timeout|ECONNRESET|EAI_AGAIN|socket hang up/i.test(e.message || '');
      if (i < attempts && retryable) {
        await new Promise(r => setTimeout(r, 400 * i)); // backoff bertingkat
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

// ─── Shared User-Agent Header ──────────────────────────────────────────────
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Testimonial Curation Helpers ────────────────────────────────────────────
// Testimonials are pushed in via a WhatsApp bot command (e.g. ".uptesti Budi | Mantap
// mainnya lancar | 5"). The raw command token + pipe formatting must NOT be shown on
// the site — so we strip the command and parse the "Name | Message | Rating" payload
// into clean fields at display & ingest time. The bot command itself keeps working.

// Generic/placeholder names the bot may send when no real name is given.
const GENERIC_TESTI_NAMES = new Set([
  'anonymous', 'anonim', 'user', 'customer', 'pelanggan', 'gamer', 'admin', 'no name', 'noname'
]);

// Plain placeholder words that aren't a real testimonial on their own.
const TRIVIAL_TESTI_TEXT = new Set([
  'done', 'ok', 'oke', 'okay', 'test', 'testing', 'tes', 'coba', 'cuba',
  'anonymous', 'anonim', 'p', 'halo', 'hi', 'hai', '-', '.', '..', '...'
]);

// Strip a leading bot-command token like ".uptesti", ".testi", "/review", "!ok".
function stripBotCommand(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/^\s*[.\/!]\s*[a-zA-Z]+\b[\s:|-]*/, '').trim();
}

// Clean a testimonial for display/storage: remove the bot command token and, if the
// content was packed as "Name | Message | Rating" into one field, split it into proper
// name / text / rating. Returns a shallow-cloned, presentable testimonial object.
function normalizeTestimonial(t) {
  if (!t) return t;
  const out = { ...t };

  let name = stripBotCommand((t.name || '').toString()) || (t.name || '').toString().trim();
  let text = stripBotCommand((t.text || '').toString()) || (t.text || '').toString().trim();
  let rating = t.rating;

  // The WA bot often dumps the whole "Name | Message | Rating" payload into one field.
  const packedInText = text.includes('|');
  const packed = packedInText ? text : (name.includes('|') ? name : null);
  if (packed) {
    const parts = packed.split('|').map(s => s.trim()).filter(s => s.length > 0);
    // A trailing 1–5 number is the rating
    if (parts.length && /^[1-5]$/.test(parts[parts.length - 1])) {
      rating = parseInt(parts.pop(), 10);
    }
    // Only treat the first segment as the name when the bot didn't already give a real
    // one (avoids turning a real review like "Bagus | mantap" into name="Bagus").
    const provided = (t.name || '').trim().toLowerCase();
    const nameIsGeneric = GENERIC_TESTI_NAMES.has(provided) || provided === '';
    if (parts.length >= 2 && (packedInText ? nameIsGeneric : true)) {
      name = parts[0];
      text = parts.slice(1).join(' — ');
    } else if (parts.length >= 1) {
      text = parts.join(' — ');
    }
  }

  // Final safety: drop any stray leading/trailing pipes
  out.name = name.replace(/^\|+|\|+$/g, '').trim();
  out.text = text.replace(/^\|+|\|+$/g, '').trim();
  if (rating) out.rating = parseInt(rating, 10) || out.rating;
  return out;
}

// Returns true when a (preferably already-normalized) testimonial has no real content
// worth showing — e.g. a bare ".testi Anonymous | Done | 5" that cleans down to "Done".
function isJunkTestimonial(t) {
  const norm = normalizeTestimonial(t);
  const name = (norm.name || '').trim();
  const text = (norm.text || '').trim();

  if (!name || !text) return true;
  if (TRIVIAL_TESTI_TEXT.has(text.toLowerCase())) return true;

  // Too short to be a meaningful testimonial (ignoring punctuation/digits)
  if (text.replace(/[^a-zA-ZÀ-ɏ]/g, '').length < 5) return true;

  return false;
}

module.exports = {
  sharedHttpsAgent,
  cleanEnvVar,
  createCachedGetter,
  createRateLimiter,
  fr3Request,
  sayabayarRequest,
  mustikapayRequest,
  BROWSER_UA,
  isJunkTestimonial,
  normalizeTestimonial,
  stripBotCommand,
  path
};
