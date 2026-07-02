const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/db');
const { ensureReferralCode, attachReferralOnRegister } = require('../utils/referral');

// ─── User cache for fast deserializeUser lookups ────────────────────────────
// Avoids scanning the full users array on every request for already-known users
const _userCache = new Map();
const USER_CACHE_TTL = 30000; // 30s

function getCachedUser(id) {
  const entry = _userCache.get(id);
  if (entry && Date.now() - entry.ts < USER_CACHE_TTL) {
    // Refresh from DB in case it changed
    const fresh = db.get('users').find({ id }).value();
    if (fresh) {
      entry.data = fresh;
      entry.ts = Date.now();
      return fresh;
    }
    _userCache.delete(id);
    return null;
  }
  const user = db.get('users').find({ id }).value();
  if (user) _userCache.set(id, { data: user, ts: Date.now() });
  return user || null;
}

passport.use(new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  const user = db.get('users').find({ email: email.toLowerCase() }).value();
  if (!user) return done(null, false, { message: 'Email tidak terdaftar.' });
  if (!user.password) return done(null, false, { message: 'Akun ini menggunakan login Google.' });
  if (!bcrypt.compareSync(password, user.password)) return done(null, false, { message: 'Password salah.' });
  if (!user.isActive) return done(null, false, { message: 'Akun dinonaktifkan.' });
  // Warm the cache on successful login
  _userCache.set(user.id, { data: user, ts: Date.now() });
  return done(null, user);
}));

// Google OAuth — hanya aktif jika env vars tersedia
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    passReqToCallback: true // butuh req untuk signupIp, sesi pendingRef, & set cookie referral
  }, (req, accessToken, refreshToken, profile, done) => {
    let user = db.get('users').find({ googleId: profile.id }).value();
    if (!user) {
      user = db.get('users').find({ email: profile.emails[0].value.toLowerCase() }).value();
      if (user) {
        db.get('users').find({ id: user.id }).assign({ googleId: profile.id }).write();
        user = db.get('users').find({ id: user.id }).value();
      } else {
        const newUser = {
          id: uuidv4(),
          name: profile.displayName,
          email: profile.emails[0].value.toLowerCase(),
          password: null,
          role: 'user',
          avatar: profile.photos[0]?.value || null,
          googleId: profile.id,
          createdAt: new Date().toISOString(),
          signupIp: req.ip,
          referralCode: null,
          referredBy: null,
          isActive: true
        };
        db.get('users').push(newUser).write();
        // Referral: kode sendiri + proses kode pengajak (anti-abuse). Cookie via req.res.
        ensureReferralCode(newUser);
        attachReferralOnRegister(req, req.res, newUser, req.session && req.session.pendingRef);
        if (req.session) delete req.session.pendingRef;

        // Send WhatsApp Notification to Owner
        try {
          const { sendWhatsAppNotification } = require('../utils/whatsapp');
          const notifMsg = `🔔 *NOTIFIKASI PENDAFTARAN BARU (GOOGLE)* 🔔\n\n` +
            `👤 *Nama:* ${newUser.name}\n` +
            `📧 *Email:* ${newUser.email}\n` +
            `📅 *Waktu:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
            `Pengguna baru telah berhasil mendaftar menggunakan Google OAuth di website AlexCloud.`;
          sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF ERROR]', err.message));
        } catch (err) {
          console.error('[WA NOTIF GOOGLE REGISTRATION ERROR]', err.message);
        }

        user = newUser;
      }
    }
    // Warm the cache on Google login
    _userCache.set(user.id, { data: user, ts: Date.now() });
    return done(null, user);
  }));
  console.log('✅ Google OAuth aktif');
} else {
  console.log('⚠️  Google OAuth tidak aktif (GOOGLE_CLIENT_ID tidak diset)');
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = getCachedUser(id);
  done(null, user || null);
});

module.exports = passport;
