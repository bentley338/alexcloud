const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// Print file existence
const envPath = path.join(__dirname, '../.env');
console.log('Env path exists:', fs.existsSync(envPath));

dotenv.config({ path: envPath });

console.log('ADMIN_EMAIL:', process.env.ADMIN_EMAIL);
console.log('DATABASE_URL starts with:', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 15) : 'undefined');
process.exit(0);
