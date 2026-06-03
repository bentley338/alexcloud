const https = require('https');
const { db } = require('../database/db');

/**
 * Sends a WhatsApp notification using the CallMeBot WhatsApp API
 * @param {string} messageText - The message content to send
 */
async function sendWhatsAppNotification(messageText) {
  const settings = db.get('settings').value() || {};
  const isEnabled = settings.whatsappEnabled === true || settings.whatsappEnabled === 'true';
  
  if (!isEnabled) {
    console.log('[WA NOTIF] Notifications are disabled in settings.');
    return { success: false, reason: 'disabled' };
  }
  
  let phone = settings.whatsappPhone || process.env.WA_NUMBER || '';
  const apiKey = settings.whatsappApiKey || '';
  
  if (!phone || !apiKey) {
    console.log('[WA NOTIF] Missing phone number or API key in settings.');
    return { success: false, reason: 'missing_credentials' };
  }
  
  // Clean phone number format
  phone = phone.replace(/[\s\-\+]/g, '');
  if (phone.startsWith('0')) {
    phone = '62' + phone.substring(1);
  }
  
  // CallMeBot Endpoint
  const textEncoded = encodeURIComponent(messageText);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${textEncoded}&apikey=${apiKey}`;
  
  console.log(`[WA NOTIF] Sending WhatsApp message to ${phone}...`);
  
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const isSuccess = res.statusCode === 200;
        console.log(`[WA NOTIF] CallMeBot Response Status: ${res.statusCode}. Body: ${body}`);
        resolve({ success: isSuccess, body });
      });
    });
    
    req.on('error', (err) => {
      console.error('[WA NOTIF] CallMeBot Request Error:', err.message);
      resolve({ success: false, reason: err.message });
    });
    
    req.setTimeout(8000, () => {
      req.destroy();
      console.error('[WA NOTIF] CallMeBot Request Timeout');
      resolve({ success: false, reason: 'timeout' });
    });
  });
}

module.exports = { sendWhatsAppNotification };
