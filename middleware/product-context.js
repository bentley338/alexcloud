const { db } = require('../database/db');

const CONSENT_VERSION = '2026-09-22';
const OPTIONAL_TRACKING_KEYS = [
  'ref', 'ref_', 'ref_id', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_term', 'utm_content', 'source', 'src', 'from', 'origin', 'via',
  'gclid', 'fbclid', 'ttclid', 'click_id', 'aff'
];

function readConsent(cookieHeader) {
  if (!cookieHeader) return null;
  const cookie = cookieHeader.split(';').find(part => part.trim().startsWith('ac_consent='));
  if (!cookie) return null;
  try {
    return JSON.parse(decodeURIComponent(cookie.trim().slice('ac_consent='.length)));
  } catch (error) {
    return null;
  }
}

module.exports = function productContext(req, res, next) {
  const consent = readConsent(req.headers.cookie || '');
  const allowsAttribution = Boolean(
    consent && consent.version === CONSENT_VERSION && consent.analytics
  );

  if (!allowsAttribution) {
    // Referral is a requested product action, so preserve it in-session without
    // creating a persistent attribution cookie.
    if (req.query.ref) {
      req.session.pendingRef = String(req.query.ref).trim().toUpperCase();
    }
    OPTIONAL_TRACKING_KEYS.forEach(key => { delete req.query[key]; });
    if (req.headers.cookie) {
      req.headers.cookie = req.headers.cookie
        .split(';')
        .filter(part => !part.trim().startsWith('ac_tracking='))
        .join(';');
    }
    delete req.session.tracking;
    if (consent) {
      res.clearCookie('ac_tracking', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production' || (process.env.BASE_URL || '').startsWith('https://')
      });
    }
  }

  try {
    const games = db.get('games').value();
    res.locals.gameCount = Array.isArray(games) ? games.length : 0;
  } catch (error) {
    res.locals.gameCount = 0;
  }

  next();
};
