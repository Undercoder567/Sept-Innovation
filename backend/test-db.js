const sql = require('mssql');

async function test() {
  const config = {
    server: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME || 'ERP42test',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD,
    pool: { max: 5 },
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
    },
    connectionTimeout: 5000,
    requestTimeout: 5000,
  };

  console.log('🔗 Database config:', {
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
  });

  try {
    console.log('\n⏳ Connecting...');
    const pool = new sql.ConnectionPool(config);
    const result = await pool.connect();
    console.log('✅ Connected successfully');

    console.log('\n📊 Testing query...');
    const request = pool.request();
    const queryResult = await request.query('SELECT 1 AS test');
    console.log('✅ Query successful:', queryResult.recordset);

    await pool.close();
    console.log('✅ Closed connection');
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('Code:', err.code);
  }
}

test();
