const http = require('http');

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    console.log('📤 Making request to:', `${options.hostname}:${options.port}${options.path}`);
    console.log('📋 Method:', options.method);
    
    const req = http.request(options, (res) => {
      console.log('✅ Got response with status:', res.statusCode);
      let data = '';
      res.on('data', chunk => {
        console.log('📨 Received chunk:', chunk.length, 'bytes');
        data += chunk;
      });
      res.on('end', () => {
        console.log('✅ Response complete');
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : data,
          });
        } catch (e) {
          console.log('⚠️ Failed to parse JSON:', e.message);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
          });
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ Request error:', err.code, err.message);
      reject(err);
    });

    req.on('timeout', () => {
      console.error('❌ Request timeout');
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.setTimeout(5000);

    if (body) {
      console.log('📝 Sending body...');
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function test() {
  try {
    console.log('🔐 Attempting to login...\n');
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

    console.log('\n✅ Login response:', loginRes.status);
    console.log(JSON.stringify(loginRes.body, null, 2));

  } catch (error) {
    console.error('\n❌ Test failed:', error.code || error.message);
    process.exit(1);
  }
}

test();
