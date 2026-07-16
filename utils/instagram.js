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
 * Supports dynamic layout depending on whether the testimonial contains a buyer-uploaded photo
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

    // 2. Stars rendering
    const starCount = testimonial.rating || 5;
    const starsSvg = Array.from({ length: 5 }, (_, i) => {
      const color = i < starCount ? '#FFD700' : '#44444c';
      const x = 540 - 150 + i * 60; // Center the 5 stars (spacing 60px)
      return `<path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z" fill="${color}" transform="translate(${x - 12}, 780) scale(1.8)"/>`;
    }).join('\n');

    // 3. Text lines SVG
    const startY = hasPhoto ? 850 : 920;
    const lineSpacing = hasPhoto ? 50 : 60;
    const textLinesSvg = displayLines.map((line, idx) => {
      const y = startY + idx * lineSpacing;
      const escapedLine = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
      return `<text x="540" y="${y}" font-family="Outfit, Inter, sans-serif" font-weight="500" font-size="${hasPhoto ? 32 : 38}" fill="#e2e8f0" text-anchor="middle">${escapedLine}</text>`;
    }).join('\n');

    // 4. Metadata escape
    const escapedName = (testimonial.name || 'Pelanggan').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let planName = 'Premium Access';
    const planMatch = (testimonial.role || '').match(/\(([^)]+)\)/);
    if (planMatch) {
      planName = planMatch[1];
    }
    const escapedPlan = planName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 5. Render Photo or Quote decoration
    let decorationSvg = '';
    if (hasPhoto) {
      decorationSvg = `
        <clipPath id="rectClip">
          <rect x="180" y="1020" width="720" height="420" rx="24" ry="24" />
        </clipPath>
        <!-- Border for the image -->
        <rect x="178" y="1018" width="724" height="424" rx="26" ry="26" fill="none" stroke="url(#blueGrad)" stroke-width="2" opacity="0.5" />
        <image href="${testimonial.image}" x="180" y="1020" width="720" height="420" preserveAspectRatio="xMidYMid slice" clip-path="url(#rectClip)" />
      `;
    } else {
      decorationSvg = `
        <text x="540" y="870" font-family="Georgia, serif" font-weight="900" font-size="160" fill="#ffffff" opacity="0.04" text-anchor="middle">“</text>
        <text x="540" y="1460" font-family="Georgia, serif" font-weight="900" font-size="160" fill="#ffffff" opacity="0.04" text-anchor="middle">”</text>
      `;
    }

    // 6. Build SVG
    const svg = `
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0d0e12" />
            <stop offset="50%" stop-color="#07080a" />
            <stop offset="100%" stop-color="#020203" />
          </linearGradient>
          <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.05" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0.01" />
          </linearGradient>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#FFD700" />
            <stop offset="100%" stop-color="#FFA500" />
          </linearGradient>
          <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#00d4ff" />
            <stop offset="100%" stop-color="#0072ff" />
          </linearGradient>
          <radialGradient id="spotlight" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#00d4ff" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0" />
          </radialGradient>
        </defs>

        <rect width="100%" height="100%" fill="url(#bgGrad)" />
        <circle cx="540" cy="960" r="800" fill="url(#spotlight)" />

        <text x="540" y="240" font-family="Outfit, Inter, sans-serif" font-weight="900" font-size="64" fill="url(#goldGrad)" text-anchor="middle" letter-spacing="4">ALEXCLOUD</text>
        <text x="540" y="295" font-family="Outfit, Inter, sans-serif" font-weight="600" font-size="22" fill="#71717a" text-anchor="middle" letter-spacing="6">PLATFORM CLOUD GAMING</text>

        <rect x="90" y="380" width="900" height="1140" rx="36" ry="36" fill="url(#cardGrad)" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2" />

        <circle cx="540" cy="540" r="84" fill="none" stroke="url(#blueGrad)" stroke-width="4" opacity="0.6" />
        <circle cx="540" cy="540" r="80" fill="#1e1f24" />
        <text x="540" y="565" font-family="Outfit, Inter, sans-serif" font-weight="800" font-size="70" fill="url(#blueGrad)" text-anchor="middle">${escapedName.substring(0, 1).toUpperCase()}</text>

        <text x="540" y="680" font-family="Outfit, Inter, sans-serif" font-weight="800" font-size="44" fill="#ffffff" text-anchor="middle">${escapedName}</text>
        
        <rect x="390" y="710" width="300" height="46" rx="23" ry="23" fill="url(#blueGrad)" opacity="0.15" />
        <rect x="390" y="710" width="300" height="46" rx="23" ry="23" fill="none" stroke="url(#blueGrad)" stroke-width="1.5" opacity="0.4" />
        <text x="540" y="740" font-family="Outfit, Inter, sans-serif" font-weight="700" font-size="20" fill="#00d4ff" text-anchor="middle" letter-spacing="1">${escapedPlan.toUpperCase()}</text>

        ${starsSvg}

        ${textLinesSvg}

        ${decorationSvg}

        <text x="540" y="1650" font-family="Outfit, Inter, sans-serif" font-weight="600" font-size="22" fill="#71717a" text-anchor="middle" letter-spacing="2">MAIN GAME AAA TANPA PC MAHAL</text>
        <text x="540" y="1710" font-family="Outfit, Inter, sans-serif" font-weight="800" font-size="36" fill="url(#goldGrad)" text-anchor="middle" letter-spacing="1">alexcloud.my.id</text>
      </svg>
    `;

    // 7. Save PNG file
    const dirPath = path.join(__dirname, '..', 'public', 'testimonials');
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const filename = `${testimonial.orderId || Date.now()}.png`;
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

  // 2. Publish to Instagram Story
  const igPublishResult = await publishToInstagramStory(publicImageUrl);

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
