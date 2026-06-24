// End-to-end: replicate kickoffQrisGeneration against the REAL db to confirm an
// order reaches qrisStatus:'ready' via the fallback chain. Cleans up the test order.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../database/db');
const { fr3Request, sayabayarRequest } = require('../utils/helpers');

function extractSbQris(sd) {
  return sd && sd.payment_channel && sd.payment_channel.qris_string;
}

async function tryFr3(id, price, nominal) {
  const fr3Data = await fr3Request('/topup', 'POST', { nominal }, 25000);
  if (!fr3Data || !fr3Data.data || !fr3Data.data.trxId) {
    throw new Error(fr3Data?.message || 'API did not return a transaction ID');
  }
}

async function trySaya(id, price) {
  const order = db.get('orders').find({ id }).value();
  const sb = await sayabayarRequest('POST', '/invoices', {
    customer_name: order?.userName || 'Pelanggan AlexCloud',
    amount: price, description: 'AlexCloud E2E', payment_method: 'qris'
  }, 20000);
  let sd = sb && sb.data;
  if (!sb || !sb.success || !sd || !sd.id) throw new Error(sb?.error?.message || 'no invoice');
  let qr = extractSbQris(sd);
  if (!qr) throw new Error('no qris string');
  db.get('orders').find({ id }).assign({ qrisStatus: 'ready', gateway: 'sayabayar', fr3QrString: qr }).write();
}

(async () => {
  const id = 'E2E-TEST-' + process.pid;
  db.get('orders').push({ id, orderId: id, userName: 'E2E', qrisStatus: 'generating' }).write();

  const primary = (process.env.PAYMENT_PRIMARY || 'sayabayar').toLowerCase();
  const seq = primary === 'sayabayar' ? ['sayabayar', 'fr3'] : ['fr3', 'sayabayar'];
  console.log('PAYMENT_PRIMARY =', primary, '| sequence =', seq.join(' -> '));

  for (const gw of seq) {
    try {
      if (gw === 'fr3') await tryFr3(id, 1000, 1049); else await trySaya(id, 1000);
      console.log(`Gateway '${gw}' SUCCESS`);
      break;
    } catch (e) {
      console.log(`Gateway '${gw}' gagal: ${e.message}`);
    }
  }

  const finalOrder = db.get('orders').find({ id }).value();
  console.log('FINAL qrisStatus =', finalOrder.qrisStatus, '| gateway =', finalOrder.gateway, '| hasQR =', !!finalOrder.fr3QrString);

  db.get('orders').remove({ id }).write(); // cleanup
  console.log('cleaned up test order');
  process.exit(0);
})();
