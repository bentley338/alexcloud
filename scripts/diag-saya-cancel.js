// Probe SayaBayar cancel endpoint against a known test invoice (amount 1000).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sayabayarRequest } = require('../utils/helpers');

const ID = '38c277d5-8d55-47ed-a158-03bfea23f8e2'; // diag-pay test invoice (amount 1000)

(async () => {
  const attempts = [
    ['POST', `/invoices/${ID}/cancel`, null],
    ['DELETE', `/invoices/${ID}`, null],
    ['PATCH', `/invoices/${ID}`, { status: 'cancelled' }],
    ['POST', `/invoices/${ID}/expire`, null],
  ];
  for (const [method, path, body] of attempts) {
    try {
      const r = await sayabayarRequest(method, path, body, 12000);
      console.log(`${method} ${path} -> ${JSON.stringify(r).slice(0, 250)}`);
      if (r && r.success) { console.log('  ^^ WORKS'); break; }
    } catch (e) {
      console.log(`${method} ${path} ERR: ${e.message}`);
    }
  }
})();
