const http = require('http');

// Simple health check first
const opts = {
  hostname: 'localhost',
  port: 3001,
  path: '/health',
  method: 'GET'
};

console.log('Testing /health endpoint...');

const req = http.request(opts, (res) => {
  console.log(`Status: ${res.statusCode}`);
  res.on('data', (d) => {
    console.log('Response:', d.toString());
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
});

req.end();

setTimeout(() => {
  process.exit(0);
}, 3000);
