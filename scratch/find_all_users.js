const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '../.env') });

const { db, initDB, restoreFromMongoDB } = require('../database/db');

async function run() {
  console.log('Restoring from Postgres...');
  await restoreFromMongoDB();
  initDB();
  
  const users = db.get('users').value() || [];
  console.log(`Total users in production Postgres: ${users.length}`);
  users.forEach(u => {
    console.log(`- ID: ${u.id}, Name: ${u.name}, Email: ${u.email}, isRoyal: ${u.isRoyal}`);
  });
  process.exit(0);
}

run().catch(console.error);
