const low = require('lowdb');
const Memory = require('lowdb/adapters/Memory');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');

// Use Memory adapter — data loaded from Postgres on startup
const adapter = new Memory();
const db = low(adapter);

db.defaults({
  users: [],
  orders: [],
  subscriptions: [],
  games: [],
  promoCodes: [],
  testimonials: [],
  plans: [],
  referrals: [],
  wallets: [],
  walletTx: [],
  settings: {},
  sessions: [],
  chatMessages: []
}).write();

// ─── Custom Lowdb Session Store (automatically backed up to Postgres) ──────────
class LowdbSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const record = db.get('sessions').find({ id: sid }).value();
      if (!record) return cb(null, null);
      cb(null, JSON.parse(record.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const dataStr = JSON.stringify(sess);
      const existing = db.get('sessions').find({ id: sid }).value();
      if (existing) {
        db.get('sessions').find({ id: sid }).assign({ data: dataStr, updatedAt: new Date().toISOString() }).write();
      } else {
        db.get('sessions').push({
          id: sid,
          data: dataStr,
          updatedAt: new Date().toISOString()
        }).write();
      }
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      db.get('sessions').remove({ id: sid }).write();
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

const sessionStore = new LowdbSessionStore();

// ─── PostgreSQL Backup (Railway internal — no SSL issues) ──────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
let _pgPool = null;
let _backupEnabled = false;

async function getPgPool() {
  if (!_pgPool && DATABASE_URL) {
    const { Pool } = require('pg');
    _pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000
    });
    // Create table if not exists
    await _pgPool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }
  return _pgPool;
}

// ─── Restore from Postgres on startup ─────────────────────────────────────────
async function restoreFromDB() {
  if (!DATABASE_URL) {
    console.log('[DB] ⚠️  No DATABASE_URL — data will reset on redeploy!');
    _backupEnabled = false;
    return;
  }
  try {
    const pool = await getPgPool();
    const result = await pool.query("SELECT value FROM app_state WHERE key = 'main'");
    if (result.rows.length > 0) {
      const savedData = result.rows[0].value;
      const state = db.getState();
      Object.keys(savedData).forEach(k => { state[k] = savedData[k]; });
      db.setState(state);
      console.log('[DB] ✅ Data restored from PostgreSQL!');
    } else {
      console.log('[DB] No backup found — seeding defaults');
    }
    _backupEnabled = true;
  } catch (e) {
    console.error('[DB] ❌ Postgres restore failed:', e.message);
    _backupEnabled = false;
  }
}

// ─── Backup to Postgres (debounced, non-blocking) ─────────────────────────────
let _backupTimer = null;

function scheduleBackup() {
  if (!_backupEnabled || !DATABASE_URL) return;
  if (_backupTimer) clearTimeout(_backupTimer);
  _backupTimer = setTimeout(() => {
    backupToPostgres().catch(e => console.error('[DB] Backup error:', e.message));
  }, 2000); // Debounce: wait 2s after last write
}

async function backupToPostgres() {
  try {
    const pool = await getPgPool();
    const data = db.getState();
    await pool.query(`
      INSERT INTO app_state (key, value, updated_at)
      VALUES ('main', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [JSON.stringify(data)]);
  } catch (e) {
    console.error('[DB] ❌ Postgres backup error:', e.message);
  }
}

// ─── Override db.write() to auto-backup ──────────────────────────────────────
const _origWrite = db.write.bind(db);
db.write = function () {
  const result = _origWrite();
  scheduleBackup();
  return result;
};

// ─── Cached Data Getters (avoid repeated lowdb scans per request) ──────────────
let _plansCache = null;
let _plansCacheTs = 0;
let _gamesCache = null;
let _gamesCacheTs = 0;
const DATA_TTL = 5000; // 5s cache

function getPlans() {
  const now = Date.now();
  if (!_plansCache || now - _plansCacheTs > DATA_TTL) {
    _plansCache = db.get('plans').value() || [];
    _plansCacheTs = now;
  }
  return _plansCache;
}

function getGames() {
  const now = Date.now();
  if (!_gamesCache || now - _gamesCacheTs > DATA_TTL) {
    _gamesCache = db.get('games').value() || [];
    _gamesCacheTs = now;
  }
  return _gamesCache;
}

function invalidatePlansCache() { _plansCacheTs = 0; }
function invalidateGamesCache() { _gamesCacheTs = 0; }

// ─── Wallet / Saldo ────────────────────────────────────────────────────────────
// Konfigurasi default dompet (bisa diedit admin lewat /admin/wallet-settings).
const WALLET_DEFAULTS = {
  enabled: true,
  minTopup: 10000,
  maxTopup: 2000000,
  // Tier bonus top-up: nominal >= min mendapat tambahan `percent`% saldo (ambil tier tertinggi yang terpenuhi).
  bonusTiers: [
    { min: 100000, percent: 5 },
    { min: 500000, percent: 10 }
  ]
};

function getWalletConfig() {
  const settings = db.get('settings').value() || {};
  return { ...WALLET_DEFAULTS, ...(settings.wallet || {}) };
}

function seedWallet() {
  const settings = db.get('settings').value() || {};
  if (!settings.wallet) {
    db.get('settings').assign({ wallet: WALLET_DEFAULTS }).write();
    console.log('[DB] Wallet config seeded');
  }
}

// Ambil (atau buat) dompet milik user. Selalu mengembalikan objek dengan balance numerik.
function getWallet(userId) {
  if (!userId) return null;
  let w = db.get('wallets').find({ userId }).value();
  if (!w) {
    w = {
      id: uuidv4(),
      userId,
      balance: 0,
      totalToppedUp: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.get('wallets').push(w).write();
  }
  return w;
}

function getBalance(userId) {
  const w = getWallet(userId);
  return w ? (w.balance || 0) : 0;
}

// Hitung bonus top-up berdasar tier tertinggi yang terpenuhi.
function calcTopupBonus(amount) {
  const cfg = getWalletConfig();
  const tiers = (cfg.bonusTiers || []).filter(t => t && amount >= t.min).sort((a, b) => b.min - a.min);
  if (!tiers.length) return 0;
  return Math.floor(amount * (tiers[0].percent || 0) / 100);
}

// ─── Satu-satunya jalur perubahan saldo (menjaga ledger selalu konsisten) ───────
// type: 'topup' | 'purchase' | 'bonus' | 'admin_credit' | 'admin_debit' | 'refund'
// amount: selalu POSITIF. Arah debit/kredit ditentukan oleh `type`.
// Menolak jika saldo jadi negatif kecuali opts.allowNegative.
function applyWalletTx(userId, { type, amount, refType = null, refId = null, note = null, createdBy = null, allowNegative = false }) {
  if (!userId) throw new Error('userId wajib untuk transaksi saldo');
  const amt = Math.round(Number(amount) || 0);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Nominal transaksi saldo tidak valid');

  const DEBIT_TYPES = ['purchase', 'admin_debit'];
  const isDebit = DEBIT_TYPES.includes(type);

  // Re-fetch tepat sebelum menulis untuk mengurangi risiko balapan (single-process/event-loop).
  const w = getWallet(userId);
  const before = w.balance || 0;
  const after = isDebit ? before - amt : before + amt;
  if (after < 0 && !allowNegative) {
    throw new Error('Saldo tidak mencukupi');
  }

  const nowIso = new Date().toISOString();
  db.get('wallets').find({ id: w.id }).assign({
    balance: after,
    totalToppedUp: (w.totalToppedUp || 0) + (['topup', 'bonus'].includes(type) ? amt : 0),
    updatedAt: nowIso
  }).write();

  const tx = {
    id: uuidv4(),
    userId,
    type,
    direction: isDebit ? 'debit' : 'credit',
    amount: amt,
    balanceBefore: before,
    balanceAfter: after,
    refType,
    refId,
    note,
    createdBy,
    createdAt: nowIso
  };
  db.get('walletTx').push(tx).write();
  return tx;
}

function getUserWalletTx(userId) {
  return db.get('walletTx').filter({ userId }).sortBy('createdAt').reverse().value() || [];
}

// Kreditkan saldo dari sebuah order top-up yang sudah lunas. IDEMPOTEN: hanya
// mengkredit sekali (guard flag order.walletCredited). Dipakai oleh hook status
// pembayaran (auto) maupun konfirmasi manual admin. Mengembalikan ringkasan
// { credited, amount, bonus, balanceAfter } atau { credited:false } bila sudah pernah.
function fulfillTopupOrder(orderInternalId, { createdBy = null } = {}) {
  const order = db.get('orders').find({ id: orderInternalId }).value();
  if (!order || order.orderType !== 'topup') return { credited: false, reason: 'bukan order topup' };
  if (order.walletCredited) return { credited: false, reason: 'sudah dikreditkan' };

  const amount = Math.round(Number(order.topupAmount || order.price) || 0);
  const bonus = Math.round(Number(order.topupBonus || 0) || 0);
  if (amount <= 0) return { credited: false, reason: 'nominal tidak valid' };

  // Tandai lebih dulu agar tidak dobel walau ada polling paralel.
  db.get('orders').find({ id: order.id }).assign({ walletCredited: true }).write();

  const tx = applyWalletTx(order.userId, {
    type: 'topup', amount, refType: 'order', refId: order.orderId,
    note: `Top-up saldo #${order.orderId}`, createdBy
  });
  let balanceAfter = tx.balanceAfter;
  if (bonus > 0) {
    const btx = applyWalletTx(order.userId, {
      type: 'bonus', amount: bonus, refType: 'order', refId: order.orderId,
      note: `Bonus top-up #${order.orderId}`, createdBy
    });
    balanceAfter = btx.balanceAfter;
  }
  return { credited: true, amount, bonus, balanceAfter };
}

// ─── Seed functions ────────────────────────────────────────────────────────────
function seedAdmin() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@alexcloud.com').toLowerCase().trim();
  const existing = db.get('users').find({ email: adminEmail }).value();
  if (!existing) {
    db.get('users').push({
      id: uuidv4(),
      name: 'Admin AlexCloud',
      email: adminEmail,
      password: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin@123', 10),
      role: 'admin',
      avatar: null,
      googleId: null,
      createdAt: new Date().toISOString(),
      isActive: true,
      isBanned: false
    }).write();
    console.log('[DB] Admin seeded:', adminEmail);
  } else {
    // Failsafe: Pastikan role-nya diset 'admin' jika email cocok
    if (existing.role !== 'admin') {
      db.get('users').find({ id: existing.id }).assign({ role: 'admin' }).write();
      console.log(`[DB] Forced admin role upgrade for existing email: ${adminEmail}`);
    }
    db.get('users').each(u => { if (typeof u.isBanned === 'undefined') u.isBanned = false; }).write();
  }
}

function seedPlans() {
  if (db.get('plans').value().length === 0) {
    db.get('plans').push(
      { id: '1week',   name: '1 Minggu',  duration: 7,  price: 40000,  priceDisplay: 'Rp 40.000',  popular: false },
      { id: '1month',  name: '1 Bulan',   duration: 30, price: 60000,  priceDisplay: 'Rp 60.000',  popular: true  },
      { id: '2months', name: '2 Bulan',   duration: 60, price: 100000, priceDisplay: 'Rp 100.000', popular: false },
      { id: '3months', name: '3 Bulan',   duration: 90, price: 150000, priceDisplay: 'Rp 150.000', popular: false }
    ).write();
    console.log('[DB] Plans seeded');
  }

  // Seed Royal plans if not present
  if (!db.get('plans').find({ id: 'royal_access' }).value()) {
    db.get('plans').push({
      id: 'royal_access',
      name: 'Royal Club Access',
      duration: 9999, // lifetime
      price: 25000,
      priceDisplay: 'Rp 25.000',
      isRoyalUpgrade: true,
      popular: false,
      desc: 'Membuka akses sewa harian (Rp 7.000/hari), prioritas antrean bypass, region server khusus, dan badge emas profil!'
    }).write();
    console.log('[DB] Royal Access plan seeded');
  }

  // Remove old 1day_royal if exists
  db.get('plans').remove({ id: '1day_royal' }).write();

  if (!db.get('plans').find({ id: 'custom_royal' }).value()) {
    db.get('plans').push({
      id: 'custom_royal',
      name: 'Sewa Harian (Royal)',
      duration: 1, // default base
      price: 7000, // per day
      priceDisplay: 'Rp 7.000 / hari',
      royalOnly: true,
      isCustomDays: true,
      popular: false,
      desc: 'Pilih jumlah hari sewa sesukamu. Sangat murah dan fleksibel!'
    }).write();
    console.log('[DB] Custom Royal plan seeded');
  }
}

const gameImageMapping = {
  'EA FC 26': '/images/games/ea_fc_26.webp',
  'EA FC 25': '/images/games/ea_fc_25.webp',
  'MotoGP 25': '/images/games/motogp_25.webp',
  'MotoGP 24': '/images/games/motogp_24.webp',
  'Alan Wake 2': '/images/games/alan_wake_2.webp',
  'Hogwarts Legacy': '/images/games/hogwarts_legacy.webp',
  'GTA VI': '/images/games/gta_vi.webp',
  'GTA V': '/images/games/gta_v.webp',
  'Red Dead Redemption 2': '/images/games/rdr_2.webp',
  'Cyberpunk 2077': '/images/games/cyberpunk_2077.webp',
  'Call of Duty: BO6': '/images/games/cod_bo6.webp',
  'The Witcher 3': '/images/games/the_witcher_3.webp',
  'Spider-Man 2': '/images/games/spiderman_2.webp',
  'Elden Ring': '/images/games/elden_ring.webp',
  'God of War Ragnarök': '/images/games/gow_ragnarok.webp',
  'Forza Horizon 5': '/images/games/forza_horizon_5.webp',
  'Mortal Kombat 1': '/images/games/mortal_kombat_1.webp'
};

function seedGames() {
  if (db.get('games').value().length === 0) {
    const games = [
      { id: uuidv4(), name: 'EA FC 26',              genre: 'Sports',           platform: 'Cloud', image: gameImageMapping['EA FC 26'],         description: 'Sepak bola paling realistis!',              rating: 4.8, popular: true,  new: true,  tag: 'NEW'        },
      { id: uuidv4(), name: 'EA FC 25',              genre: 'Sports',           platform: 'Cloud', image: gameImageMapping['EA FC 25'],         description: 'Edisi terdahulu EA FC.',                    rating: 4.7, popular: true,  new: false, tag: 'POPULAR'    },
      { id: uuidv4(), name: 'MotoGP 25',             genre: 'Racing',           platform: 'Cloud', image: gameImageMapping['MotoGP 25'],        description: 'Balapan MotoGP terbaru.',                   rating: 4.6, popular: true,  new: true,  tag: 'NEW'        },
      { id: uuidv4(), name: 'MotoGP 24',             genre: 'Racing',           platform: 'Cloud', image: gameImageMapping['MotoGP 24'],        description: 'Seri MotoGP sebelumnya.',                   rating: 4.5, popular: true,  new: false, tag: 'HOT'        },
      { id: uuidv4(), name: 'Alan Wake 2',            genre: 'Horror/Action',   platform: 'Cloud', image: gameImageMapping['Alan Wake 2'],      description: 'Thriller psychological horror terbaik.',    rating: 4.9, popular: true,  new: false, tag: 'TOP RATED'  },
      { id: uuidv4(), name: 'Hogwarts Legacy',        genre: 'RPG',             platform: 'Cloud', image: gameImageMapping['Hogwarts Legacy'],  description: 'Jelajahi dunia sihir Hogwarts.',            rating: 4.8, popular: true,  new: false, tag: 'BESTSELLER' },
      { id: uuidv4(), name: 'GTA VI',                 genre: 'Action',          platform: 'Cloud', image: gameImageMapping['GTA VI'],           description: 'Open world terbesar Rockstar Games.',       rating: 5.0, popular: true,  new: true,  tag: 'COMING SOON'},
      { id: uuidv4(), name: 'Red Dead Redemption 2',  genre: 'Action/Adventure',platform: 'Cloud', image: gameImageMapping['Red Dead Redemption 2'],description: 'Petualangan koboi epik.',                   rating: 4.9, popular: true,  new: false, tag: 'CLASSIC'    },
      { id: uuidv4(), name: 'Cyberpunk 2077',         genre: 'RPG',             platform: 'Cloud', image: gameImageMapping['Cyberpunk 2077'],   description: 'Dunia dystopia futuristik Night City.',     rating: 4.7, popular: true,  new: false, tag: 'HOT'        },
      { id: uuidv4(), name: 'Call of Duty: BO6',      genre: 'FPS',             platform: 'Cloud', image: gameImageMapping['Call of Duty: BO6'],description: 'Multiplayer FPS terpanas.',                 rating: 4.6, popular: true,  new: true,  tag: 'NEW'        },
      { id: uuidv4(), name: 'The Witcher 3',           genre: 'RPG',             platform: 'Cloud', image: gameImageMapping['The Witcher 3'],    description: 'RPG terbaik sepanjang masa.',               rating: 5.0, popular: false, new: false, tag: 'LEGENDARY'  },
      { id: uuidv4(), name: 'Spider-Man 2',            genre: 'Action',          platform: 'Cloud', image: gameImageMapping['Spider-Man 2'],     description: 'Berayun di New York sebagai Spider-Man.',   rating: 4.8, popular: true,  new: false, tag: 'POPULAR'    },
      { id: uuidv4(), name: 'Elden Ring',              genre: 'Action RPG',      platform: 'Cloud', image: gameImageMapping['Elden Ring'],       description: 'Mahakarya FromSoftware x GRRM.',            rating: 4.9, popular: true,  new: false, tag: 'TOP RATED'  },
      { id: uuidv4(), name: 'God of War Ragnarök',     genre: 'Action/Adventure',platform: 'Cloud', image: gameImageMapping['God of War Ragnarök'],description: 'Kratos vs para dewa Norse.',                rating: 4.9, popular: true,  new: false, tag: 'EPIC'       },
      { id: uuidv4(), name: 'Forza Horizon 5',         genre: 'Racing',          platform: 'Cloud', image: gameImageMapping['Forza Horizon 5'],  description: 'Racing terbaik di Meksiko.',                rating: 4.7, popular: false, new: false, tag: 'HOT'        },
      { id: uuidv4(), name: 'Mortal Kombat 1',         genre: 'Fighting',        platform: 'Cloud', image: gameImageMapping['Mortal Kombat 1'],  description: 'Fatality paling brutal.',                   rating: 4.5, popular: false, new: false, tag: 'BRUTAL'     }
    ];
    db.get('games').push(...games).write();
    console.log('[DB] Games seeded:', games.length);
  }
}

function seedTestimonials() {
  if (db.get('testimonials').value().length === 0) {
    db.get('testimonials').push(
      { id: uuidv4(), name: 'Rizky Pratama',  role: 'Gamer Hardcore',  text: 'AlexCloud benar-benar mengubah cara saya bermain! Latency rendah dan gambar 4K super tajam. Worth it!', rating: 5, image: null, avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=rizky', createdAt: new Date().toISOString(), approved: true },
      { id: uuidv4(), name: 'Siti Nurhaliza', role: 'Casual Gamer',    text: 'Saya bisa main GTA VI di HP android! Tidak percaya bisa sesmoeth ini. AlexCloud the best!',             rating: 5, image: null, avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=siti',  createdAt: new Date().toISOString(), approved: true },
      { id: uuidv4(), name: 'Budi Santoso',   role: 'Content Creator', text: 'Paket 3 bulan sangat worth it! Hemat banyak dibanding beli PC gaming. Rekomen banget!',                 rating: 5, image: null, avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=budi',  createdAt: new Date().toISOString(), approved: true },
      { id: uuidv4(), name: 'Dewi Rahayu',    role: 'Student Gamer',   text: 'Support adminnya ramah banget! Respon cepat dan masalah langsung beres. Top markotop!',                 rating: 5, image: null, avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=dewi',  createdAt: new Date().toISOString(), approved: true }
    ).write();
    console.log('[DB] Testimonials seeded');
  }
}

function cleanOldSessions() {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.get('sessions')
      .remove(s => !s.updatedAt || s.updatedAt < oneWeekAgo)
      .write();
    console.log('[DB] Cleaned expired sessions');
  } catch (e) {
    console.error('[DB] Clean sessions error:', e.message);
  }
}

function updateGameImages() {
  try {
    const games = db.get('games').value() || [];
    let updated = false;
    games.forEach(g => {
      const correctImage = gameImageMapping[g.name];
      if (correctImage && (g.image !== correctImage || g.image.includes('placehold.co') || g.image.startsWith('data:image'))) {
        g.image = correctImage;
        updated = true;
      }
    });
    if (updated) {
      db.write();
      console.log('[DB] ✅ Game images successfully updated to local/CDN paths');
    }
  } catch (e) {
    console.error('[DB] ❌ Update game images failed:', e.message);
  }
}

// ─── Referral: default config + backfill kode untuk user lama ───────────────────
function seedReferral() {
  // Default config (admin-editable via /admin/referrals)
  const settings = db.get('settings').value() || {};
  if (!settings.referral) {
    db.get('settings').assign({
      referral: { welcomeDiscount: 10000, referrerReward: 10000, enabled: true }
    }).write();
    console.log('[DB] Referral config seeded');
  }
  // Backfill referralCode untuk semua user yang belum punya (pola seedAdmin:202).
  // Lazy-require agar tidak circular dengan utils/referral.js.
  try {
    const { ensureReferralCode } = require('../utils/referral');
    const users = db.get('users').value();
    let n = 0;
    users.forEach(u => { if (!u.referralCode) { ensureReferralCode(u); n++; } });
    if (n) console.log(`[DB] Referral codes backfilled: ${n} user`);
  } catch (e) {
    console.error('[DB] Referral backfill error:', e.message);
  }
}

function initDB() {
  seedAdmin();
  seedPlans();
  seedGames();
  seedTestimonials();
  seedReferral();
  seedWallet();
  updateGameImages();
  cleanOldSessions();

  // Schedule periodic session cleanup every 6 hours
  setInterval(() => {
    cleanOldSessions();
  }, 6 * 60 * 60 * 1000).unref();
}

function activateUserSubscription(userId, planId, orderId, durationOverride) {
  const plans = getPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return false;

  const now = new Date().toISOString();
  if (plan.id === 'royal_access') {
    // 1. Mark user as Royal
    db.get('users').find({ id: userId }).assign({ isRoyal: true, isActive: true }).write();

    // 2. Add Royal subscription (expires in 2099-12-31 / lifetime)
    db.get('subscriptions').push({
      id: uuidv4(),
      userId,
      orderId,
      planId: plan.id,
      planName: plan.name,
      status: 'active',
      createdAt: now,
      expiresAt: '2099-12-31T23:59:59.000Z'
    }).write();
  } else {
    // Normal package or Custom Royal
    const duration = durationOverride || plan.duration;
    const expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();
    
    // Clear any previous active normal subscription (keep royal_access active)
    db.get('subscriptions').remove(sub => sub.userId === userId && sub.status === 'active' && sub.planId !== 'royal_access').write();

    // Add new subscription
    db.get('subscriptions').push({
      id: uuidv4(),
      userId,
      orderId,
      planId: plan.id,
      planName: plan.id === 'custom_royal' ? `Sewa Harian (${duration} Hari)` : plan.name,
      status: 'active',
      createdAt: now,
      expiresAt
    }).write();
    
    // Set user as active
    db.get('users').find({ id: userId }).assign({ isActive: true }).write();
  }
  return true;
}

module.exports = {
  db,
  initDB,
  restoreFromMongoDB: restoreFromDB,
  sessionStore,
  getPlans,
  getGames,
  invalidatePlansCache,
  invalidateGamesCache,
  // Wallet / saldo
  getWallet,
  getBalance,
  getWalletConfig,
  calcTopupBonus,
  applyWalletTx,
  getUserWalletTx,
  fulfillTopupOrder,
  activateUserSubscription
};
