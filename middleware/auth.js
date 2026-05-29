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
  res.status(403).render('error', { message: 'Akses ditolak. Hanya admin yang boleh masuk.', user: req.user || null });
}

function ensureGuest(req, res, next) {
  if (!req.isAuthenticated()) return next();
  res.redirect('/dashboard');
}

module.exports = { ensureAuthenticated, ensureAdmin, ensureGuest };
