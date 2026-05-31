// WARNING: JANGAN EDIT FILE INI SECARA LANGSUNG. Edit file .src.js yang sesuai. File ini di-minify otomatis saat startup server.
window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 20);
});
function toggleNav() {
  const links = document.getElementById('navLinks');
  const btn = document.getElementById('navToggleBtn');
  if (links) {
    const isOpen = links.classList.toggle('open');
    if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (btn) btn.setAttribute('aria-label', isOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi');
  }
}
function toggleUserMenu() {
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.classList.toggle('show');
}
document.addEventListener('click', (e) => {
  const links = document.getElementById('navLinks');
  const btn = document.getElementById('navToggleBtn');
  const dropdown = document.getElementById('userDropdown');
  const userBtn = document.querySelector('.nav-user-btn');
  if (links && links.classList.contains('open')) {
    if (!links.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
      links.classList.remove('open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (btn) btn.setAttribute('aria-label', 'Buka menu navigasi');
    }
  }
  if (dropdown && userBtn && !userBtn.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.remove('show');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const links = document.getElementById('navLinks');
    const btn = document.getElementById('navToggleBtn');
    if (links && links.classList.contains('open')) {
      links.classList.remove('open');
      if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
    }
    const aiWindow = document.getElementById('aiChatWindow');
    if (aiWindow && aiWindow.classList.contains('open')) {
      toggleAIChat();
    }
  }
});
document.querySelectorAll('.alert').forEach(alert => {
  setTimeout(() => {
    alert.style.opacity = '0';
    alert.style.transform = 'translateY(-10px)';
    alert.style.transition = 'all 0.5s ease';
    setTimeout(() => alert.remove(), 500);
  }, 5000);
});
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
      observer.unobserve(entry.target); 
    }
  });
}, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
document.querySelectorAll('.feature-card, .game-card, .plan-card, .stat-card, .trending-card').forEach(el => {
  const rect = el.getBoundingClientRect();
  const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
  if (isInViewport) {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  } else {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
  }
});
function copyOrderId(orderId) {
  navigator.clipboard.writeText(orderId).then(() => showToast('Order ID disalin!'));
}
function showToast(msg, type = 'success') {
  const toast = document.createElement('div');
  toast.innerHTML = msg;
  toast.style.cssText = `
    position: fixed; bottom: 5rem; right: 2rem; z-index: 99999;
    background: ${type === 'success' ? 'linear-gradient(135deg, #00d4ff, #00ff88)' : '#ff4444'};
    color: #000; font-family: 'Rajdhani', sans-serif; font-weight: 700;
    padding: 0.85rem 1.5rem; border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.4);
    font-size: 0.95rem;
    max-width: 320px;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
const timerEl = document.getElementById('paymentTimer');
if (timerEl) {
  let seconds = 15 * 60;
  const interval = setInterval(() => {
    seconds--;
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
    if (seconds <= 0) {
      clearInterval(interval);
      timerEl.textContent = 'EXPIRED';
      timerEl.style.color = '#ff4444';
    }
  }, 1000);
}
const AI_KNOWLEDGE = {
  harga: `💰 **Harga Paket AlexCloud:**
• 🗓️ 1 Minggu → **Rp 40.000**
• 📅 1 Bulan → **Rp 60.000** ⭐ Paling Populer
• 📆 2 Bulan → **Rp 100.000** (hemat Rp 20.000)
• 🗃️ 3 Bulan → **Rp 150.000** (hemat Rp 30.000)
Semua paket: akses ke **100+ game premium**, streaming 4K/60fps, cloud save. Tidak ada biaya tambahan per game! 🎮`,
  bayar: `💳 **Cara Pembayaran AlexCloud:**
1. Pilih paket di halaman Harga
2. Login atau daftar akun (bisa pakai Google!)
3. Klik **"Pilih Paket Ini"**
4. Masukkan kode promo (opsional)
5. **Scan QRIS** dengan GoPay/OVO/DANA/ShopeePay/M-Banking
6. Screenshot bukti pembayaran
7. Kirim bukti ke admin via WhatsApp
8. ✅ Akun aktif dalam **1-15 menit!**`,
  game: `🎮 **Game Tersedia di AlexCloud (16+ game):**
**🏆 Action/Open World:**
• GTA VI (5.0★), GTA V, Cyberpunk 2077
• Spider-Man 2, God of War Ragnarök
**⚔️ RPG:**
• Elden Ring (4.9★), Hogwarts Legacy (4.8★)
• The Witcher 3 (5.0★), Red Dead Redemption 2
**🔫 FPS:**
• COD Black Ops 6, Battlefield 2042
**⚽ Sports:**
• EA FC 26, EA FC 25
**🏍️ Racing:**
• MotoGP 25, MotoGP 24
**🎭 Horror/Thriller:**
• Alan Wake 2 (4.9★)
Library terus bertambah setiap bulan! 🔥`,
  fitur: `⚡ **Fitur Unggulan AlexCloud:**
**🎮 Gaming:**
• Streaming **4K / 60fps** ultra smooth
• Latency rendah **<30ms** (Indonesia)
• Cloud Save otomatis — progress tidak hilang
• Akses **100+ game premium**
**🔐 Keamanan:**
• Login aman via Google OAuth
• Data terenkripsi
• Session 7 hari
**💡 Smart Features:**
• AI Search & Rekomendasi Game
• Kode promo diskon
• View mode (Grid/List/Compact)
• Live chat support 24/7`,
  cloudGaming: `☁️ **Apa itu Cloud Gaming?**
Cloud Gaming (gaming berbasis cloud) adalah teknologi yang memungkinkan kamu bermain game **tanpa perlu PC/konsol mahal**. Game berjalan di server powerful milik AlexCloud, hasilnya di-stream ke perangkat kamu!
**Cara Kerjanya:**
1. Server AlexCloud menjalankan game dengan hardware kelas atas
2. Visual game di-render di server
3. Dikirim ke layarmu via internet (streaming)
4. Input keyboard/mouse/controller kamu dikirim balik ke server
**Analogi:** Seperti Netflix, tapi untuk game! 🎬🎮`,
  keunggulan: `✅ **Keunggulan Cloud Gaming vs PC/Konsol:**
| Aspek | Cloud Gaming | PC Gaming |
|-------|-------------|-----------|
| Biaya | Rp 60rb/bulan | Rp 15-50 juta |
| Maintenance | ❌ Tidak perlu | ✅ Perlu |
| Update Hardware | ❌ Tidak perlu | ✅ Perlu mahal |
| Main di HP/Laptop | ✅ Bisa | ❌ Terbatas |
| Game terbaru | ✅ Langsung | ✅ Tapi mahal |
| Portabilitas | ✅ Di mana saja | ❌ Stasioner |
**Kesimpulan:** Cloud Gaming 10x lebih hemat, tidak ribet! 💸`,
  perangkat: `📱 **Perangkat yang Bisa Digunakan:**
✅ **Kompatibel dengan:**
• 💻 Laptop/PC (semua OS: Windows, Mac, Linux)
• 📱 Smartphone Android & iOS
• 🖥️ Smart TV (dengan browser)
• 📟 Tablet (iPad, Android Tablet)
**Yang dibutuhkan hanya:**
• Browser modern (Chrome, Firefox, Edge, Safari)
• Koneksi internet **minimal 10 Mbps**
• Untuk 4K: **25+ Mbps**
Tidak perlu install game! Buka browser → login → main! 🚀`,
  internet: `📶 **Kebutuhan Internet untuk Cloud Gaming:**
| Kualitas | Kecepatan | Resolusi |
|----------|-----------|----------|
| Minimum | 5 Mbps | 720p |
| Standar | 10 Mbps | 1080p/60fps |
| HD | 15 Mbps | 1440p |
| Ultra 4K | 25 Mbps | 4K/60fps |
**Tips Koneksi Terbaik:**
• 🔌 Gunakan kabel LAN jika memungkinkan
• 📶 WiFi 5GHz lebih stabil dari 2.4GHz
• 📱 Hindari main saat banyak yang pakai WiFi bersama
• 🌙 Malam hari biasanya lebih smooth`,
  latency: `⚡ **Latency & Performa AlexCloud:**
• **Ping rata-rata:** 15-30ms (Indonesia)
• **Resolusi:** hingga 4K Ultra HD
• **Frame rate:** stabil 60fps
• **Bitrate:** adaptif (auto-adjust sesuai internet)
• **Server lokasi:** Jakarta & Indonesia
**Faktor yang mempengaruhi latency:**
• Jarak ke server (lebih dekat = lebih cepat)
• Kualitas koneksi internet kamu
• Jenis koneksi (kabel > WiFi > data seluler)
**Apakah ada input lag?** Ya, tapi sangat minimal (<30ms). Untuk game casual & single-player, hampir tidak terasa! 🎮`,
  vs: `🆚 **AlexCloud vs Layanan Cloud Gaming Lain:**
| Layanan | Harga/bulan | Server Indonesia |
|---------|------------|-----------------|
| **AlexCloud** | Rp 60.000 | ✅ Ya |
| GeForce NOW | $10 (~Rp 155rb) | ❌ Terbatas |
| Xbox Cloud | $15 (~Rp 230rb) | ❌ |
| PlayStation Now | $18 (~Rp 275rb) | ❌ |
| Shadow | €30 (~Rp 500rb) | ❌ |
**AlexCloud adalah pilihan terbaik untuk Indonesia!** 🇮🇩
• Server lokal = latency minimal
• Harga sangat terjangkau
• Support bahasa Indonesia
• Bayar dengan QRIS/e-wallet lokal`,
  cara: `🚀 **Cara Main Cloud Gaming di AlexCloud:**
**Langkah mudah:**
1. 📝 **Daftar akun** (atau login Google)
2. 💳 **Pilih & bayar paket** (QRIS)
3. ✅ **Konfirmasi ke admin WA** + kirim bukti
4. ⚡ **Akun aktif** dalam 15 menit
5. 🎮 **Buka browser** → login → pilih game
6. **Langsung main!** Tidak perlu download/install
**Itu saja! Semudah itu.** 😎`,
  troubleshoot: `🔧 **Troubleshooting Cloud Gaming:**
**Lag/Frame drop?**
• Cek kecepatan internet (min. 10 Mbps)
• Tutup app lain yang pakai internet
• Gunakan LAN/WiFi 5GHz
• Coba waktu berbeda (hindari jam sibuk)
**Gambar blur/pixelated?**
• Internet kurang cepat untuk resolusi tinggi
• Tunggu beberapa detik agar bitrate auto-adjust
**Tidak bisa login?**
• Cek email & password
• Coba "Lupa Password" atau login Google
• Hubungi admin WA jika masih gagal
**Game tidak smooth?**
• Restart browser
• Hapus cache browser
• Gunakan browser Chrome/Edge terbaru`,
  rekomendasi: `🤖 **AI Rekomendasi Game untuk Kamu:**
**🏆 Rating Tertinggi (5.0★):**
→ The Witcher 3 Wild Hunt *(RPG legendaris)*
→ GTA VI *(open world terbesar)*
**🔥 Paling Trending (4.9★):**
→ Alan Wake 2 *(horror/thriller sinematik)*
→ Elden Ring *(action RPG souls-like)*
→ God of War Ragnarök *(action epic)*
→ Red Dead Redemption 2 *(cowboy open world)*
**⚽ Untuk Fans Sports:**
→ EA FC 26 / EA FC 25 *(sepakbola terbaik)*
**🏍️ Untuk Fans Racing:**
→ MotoGP 25 *(simulasi balap motor)*
**🔫 Untuk FPS Lovers:**
→ COD Black Ops 6 *(multiplayer seru)* 🎯`,
  trending: `📈 **Game Trending Minggu Ini:**
🥇 #1 **Alan Wake 2** (4.9★) — Horror kelas AAA
🥈 #2 **Elden Ring** (4.9★) — Souls-like epic
🥉 #3 **God of War Ragnarök** (4.9★) — Aksi norse
🎖️ #4 **Red Dead Redemption 2** (4.9★) — Open world
🎖️ #5 **GTA VI** (5.0★) — Coming soon!
🎖️ #6 **Hogwarts Legacy** (4.8★) — Dunia Harry Potter`,
  promo: `🏷️ **Kode Promo AlexCloud:**
Kode promo memberikan **diskon langsung** di checkout!
**Cara pakai:**
1. Buka halaman Order
2. Input kode di kolom "Punya Kode Promo?"
3. Klik "Pakai" — diskon langsung terpotong!
**Dapat kode promo dari mana?**
• Event & giveaway di media sosial AlexCloud
• Tanya admin via WhatsApp
• Promo musiman (Lebaran, tahun baru, dll)
**Demo code:** Tanya admin WA untuk kode aktif saat ini! 😉`,
  daftar: `👤 **Cara Daftar Akun AlexCloud:**
**Opsi 1 — Google (Tercepat ⚡):**
1. Klik **"Daftar Gratis"**
2. Pilih **"Daftar dengan Google"**
3. Pilih akun Google kamu
4. Selesai! Akun langsung aktif ✅
**Opsi 2 — Email & Password:**
1. Klik **"Daftar Gratis"**
2. Isi: Nama, Email, Password
3. Klik **"Daftar Sekarang"**
4. Langsung login!
Setelah daftar, pilih paket dan mulai gaming! 🎮`,
  aman: `🔐 **Keamanan Cloud Gaming AlexCloud:**
✅ **Data kamu aman karena:**
• Login via **Google OAuth** (tidak simpan password Google)
• Password di-**enkripsi** dengan bcrypt
• Session aman dengan httpOnly cookies
• Tidak ada kartu kredit disimpan (bayar QRIS)
• Server proteksi DDoS
✅ **Progress game aman karena:**
• **Cloud Save otomatis** setiap sesi
• Data tidak hilang meski ganti perangkat
• Backup rutin oleh tim AlexCloud
**Privacy:** Data kamu tidak dijual ke pihak ketiga! 🛡️`,
  save: `💾 **Cloud Save di AlexCloud:**
Progress game kamu tersimpan otomatis di cloud!
**Artinya kamu bisa:**
• Main di HP pagi hari
• Lanjut di laptop siang
• Main di PC malam
→ Progress tetap sama! 🔄
**Game save tersimpan:** Semua game di library AlexCloud mendukung cloud save.
Tidak perlu khawatir progress hilang! 🎮✅`,
  kontrol: `🎮 **Kontrol & Input Cloud Gaming:**
**Input yang bisa digunakan:**
• ⌨️ **Keyboard + Mouse** (PC/Laptop)
• 🎮 **Controller** — Xbox, PS4/PS5, Gamepad USB
• 📱 **Touch screen** (HP/Tablet) — untuk game yang support
• 🖱️ **Mouse saja** (untuk game strategi)
**Tips Controller:**
• Xbox controller paling direkomendasikan
• PS4/PS5 controller: pakai kabel USB atau DS4Windows
• Gamepad generic USB: langsung plug-and-play
**Apakah controller terasa lag?**
Input lag <30ms, hampir tidak terasa untuk kebanyakan game! 🎯`,
  browser: `🌐 **Browser Terbaik untuk Cloud Gaming:**
**✅ Direkomendasikan:**
1. **Google Chrome** (terbaik, paling stabil)
2. **Microsoft Edge** (berbasis Chromium, cepat)
3. **Mozilla Firefox** (bagus, alternatif)
4. **Safari** (untuk pengguna Mac/iPhone)
**❌ Hindari:**
• Internet Explorer (sudah usang)
• Browser lama yang tidak update
**Tips:**
• Selalu update browser ke versi terbaru
• Disable extensi yang berat saat gaming
• Gunakan mode hardware acceleration (biasanya default ON)`,
};
function _getAIResponseLegacy(msg) {
  const lower = msg.toLowerCase();
  if (lower.match(/halo|hai|hi|hello|hey|apa kabar|selamat|assalam|pagi|siang|malam|sore/))
    return `Halo! 👋 Saya **AlexBot**, AI assistant AlexCloud!\n\nSaya tahu segala hal tentang cloud gaming dan AlexCloud. Tanya saja apa saja! 😊\n\n🎮 Game library\n💰 Harga & paket\n☁️ Apa itu cloud gaming?\n💳 Cara bayar & daftar\n🔧 Troubleshooting\n⚡ Tips performa`;
  if (lower.match(/terima kasih|makasih|thanks|thank you|mantap|keren|bagus|oke/))
    return `Sama-sama! 😊 Senang bisa membantu!\n\nJangan ragu tanya lagi kalau ada yang mau ditanyakan. **Happy gaming!** 🎮⚡`;
  if (lower.match(/harga|paket|biaya|tarif|murah|berapa|bayar berapa|cost|price/))
    return AI_KNOWLEDGE.harga;
  if (lower.match(/cara bayar|pembayaran|qris|transfer|cara order|beli|checkout|konfirmasi|wa admin|whatsapp/))
    return AI_KNOWLEDGE.bayar;
  if (lower.match(/game apa|list game|daftar game|judul|library|koleksi|ada game|game tersedia|game nya apa/))
    return AI_KNOWLEDGE.game;
  if (lower.match(/fitur|keunggulan|kelebihan|kenapa pilih|keuntungan|apa saja|benefit/))
    return AI_KNOWLEDGE.fitur;
  if (lower.match(/apa itu cloud|cloud gaming itu|gimana cloud|bagaimana cloud|definisi cloud|pengertian/))
    return AI_KNOWLEDGE.cloudGaming;
  if (lower.match(/cara main|gimana main|bagaimana main|langkah|cara pakai|cara akses|cara login|cara bermain/))
    return AI_KNOWLEDGE.cara;
  if (lower.match(/hp|handphone|laptop|pc|tablet|ipad|smart tv|perangkat|device|bisa main di|support di/))
    return AI_KNOWLEDGE.perangkat;
  if (lower.match(/internet|mbps|wifi|koneksi|speed|bandwidth|data|kuota|jaringan/))
    return AI_KNOWLEDGE.internet;
  if (lower.match(/ping|latency|lag|fps|kualitas|4k|performa|smooth|input lag|delay|ngelag/))
    return AI_KNOWLEDGE.latency;
  if (lower.match(/banding|compare|vs|versus|geforce|xbox cloud|playstation|shadow|nvidia|lebih bagus|beda|bedanya/))
    return AI_KNOWLEDGE.vs;
  if (lower.match(/beli pc|mahal|tanpa pc|tanpa konsol|gak perlu|tidak perlu|hemat|murah dari/))
    return AI_KNOWLEDGE.keunggulan;
  if (lower.match(/rekomendasi|rekomen|saran|suggest|terbaik|bagus|enak dimain|wajib main|game seru/))
    return AI_KNOWLEDGE.rekomendasi;
  if (lower.match(/trending|populer|hits|viral|terpopuler|paling banyak|hot game/))
    return AI_KNOWLEDGE.trending;
  if (lower.match(/promo|diskon|kode|voucher|potongan|coupon|cashback/))
    return AI_KNOWLEDGE.promo;
  if (lower.match(/daftar|register|buat akun|signup|sign up|cara daftar/))
    return AI_KNOWLEDGE.daftar;
  if (lower.match(/aman|keamanan|privasi|data|hack|save|bocor|enkripsi/))
    return AI_KNOWLEDGE.aman;
  if (lower.match(/save|simpan|progress|lanjut|ganti perangkat|hilang|tersimpan/))
    return AI_KNOWLEDGE.save;
  if (lower.match(/kontrol|controller|joystick|keyboard|mouse|gamepad|ps4|xbox|input/))
    return AI_KNOWLEDGE.kontrol;
  if (lower.match(/browser|chrome|firefox|edge|safari|aplikasi|app/))
    return AI_KNOWLEDGE.browser;
  if (lower.match(/error|problem|masalah|tidak bisa|gangguan|crash|freeze|black screen|tidak jalan|tidak konek/))
    return AI_KNOWLEDGE.troubleshoot;
  if (lower.match(/bisa apa|bantu apa|tanya apa|topik|pertanyaan|menu|help|bantuan/))
    return `🤖 Saya bisa menjawab pertanyaan tentang:\n\n☁️ **Cloud Gaming**\n• Apa itu cloud gaming?\n• Cara kerja & keunggulan\n• Perangkat yang bisa digunakan\n• Kebutuhan internet\n\n🎮 **AlexCloud**\n• Harga paket\n• Cara daftar & bayar\n• Daftar game library\n• Rekomendasi game\n• Troubleshooting\n• Keamanan & privasi\n\nKetik pertanyaan kamu! 😊`;
  return `🤖 Hmm, saya kurang yakin dengan pertanyaan itu.\n\nCoba tanya tentang:\n• **"apa itu cloud gaming?"**\n• **"cara main di AlexCloud"**\n• **"game apa yang ada?"**\n• **"harga paket berapa?"**\n• **"koneksi berapa Mbps?"**\n\nAtau hubungi admin langsung via WhatsApp! 📱`;
}
let chatOpen = false;
function toggleAIChat() {
  chatOpen = !chatOpen;
  const win = document.getElementById('aiChatWindow');
  const toggle = document.getElementById('aiChatToggle');
  if (win) win.classList.toggle('open', chatOpen);
  if (toggle) toggle.setAttribute('aria-expanded', chatOpen ? 'true' : 'false');
  if (toggle) toggle.setAttribute('aria-label', chatOpen ? 'Tutup AI Chat AlexBot' : 'Buka AI Chat AlexBot');
}
function sendAIMessage() {
  const input = document.getElementById('aiChatInput');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  addChatMessage(msg, 'user');
  const typingId = addTypingIndicator();
  setTimeout(() => {
    removeTypingIndicator(typingId);
    const response = getAIResponse(msg);
    addChatMessage(response, 'bot');
  }, 800 + Math.random() * 600);
}
function askAI(question) {
  document.getElementById('aiChatInput').value = question;
  sendAIMessage();
}
function handleChatEnter(e) {
  if (e.key === 'Enter') sendAIMessage();
}
function addChatMessage(msg, sender) {
  const container = document.getElementById('aiMessages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `ai-message ${sender}`;
  const avatar = document.createElement('div');
  avatar.className = 'ai-msg-avatar';
  avatar.innerHTML = sender === 'bot' ? '<i class="fas fa-robot"></i>' : '<i class="fas fa-user"></i>';
  const bubble = document.createElement('div');
  bubble.className = 'ai-msg-bubble';
  bubble.innerHTML = msg.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  div.appendChild(avatar);
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}
function addTypingIndicator() {
  const container = document.getElementById('aiMessages');
  if (!container) return null;
  const id = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'ai-message bot';
  div.id = id;
  div.innerHTML = `<div class="ai-msg-avatar"><i class="fas fa-robot"></i></div><div class="ai-msg-bubble"><div class="ai-typing"><span></span><span></span><span></span></div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}
function removeTypingIndicator(id) {
  if (id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
}
function clearChat() {
  const container = document.getElementById('aiMessages');
  if (container) container.innerHTML = `
    <div class="ai-message bot">
      <div class="ai-msg-avatar"><i class="fas fa-robot"></i></div>
      <div class="ai-msg-bubble">
        Chat dibersihkan! Halo lagi 👋 Ada yang bisa saya bantu?
        <div class="ai-quick-chips">
          <button onclick="askAI('rekomendasi game terbaik')">🎮 Rekomendasi Game</button>
          <button onclick="askAI('harga paket berlangganan')">💰 Info Harga</button>
        </div>
      </div>
    </div>`;
}
let searchTimeout;
const navSearchInput = document.getElementById('navSearchInput');
const searchDropdown = document.getElementById('searchDropdown');
if (navSearchInput) {
  navSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (!q) {
      searchDropdown.classList.remove('show');
      searchDropdown.innerHTML = '';
      return;
    }
    searchTimeout = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/games/search?q=${encodeURIComponent(q)}`);
        const games = await resp.json();
        if (games.length === 0) {
          searchDropdown.classList.remove('show');
          return;
        }
        searchDropdown.innerHTML = games.map(g => `
          <a href="/games?q=${encodeURIComponent(g.name)}" class="search-result-item">
            <img src="${g.image}" alt="${g.name}" loading="lazy">
            <div class="search-result-info">
              <div class="search-result-name">${g.name}</div>
              <div class="search-result-genre">${g.genre} · ⭐ ${g.rating}</div>
            </div>
          </a>
        `).join('');
        searchDropdown.classList.add('show');
      } catch(e) {}
    }, 300);
  });
  navSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      window.location.href = `/games?q=${encodeURIComponent(navSearchInput.value.trim())}`;
    }
  });
  document.addEventListener('click', (e) => {
    if (searchDropdown && !searchDropdown.contains(e.target) && e.target !== navSearchInput) {
      searchDropdown.classList.remove('show');
    }
  });
}
function setViewMode(mode) {
  const display = document.getElementById('gamesDisplay');
  if (!display) return;
  display.classList.remove('list-view', 'compact-view', 'grid-view');
  if (mode === 'list') display.classList.add('list-view');
  else if (mode === 'compact') display.classList.add('compact-view');
  document.querySelectorAll('.view-mode-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById('btn-' + mode);
  if (activeBtn) activeBtn.classList.add('active');
  localStorage.setItem('alexcloud_view_mode', mode);
}
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('alexcloud_view_mode');
  if (saved && saved !== 'grid') setViewMode(saved);
});
let currentTesti = 0;
let testiAutoPlay;
function goToTesti(idx) {
  const cards = document.querySelectorAll('.testi-card');
  const dots = document.querySelectorAll('.testi-dot');
  if (!cards.length) return;
  cards[currentTesti]?.classList.remove('active');
  dots[currentTesti]?.classList.remove('active');
  currentTesti = (idx + cards.length) % cards.length;
  cards[currentTesti]?.classList.add('active');
  dots[currentTesti]?.classList.add('active');
}
function testiNext() {
  goToTesti(currentTesti + 1);
  resetTestiAutoPlay();
}
function testiPrev() {
  goToTesti(currentTesti - 1);
  resetTestiAutoPlay();
}
function startTestiAutoPlay() {
  testiAutoPlay = setInterval(() => goToTesti(currentTesti + 1), 5000);
}
function resetTestiAutoPlay() {
  clearInterval(testiAutoPlay);
  startTestiAutoPlay();
}
if (document.querySelectorAll('.testi-card').length > 1) {
  startTestiAutoPlay();
}