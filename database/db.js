const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// ─── Persistent path: Railway Volume (/data) or local ──────────────────────────
// Railway Volume di-mount ke /data — data di sini TIDAK hilang saat redeploy
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname);
const DB_PATH  = path.join(DATA_DIR, 'db.json');

console.log(`[DB] Using database path: ${DB_PATH}`);

const adapter = new FileSync(DB_PATH);
const db = low(adapter);

// Default structure
db.defaults({
  users: [],
  orders: [],
  subscriptions: [],
  games: [],
  promoCodes: [],
  testimonials: [],
  plans: [],
  settings: {}
}).write();

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

function initDB() {
  seedAdmin();
  seedPlans();
  seedGames();
  seedTestimonials();
}

// No MongoDB needed — using Railway Volume
async function restoreFromMongoDB() {
  // Railway Volume handles persistence automatically
  if (fs.existsSync('/data')) {
    console.log('[DB] ✅ Railway Volume detected — data is persistent!');
  } else {
    console.log('[DB] ⚠️  No persistent volume — running locally');
  }
}

module.exports = { db, initDB, restoreFromMongoDB };
