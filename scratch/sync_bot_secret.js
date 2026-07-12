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
    }
  });
}

if (!botSecret) {
  console.log('❌ BOT_SHARED_SECRET not found in alexcloud .env!');
  process.exit(1);
}

// Write to botwa .env
const botwaEnvPath = '/var/www/botwa/.env';
let existingEnv = '';
if (fs.existsSync(botwaEnvPath)) {
  existingEnv = fs.readFileSync(botwaEnvPath, 'utf8');
}

// Remove existing BOT_SHARED_SECRET
const filteredLines = existingEnv.split('\n').filter(line => {
  const key = line.split('=')[0].trim();
  return key !== 'BOT_SHARED_SECRET';
});

filteredLines.push(`BOT_SHARED_SECRET=${botSecret}`);
const newContent = filteredLines.filter(l => l.trim()).join('\n') + '\n';
fs.writeFileSync(botwaEnvPath, newContent);

console.log(`✅ Written BOT_SHARED_SECRET to ${botwaEnvPath} (length: ${botSecret.length})`);
console.log('Now run: pm2 restart botwa --update-env');
process.exit(0);
