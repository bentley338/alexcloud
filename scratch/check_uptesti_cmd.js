const fs = require('fs');
const path = require('path');

const botwaDir = '/var/www/botwa';
const handlerPath = path.join(botwaDir, 'handler.js');

if (fs.existsSync(handlerPath)) {
  const content = fs.readFileSync(handlerPath, 'utf8');
  const lines = content.split('\n');
  
  // Find uptesti command block - search for 500 lines around 'uptesti'
  let foundIndices = [];
  lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('uptesti') || line.toLowerCase().includes('testimonialapi') || line.toLowerCase().includes('testimonial_api')) {
      foundIndices.push(idx);
    }
  });

  if (foundIndices.length === 0) {
    console.log('No uptesti command found in handler.js!');
    console.log('Checking all command names...');
    lines.forEach((line, idx) => {
      if (line.includes("cmd ===") || line.includes("command ===") || line.includes("startsWith('.'") || line.includes("startsWith(\".")) {
        console.log(`${idx + 1}: ${line}`);
      }
    });
  } else {
    foundIndices.forEach(idx => {
      const start = Math.max(0, idx - 15);
      const end = Math.min(lines.length, idx + 30);
      console.log(`\n--- Lines ${start + 1}-${end + 1} (around line ${idx + 1}) ---`);
      for (let i = start; i < end; i++) {
        const line = lines[i];
        // Redact API keys
        if (line.includes('Key') || line.includes('key') || line.includes('secret') || line.includes('password') || line.includes('token')) {
          const eqIdx = line.indexOf('=');
          if (eqIdx > -1) {
            console.log(`${i + 1}: ${line.substring(0, eqIdx + 1)}***REDACTED***`);
          } else {
            console.log(`${i + 1}: ${line}`);
          }
        } else {
          console.log(`${i + 1}: ${line}`);
        }
      }
    });
  }
} else {
  console.log('handler.js not found!');
}

// Also check .env of alexcloud
const alexcloudEnvPath = '/var/www/alexcloud/.env';
if (fs.existsSync(alexcloudEnvPath)) {
  console.log('\n--- /var/www/alexcloud/.env (testimonial key section) ---');
  const content = fs.readFileSync(alexcloudEnvPath, 'utf8');
  content.split('\n').forEach(line => {
    if (line.includes('TESTIMONIAL') || line.includes('BOT_SECRET') || line.includes('FR3_API_KEY')) {
      const parts = line.split('=');
      if (parts.length > 1 && parts[1].trim()) {
        console.log(`${parts[0]}=***REDACTED (length: ${parts[1].trim().length})***`);
      } else {
        console.log(line);
      }
    }
  });
}
process.exit(0);
