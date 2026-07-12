const { db, initDB } = require('../database/db');

async function run() {
  await initDB();
  const users = db.get('users').value() || [];
  console.log('All Users:');
  users.forEach(u => {
    console.log(`- ID: ${u.id}, Name: ${u.name}, Email: ${u.email}, Role: ${u.role}, isRoyal: ${u.isRoyal}`);
  });
  process.exit(0);
}

run().catch(console.error);
