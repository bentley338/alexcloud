# ⚡ AlexCloud - Premium Cloud Gaming Platform

Platform cloud gaming dengan backend lengkap, sistem login, admin panel, dan pembayaran QRIS via WhatsApp.

---

## 🚀 CARA MENJALANKAN

### 1. Install Dependencies
```bash
npm install
```

### 2. Konfigurasi Environment
Edit file `.env`:
```
PORT=3000
SESSION_SECRET=ganti_dengan_string_acak_panjang
GOOGLE_CLIENT_ID=CLIENT_ID_dari_Google_Console
GOOGLE_CLIENT_SECRET=CLIENT_SECRET_dari_Google_Console
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
ADMIN_EMAIL=admin@alexcloud.com
WA_NUMBER=082328437656
QRIS_IMAGE=https://img1.pixhost.to/images/5339/592942381_rizzhosting.jpg
BASE_URL=http://localhost:3000
```

### 3. Jalankan Server
```bash
npm start
# atau untuk development dengan auto-reload:
npm run dev
```

### 4. Buka Browser
```
http://localhost:3000
```

---

## 👤 AKUN DEFAULT

| Role  | Email                  | Password   |
|-------|------------------------|------------|
| Admin | admin@alexcloud.com    | Admin@123  |

> Admin hanya bisa diakses oleh akun dengan email `ADMIN_EMAIL` di `.env`

---

## 🔑 SETUP GOOGLE LOGIN

1. Buka [Google Cloud Console](https://console.cloud.google.com)
2. Buat project baru atau pilih yang ada
3. Ke **APIs & Services > Credentials**
4. Klik **Create Credentials > OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Tambahkan Authorized redirect URI:
   - `http://localhost:3000/auth/google/callback` (development)
   - `https://domainmu.com/auth/google/callback` (production)
7. Copy Client ID dan Client Secret ke file `.env`

---

## 🌐 DEPLOY KE PRODUCTION (VPS/Hosting)

### Menggunakan PM2:
```bash
npm install -g pm2
pm2 start server.js --name alexcloud
pm2 save
pm2 startup
```

### Update .env untuk production:
```
BASE_URL=https://domainmu.com
GOOGLE_CALLBACK_URL=https://domainmu.com/auth/google/callback
```

### Nginx config (opsional):
```nginx
server {
    server_name domainmu.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📁 STRUKTUR PROJECT

```
alexcloud/
├── server.js           # Entry point
├── .env                # Konfigurasi environment
├── package.json
├── database/
│   ├── db.js           # Setup & seed database
│   └── db.json         # Data (auto-generated)
├── middleware/
│   ├── auth.js         # Auth middleware
│   └── passport.js     # Passport config (Local + Google)
├── routes/
│   ├── auth.js         # Login, Register, Google OAuth, Logout
│   ├── main.js         # Homepage, Dashboard, Order, Payment
│   └── admin.js        # Admin panel routes
├── views/
│   ├── partials/       # Header & Footer
│   ├── auth/           # Login & Register pages
│   ├── admin/          # Admin panel views
│   ├── index.ejs       # Homepage
│   ├── dashboard.ejs   # User dashboard
│   ├── games.ejs       # Game library
│   ├── pricing.ejs     # Pricing page
│   ├── order.ejs       # Order confirmation
│   ├── payment.ejs     # Payment (QRIS + WA)
│   └── profile.ejs     # User profile
└── public/
    ├── css/main.css    # Semua styling
    └── js/main.js      # Client-side JavaScript
```

---

## ✨ FITUR LENGKAP

- ✅ Homepage dengan hero section, game library, pricing
- ✅ Login & Register dengan email/password
- ✅ Login dengan Google OAuth 2.0
- ✅ Dashboard user (status sub, riwayat order, paket)
- ✅ Sistem order & pembayaran QRIS + konfirmasi WhatsApp
- ✅ Admin Panel (dashboard stats, kelola order/user/game/sub)
- ✅ Konfirmasi order otomatis aktivasi subscription
- ✅ Database JSON (lowdb, no native binary needed)
- ✅ Session management (7 hari)
- ✅ Responsive design (mobile-friendly)
- ✅ 16+ game default sudah ter-seed
- ✅ Proteksi route (middleware auth & admin)

---

## 💬 SUPPORT

WhatsApp: 082328437656

---

© 2024 AlexCloud. All rights reserved.
