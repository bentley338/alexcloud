const fs = require('fs');
const path = require('path');

const testiPath = '/var/www/botwa/commands/owner/testi.js';
if (!fs.existsSync(testiPath)) {
  console.log('testi.js not found!');
  process.exit(1);
}

const content = fs.readFileSync(testiPath, 'utf8');
const lines = content.split('\n');

// Find the axios.post block that sends to /api/testimonials
let startIdx = -1, endIdx = -1;
lines.forEach((line, idx) => {
  if (line.includes('/api/testimonials') && line.includes('axios')) {
    startIdx = Math.max(0, idx - 5);
    endIdx = Math.min(lines.length - 1, idx + 30);
  }
});

if (startIdx > -1) {
  console.log(`\n--- testi.js lines ${startIdx + 1}-${endIdx + 1} ---`);
  for (let i = startIdx; i <= endIdx; i++) {
    const line = lines[i];
    if (line.includes('key') || line.includes('Key') || line.includes('secret') || line.includes('token')) {
      console.log(`${i + 1}: [REDACTED LINE]`);
    } else {
      console.log(`${i + 1}: ${line}`);
    }
  }
} else {
  console.log('Could not find /api/testimonials axios call in testi.js!');
  // Print full file
  lines.forEach((line, idx) => {
    if (line.includes('key') || line.includes('Key') || line.includes('secret') || line.includes('token') || line.includes('password')) {
      console.log(`${idx + 1}: [REDACTED LINE]`);
    } else {
      console.log(`${idx + 1}: ${line}`);
    }
  });
}
process.exit(0);
