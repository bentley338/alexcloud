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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from FR3')); }
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

// ─── Shared User-Agent Header ──────────────────────────────────────────────
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

module.exports = {
  sharedHttpsAgent,
  cleanEnvVar,
  createCachedGetter,
  createRateLimiter,
  fr3Request,
  sayabayarRequest,
  BROWSER_UA,
  path
};
