const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

/**
 * Wraps text into lines of maximum length
 */
function wrapText(text, maxCharsPerLine = 32) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  
  words.forEach(word => {
    if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  });
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Generates a beautiful 1080x1920 portrait testimonial poster PNG
 * Styled in high-vibrancy brand tones: Charcoal Luxe & Electric Gold/Orange
 */
async function generateTestimonialPoster(testimonial) {
  try {
    const hasPhoto = !!testimonial.image;
    
    // 1. Text wrapping & layout limits
    const maxLines = hasPhoto ? 3 : 6;
    const textLines = wrapText(testimonial.text || '', 28);
    const displayLines = textLines.slice(0, maxLines);
    if (textLines.length > maxLines) {
      displayLines[displayLines.length - 1] = displayLines[displayLines.length - 1] + '...';
    }

    // 2. Stars rendering (vibrant gold)
    const starCount = testimonial.rating || 5;
    const starsSvg = Array.from({ length: 5 }, (_, i) => {
      const color = i < starCount ? '#fbbf24' : '#3f3f46';
      const x = 540 - 150 + i * 60; // Center the 5 stars (spacing 60px)
      return `<path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z" fill="${color}" transform="translate(${x - 12}, 780) scale(1.9)"/>`;
    }).join('\n');

    // 3. Text lines SVG
    const startY = hasPhoto ? 855 : 920;
    const lineSpacing = hasPhoto ? 52 : 60;
    const textLinesSvg = displayLines.map((line, idx) => {
      const y = startY + idx * lineSpacing;
      const escapedLine = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
      return `<text x="540" y="${y}" font-family="Outfit, Inter, sans-serif" font-weight="500" font-size="${hasPhoto ? 34 : 38}" fill="#ededf0" text-anchor="middle">${escapedLine}</text>`;
    }).join('\n');

    // 4. Metadata escape
    const escapedName = (testimonial.name || 'Pelanggan').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let planName = 'Premium Access';
    const planMatch = (testimonial.role || '').match(/\(([^)]+)\)/);
    if (planMatch) {
      planName = planMatch[1];
    }
    const escapedPlan = planName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 5. Render Photo or Quote decoration (using vibrant gold accents)
    let decorationSvg = '';
    if (hasPhoto) {
      decorationSvg = `
        <clipPath id="rectClip">
          <rect x="180" y="1020" width="720" height="420" rx="24" ry="24" />
        </clipPath>
        <!-- Golden outer frame for the buyer photo -->
        <rect x="176" y="1016" width="728" height="428" rx="28" ry="28" fill="none" stroke="url(#goldGrad)" stroke-width="4" />
        <!-- Solid background for the picture frame area -->
        <rect x="180" y="1020" width="720" height="420" rx="24" ry="24" fill="#07080a" />
        <!-- Image rendered using 'meet' to ensure it is never cropped/sliced -->
        <image href="${testimonial.image}" x="180" y="1020" width="720" height="420" preserveAspectRatio="xMidYMid meet" clip-path="url(#rectClip)" />
      `;
    } else {
      decorationSvg = `
        <text x="540" y="870" font-family="Georgia, serif" font-weight="900" font-size="160" fill="url(#goldGrad)" opacity="0.08" text-anchor="middle">“</text>
        <text x="540" y="1460" font-family="Georgia, serif" font-weight="900" font-size="160" fill="url(#goldGrad)" opacity="0.08" text-anchor="middle">”</text>
      `;
    }

    // 6. Build SVG with High-Vibrancy Gold/Orange design
    const svg = `
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0a0b0d" />
            <stop offset="100%" stop-color="#050506" />
          </linearGradient>
          <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#131418" />
            <stop offset="100%" stop-color="#07080a" />
          </linearGradient>
          <!-- Highly vibrant gold to warm orange gradient to match AlexCloud website -->
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fbbf24" />
            <stop offset="50%" stop-color="#f59e0b" />
            <stop offset="100%" stop-color="#ea580c" />
          </linearGradient>
          <!-- Glowing background spotlight -->
          <radialGradient id="goldSpotlight" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="stripeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.06" />
            <stop offset="100%" stop-color="#fbbf24" stop-opacity="0" />
          </linearGradient>
        </defs>

        <!-- 1. Background Layer -->
        <rect width="100%" height="100%" fill="url(#bgGrad)" />
        <path d="M-100 0 L600 0 L1080 1920 L380 1920 Z" fill="url(#stripeGrad)" />
        <circle cx="540" cy="960" r="900" fill="url(#goldSpotlight)" />

        <!-- Outer Gold Frame -->
        <rect x="40" y="40" width="1000" height="1840" rx="32" ry="32" fill="none" stroke="url(#goldGrad)" stroke-opacity="0.25" stroke-width="3" />

        <!-- 2. Header Branding -->
        <line x1="440" y1="140" x2="640" y2="140" stroke="url(#goldGrad)" stroke-width="4" stroke-linecap="round" />
        <text x="540" y="240" font-family="Outfit, Inter, sans-serif" font-weight="900" font-size="70" fill="url(#goldGrad)" text-anchor="middle" letter-spacing="8">ALEXCLOUD</text>
        <text x="540" y="295" font-family="Outfit, Inter, sans-serif" font-weight="700" font-size="20" fill="#9aa0aa" text-anchor="middle" letter-spacing="5">PREMIUM CLOUD GAMING</text>

        <!-- 3. Testimonial Card with offset shadow -->
        <rect x="94" y="384" width="900" height="1140" rx="40" ry="40" fill="#000000" opacity="0.6" />
        <!-- Card with thick glowing gold border -->
        <rect x="90" y="380" width="900" height="1140" rx="40" ry="40" fill="url(#cardGrad)" stroke="url(#goldGrad)" stroke-opacity="0.6" stroke-width="4" />

        <!-- Avatar Container -->
        <circle cx="540" cy="540" r="90" fill="none" stroke="url(#goldGrad)" stroke-width="4" />
        <circle cx="540" cy="540" r="88" fill="none" stroke="#0a0b0d" stroke-width="2" />
        <circle cx="540" cy="540" r="82" fill="#131418" />
        <text x="540" y="568" font-family="Outfit, Inter, sans-serif" font-weight="900" font-size="80" fill="url(#goldGrad)" text-anchor="middle">${escapedName.substring(0, 1).toUpperCase()}</text>

        <!-- Client Name in Gold gradient -->
        <text x="540" y="685" font-family="Outfit, Inter, sans-serif" font-weight="800" font-size="46" fill="url(#goldGrad)" text-anchor="middle">${escapedName}</text>
        
        <!-- Product Badge Capsule -->
        <rect x="340" y="715" width="400" height="50" rx="25" ry="25" fill="url(#goldGrad)" />
        <text x="540" y="748" font-family="Outfit, Inter, sans-serif" font-weight="800" font-size="22" fill="#0a0b0d" text-anchor="middle" letter-spacing="1.5">${escapedPlan.toUpperCase()}</text>

        ${starsSvg}

        ${textLinesSvg}

        ${decorationSvg}

        <!-- 4. Footer Brand Info -->
        <text x="540" y="1650" font-family="Outfit, Inter, sans-serif" font-weight="700" font-size="24" fill="#9aa0aa" text-anchor="middle" letter-spacing="3">MAIN GAME AAA TANPA PC MAHAL</text>
        
        <!-- Golden URL Pill -->
        <rect x="340" y="1685" width="400" height="60" rx="30" ry="30" fill="#131418" stroke="url(#goldGrad)" stroke-opacity="0.8" stroke-width="2.5" />
        <text x="540" y="1727" font-family="Outfit, Inter, sans-serif" font-weight="900" font-size="34" fill="url(#goldGrad)" text-anchor="middle" letter-spacing="1">alexcloud.my.id</text>
      </svg>
    `;

    // 7. Save PNG file with version suffix to bypass Cloudflare/Meta caches
    const dirPath = path.join(__dirname, '..', 'public', 'testimonials');
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const filename = `${testimonial.orderId || testimonial.id}-gold-v3.png`;
    const filePath = path.join(dirPath, filename);
    
    await sharp(Buffer.from(svg))
      .png()
      .toFile(filePath);

    return `/testimonials/${filename}`;
  } catch (err) {
    console.error('[POSTER GENERATOR] Error:', err.message);
    return null;
  }
}

/**
 * Publishes a portrait image to Instagram Story via the Graph API
 */
async function publishToInstagramStory(imageUrl) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igUserId = process.env.INSTAGRAM_USER_ID;

  if (!token || !igUserId) {
    console.warn('[INSTAGRAM STORY] Missing credentials in environment, skipping auto-post.');
    return { success: false, reason: 'missing_credentials' };
  }

  try {
    console.log(`[INSTAGRAM STORY] Creating container for ${imageUrl}...`);
    // 1. Create media container
    const containerRes = await axios.post(`https://graph.instagram.com/v20.0/${igUserId}/media`, {
      media_type: 'STORIES',
      image_url: imageUrl,
      access_token: token
    });
    
    const containerId = containerRes.data.id;
    console.log(`[INSTAGRAM STORY] Container created: ${containerId}. Waiting for processing...`);

    // 2. Poll/Wait and Publish (up to 3 attempts with 6s delay)
    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise(r => setTimeout(r, 6000));
      try {
        console.log(`[INSTAGRAM STORY] Publishing container (Attempt ${attempt})...`);
        const publishRes = await axios.post(`https://graph.instagram.com/v20.0/${igUserId}/media_publish`, {
          creation_id: containerId,
          access_token: token
        });
        
        console.log('[INSTAGRAM STORY] Successfully published to IG Story! ID:', publishRes.data.id);
        return { success: true, id: publishRes.data.id };
      } catch (publishErr) {
        const errorData = publishErr.response ? publishErr.response.data : {};
        console.warn(`[INSTAGRAM STORY] Publish attempt ${attempt} failed:`, errorData.error ? errorData.error.message : publishErr.message);
        
        // If it's not a "not ready yet" error, fail early
        if (errorData.error && errorData.error.error_subcode !== 2207027) {
          throw publishErr;
        }
      }
    }
    throw new Error('Timeout waiting for Meta to process the image container');
  } catch (err) {
    const errMsg = err.response && err.response.data && err.response.data.error 
      ? err.response.data.error.message 
      : err.message;
    console.error('[INSTAGRAM STORY] Failed to publish story:', errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Core handler to process a new testimonial: generates image, posts to IG Story, and sends WhatsApp alert with image!
 */
async function handleNewTestimonialAutoPublish(testimonial) {
  // 1. Generate poster
  const imageRelativePath = await generateTestimonialPoster(testimonial);
  if (!imageRelativePath) return;

  const baseUrl = process.env.BASE_URL || 'https://alexcloud.my.id';
  const publicImageUrl = `${baseUrl}${imageRelativePath}`;
  
  console.log(`[TESTIMONIAL AUTOPOST] Poster generated at: ${publicImageUrl}`);

  // 2. Publish to Instagram Story using cache buster query parameter
  const cacheBusterUrl = `${publicImageUrl}?t=${Date.now()}`;
  const igPublishResult = await publishToInstagramStory(cacheBusterUrl);

  // 3. Send WhatsApp notification with the generated poster image!
  try {
    const { db } = require('../database/db');
    const settings = db.get('settings').value() || {};
    const botWaUrl = process.env.BOT_WA_URL || settings.botWaUrl || '';
    let phone = settings.whatsappPhone || process.env.WA_NUMBER || '6282328437656';
    
    if (botWaUrl && phone) {
      phone = phone.replace(/[\s\-\+]/g, '');
      if (phone.startsWith('0')) {
        phone = '62' + phone.substring(1);
      }
      
      const stars = '⭐'.repeat(testimonial.rating || 5);
      const igStatus = igPublishResult.success 
        ? '✅ *Berhasil Diposting Otomatis ke IG Story!*' 
        : `❌ *Gagal Posting ke IG Story:* ${igPublishResult.error || 'Konfigurasi tidak lengkap'}`;

      const waMsg = `🌟 *ULASAN PELANGGAN BARU* 🌟\n\n` +
        `👤 *Nama:* ${testimonial.name}\n` +
        `🎮 *Game/Paket:* ${testimonial.role.replace('Pelanggan AlexCloud (', '').replace(')', '')}\n` +
        `⭐ *Rating:* ${stars}\n` +
        `💬 *Ulasan:* "${testimonial.text}"\n\n` +
        `${igStatus}\n\n` +
        `💡 _Poster testimoni format IG Story cantik terlampir di atas._`;

      const postData = JSON.stringify({
        secret: process.env.BOT_SHARED_SECRET || '',
        phone: phone,
        message: waMsg,
        imageUrl: publicImageUrl // Injected parameter!
      });

      const urlObj = new URL(botWaUrl);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? require('https') : require('http');

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: '/api/send-message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000
      };

      const req = httpModule.request(options);
      req.write(postData);
      req.end();
      console.log('[TESTIMONIAL AUTOPOST] WhatsApp media notification request sent.');
    }
  } catch (waErr) {
    console.error('[TESTIMONIAL AUTOPOST] Failed to send WhatsApp notification:', waErr.message);
  }
}

module.exports = {
  generateTestimonialPoster,
  publishToInstagramStory,
  handleNewTestimonialAutoPublish
};
