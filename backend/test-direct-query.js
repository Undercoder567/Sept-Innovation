const http = require('http');

// Test 1: Login
console.log('\n=== Test 1: Login ===');
const loginData = JSON.stringify({
  userId: 'admin',
  password: 'admin123'
});

const loginOptions = {
  hostname: 'localhost',
  port: 3001,
  path: '/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
};

const loginReq = http.request(loginOptions, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const response = JSON.parse(body);
    console.log('Login Response:', JSON.stringify(response, null, 2));
    
    if (response.token) {
      const token = response.token;
      
      // Test 2: Run direct query for Acme Corporation customer activity
      console.log('\n=== Test 2: Direct Query - Acme Corporation Activity ===');
      const query = `
        SELECT ca.*, c.name as customer_name
        FROM customer_activity ca
        JOIN customers c ON ca.customer_id = c.customer_id
        WHERE c.name ILIKE '%Acme%'
        AND ca.activity_date = '2025-03-05'
        ORDER BY ca.activity_date DESC
      `;
      
      const queryData = JSON.stringify({
        query: query,
        masked: true
      });

      const queryOptions = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/analytics/direct-query',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': queryData.length
        }
      };

      const queryReq = http.request(queryOptions, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const response = JSON.parse(body);
          console.log('Query Response:', JSON.stringify(response, null, 2));
          
          // Test 3: Show all customers
          console.log('\n=== Test 3: Direct Query - All Customers ===');
          const custQuery = `SELECT customer_id, name, email, company FROM customers LIMIT 5`;
          
          const custData = JSON.stringify({
            query: custQuery,
            masked: false
          });

          const custOptions = {
            hostname: 'localhost',
            port: 3001,
            path: '/api/analytics/direct-query',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Content-Length': custData.length
            }
          };

          const custReq = http.request(custOptions, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
              const response = JSON.parse(body);
              console.log('Customers Response:', JSON.stringify(response, null, 2));
            });
          });

          custReq.on('error', console.error);
          custReq.write(custData);
          custReq.end();
        });
      });

      queryReq.on('error', console.error);
      queryReq.write(queryData);
      queryReq.end();
    }
  });
});

loginReq.on('error', console.error);
loginReq.write(loginData);
loginReq.end();
