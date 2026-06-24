/**
 * AlexCloud rebrand → "Electric Gaming" identity
 * Maps the old indigo→blue palette (LevviCode-derived) to violet (#7C3AED)
 * + hot rose (#F43F5E) over a blue-black base (#0F0F23).
 *
 * Runs against every text asset that hard-codes brand colors and is idempotent:
 * re-running on an already-rebranded file is a no-op (old tokens no longer present).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Hex / rgb token map. Order matters: longest/most-specific first. ──
const HEX = [
  // legacy violet alias (must run before generic purple/hot merge)
  ['#818cf8', '#A78BFA'], // accent-purple (light indigo) → lavender

  // hot / cyan / blue accent family → hot rose
  ['#3b82f6', '#F43F5E'], // accent-cyan / accent-secondary
  ['#06b6d4', '#FB7185'], // cyan tail (favicon/toast) → rose-300
  ['#a855f7', '#F43F5E'], // accent-hot (purple-pink) → rose-500

  // primary indigo → violet
  ['#4f46e5', '#7C3AED'], // accent / accent-blue / accent-indigo
  ['#6366f1', '#9061F9'], // accent-hover

  // backgrounds → blue-black family
  ['#0a0a0c', '#0F0F23'], // bg-primary
  ['#0c0d12', '#14142b'], // bg-secondary
  ['#111217', '#1E1C35'], // bg-card
  ['#16171d', '#26244A'], // bg-card-hover
  ['#1e293b', '#26244A'], // bg-elevated
  ['#0f1117', '#171534'], // bg-surface

  // legacy indigo gradient anchors already covered above; keep green (status only)
];

// ── rgba() families (keep the alpha slot untouched). Whitespace-tolerant. ──
const RGBA = [
  // primary indigo (79,70,229) → violet (124,58,237)
  [/rgba\(\s*79\s*,\s*70\s*,\s*229\s*,/gi, 'rgba(124,58,237,'],
  // accent-cyan (59,130,246) → rose (244,63,94)
  [/rgba\(\s*59\s*,\s*130\s*,\s*246\s*,/gi, 'rgba(244,63,94,'],
  // light indigo (129,140,248) → lavender (167,139,250)
  [/rgba\(\s*129\s*,\s*140\s*,\s*248\s*,/gi, 'rgba(167,139,250,'],
  // legacy purple-pink (168,85,247) → rose
  [/rgba\(\s*168\s*,\s*85\s*,\s*247\s*,/gi, 'rgba(244,63,94,'],
  // legacy violet rgb (123,47,255) seen in admin → violet
  [/rgba\(\s*123\s*,\s*47\s*,\s*255\s*,/gi, 'rgba(124,58,237,'],
];

function brand(text) {
  let out = text;
  for (const [from, to] of HEX) {
    // case-insensitive, but preserve the replacement as written
    out = out.split(from).join(to);
    out = out.split(from.toUpperCase()).join(to);
  }
  for (const [re, to] of RGBA) {
    out = out.replace(re, to);
  }
  return out;
}

// Files known to hard-code brand colors (audit-derived).
const FILES = [
  'public/css/main.src.css',
  'public/css/main.css',
  'public/js/main.src.js',
  'public/js/main.js',
  'public/favicon.svg',
  'public/manifest.json',
  'views/partials/header.ejs',
  'views/partials/footer.ejs',
  'views/index.ejs',
  'views/order.ejs',
  'views/payment.ejs',
  'views/network-test.ejs',
  'views/admin/dashboard.ejs',
  'views/admin/games.ejs',
  'views/admin/layout-header.ejs',
  'views/admin/settings-whatsapp.ejs',
  'views/auth/login.ejs',
  'views/dashboard.ejs',
  'views/faq.ejs',
  'views/games.ejs',
];

let changed = 0;
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.warn('  skip (missing):', rel); continue; }
  const before = fs.readFileSync(abs, 'utf8');
  const after = brand(before);
  if (after !== before) {
    fs.writeFileSync(abs, after);
    changed++;
    console.log('  ✓ rebranded:', rel);
  } else {
    console.log('  · unchanged:', rel);
  }
}
console.log(`\nDone. ${changed} file(s) updated.`);
