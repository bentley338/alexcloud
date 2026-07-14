const fs = require('fs');
const path = require('path');

// Read last 50 lines of alexcloud error log
const logPath = '/home/ubuntu/.pm2/logs/alexcloud-error.log';
if (fs.existsSync(logPath)) {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  const last = lines.slice(-60).join('\n');
  console.log('--- alexcloud-error.log (last 60 lines) ---');
  console.log(last);
} else {
  console.log('Log file not found: ' + logPath);
}
process.exit(0);
