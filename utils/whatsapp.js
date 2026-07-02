const https = require('https');
const querystring = require('querystring');
const { db } = require('../database/db');
const { sharedHttpsAgent } = require('./helpers');

/**
 * Sends message via our own WhatsApp Bot (botwa)
 */
function sendViaBotWa(settings, messageText) {
  const botWaUrl = process.env.BOT_WA_URL || settings.botWaUrl || '';
  let phone = settings.whatsappPhone || process.env.WA_NUMBER || '6282328437656';
  
  if (!botWaUrl) {
    return { success: false, reason: 'missing_bot_url' };
  }
  
  phone = phone.replace(/[\s\-\+]/g, '');
  if (phone.startsWith('0')) {
    phone = '62' + phone.substring(1);
  }
  
  const postData = JSON.stringify({
    secret: process.env.BOT_SHARED_SECRET || '',
    phone: phone,
    message: messageText
  });
  
  console.log(`[WA NOTIF] Sending via WhatsApp Bot to ${phone}...`);
  
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(botWaUrl);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? require('https') : require('http');
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: '/api/send-message',
        method: 'POST',
        agent: isHttps ? sharedHttpsAgent : undefined,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 8000
      };
      
      const req = httpModule.request(options, (res) => {
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
      
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, reason: 'timeout' });
      });
      
      req.write(postData);
      req.end();
    } catch (err) {
      resolve({ success: false, reason: err.message });
    }
  });
}

/**
 * Sends a WhatsApp notification using either CallMeBot, Twilio Sandbox, or our own Bot
 * @param {string} messageText - The message content to send
 */
async function sendWhatsAppNotification(messageText, isTest = false) {
  const settings = db.get('settings').value() || {};
  
  // Try sending via botwa first if BOT_WA_URL is configured
  const botWaUrl = process.env.BOT_WA_URL || settings.botWaUrl || '';
  if (botWaUrl) {
    try {
      const res = await sendViaBotWa(settings, messageText);
      if (res.success) return res;
      console.warn('[WA NOTIF] Bot WA failed, trying fallback...', res.reason || res.body);
    } catch (e) {
      console.warn('[WA NOTIF] Bot WA exception, trying fallback...', e.message);
    }
  }

  const isEnabled = settings.whatsappEnabled === true || settings.whatsappEnabled === 'true';
  
  if (!isEnabled && !isTest) {
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
    const options = {
      agent: sharedHttpsAgent,
      timeout: 8000
    };
    const req = https.get(url, options, (res) => {
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
    agent: sharedHttpsAgent,
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
