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
  settings: {},
  sessions: []
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

// ─── Seed functions ────────────────────────────────────────────────────────────
function seedAdmin() {
  const existing = db.get('users').find({ email: process.env.ADMIN_EMAIL || 'admin@alexcloud.com' }).value();
  if (!existing) {
    db.get('users').push({
      id: uuidv4(),
      name: 'Admin AlexCloud',
      email: process.env.ADMIN_EMAIL || 'admin@alexcloud.com',
      password: bcrypt.hashSync('Admin@123', 10),
      role: 'admin',
      avatar: null,
      googleId: null,
      createdAt: new Date().toISOString(),
      isActive: true,
      isBanned: false
    }).write();
    console.log('[DB] Admin seeded');
  } else {
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
}

function seedGames() {
  if (db.get('games').value().length === 0) {
    const games = [
      { id: uuidv4(), name: 'EA FC 26',              genre: 'Sports',           platform: 'Cloud', image: 'https://placehold.co/400x220/1a1a2e/00d4ff?text=EA+FC+26&font=montserrat',         description: 'Sepak bola paling realistis!',              rating: 4.8, popular: true,  new: true,  tag: 'NEW'        },
      { id: uuidv4(), name: 'EA FC 25',              genre: 'Sports',           platform: 'Cloud', image: 'https://placehold.co/400x220/1a1a2e/00d4ff?text=EA+FC+25&font=montserrat',         description: 'Edisi terdahulu EA FC.',                    rating: 4.7, popular: true,  new: false, tag: 'POPULAR'    },
      { id: uuidv4(), name: 'MotoGP 25',             genre: 'Racing',           platform: 'Cloud', image: 'https://placehold.co/400x220/0d0d1a/ff6b35?text=MotoGP+25&font=montserrat',        description: 'Balapan MotoGP terbaru.',                   rating: 4.6, popular: true,  new: true,  tag: 'NEW'        },
      { id: uuidv4(), name: 'MotoGP 24',             genre: 'Racing',           platform: 'Cloud', image: 'https://placehold.co/400x220/0d0d1a/ff6b35?text=MotoGP+24&font=montserrat',        description: 'Seri MotoGP sebelumnya.',                   rating: 4.5, popular: true,  new: false, tag: 'HOT'        },
      { id: uuidv4(), name: 'Alan Wake 2',            genre: 'Horror/Action',   platform: 'Cloud', image: 'https://placehold.co/400x220/0a0a0a/7b2fff?text=Alan+Wake+2&font=montserrat',      description: 'Thriller psychological horror terbaik.',    rating: 4.9, popular: true,  new: false, tag: 'TOP RATED'  },
      { id: uuidv4(), name: 'Hogwarts Legacy',        genre: 'RPG',             platform: 'Cloud', image: 'https://placehold.co/400x220/1a0a2e/ffcc00?text=Hogwarts+Legacy&font=montserrat',  description: 'Jelajahi dunia sihir Hogwarts.',            rating: 4.8, popular: true,  new: false, tag: 'BESTSELLER' },
      { id: uuidv4(), name: 'GTA VI',                 genre: 'Action',          platform: 'Cloud', image: 'https://placehold.co/400x220/0a1a0a/00ff88?text=GTA+VI&font=montserrat',           description: 'Open world terbesar Rockstar Games.',       rating: 5.0, popular: true,  new: true,  tag: 'COMING SOON'},
      { id: uuidv4(), name: 'Red Dead Redemption 2',  genre: 'Action/Adventure',platform: 'Cloud', image: 'https://placehold.co/400x220/1a0a00/ff4500?text=RDR+2&font=montserrat',            description: 'Petualangan koboi epik.',                   rating: 4.9, popular: true,  new: false, tag: 'CLASSIC'    },
      { id: uuidv4(), name: 'Cyberpunk 2077',         genre: 'RPG',             platform: 'Cloud', image: 'https://placehold.co/400x220/0a001a/ffff00?text=Cyberpunk+2077&font=montserrat',   description: 'Dunia dystopia futuristik Night City.',     rating: 4.7, popular: true,  new: false, tag: 'HOT'        },
      { id: uuidv4(), name: 'Call of Duty: BO6',      genre: 'FPS',             platform: 'Cloud', image: 'https://placehold.co/400x220/0a0a0a/ff0000?text=COD+BO6&font=montserrat',          description: 'Multiplayer FPS terpanas.',                 rating: 4.6, popular: true,  new: true,  tag: 'NEW'        },
      { id: uuidv4(), name: 'The Witcher 3',           genre: 'RPG',             platform: 'Cloud', image: 'https://placehold.co/400x220/001a0a/00ff44?text=The+Witcher+3&font=montserrat',    description: 'RPG terbaik sepanjang masa.',               rating: 5.0, popular: false, new: false, tag: 'LEGENDARY'  },
      { id: uuidv4(), name: 'Spider-Man 2',            genre: 'Action',          platform: 'Cloud', image: 'https://placehold.co/400x220/1a001a/ff0066?text=Spider-Man+2&font=montserrat',     description: 'Berayun di New York sebagai Spider-Man.',   rating: 4.8, popular: true,  new: false, tag: 'POPULAR'    },
      { id: uuidv4(), name: 'Elden Ring',              genre: 'Action RPG',      platform: 'Cloud', image: 'https://placehold.co/400x220/0a0500/ffaa00?text=Elden+Ring&font=montserrat',       description: 'Mahakarya FromSoftware x GRRM.',            rating: 4.9, popular: true,  new: false, tag: 'TOP RATED'  },
      { id: uuidv4(), name: 'God of War Ragnarök',     genre: 'Action/Adventure',platform: 'Cloud', image: 'https://placehold.co/400x220/050010/4444ff?text=GoW+Ragnarok&font=montserrat',     description: 'Kratos vs para dewa Norse.',                rating: 4.9, popular: true,  new: false, tag: 'EPIC'       },
      { id: uuidv4(), name: 'Forza Horizon 5',         genre: 'Racing',          platform: 'Cloud', image: 'https://placehold.co/400x220/001a00/44ff44?text=Forza+H5&font=montserrat',         description: 'Racing terbaik di Meksiko.',                rating: 4.7, popular: false, new: false, tag: 'HOT'        },
      { id: uuidv4(), name: 'Mortal Kombat 1',         genre: 'Fighting',        platform: 'Cloud', image: 'https://placehold.co/400x220/1a0000/ff2222?text=MK+1&font=montserrat',             description: 'Fatality paling brutal.',                   rating: 4.5, popular: false, new: false, tag: 'BRUTAL'     }
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

function initDB() {
  seedAdmin();
  seedPlans();
  seedGames();
  seedTestimonials();
  cleanOldSessions();
}

module.exports = { db, initDB, restoreFromMongoDB: restoreFromDB, sessionStore };
