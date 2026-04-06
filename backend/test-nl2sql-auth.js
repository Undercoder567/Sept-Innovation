const http = require('http');

const BASE_URL = 'http://localhost:3001';

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : data,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
          });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  try {
    console.log('🔐 Step 1: Login to get JWT token...');
    const loginRes = await makeRequest(
      {
        hostname: 'localhost',
        port: 3001,
        path: '/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      { userId: 'user', password: 'user123' }
    );

    console.log('Login Response:', loginRes.status);
    if (loginRes.status !== 200) {
      console.error('❌ Login failed:', loginRes.body);
      return;
    }

    const token = loginRes.body.token;
    console.log('✅ Token received:', token.substring(0, 20) + '...');

    console.log('\n📝 Step 2: Test NL2SQL endpoint...');
    const nlRes = await makeRequest(
      {
        hostname: 'localhost',
        port: 3001,
        path: '/api/analytics/nl-query',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      },
      { query: 'Give me name of customers' }
    );

    console.log('NL2SQL Response Status:', nlRes.status);
    console.log('NL2SQL Response Body:', JSON.stringify(nlRes.body, null, 2));

    if (nlRes.status === 200) {
      console.log('\n✅ SQL Generated:', nlRes.body.sql);
      console.log('📊 Tables:', nlRes.body.tables);
      console.log('💬 Intent:', nlRes.body.intent);
    } else {
      console.log('❌ NL2SQL failed:', nlRes.body);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();
