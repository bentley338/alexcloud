// Capture the RAW FR3 response body (not JSON-parsed) to see what it actually returns.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');

const KEY = process.env.FR3_API_KEY;
const body = JSON.stringify({ apikey: KEY, nominal: 1000 });

const req = https.request({
  hostname: 'fr3newera.com',
  path: '/api/v1/topup',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('CONTENT-TYPE:', res.headers['content-type']);
    console.log('SERVER:', res.headers['server']);
    console.log('BODY (first 800 chars):\n', data.slice(0, 800));
  });
});
req.on('error', e => console.log('NET ERR:', e.message));
req.setTimeout(25000, () => req.destroy(new Error('timeout')));
req.write(body);
req.end();
