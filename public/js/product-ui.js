(function () {
  'use strict';

  var CONSENT_COOKIE = 'ac_consent';
  var CONSENT_VERSION = '2026-09-22';
  var staticResults = [
    { title: 'Game Library', note: 'Lihat semua game yang tersedia', url: '/games', icon: 'fa-gamepad' },
    { title: 'Paket & Harga', note: 'Bandingkan paket AlexCloud', url: '/pricing', icon: 'fa-tags' },
    { title: 'Cek Koneksi', note: 'Uji kesiapan jaringan kamu', url: '/network-test', icon: 'fa-wifi' },
    { title: 'Pusat Bantuan', note: 'Panduan dan kontak bantuan', url: '/support', icon: 'fa-headset' },
    { title: 'FAQ', note: 'Jawaban untuk pertanyaan umum', url: '/faq', icon: 'fa-question-circle' }
  ];

  function readCookie(name) {
    var prefix = name + '=';
    var part = document.cookie.split(';').map(function (v) { return v.trim(); }).find(function (v) { return v.indexOf(prefix) === 0; });
    if (!part) return null;
    try { return decodeURIComponent(part.slice(prefix.length)); } catch (_) { return null; }
  }

  function getConsent() {
    try {
      var parsed = JSON.parse(readCookie(CONSENT_COOKIE) || 'null');
      return parsed && parsed.version === CONSENT_VERSION ? parsed : null;
    } catch (_) { return null; }
  }

  function setConsent(settings) {
    var value = {
      version: CONSENT_VERSION,
      necessary: true,
      preferences: !!settings.preferences,
      analytics: !!settings.analytics,
      marketing: !!settings.marketing,
      updatedAt: new Date().toISOString()
    };
    var cookie = CONSENT_COOKIE + '=' + encodeURIComponent(JSON.stringify(value)) + '; Max-Age=31536000; Path=/; SameSite=Lax';
    if (location.protocol === 'https:') cookie += '; Secure';
    document.cookie = cookie;
    window.dispatchEvent(new CustomEvent('alexcloud:consent', { detail: value }));
    return value;
  }

  function icon(name) { return '<i class="fas ' + name + '" aria-hidden="true"></i>'; }

  function mountConsent() {
    var banner = document.createElement('aside');
    banner.className = 'ax-consent';
    banner.id = 'axConsentBanner';
    banner.setAttribute('aria-label', 'Pilihan cookie');
    banner.innerHTML = '<div class="ax-consent-row"><div class="ax-consent-copy"><strong>Privasi kamu penting</strong><p>Kami memakai cookie wajib agar akun dan pembayaran bekerja. Cookie preferensi dan atribusi hanya aktif setelah kamu menyetujuinya. <a href="/cookies">Pelajari cookie</a>.</p></div><div class="ax-consent-actions"><button class="ax-button" data-consent="reject">Tolak opsional</button><button class="ax-button" data-consent="settings">Atur pilihan</button><button class="ax-button ax-button--primary" data-consent="accept">Terima semua</button></div></div>';
    if (getConsent()) banner.hidden = true;
    document.body.appendChild(banner);

    var overlay = document.createElement('div');
    overlay.className = 'ax-overlay';
    overlay.id = 'axConsentSettings';
    overlay.hidden = true;
    overlay.innerHTML = '<section class="ax-dialog" role="dialog" aria-modal="true" aria-labelledby="axConsentTitle"><div class="ax-dialog-head"><h2 id="axConsentTitle">Pengaturan cookie</h2><button class="ax-icon-button" data-close-consent aria-label="Tutup">' + icon('fa-times') + '</button></div><div class="ax-settings-body"><div class="ax-setting"><div><strong>Cookie wajib</strong><p>Diperlukan untuk keamanan, sesi login, keranjang, dan proses pembayaran.</p></div><input class="ax-switch" type="checkbox" checked disabled aria-label="Cookie wajib selalu aktif"></div><div class="ax-setting"><div><strong>Preferensi</strong><p>Mengingat pengaturan tampilan yang kamu pilih pada perangkat ini.</p></div><input class="ax-switch" id="axConsentPreferences" type="checkbox"></div><div class="ax-setting"><div><strong>Analitik & atribusi</strong><p>Membantu kami memahami sumber kunjungan dan memperbaiki pengalaman produk.</p></div><input class="ax-switch" id="axConsentAnalytics" type="checkbox"></div></div><div class="ax-settings-actions"><button class="ax-button" data-consent="reject">Tolak opsional</button><button class="ax-button ax-button--primary" data-consent="save">Simpan pilihan</button></div></section>';
    document.body.appendChild(overlay);

    function closeSettings() { overlay.hidden = true; document.body.style.overflow = ''; }
    function openSettings() {
      var current = getConsent() || {};
      document.getElementById('axConsentPreferences').checked = !!current.preferences;
      document.getElementById('axConsentAnalytics').checked = !!current.analytics;
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
      setTimeout(function () { overlay.querySelector('button').focus(); }, 0);
    }
    function commit(type) {
      if (type === 'accept') setConsent({ preferences: true, analytics: true, marketing: false });
      if (type === 'reject') setConsent({ preferences: false, analytics: false, marketing: false });
      if (type === 'save') setConsent({ preferences: document.getElementById('axConsentPreferences').checked, analytics: document.getElementById('axConsentAnalytics').checked, marketing: false });
      banner.hidden = true;
      closeSettings();
      toast('Pilihan privasi tersimpan.');
    }
    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-consent]');
      if (button) {
        var action = button.getAttribute('data-consent');
        if (action === 'settings') openSettings(); else commit(action);
      }
      if (event.target.closest('[data-close-consent]') || event.target === overlay) closeSettings();
    });
    window.AlexCloudUI = window.AlexCloudUI || {};
    window.AlexCloudUI.openCookieSettings = openSettings;
  }

  var toastStack;
  function toast(message) {
    if (!toastStack) {
      toastStack = document.createElement('div');
      toastStack.className = 'ax-toast-stack';
      toastStack.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastStack);
    }
    var item = document.createElement('div');
    item.className = 'ax-toast';
    item.textContent = message;
    toastStack.appendChild(item);
    setTimeout(function () { item.remove(); }, 3200);
  }

  function mountSearch() {
    var overlay = document.createElement('div');
    overlay.className = 'ax-overlay';
    overlay.id = 'axGlobalSearch';
    overlay.hidden = true;
    overlay.innerHTML = '<section class="ax-dialog" role="dialog" aria-modal="true" aria-labelledby="axSearchTitle"><div class="ax-dialog-head"><h2 id="axSearchTitle">Cari di AlexCloud</h2><button class="ax-icon-button" data-close-search aria-label="Tutup pencarian">' + icon('fa-times') + '</button></div><div class="ax-search-field"><input type="search" id="axSearchInput" autocomplete="off" placeholder="Cari game, harga, atau bantuan..." aria-label="Kata kunci pencarian"></div><div class="ax-search-results" id="axSearchResults"></div></section>';
    document.body.appendChild(overlay);
    var input = overlay.querySelector('#axSearchInput');
    var results = overlay.querySelector('#axSearchResults');
    var timer;

    function render(items, heading) {
      results.innerHTML = (heading ? '<p style="padding:6px 12px;color:var(--ax-muted);font-size:.76rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em">' + heading + '</p>' : '') + items.map(function (item) {
        return '<a class="ax-search-result" href="' + item.url + '">' + icon(item.icon || 'fa-gamepad') + '<span><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.note || '') + '</small></span></a>';
      }).join('');
    }
    function escapeHtml(value) { var div = document.createElement('div'); div.textContent = value || ''; return div.innerHTML; }
    function openSearch(initial) {
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
      input.value = initial || '';
      render(staticResults, 'Akses cepat');
      setTimeout(function () { input.focus(); }, 0);
      if (initial) runSearch(initial);
    }
    function closeSearch() { overlay.hidden = true; document.body.style.overflow = ''; }
    function runSearch(query) {
      var q = (query || '').trim();
      if (!q) { render(staticResults, 'Akses cepat'); return; }
      clearTimeout(timer);
      timer = setTimeout(function () {
        fetch('/api/games/search?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } })
          .then(function (response) { return response.ok ? response.json() : []; })
          .then(function (payload) {
            var raw = Array.isArray(payload) ? payload : (payload.games || payload.results || []);
            var games = raw.slice(0, 7).map(function (game) { return { title: game.name || game.title, note: game.genre || 'Tersedia di Game Library', url: '/games?q=' + encodeURIComponent(game.name || game.title || q), icon: 'fa-gamepad' }; });
            var pages = staticResults.filter(function (item) { return (item.title + ' ' + item.note).toLowerCase().indexOf(q.toLowerCase()) !== -1; });
            render(games.concat(pages).slice(0, 9), games.length || pages.length ? 'Hasil pencarian' : 'Tidak ada hasil');
          }).catch(function () { render(staticResults, 'Akses cepat'); });
      }, 220);
    }
    input.addEventListener('input', function () { runSearch(input.value); });
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-open-search]');
      if (trigger) { event.preventDefault(); openSearch(); }
      if (event.target.closest('[data-close-search]') || event.target === overlay) closeSearch();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { event.preventDefault(); openSearch(); }
      if (event.key === 'Escape' && !overlay.hidden) closeSearch();
    });
    var legacyInput = document.getElementById('navSearchInput');
    if (legacyInput) {
      legacyInput.setAttribute('readonly', 'readonly');
      legacyInput.setAttribute('aria-label', 'Buka pencarian');
      legacyInput.addEventListener('click', function () { openSearch(); });
      legacyInput.addEventListener('focus', function () { legacyInput.blur(); openSearch(); });
    }
  }

  function enhanceFooter() {
    var legal = document.querySelector('.footer-legal-links');
    if (!legal || legal.querySelector('.ax-cookie-link')) return;
    var separator = document.createElement('span'); separator.setAttribute('aria-hidden', 'true'); separator.textContent = '•';
    var policy = document.createElement('a'); policy.href = '/cookies'; policy.textContent = 'Cookie';
    var button = document.createElement('button'); button.type = 'button'; button.className = 'ax-cookie-link'; button.textContent = 'Atur cookie';
    button.addEventListener('click', function () { if (window.AlexCloudUI) window.AlexCloudUI.openCookieSettings(); });
    legal.appendChild(separator); legal.appendChild(policy); legal.appendChild(separator.cloneNode(true)); legal.appendChild(button);
  }

  function boot() {
    window.AlexCloudUI = window.AlexCloudUI || {};
    window.AlexCloudUI.toast = toast;
    mountConsent();
    mountSearch();
    enhanceFooter();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
