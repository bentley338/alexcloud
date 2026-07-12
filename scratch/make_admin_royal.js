const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const { db, initDB, restoreFromMongoDB, activateUserSubscription } = require('../database/db');

async function run() {
  console.log('Restoring from Postgres...');
  await restoreFromMongoDB();
  initDB();

  const targetEmails = ['graha9181@gmail.com', 'bentleysamp462@gmail.com'];
  
  for (const email of targetEmails) {
    const user = db.get('users').find({ email }).value();
    if (user) {
      console.log(`Found User: ${user.name} (${user.email}), ID: ${user.id}`);
      db.get('users').find({ id: user.id }).assign({ isRoyal: true }).write();
      console.log(`Set isRoyal: true for ${user.email}`);
      activateUserSubscription(user.id, 'royal_access', 'ADMIN_GRANT_' + Date.now());
      console.log(`Activated royal_access subscription for ${user.email}`);
    } else {
      console.warn(`User with email ${email} not found.`);
    }
  }

  console.log('Waiting for PostgreSQL backup sync...');
  await new Promise(resolve => setTimeout(resolve, 3500));

  console.log('Successfully completed!');
  process.exit(0);
}

run().catch(console.error);
