const http = require('http');

const data = JSON.stringify({
  query: 'Give me name of customers',
  userId: 'test-user'
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/analytics/nl-query',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log('Sending request to NL2SQL endpoint...');
console.log('Request body:', data);

const req = http.request(options, (res) => {
  let body = '';
  console.log(`Status: ${res.statusCode}`);
  
  res.on('data', (d) => {
    body += d;
  });
  
  res.on('end', () => {
    console.log('\n=== RESPONSE ===');
    try {
      const parsed = JSON.parse(body);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(body.substring(0, 3000));
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
  process.exit(1);
});

req.write(data);
req.end();

// Timeout after 10 seconds
setTimeout(() => {
  console.error('Request timeout');
  process.exit(1);
}, 10000);
