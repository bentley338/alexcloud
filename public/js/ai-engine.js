// WARNING: JANGAN EDIT FILE INI SECARA LANGSUNG. Edit file .src.js yang sesuai. File ini di-minify otomatis saat startup server.
(function () {
  'use strict';
  var chatWindow   = null;
  var chatMessages = null;
  var chatInput    = null;
  var toggleBtn    = null;
  var knowledgeBase = [
    {
      keywords: ['harga', 'paket', 'price', 'berapa', 'biaya', 'tarif', 'murah', 'promo'],
      response:
        '💰 <b>Paket Harga AlexCloud Gaming:</b><br><br>' +
        '• <b>1 Minggu</b> — Rp40.000<br>' +
        '• <b>1 Bulan</b> — Rp60.000<br>' +
        '• <b>2 Bulan</b> — Rp100.000<br>' +
        '• <b>3 Bulan</b> — Rp150.000<br><br>' +
        '✨ Semakin lama langganan, semakin hemat! Mau langsung order? Hubungi admin via WhatsApp ya 😉'
    },
    {
      keywords: ['game', 'rekomendasi', 'main', 'judul', 'daftar game', 'katalog', 'list game', 'permainan'],
      response:
        '🎮 <b>Game Populer di AlexCloud:</b><br><br>' +
        '⚽ EA FC 26 &amp; EA FC 25<br>' +
        '🏍️ MotoGP 25 &amp; MotoGP 24<br>' +
        '🔦 Alan Wake 2<br>' +
        '🧙 Hogwarts Legacy<br>' +
        '⚔️ God of War Ragnarök<br>' +
        '🕷️ Spider-Man 2<br>' +
        '🏎️ Forza Horizon 5<br>' +
        '🔫 Call of Duty MW3<br>' +
        '🧟 Resident Evil 4 Remake<br><br>' +
        'Dan masih banyak lagi! Semua bisa langsung dimainkan tanpa download besar 🚀'
    },
    {
      keywords: ['bayar', 'payment', 'qris', 'gopay', 'transfer', 'dana', 'ovo', 'bca', 'pembayaran'],
      response:
        '💳 <b>Cara Pembayaran AlexCloud:</b><br><br>' +
        '1️⃣ Scan <b>QRIS</b> yang tersedia di halaman checkout<br>' +
        '2️⃣ Bayar via <b>GoPay</b>, DANA, atau OVO<br>' +
        '3️⃣ Setelah bayar, <b>konfirmasi ke admin</b> via WhatsApp<br><br>' +
        '⚡ Akun aktif dalam 1–5 menit setelah konfirmasi!'
    },
    {
      keywords: ['fitur', 'spesifikasi', 'server', 'spec', 'kualitas', 'latency', 'lag', 'ping', 'fps', 'resolusi'],
      response:
        '🖥️ <b>Fitur Unggulan AlexCloud:</b><br><br>' +
        '🇮🇩 Server lokal <b>Indonesia</b> — ping rendah<br>' +
        '⚡ <b>Low latency</b> untuk pengalaman gaming mulus<br>' +
        '🎬 Streaming hingga <b>4K 60fps</b><br>' +
        '🛡️ <b>Support 24/7</b> — tim kami selalu siap bantu<br>' +
        '☁️ Tanpa download — langsung main dari browser<br><br>' +
        'Gaming kelas PC premium, cukup dari HP kamu! 📱'
    },
    {
      keywords: ['daftar', 'register', 'akun', 'buat akun', 'sign up', 'signup', 'registrasi', 'cara daftar'],
      response:
        '📝 <b>Cara Daftar AlexCloud:</b><br><br>' +
        '1️⃣ Klik tombol <b>"Daftar"</b> di halaman utama<br>' +
        '2️⃣ Isi data diri (nama, email, no. HP)<br>' +
        '3️⃣ Pilih paket yang kamu mau<br>' +
        '4️⃣ Lakukan pembayaran<br>' +
        '5️⃣ Akun siap digunakan! 🎉<br><br>' +
        'Mudah banget, kan? Yuk langsung daftar!'
    },
    {
      keywords: ['halo', 'hai', 'hello', 'hi', 'hey', 'apa kabar', 'selamat'],
      response:
        'Halo! 👋 Selamat datang di <b>AlexCloud Gaming</b>!<br><br>' +
        'Aku <b>AlexBot</b>, asisten virtual kamu. Mau tanya soal apa nih? 😊<br><br>' +
        '• 💰 Harga &amp; Paket<br>' +
        '• 🎮 Daftar Game<br>' +
        '• 💳 Cara Pembayaran<br>' +
        '• 🖥️ Fitur &amp; Spesifikasi<br>' +
        '• 📝 Cara Daftar'
    },
    {
      keywords: ['terima kasih', 'thanks', 'makasih', 'thx', 'thank you'],
      response:
        'Sama-sama! 😊 Senang bisa membantu.<br>Kalau ada pertanyaan lain, jangan ragu tanya lagi ya! 🎮'
    },
    {
      keywords: ['admin', 'whatsapp', 'wa', 'kontak', 'hubungi', 'contact'],
      response:
        '📞 <b>Hubungi Admin AlexCloud:</b><br><br>' +
        'Kamu bisa langsung chat admin via <b>WhatsApp</b> untuk bantuan lebih lanjut.<br>' +
        'Klik tombol WhatsApp di pojok halaman atau kirim pesan ke nomor yang tertera di website 💬'
    }
  ];
  var defaultResponse =
    '🤔 Hmm, aku belum paham pertanyaan kamu nih.<br><br>' +
    'Coba tanya tentang:<br>' +
    '• 💰 <b>Harga</b> — ketik "harga" atau "paket"<br>' +
    '• 🎮 <b>Game</b> — ketik "game" atau "rekomendasi"<br>' +
    '• 💳 <b>Pembayaran</b> — ketik "bayar" atau "QRIS"<br>' +
    '• 🖥️ <b>Fitur</b> — ketik "fitur" atau "server"<br>' +
    '• 📝 <b>Daftar</b> — ketik "daftar" atau "register"<br><br>' +
    'Atau hubungi admin langsung via WhatsApp ya! 😉';
  function appendMessage(text, sender) {
    if (!chatMessages) return;
    var messageDiv = document.createElement('div');
    messageDiv.className = 'ai-message ' + (sender === 'user' ? 'user' : 'bot');
    var avatarDiv = document.createElement('div');
    avatarDiv.className = 'ai-msg-avatar';
    var icon = document.createElement('i');
    icon.className = sender === 'user' ? 'fas fa-user' : 'fas fa-robot';
    avatarDiv.appendChild(icon);
    var bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'ai-msg-bubble';
    if (sender === 'user') {
      bubbleDiv.textContent = text;
    } else {
      bubbleDiv.innerHTML = text;
    }
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(bubbleDiv);
    chatMessages.appendChild(messageDiv);
    scrollChatToBottom();
    return messageDiv;
  }
  function showTypingIndicator() {
    if (!chatMessages) return null;
    var indicator = document.createElement('div');
    indicator.className = 'ai-message bot typing-indicator';
    var avatarDiv = document.createElement('div');
    avatarDiv.className = 'ai-msg-avatar';
    var icon = document.createElement('i');
    icon.className = 'fas fa-robot';
    avatarDiv.appendChild(icon);
    var bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'ai-msg-bubble';
    var typingDiv = document.createElement('div');
    typingDiv.className = 'ai-typing';
    typingDiv.innerHTML = '<span></span><span></span><span></span>';
    bubbleDiv.appendChild(typingDiv);
    indicator.appendChild(avatarDiv);
    indicator.appendChild(bubbleDiv);
    chatMessages.appendChild(indicator);
    scrollChatToBottom();
    return indicator;
  }
  function removeTypingIndicator(indicator) {
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }
  function scrollChatToBottom() {
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }
  function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function getAIResponse(query) {
    var normalised = query.toLowerCase().trim();
    for (var i = 0; i < knowledgeBase.length; i++) {
      var entry = knowledgeBase[i];
      for (var k = 0; k < entry.keywords.length; k++) {
        if (normalised.indexOf(entry.keywords[k]) !== -1) {
          return entry.response;
        }
      }
    }
    return defaultResponse;
  }
  window.getAIResponse = getAIResponse;
  function sendAIMessage() {
    if (!chatInput) return;
    var text = chatInput.value.trim();
    if (!text) return;
    appendMessage(text, 'user');
    chatInput.value = '';
    chatInput.focus();
    var indicator = showTypingIndicator();
    fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: text })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('API response not OK');
      return res.json();
    })
    .then(function(data) {
      removeTypingIndicator(indicator);
      if (data && data.response) {
        appendMessage(data.response, 'bot');
      } else {
        throw new Error('Invalid API response format');
      }
    })
    .catch(function(err) {
      console.warn('[AI CHAT] Gemini API error, falling back to local engine:', err);
      removeTypingIndicator(indicator);
      var response = getAIResponse(text);
      if (response !== defaultResponse) {
        appendMessage(response, 'bot');
      }
    });
  }
  window.sendAIMessage = sendAIMessage;
  function handleChatEnter(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendAIMessage();
    }
  }
  window.handleChatEnter = handleChatEnter;
  function askAI(question) {
    if (!chatInput) {
      chatInput = document.getElementById('aiChatInput');
    }
    if (chatInput) {
      chatInput.value = question;
    }
    sendAIMessage();
  }
  window.askAI = askAI;
  function clearChat() {
    if (!chatMessages) return;
    var messages = chatMessages.querySelectorAll('.ai-message');
    for (var i = 1; i < messages.length; i++) {
      chatMessages.removeChild(messages[i]);
    }
    if (!chatMessages.querySelector('.ai-message')) {
      appendMessage(
        '👋 Halo! Aku <b>AlexBot</b>, asisten virtual AlexCloud Gaming.<br>' +
        'Tanya aku soal harga, game, pembayaran, atau fitur ya!',
        'bot'
      );
    }
    if (chatInput) {
      chatInput.value = '';
      chatInput.focus();
    }
  }
  window.clearChat = clearChat;
  function toggleAIChat() {
    if (!chatWindow) {
      chatWindow = document.getElementById('aiChatWindow');
    }
    if (!chatWindow) return;
    var isOpen = chatWindow.classList.toggle('open');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', String(isOpen));
    }
    if (isOpen) {
      if (chatMessages && !chatMessages.querySelector('.ai-message')) {
        appendMessage(
          '👋 Halo! Aku <b>AlexBot</b>, asisten virtual AlexCloud Gaming.<br>' +
          'Tanya aku soal harga, game, pembayaran, atau fitur ya!',
          'bot'
        );
      }
      if (chatInput) chatInput.focus();
    }
  }
  window.toggleAIChat = toggleAIChat;
  function init() {
    chatWindow   = document.getElementById('aiChatWindow');
    chatMessages = document.getElementById('aiMessages');
    chatInput    = document.getElementById('aiChatInput');
    toggleBtn    = document.querySelector('[data-chat-toggle], .ai-chat-toggle, #aiChatToggle');
    if (chatInput) {
      chatInput.addEventListener('keydown', handleChatEnter);
    }
    var sendBtn = document.querySelector('#aiChatSend, .ai-chat-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', sendAIMessage);
    }
    var clearBtn = document.querySelector('#aiChatClear, .ai-chat-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearChat);
    }
    var chips = document.querySelectorAll('[data-ai-ask]');
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        askAI(chip.getAttribute('data-ai-ask'));
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();