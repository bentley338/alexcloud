const https = require('https');
const { db } = require('../database/db');
const { sharedHttpsAgent } = require('./helpers');

/**
 * Sends a Telegram notification using the official Telegram Bot API
 * @param {string} messageText - The message content to send
 */
async function sendTelegramNotification(messageText) {
  const settings = db.get('settings').value() || {};
  const isEnabled = settings.telegramEnabled === true || settings.telegramEnabled === 'true';
  
  if (!isEnabled) {
    console.log('[TG NOTIF] Telegram notifications are disabled.');
    return { success: false, reason: 'disabled' };
  }
  
  const botToken = settings.telegramBotToken || '';
  const chatId = settings.telegramChatId || '';
  
  if (!botToken || !chatId) {
    console.log('[TG NOTIF] Missing bot token or chat ID.');
    return { success: false, reason: 'missing_credentials' };
  }
  
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = JSON.stringify({
    chat_id: chatId,
    text: messageText,
    parse_mode: 'Markdown'
  });
  
  console.log(`[TG NOTIF] Sending Telegram message to ${chatId}...`);
  
  return new Promise((resolve) => {
    const options = {
      method: 'POST',
      agent: sharedHttpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 8000
    };
    
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const isSuccess = res.statusCode === 200;
        console.log(`[TG NOTIF] Telegram Response Status: ${res.statusCode}. Body: ${body}`);
        resolve({ success: isSuccess, body });
      });
    });
    
    req.on('error', (err) => {
      console.error('[TG NOTIF] Telegram Request Error:', err.message);
      resolve({ success: false, reason: err.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.error('[TG NOTIF] Telegram Request Timeout');
      resolve({ success: false, reason: 'timeout' });
    });
    
    req.write(payload);
    req.end();
  });
}

module.exports = { sendTelegramNotification };
