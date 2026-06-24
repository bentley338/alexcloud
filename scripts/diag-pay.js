// Diagnostic: hit both payment gateways live and print raw responses.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { fr3Request, sayabayarRequest } = require('../utils/helpers');

(async () => {
  const amount = 1000;

  console.log('\n=== FR3 NEWERA (/topup) ===');
  console.log('key prefix:', (process.env.FR3_API_KEY || '(none)').slice(0, 6));
  try {
    const r = await fr3Request('/topup', 'POST', { nominal: amount }, 25000, 1);
    console.log('RESP:', JSON.stringify(r, null, 2));
  } catch (e) {
    console.log('ERR:', e.message);
  }

  console.log('\n=== SayaBayar (POST /invoices) ===');
  console.log('key prefix:', (process.env.SAYABAYAR_API_KEY || '(none)').slice(0, 6));
  try {
    const r = await sayabayarRequest('POST', '/invoices', {
      customer_name: 'Diag Test',
      amount,
      description: 'AlexCloud Diag',
      payment_method: 'qris'
    }, 20000);
    console.log('CREATE RESP:', JSON.stringify(r, null, 2));
    const id = r && r.data && r.data.id;
    if (id) {
      const d = await sayabayarRequest('GET', `/invoices/${id}`, null, 10000);
      console.log('DETAIL RESP:', JSON.stringify(d, null, 2));
    }
  } catch (e) {
    console.log('ERR:', e.message);
  }
  process.exit(0);
})();
