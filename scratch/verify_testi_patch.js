const fs = require('fs');

// Read alexcloud .env BOT_SHARED_SECRET
const alexcloudEnv = '/var/www/alexcloud/.env';
let botSecret = null;

if (fs.existsSync(alexcloudEnv)) {
  const content = fs.readFileSync(alexcloudEnv, 'utf8');
  content.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    const val = rest.join('=').trim();
    if (key && key.trim() === 'BOT_SHARED_SECRET') {
      botSecret = val;
      console.log(`BOT_SHARED_SECRET in alexcloud .env: "${val}" (length: ${val.length})`);
    }
  });
  if (!botSecret) {
    console.log('BOT_SHARED_SECRET NOT set in alexcloud .env!');
    console.log('Server will use fallback: "alexcloud-botwa-secret-2026"');
  }
}

// Read botwa testi.js to confirm the patch
const testiPath = '/var/www/botwa/commands/owner/testi.js';
const testiContent = fs.readFileSync(testiPath, 'utf8');
if (testiContent.includes("alexcloud-botwa-secret-2026")) {
  console.log('\n✅ botwa testi.js uses fallback secret: "alexcloud-botwa-secret-2026"');
} else if (testiContent.includes("BOT_SHARED_SECRET")) {
  console.log('\n✅ botwa testi.js uses BOT_SHARED_SECRET env var');
} else {
  console.log('\n❌ botwa testi.js does NOT have the secret field!');
}

if (testiContent.includes("x-api-key")) {
  console.log('❌ botwa testi.js STILL has x-api-key header!');
} else {
  console.log('✅ botwa testi.js: x-api-key header has been removed');
}

// Show the patched section
const lines = testiContent.split('\n');
let inSection = false;
lines.forEach((line, idx) => {
  if (line.includes('/api/testimonials') && line.includes('axios')) inSection = true;
  if (inSection) {
    if (line.includes('secret') || line.includes('name:') || line.includes('Content-Type') || line.includes('timeout') || line.includes('/api/testimonials')) {
      if (!line.includes('API_KEY') && !line.includes('testimonialApiKey')) {
        console.log(`  ${idx+1}: ${line}`);
      }
    }
    if (line.includes('maxContentLength')) inSection = false;
  }
});

process.exit(0);
