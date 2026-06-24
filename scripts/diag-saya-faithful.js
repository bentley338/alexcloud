// Faithful repro of trySayabayarGateway with realistic inputs + verbose logging.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sayabayarRequest } = require('../utils/helpers');

function extractSbQris(sd) {
  return sd && sd.payment_channel && sd.payment_channel.qris_string;
}

async function trySaya(order) {
  console.log(`\n--- amount=${order.price} email=${order.userEmail || '(none)'} ---`);
  let sb;
  try {
    sb = await sayabayarRequest('POST', '/invoices', {
      customer_name: order?.userName || 'Pelanggan AlexCloud',
      customer_email: order?.userEmail || undefined,
      amount: order.price,
      description: order?.planName ? `AlexCloud - ${order.planName}` : 'AlexCloud Order',
      payment_method: 'qris'
    }, 20000);
  } catch (e) {
    console.log('CREATE network ERR:', e.message);
    return;
  }
  console.log('create.success =', sb && sb.success, '| error =', JSON.stringify(sb && sb.error));
  let sd = sb && sb.data;
  if (!sb || !sb.success || !sd || !sd.id) {
    console.log('=> THROW: did not create invoice. raw:', JSON.stringify(sb).slice(0, 300));
    return;
  }
  let qrString = extractSbQris(sd);
  console.log('qris in create response?', !!qrString);
  for (let i = 0; i < 4 && !qrString; i++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const detail = await sayabayarRequest('GET', `/invoices/${sd.id}`, null, 10000);
      if (detail && detail.success && detail.data) { sd = detail.data; qrString = extractSbQris(sd); }
      console.log(`  poll ${i + 1}: qris?`, !!qrString);
    } catch (e) { console.log(`  poll ${i + 1} ERR:`, e.message); }
  }
  console.log(qrString ? '=> SUCCESS (ready)' : '=> THROW: qris never appeared => MANUAL');
}

(async () => {
  // Realistic orders mirroring db.json prices, incl. the negative-price edge case.
  await trySaya({ userName: 'Budi', userEmail: 'budi@gmail.com', price: 40000, planName: 'EA FC 26' });
  await trySaya({ userName: 'Siti', userEmail: 'siti@gmail.com', price: 60000, planName: 'Plan B' });
  await trySaya({ userName: 'NoEmail', userEmail: null, price: 5000, planName: 'Cek' });
  await trySaya({ userName: 'NegPrice', userEmail: 'x@y.com', price: -359600, planName: 'Promo bug' });
  process.exit(0);
})();
