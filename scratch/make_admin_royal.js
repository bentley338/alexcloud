const path = require('path');
const dotenv = require('dotenv');

// Load env
dotenv.config({ path: path.join(__dirname, '../.env') });

const { db, initDB, activateUserSubscription } = require('../database/db');

async function run() {
  console.log('Initializing DB...');
  await initDB();

  // Find user with name Bentley or role admin
  let user = db.get('users').find({ role: 'admin' }).value();
  if (!user) {
    user = db.get('users').find(u => u.name.toLowerCase().includes('bentley')).value();
  }

  if (!user) {
    console.error('User Bentley or Admin not found!');
    process.exit(1);
  }

  console.log(`Found User: ${user.name} (${user.email}), ID: ${user.id}`);
  
  // Set isRoyal: true
  db.get('users').find({ id: user.id }).assign({ isRoyal: true }).write();
  console.log('Set isRoyal: true');

  // Activate subscription
  activateUserSubscription(user.id, 'royal_access', 'ADMIN_GRANT_' + Date.now());
  console.log('Activated royal_access subscription');

  // Wait for PostgreSQL backup sync (debounce is 2000ms)
  console.log('Waiting for PostgreSQL backup sync...');
  await new Promise(resolve => setTimeout(resolve, 3500));

  console.log('Successfully completed!');
  process.exit(0);
}

run().catch(console.error);
