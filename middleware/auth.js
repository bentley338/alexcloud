function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    // Cek jika user dibanned
    if (req.user && req.user.isBanned) {
      req.logout(() => {});
      req.flash('error', 'Akun kamu telah dibanned oleh admin.');
      return res.redirect('/login');
    }
    return next();
  }
  req.flash('error', 'Silakan login terlebih dahulu.');
  res.redirect('/login');
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();

  // Kirim notifikasi upaya akses ilegal ke dashboard admin
  try {
    const { sendWhatsAppNotification } = require('../utils/whatsapp');
    const ip = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || req.ip;
    const userDetail = req.user ? `${req.user.name} (${req.user.email})` : 'Anonymous / Guest';
    const notifMsg = `🚨 *PERINGATAN UPAYA AKSES DASHBOARD ADMIN* 🚨\n\n` +
      `👤 *Aktor:* ${userDetail}\n` +
      `🌐 *IP Address:* ${ip}\n` +
      `📝 *Target URL:* ${req.originalUrl}\n` +
      `📅 *Waktu:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
      `Sistem mendeteksi upaya akses tidak sah ke dashboard admin dan telah memblokirnya (403 Forbidden).`;
    sendWhatsAppNotification(notifMsg).catch(err => console.error('[WA NOTIF SECURITY ERROR]', err.message));
  } catch (err) {
    console.error('[WA NOTIF SECURITY EXCEPTION]', err.message);
  }

  res.status(403).render('error', { message: 'Akses ditolak. Hanya admin yang boleh masuk.', user: req.user || null });
}

function ensureGuest(req, res, next) {
  if (!req.isAuthenticated()) return next();
  res.redirect('/dashboard');
}

module.exports = { ensureAuthenticated, ensureAdmin, ensureGuest };
