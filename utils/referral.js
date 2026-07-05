// ═══════════════════════════════════════════════════════════════════════════
// Referral / Affiliate — logika terpusat (dipakai auth, passport, admin, main)
//
// Reward = "personal promo code" yang di-reuse dari sistem promoCodes:
//   • fixed discount, maxUses:1, terikat ke ownerUserId.
// Anti-abuse berlapis (lihat attachReferralOnRegister):
//   1) guard ekonomi — reward pengajak baru cair setelah teman BAYAR & di-confirm.
//   2) referredBy immutable (1 user = 1 pengajak, permanen).
//   3) idempoten — 1 record referral = 1 reward.
//   4) guard identitas — signupIp + cookie penanda (anti bikin akun baru di device sama).
//   5) cap 1 referral rewardable per IP.
// ═══════════════════════════════════════════════════════════════════════════
const { db, applyWalletTx } = require('../database/db');
const { v4: uuidv4 } = require('uuid');

// Karakter tanpa yang membingungkan (0/O/1/I/L) agar kode mudah dibaca/diketik.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REF_COOKIE = 'ac_ref';
const DEFAULT_CFG = { welcomeDiscount: 10000, referrerReward: 10000, enabled: true };

function randCode(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function generateReferralCode() {
  let code;
  do { code = randCode(6); } while (db.get('users').find({ referralCode: code }).value());
  return code;
}

// Assign kode kalau user belum punya (dipakai backfill startup + lazy di dashboard).
function ensureReferralCode(user) {
  if (!user) return null;
  if (user.referralCode) return user.referralCode;
  const code = generateReferralCode();
  db.get('users').find({ id: user.id }).assign({ referralCode: code }).write();
  user.referralCode = code; // mutate objek sesi agar langsung kepakai di request ini
  return code;
}

function getReferralConfig() {
  const s = db.get('settings').value() || {};
  return { ...DEFAULT_CFG, ...(s.referral || {}) };
}

function setReferralConfig(patch) {
  const cur = getReferralConfig();
  const next = { ...cur, ...patch };
  db.get('settings').assign({ referral: next }).write();
  return next;
}

// Buat personal promo code (single-use, terikat pemilik). Return kode-nya.
function createPersonalPromo({ ownerUserId, kind, value, description }) {
  let code;
  const prefix = kind === 'welcome' ? 'WELCOME-' : 'REF-';
  do { code = prefix + randCode(5); } while (db.get('promoCodes').find({ code }).value());
  db.get('promoCodes').push({
    id: uuidv4(),
    code,
    discountType: 'fixed',
    discountValue: Number(value) || 0,
    maxUses: 1,
    minPurchase: null,
    usedCount: 0,
    expiresAt: null,
    description: description || '',
    isActive: true,
    ownerUserId,           // <-- personal: hanya bisa dipakai pemilik (enforce di main.js)
    kind,                  // 'welcome' | 'referral' (label admin)
    createdAt: new Date().toISOString()
  }).write();
  return code;
}

// ─── Guard identitas ──────────────────────────────────────────────────────────
// Loopback & IP privat (RFC1918) TIDAK dipakai sebagai sidik jari: di dev semua
// loopback, dan di prod (trust proxy) client IP selalu publik — jadi ini aman.
function fingerprintableIp(ip) {
  if (!ip) return null;
  let s = String(ip).trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1' || s === '127.0.0.1' || s.startsWith('10.') || s.startsWith('192.168.')) return null;
  const m = s.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return null;
  return s;
}

function hasRefCookie(req) {
  const raw = req && req.headers && req.headers.cookie;
  if (!raw) return false;
  return raw.split(';').some(c => c.trim().startsWith(REF_COOKIE + '='));
}

function setRefCookie(res) {
  if (res && typeof res.cookie === 'function') {
    res.cookie(REF_COOKIE, '1', {
      httpOnly: true, sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000 // ~1 tahun
    });
  }
}

function findReferrerByCode(code) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (!c) return null;
  return db.get('users').find({ referralCode: c }).value() || null;
}

// Dipanggil setelah user baru dibuat (email & Google). Menentukan pending/blocked.
// Return { status } untuk logging/flash. Tidak pernah throw.
function attachReferralOnRegister(req, res, newUser, refCodeRaw) {
  try {
    const cfg = getReferralConfig();
    if (!cfg.enabled) return { status: 'disabled' };

    const referrer = findReferrerByCode(refCodeRaw);
    if (!referrer) return { status: 'none' };                 // kode kosong/invalid → diabaikan
    if (referrer.id === newUser.id) return { status: 'self' };
    if (referrer.email && newUser.email &&
        referrer.email.toLowerCase() === newUser.email.toLowerCase()) return { status: 'self' };
    if (newUser.referredBy) return { status: 'already' };     // immutable

    // Deteksi abuse
    const fpNew = fingerprintableIp(newUser.signupIp);
    const fpRef = fingerprintableIp(referrer.signupIp);
    const sameIp = !!(fpNew && fpRef && fpNew === fpRef);
    const cookieSeen = hasRefCookie(req);
    let ipCapped = false;
    if (fpNew) {
      const fromIp = db.get('referrals').value()
        .filter(r => r.status !== 'blocked' && fingerprintableIp(r.signupIp) === fpNew).length;
      ipCapped = fromIp >= 1;
    }
    const isAdmin = newUser.role === 'admin';
    const abusive = !isAdmin && (sameIp || cookieSeen || ipCapped);

    // Link pengajak selalu dicatat (immutable), reward hanya kalau tidak abusive.
    db.get('users').find({ id: newUser.id }).assign({ referredBy: referrer.id }).write();
    newUser.referredBy = referrer.id;

    const rec = {
      id: uuidv4(),
      referrerId: referrer.id,
      referredUserId: newUser.id,
      referredName: newUser.name,
      signupIp: newUser.signupIp || null,
      orderId: null,
      status: abusive ? 'blocked' : 'pending',
      reason: abusive ? (sameIp ? 'same_ip' : cookieSeen ? 'cookie' : 'ip_cap') : null,
      welcomeCode: null,
      rewardCode: null,
      createdAt: new Date().toISOString(),
      rewardedAt: null
    };

    if (!abusive) {
      rec.welcomeCode = createPersonalPromo({
        ownerUserId: newUser.id, kind: 'welcome', value: cfg.welcomeDiscount,
        description: `Diskon welcome referral dari ${referrer.name}`
      });
      setRefCookie(res);
    }
    db.get('referrals').push(rec).write();
    return { status: rec.status, referrerId: referrer.id, welcomeCode: rec.welcomeCode, reason: rec.reason };
  } catch (e) {
    console.error('[REFERRAL] attach error:', e.message);
    return { status: 'error' };
  }
}

// Dipanggil saat admin confirm order. Cairkan reward pengajak (idempoten).
function rewardReferrerOnFirstOrder(order) {
  try {
    if (!order) return null;
    const cfg = getReferralConfig();
    if (!cfg.enabled) return null;
    // Hanya record 'pending' (blocked/rewarded dilewati → tidak dobel).
    const rec = db.get('referrals').find({ referredUserId: order.userId, status: 'pending' }).value();
    if (!rec) return null;
    const referrer = db.get('users').find({ id: rec.referrerId }).value();
    if (!referrer) {
      db.get('referrals').find({ id: rec.id }).assign({ status: 'blocked', reason: 'referrer_gone' }).write();
      return null;
    }

    const bonusAmount = Number(cfg.referrerReward) || 10000;
    
    // Berikan saldo ke pengajak
    applyWalletTx(referrer.id, {
      type: 'bonus',
      amount: bonusAmount,
      refType: 'referral',
      refId: rec.id,
      note: `Bonus ajak teman: ${rec.referredName || 'Pengguna baru'} berlangganan`
    });

    db.get('referrals').find({ id: rec.id }).assign({
      status: 'rewarded', orderId: order.id, rewardCode: `SALDO-${bonusAmount}`, rewardedAt: new Date().toISOString()
    }).write();
    
    return { referrerId: referrer.id, referrerName: referrer.name, rewardCode: `SALDO-${bonusAmount}`, bonusAmount };
  } catch (e) {
    console.error('[REFERRAL] reward error:', e.message);
    return null;
  }
}

module.exports = {
  REF_COOKIE,
  generateReferralCode,
  ensureReferralCode,
  getReferralConfig,
  setReferralConfig,
  createPersonalPromo,
  attachReferralOnRegister,
  rewardReferrerOnFirstOrder
};
