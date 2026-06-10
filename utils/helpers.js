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
function fr3Request(endpoint, method, payload, timeoutMs) {
  const FR3_API_KEY = process.env.FR3_API_KEY || 'FR3_shact6823052026ehmlukrxggvoax';
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
    req.setTimeout(timeoutMs || 20000, () => {
      req.destroy();
      reject(new Error(`FR3 Gateway Timeout (${(timeoutMs || 20000) / 1000}s)`));
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
  BROWSER_UA,
  path
};
