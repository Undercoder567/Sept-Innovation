const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/health',
  method: 'GET',
  timeout: 2000
};

const req = http.request(options, (res) => {
  console.log('✅ STATUS:', res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('✅ RESPONSE:', data);
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('❌ ERROR:', e.code, '-', e.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('❌ TIMEOUT');
  req.destroy();
  process.exit(1);
});

console.log('📡 Testing http://localhost:3001/health ...');
req.end();
