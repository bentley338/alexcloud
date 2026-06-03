const https = require('https');

const FR3_API_KEY = 'FR3_shact6823052026ehmlukrxggvoax';
const FR3_BASE = 'https://fr3newera.com/api/v1';

async function testTopup() {
  const payload = JSON.stringify({ apikey: FR3_API_KEY, nominal: 10000 });
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'User-Agent': 'AlexCloud/1.0'
    }
  };

  const response = await new Promise((resolve, reject) => {
    const req = https.request(`${FR3_BASE}/topup`, options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  console.log('TOPUP RESPONSE:', JSON.stringify(response, null, 2));

  if (response.data && response.data.trxId) {
    const trxId = response.data.trxId;
    console.log('Querying check-status for trxId:', trxId);
    
    const statusResponse = await new Promise((resolve, reject) => {
      const url = `${FR3_BASE}/check-status?apikey=${encodeURIComponent(FR3_API_KEY)}&idTransaksi=${encodeURIComponent(trxId)}`;
      https.get(url, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });

    console.log('STATUS RESPONSE:', JSON.stringify(statusResponse, null, 2));
  }
}

testTopup().catch(console.error);
