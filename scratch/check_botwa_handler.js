const fs = require('fs');
const path = require('path');

const botwaDir = '/var/www/botwa';

// Check handler.js for uptesti command
const handlerPath = path.join(botwaDir, 'handler.js');
if (fs.existsSync(handlerPath)) {
  console.log('--- /var/www/botwa/handler.js - searching for uptesti/testimonial lines ---');
  const content = fs.readFileSync(handlerPath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (
      line.toLowerCase().includes('uptesti') ||
      line.toLowerCase().includes('testimonial') ||
      line.toLowerCase().includes('testi') ||
      line.toLowerCase().includes('api-key') ||
      line.toLowerCase().includes('x-api-key') ||
      line.toLowerCase().includes('alexcloud') ||
      (line.toLowerCase().includes('axios') && (idx > 0 && (lines[idx-1] || '').toLowerCase().includes('testi')))
    ) {
      // Redact actual keys
      if (line.includes('=') && (line.includes('KEY') || line.includes('key') || line.includes('secret'))) {
        const parts = line.split('=');
        console.log(`${idx + 1}: ${parts[0]}=***REDACTED***`);
      } else {
        console.log(`${idx + 1}: ${line}`);
      }
    }
  });
} else {
  console.log('handler.js not found!');
}

// Also check config.js
const configPath = path.join(botwaDir, 'config.js');
if (fs.existsSync(configPath)) {
  console.log('\n--- /var/www/botwa/config.js ---');
  const content = fs.readFileSync(configPath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('KEY') || line.includes('key') || line.includes('secret') || line.includes('password') || line.includes('token') || line.includes('url') || line.includes('URL')) {
      const parts = line.split(':');
      if (parts.length > 1 && !line.trim().startsWith('//')) {
        console.log(`${idx + 1}: ${parts[0]}:***REDACTED***`);
      } else {
        console.log(`${idx + 1}: ${line}`);
      }
    } else {
      console.log(`${idx + 1}: ${line}`);
    }
  });
}
process.exit(0);
