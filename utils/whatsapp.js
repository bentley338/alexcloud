const https = require('https');
const querystring = require('querystring');
const { db } = require('../database/db');

/**
 * Sends a WhatsApp notification using either CallMeBot or Twilio Sandbox
 * @param {string} messageText - The message content to send
 */
async function sendWhatsAppNotification(messageText) {
  const settings = db.get('settings').value() || {};
  const isEnabled = settings.whatsappEnabled === true || settings.whatsappEnabled === 'true';
  
  if (!isEnabled) {
    console.log('[WA NOTIF] WhatsApp notifications are disabled.');
    return { success: false, reason: 'disabled' };
  }
  
  const provider = settings.whatsappProvider || 'callmebot';
  
  if (provider === 'twilio') {
    return sendViaTwilio(settings, messageText);
  } else {
    return sendViaCallMeBot(settings, messageText);
  }
}

/**
 * Sends message via CallMeBot API
 */
function sendViaCallMeBot(settings, messageText) {
  let phone = settings.whatsappPhone || process.env.WA_NUMBER || '';
  const apiKey = settings.whatsappApiKey || '';
  
  if (!phone || !apiKey) {
    console.log('[WA NOTIF] Missing phone or CallMeBot API key.');
    return { success: false, reason: 'missing_credentials' };
  }
  
  phone = phone.replace(/[\s\-\+]/g, '');
  if (phone.startsWith('0')) {
    phone = '62' + phone.substring(1);
  }
  
  const textEncoded = encodeURIComponent(messageText);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${textEncoded}&apikey=${apiKey}`;
  
  console.log(`[WA NOTIF] Sending CallMeBot WA to ${phone}...`);
  
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const isSuccess = res.statusCode === 200;
        resolve({ success: isSuccess, body });
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, reason: err.message });
    });
    
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ success: false, reason: 'timeout' });
    });
  });
}

/**
 * Sends message via Twilio Sandbox API (100% reliable free official gateway)
 */
function sendViaTwilio(settings, messageText) {
  const accountSid = settings.twilioAccountSid || '';
  const authToken = settings.twilioAuthToken || '';
  let sandboxNumber = settings.twilioSandboxNumber || '+14155238886';
  let phone = settings.whatsappPhone || process.env.WA_NUMBER || '';
  
  if (!accountSid || !authToken || !phone) {
    console.log('[WA NOTIF] Missing Twilio SID, Token, or Phone.');
    return { success: false, reason: 'missing_credentials' };
  }
  
  // Format numbers to E.164
  phone = phone.replace(/[\s\-\+]/g, '');
  if (phone.startsWith('0')) {
    phone = '62' + phone.substring(1);
  }
  if (!phone.startsWith('+')) {
    phone = '+' + phone;
  }
  
  sandboxNumber = sandboxNumber.replace(/[\s\-\+]/g, '');
  if (!sandboxNumber.startsWith('+')) {
    sandboxNumber = '+' + sandboxNumber;
  }
  
  const postData = querystring.stringify({
    To: `whatsapp:${phone}`,
    From: `whatsapp:${sandboxNumber}`,
    Body: messageText
  });
  
  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  
  const options = {
    hostname: 'api.twilio.com',
    path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
      'Authorization': authHeader
    },
    timeout: 8000
  };
  
  console.log(`[WA NOTIF] Sending Twilio WA from ${sandboxNumber} to ${phone}...`);
  
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const isSuccess = res.statusCode === 201 || res.statusCode === 200;
        resolve({ success: isSuccess, body });
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, reason: err.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, reason: 'timeout' });
    });
    
    req.write(postData);
    req.end();
  });
}

module.exports = { sendWhatsAppNotification };
