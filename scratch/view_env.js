const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  console.log('--- .env content ---');
  content.split('\n').forEach(line => {
    if (line.includes('PASSWORD') || line.includes('SECRET') || line.includes('KEY')) {
      const parts = line.split('=');
      console.log(`${parts[0]}=***REDACTED***`);
    } else {
      console.log(line);
    }
  });
} else {
  console.log('.env file not found!');
}
process.exit(0);
