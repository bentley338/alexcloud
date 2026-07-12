const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Read alexcloud .env TESTIMONIAL_API_KEY
const alexcloudEnv = '/var/www/alexcloud/.env';
let alexcloudTestiKey = null;
let alexcloudFr3Key = null;

if (fs.existsSync(alexcloudEnv)) {
  const content = fs.readFileSync(alexcloudEnv, 'utf8');
  content.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    const val = rest.join('=').trim();
    if (key && key.trim() === 'TESTIMONIAL_API_KEY') alexcloudTestiKey = val;
    if (key && key.trim() === 'FR3_API_KEY') alexcloudFr3Key = val;
  });
}

const effectiveAlexcloudKey = alexcloudTestiKey || alexcloudFr3Key;
console.log(`AlexCloud effective testimonial key (first 10 chars): ${effectiveAlexcloudKey ? effectiveAlexcloudKey.substring(0, 10) + '...' : 'NOT FOUND'}`);
console.log(`AlexCloud TESTIMONIAL_API_KEY length: ${alexcloudTestiKey ? alexcloudTestiKey.length : 'N/A'}`);
console.log(`AlexCloud FR3_API_KEY length: ${alexcloudFr3Key ? alexcloudFr3Key.length : 'N/A'}`);

// Read botwa config to see what key it uses
const botwaConfig = '/var/www/botwa/config.js';
const botwaEnvContent = {};

// Try to load botwa's effective key by evaluating config
// Instead, let's just check if TESTIMONIAL_API_KEY is set in botwa's environment
// We can't easily read botwa's env, but we can check if there's an .env file
const botwaEnvFiles = ['/var/www/botwa/.env', '/home/ubuntu/botwa.env', '/root/botwa.env'];
for (const f of botwaEnvFiles) {
  if (fs.existsSync(f)) {
    console.log(`\nFound botwa env file at: ${f}`);
    const content = fs.readFileSync(f, 'utf8');
    content.split('\n').forEach(line => {
      const [key, ...rest] = line.split('=');
      const val = rest.join('=').trim();
      if (key && (key.trim().includes('TESTIMONIAL') || key.trim().includes('WEBSITE_API') || key.trim().includes('FR3'))) {
        console.log(`${key.trim()} = ***REDACTED (length: ${val.length})***`);
      }
    });
  }
}

// Now fix: update botwa .env or create it to set TESTIMONIAL_API_KEY to match alexcloud's
if (effectiveAlexcloudKey) {
  console.log('\n--- Action: Syncing TESTIMONIAL_API_KEY ---');
  
  // Check if pm2 env can show us the botwa env
  // Let's write a .env patch for botwa
  const botwaEnvPath = '/var/www/botwa/.env';
  let existingEnv = '';
  if (fs.existsSync(botwaEnvPath)) {
    existingEnv = fs.readFileSync(botwaEnvPath, 'utf8');
  }
  
  // Remove existing TESTIMONIAL_API_KEY and WEBSITE_API_KEY lines
  const filteredLines = existingEnv.split('\n').filter(line => {
    const key = line.split('=')[0].trim();
    return key !== 'TESTIMONIAL_API_KEY' && key !== 'WEBSITE_API_KEY';
  });
  
  // Add new TESTIMONIAL_API_KEY matching alexcloud's key
  filteredLines.push(`TESTIMONIAL_API_KEY=${effectiveAlexcloudKey}`);
  
  const newEnvContent = filteredLines.filter(l => l.trim()).join('\n') + '\n';
  fs.writeFileSync(botwaEnvPath, newEnvContent);
  console.log(`✅ Written TESTIMONIAL_API_KEY to ${botwaEnvPath} (length: ${effectiveAlexcloudKey.length})`);
  console.log('Now restart botwa with: pm2 restart botwa --update-env');
} else {
  console.log('\n❌ Could not read alexcloud testimonial key. Cannot sync!');
}

process.exit(0);
