// Probe SayaBayar list/cancel endpoints (NO new invoices created).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sayabayarRequest } = require('../utils/helpers');

(async () => {
  console.log('=== GET /invoices ===');
  for (const path of ['/invoices', '/invoices?status=pending', '/invoices?limit=20']) {
    try {
      const r = await sayabayarRequest('GET', path, null, 12000);
      console.log(`\n${path} -> success=${r && r.success}`);
      const list = (r && r.data) || [];
      if (Array.isArray(list)) {
        console.log(`  count=${list.length}`);
        list.slice(0, 10).forEach(i => console.log(`   ${i.id} | ${i.status} | ${i.amount} | ${i.created_at}`));
      } else {
        console.log('  data is not array:', JSON.stringify(r).slice(0, 400));
      }
      break; // first working list endpoint is enough
    } catch (e) { console.log(`${path} ERR: ${e.message}`); }
  }
})();
