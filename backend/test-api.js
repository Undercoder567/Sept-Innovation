#!/usr/bin/env node

/**
 * API Health Check
 * Tests the backend API endpoints
 */

const http = require('http');

function testEndpoint(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: path,
      method: method,
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function runTests() {
  console.log('🔍 Testing Backend API Endpoints\n');

  try {
    // Test health endpoint
    console.log('Testing /health endpoint...');
    const healthTest = await testEndpoint('/health');
    console.log(`  Status: ${healthTest.status}`);
    if (healthTest.status === 200) {
      console.log('  ✅ Health check passed\n');
    } else {
      console.log('  ⚠️  Unexpected status\n');
    }

    // Test schema endpoint
    console.log('Testing /api/analytics/schema endpoint...');
    const schemaTest = await testEndpoint('/api/analytics/schema');
    console.log(`  Status: ${schemaTest.status}`);
    if (schemaTest.status === 401) {
      console.log('  ✅ Authentication required (expected)\n');
    } else if (schemaTest.status === 200) {
      console.log('  ✅ Schema endpoint accessible\n');
    }

    console.log('✨ Basic API tests completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTests();
