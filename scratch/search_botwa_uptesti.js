const fs = require('fs');
const path = require('path');

const botwaDir = '/var/www/botwa';

// List all JS files in botwa dir (not node_modules)
function searchInFile(filePath, searchTerms) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let found = false;
    lines.forEach((line, idx) => {
      if (searchTerms.some(term => line.toLowerCase().includes(term))) {
        if (!found) {
          console.log(`\n=== Found in: ${filePath} ===`);
          found = true;
        }
        // Redact secrets
        if (line.includes('Key') || line.includes('key') || line.includes('token') || line.includes('secret') || line.includes('password')) {
          const eqIdx = line.indexOf('=');
          if (eqIdx > -1 && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
            console.log(`${idx + 1}: ${line.substring(0, eqIdx + 1)}***REDACTED***`);
          } else {
            console.log(`${idx + 1}: ${line}`);
          }
        } else {
          console.log(`${idx + 1}: ${line}`);
        }
      }
    });
  } catch(e) {
    // skip
  }
}

function walkDir(dir, callback) {
  try {
    const files = fs.readdirSync(dir);
    files.forEach(f => {
      if (f === 'node_modules' || f === '.git' || f === 'session') return;
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, callback);
      } else if (fullPath.endsWith('.js')) {
        callback(fullPath);
      }
    });
  } catch(e) {}
}

const searchTerms = ['uptesti', 'testimonial_api', 'testimonialapi', 'testimonialkey'];

console.log(`Searching for: ${searchTerms.join(', ')}`);
walkDir(botwaDir, (filePath) => {
  searchInFile(filePath, searchTerms);
});

console.log('\n\nDone searching!');
process.exit(0);
