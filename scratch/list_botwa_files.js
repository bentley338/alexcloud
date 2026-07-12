const fs = require('fs');
const path = require('path');

function listDirRecursive(dir, indent = '') {
  if (!fs.existsSync(dir)) {
    console.log(`${dir} does not exist!`);
    return;
  }
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        console.log(`${indent}[DIR] ${file}`);
        listDirRecursive(fullPath, indent + '  ');
      }
    } else {
      console.log(`${indent}- ${file} (${stats.size} bytes)`);
    }
  });
}

console.log('Listing /var/www/botwa:');
listDirRecursive('/var/www/botwa');
process.exit(0);
