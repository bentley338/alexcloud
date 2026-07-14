const { Client } = require('../node_modules/ssh2');
const conn = new Client();

const config = {
  host: '103.186.31.46',
  port: 19145,
  username: 'ubuntu',
  password: '157299pro'
};

conn.on('ready', () => {
  conn.exec('cat /var/www/botwa/commands/owner/testi.js', (err, stream) => {
    if (err) {
      console.error(err);
      conn.end();
      return;
    }
    stream.on('close', (code, signal) => {
      conn.end();
    }).on('data', (data) => {
      process.stdout.write(data);
    }).stderr.on('data', (data) => {
      process.stderr.write(data);
    });
  });
}).connect(config);
