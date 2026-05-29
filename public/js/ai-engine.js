// ============================================
// 🧠 ALEXBOT SMART AI ENGINE v2
// Fuzzy + Scoring-based intent detection
// ============================================

const AI_TOPICS = [
  {
    key: 'greet',
    kw: ['halo','hai','hi','hello','hey','apa kabar','selamat','assalamualaikum','pagi','siang','malam','sore','hoi','haloo','helo','p','yo'],
    direct: `Halo! 👋 Saya **AlexBot** 🤖 — AI assistant AlexCloud!\n\nSaya bisa jawab semua pertanyaan tentang:\n🎮 Game & library\n💰 Harga & paket\n☁️ Apa itu cloud gaming?\n💳 Cara bayar & daftar\n📱 Perangkat yang bisa dipakai\n⚡ Performa & tips\n📶 Test kecepatan internet\n\nTanya apa saja, saya siap bantu! 😊`
  },
  {
    key: 'thanks',
    kw: ['terima kasih','makasih','thanks','thank','tengkiu','thx','tx','mantap','keren','oke','ok','sip','bagus','good','nice','top','gas','gass','siap','iya','ya'],
    direct: `Sama-sama! 😊 Senang bisa membantu!\n\n**Happy gaming!** 🎮⚡\nJangan ragu tanya lagi ya!`
  },
  {
    key: 'harga',
    kw: ['harga','paket','biaya','tarif','berapa','bayar berapa','cost','price','idr','rupiah','rp','uang','murah','mahal','cicil','subscribe','berlangganan','plan','tipe pilihan','plan apa','paket apa','brp','hrgnya','hrg','bayar brp','biayanya'],
    resp: 'harga'
  },
  {
    key: 'bayar',
    kw: ['cara bayar','bayar','pembayaran','qris','transfer','cara order','order','beli','checkout','konfirmasi','aktifkan','cara pesan','transaksi','gopay','ovo','dana','shopeepay','linkaja','mbanking','mobile banking','scan qr','scan','gmn bayar','bayar gmn','cara order gmn','pesan'],
    resp: 'bayar'
  },
  {
    key: 'game',
    kw: ['game','games','judul game','main apa','library','koleksi','tersedia','gta','elden ring','god of war','ea fc','motogp','cod','alan wake','cyberpunk','spider man','hogwarts','witcher','rdr','battlefield','list game','ada game','game apa','judul apa'],
    resp: 'game'
  },
  {
    key: 'fitur',
    kw: ['fitur','feature','keunggulan','kelebihan','kenapa pilih','keuntungan','benefit','apa yang ada','fasilitas','layanan','service','advantage','apa aja','apa saja','keistimewaan'],
    resp: 'fitur'
  },
  {
    key: 'cloudGaming',
    kw: ['cloud gaming','apa itu','pengertian','definisi','cara kerja','sistem','teknologi','gimana sih','gimana cara','streaming game','remote play','cloud game itu','maksudnya','artinya'],
    resp: 'cloudGaming'
  },
  {
    key: 'cara',
    kw: ['cara','langkah','gimana','bagaimana','tutorial','guide','cara main','mulai','start','step by step','how to','akses','cara masuk','cara login','pertama kali','baru pertama'],
    resp: 'cara'
  },
  {
    key: 'perangkat',
    kw: ['perangkat','device','hp','handphone','ponsel','smartphone','laptop','pc','computer','komputer','tablet','ipad','tv','smart tv','chromebook','macbook','android','ios','iphone','bisa di','support di','kompatibel','bisa pakai'],
    resp: 'perangkat'
  },
  {
    key: 'internet',
    kw: ['internet','mbps','wifi','koneksi','speed','bandwidth','data','kuota','jaringan','sinyal','4g','5g','fiber','indihome','telkom','xl','simpati','tri','axis','kencang','lemot','lambat','cepat','stabil','butuh berapa','minimal berapa','berapa mbps'],
    resp: 'internet'
  },
  {
    key: 'latency',
    kw: ['ping','latency','lag','fps','frame','performa','smooth','input lag','delay','ngelag','patah','lemot','berat','slow','glitch','freeze','stuttering','4k','resolusi','quality','kualitas','rebahan','tidak smooth'],
    resp: 'latency'
  },
  {
    key: 'vs',
    kw: ['banding','compare','vs','versus','geforce','xbox cloud','playstation','shadow','nvidia','stadia','luna','lebih bagus dari','beda','perbedaan','bedanya','alternatif','competitor','lain','other','dibanding'],
    resp: 'vs'
  },
  {
    key: 'keunggulan',
    kw: ['beli pc','beli konsol','tanpa pc','tanpa konsol','gak perlu','tidak perlu hardware','hemat','menghemat','lebih murah dari','worth','invest','mahal beli','spec pc','spesifikasi','min spec','butuh pc'],
    resp: 'keunggulan'
  },
  {
    key: 'rekomendasi',
    kw: ['rekomendasi','rekomen','rekom','saran','suggest','bagus','enak dimain','wajib main','game seru','terbaik','top game','must play','harus main','suka main','genre apa','rpg','fps','sport','racing','horror','action','adventure','mana yang','game bagus'],
    resp: 'rekomendasi'
  },
  {
    key: 'trending',
    kw: ['trending','trend','populer','popular','hits','viral','banyak dimain','hot','top chart','paling laris','sedang hits','minggu ini','terkini','terbaru','new game','newest','latest'],
    resp: 'trending'
  },
  {
    key: 'promo',
    kw: ['promo','diskon','kode promo','voucher','coupon','cashback','potongan harga','promo apa','kode apa','redeem','kupon','reward','promo sekarang','ada diskon','ada promo','promo gak','diskon gak','kode diskon','kode voucher'],
    resp: 'promo'
  },
  {
    key: 'daftar',
    kw: ['daftar','register','buat akun','signup','sign up','cara daftar','registrasi','join','akun baru','google login','login google','oauth','masuk akun','new account','belum punya akun'],
    resp: 'daftar'
  },
  {
    key: 'aman',
    kw: ['aman','keamanan','privasi','data','hack','enkripsi','secure','safety','bocor','terpercaya','trust','privasi','terlindungi','safe','privacy'],
    resp: 'aman'
  },
  {
    key: 'save',
    kw: ['save','simpan','progress','lanjut','ganti hp','ganti perangkat','beda device','hilang','cloud save','tersimpan','tersinkron','sync','progress hilang','data hilang'],
    resp: 'save'
  },
  {
    key: 'kontrol',
    kw: ['kontrol','controller','joystick','keyboard','mouse','gamepad','ps4','ps5','xbox','input','stik','stick','dualshock','dualshock4','kontroller','cara kontrol','pakai apa','bisa pakai stik','stik bisa','ctrl','pad','analog'],
    resp: 'kontrol'
  },
  {
    key: 'browser',
    kw: ['browser','chrome','firefox','edge','safari','opera','aplikasi','app','download app','install','software','pakai browser apa','browser terbaik'],
    resp: 'browser'
  },
  {
    key: 'troubleshoot',
    kw: ['error','problem','masalah','tidak bisa','gangguan','crash','freeze','black screen','tidak jalan','tidak konek','blank','rusak','bug','issue','tolong','susah','gagal','kenapa tidak','kenapa gak','tidak keluar','tidak muncul'],
    resp: 'troubleshoot'
  },
  {
    key: 'speedtest',
    kw: ['speed test','tes kecepatan','test jaringan','cek internet','cek koneksi','tes internet','ukur kecepatan','kecepatan internet','network test','speedtest','test speed','test net','cek speed','tes speed'],
    direct: `📶 **Test Kecepatan Jaringan**\n\nTest kecepatan internet kamu langsung di:\n👉 **[/network-test](/network-test)**\n\nHasil test:\n• 🏓 Ping (latency)\n• ⬇️ Download speed\n• ⬆️ Upload speed\n• 📊 Rekomendasi kualitas gaming\n\n**Panduan kecepatan:**\n• ≥ 25 Mbps → 4K/60fps 🚀\n• ≥ 10 Mbps → 1080p/60fps ✅\n• ≥ 5 Mbps → 720p ⚠️\n• < 5 Mbps → Tidak direkomendasikan ❌`
  },
  {
    key: 'faq',
    kw: ['faq','pertanyaan umum','tanya jawab','qna','q&a','sering ditanya','info lengkap','panduan lengkap','semua pertanyaan','daftar pertanyaan'],
    direct: `❓ **FAQ AlexCloud**\n\nLihat semua pertanyaan lengkap di:\n👉 **[/faq](/faq)**\n\nKategori FAQ:\n• 💡 Pertanyaan Umum\n• ⚙️ Teknis & Performa\n• 💳 Pembayaran & Harga\n• 👤 Akun & Login\n• 🎮 Seputar Game\n\nAtau tanya langsung ke saya! 🤖`
  },
  {
    key: 'refund',
    kw: ['refund','uang kembali','cancel','pembatalan','batal','tidak jadi','kembaliin uang','minta refund','garansi','kembalikan'],
    direct: `💸 **Kebijakan Refund AlexCloud:**\n\n✅ Refund penuh jika akun **belum diaktifkan** dalam 24 jam\n✅ Kompensasi waktu jika ada **gangguan server** dari kami\n⚠️ Tidak ada refund jika akun sudah aktif & digunakan\n\nUntuk diskusi lebih lanjut, hubungi admin via **WhatsApp**!`
  },
  {
    key: 'multidevice',
    kw: ['multi device','banyak perangkat','berapa perangkat','beberapa hp','sharing akun','share akun','2 hp','dua device','login banyak','serentak','bersamaan'],
    direct: `📱 **Multi-Device AlexCloud:**\n\nSatu akun hanya untuk **1 sesi aktif** dalam satu waktu.\n\nJika login di perangkat lain → sesi sebelumnya otomatis logout.\n\nIni untuk menjaga kualitas layanan dan keadilan untuk semua pengguna.`
  },
  {
    key: 'multiplayer',
    kw: ['multiplayer','online','pvp','coop','co-op','bareng teman','sama teman','main bareng','online multiplayer','bisa main sama','versus orang'],
    direct: `🎮 **Multiplayer di AlexCloud:**\n\nTergantung game yang dimainkan:\n✅ Game dengan **mode online built-in** (COD, EA FC, dll) → langsung main online!\n✅ **Co-op campaign** → bisa jika game mendukung\n⚠️ **Local multiplayer** → tidak tersedia (cloud-based)\n\nUntuk detail per game, tanya admin WhatsApp!`
  },
  {
    key: 'aktivasi',
    kw: ['aktivasi','aktifkan','sudah bayar','setelah bayar','berapa lama','kapan aktif','belum aktif','aktivasi berapa lama','aktif nya','akun aktif','lama aktivasi'],
    direct: `⚡ **Waktu Aktivasi Akun:**\n\nAkun diaktifkan dalam **1–15 menit** setelah konfirmasi!\n\n**Cara konfirmasi:**\n1. Screenshot bukti pembayaran\n2. Kirim ke admin WhatsApp\n3. Admin verifikasi & aktifkan\n4. Kamu langsung bisa main! 🎮\n\nKami beroperasi **24/7** untuk konfirmasi cepat!`
  },
  {
    key: 'help',
    kw: ['bantu','help','bantuan','bisa apa','ngapain','topik','tanya apa','list','menu','kemampuan','kapabilitas','apa fungsi'],
    direct: `🤖 Saya bisa jawab pertanyaan tentang:\n\n☁️ **Cloud Gaming**\n• Apa itu & cara kerjanya\n• Perangkat yang bisa dipakai\n• Koneksi internet yang dibutuhkan\n\n🎮 **AlexCloud**\n• Harga & paket\n• Cara daftar & login\n• Cara bayar (QRIS)\n• Library game\n• Rekomendasi & trending\n• Troubleshooting\n\n🔧 **Tools**\n• 📶 [Test kecepatan internet](/network-test)\n• ❓ [FAQ lengkap](/faq)\n\nKetik pertanyaan kamu! 😊`
  }
];

// Levenshtein distance for typo tolerance
function lev(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b[i-1] === a[j-1] ? m[i-1][j-1]
        : 1 + Math.min(m[i-1][j-1], m[i][j-1], m[i-1][j]);
    }
  }
  return m[b.length][a.length];
}

function getAIResponse(msg) {
  const lower = msg.toLowerCase().trim();
  const words = lower.split(/[\s,!?.]+/).filter(w => w.length > 1);

  // Empty / very short
  if (!lower || lower.length < 2) {
    return `Hai! 😊 Ketik pertanyaan kamu ya!\n\nContoh:\n• "harga berapa?"\n• "game apa yang ada?"\n• "cara daftar gimana?"`;
  }

  // Score each topic
  const results = AI_TOPICS.map(topic => {
    let score = 0;

    // Full phrase match in full message (highest priority)
    for (const kw of topic.kw) {
      if (kw.includes(' ') && lower.includes(kw)) score += 20;
    }

    // Word-level matching
    for (const word of words) {
      if (word.length < 2) continue;
      for (const kw of topic.kw) {
        if (kw.includes(' ')) continue; // already handled above
        if (kw === word) score += 10;                              // exact
        else if (kw.startsWith(word) && word.length >= 3) score += 6; // prefix
        else if (word.startsWith(kw) && kw.length >= 4) score += 5;   // word contains kw
        else if (kw.includes(word) && word.length >= 4) score += 4;   // kw contains word
        else if (lev(word, kw) === 1 && kw.length >= 5) score += 4;   // 1 char typo
        else if (lev(word, kw) === 2 && kw.length >= 6) score += 2;   // 2 char typo
      }
    }
    return { topic, score };
  }).sort((a, b) => b.score - a.score);

  const best = results[0];

  // Confident match
  if (best && best.score >= 3) {
    const t = best.topic;
    if (t.direct) return t.direct;
    if (t.resp && typeof AI_KNOWLEDGE !== 'undefined' && AI_KNOWLEDGE[t.resp]) {
      return AI_KNOWLEDGE[t.resp];
    }
  }

  // Weak match — suggest closest topics
  const topSuggestions = results.filter(r => r.score >= 1).slice(0, 3);
  const topicLabels = {
    harga: '💰 Harga paket', bayar: '💳 Cara bayar', game: '🎮 Daftar game',
    cloudGaming: '☁️ Apa itu cloud gaming', cara: '🚀 Cara main',
    perangkat: '📱 Perangkat', internet: '📶 Koneksi internet',
    rekomendasi: '🎯 Rekomendasi game', promo: '🏷️ Promo & diskon',
    daftar: '👤 Cara daftar', latency: '⚡ Performa', speedtest: '📶 Speed test',
    faq: '❓ FAQ', refund: '💸 Refund', aktivasi: '⚡ Aktivasi akun'
  };

  if (topSuggestions.length) {
    const list = topSuggestions.map(r => `• ${topicLabels[r.topic.key] || r.topic.key}`).join('\n');
    return `🤖 Hmm, kurang paham maksudnya. Mungkin kamu mau tanya tentang:\n\n${list}\n\nCoba tanya dengan lebih spesifik, atau hubungi admin via **WhatsApp**! 📱`;
  }

  return `🤖 Saya tidak menemukan jawaban yang tepat.\n\nCoba tanya tentang:\n• "harga paket"\n• "cara daftar"\n• "game yang ada"\n• "koneksi internet"\n\nAtau hubungi admin **WhatsApp** untuk bantuan langsung! 📱`;
}
