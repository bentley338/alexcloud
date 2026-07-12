const fs = require('fs');
const path = require('path');

const botwaDir = '/var/www/botwa';

if (fs.existsSync(botwaDir)) {
  const indexJsPath = path.join(botwaDir, 'index.js');
  if (fs.existsSync(indexJsPath)) {
    console.log('--- /var/www/botwa/index.js (first 100 lines) ---');
    const content = fs.readFileSync(indexJsPath, 'utf8');
    const lines = content.split('\n');
    lines.slice(0, 100).forEach((line, idx) => {
      // Redact anything sensitive
      if (line.includes('API_KEY') || line.includes('apikey') || line.includes('secret') || line.includes('password') || line.includes('key')) {
        console.log(`${idx + 1}: [REDACTED]`);
      } else {
        console.log(`${idx + 1}: ${line}`);
      }
    });
  } else {
    console.log('index.js not found in botwa dir!');
  }
} else {
  console.log('botwa dir does not exist!');
}
process.exit(0);
