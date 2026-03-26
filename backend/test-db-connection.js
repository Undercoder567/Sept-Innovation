#!/usr/bin/env node

/**
 * Database Connection Test
 * Verifies that the backend can connect to PostgreSQL
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'analytics_db',
  user: 'postgres',
  password: 'Ujjawal@963',
});

async function testConnection() {
  try {
    console.log('🔍 Testing PostgreSQL connection...');
    const result = await pool.query('SELECT NOW() as current_time;');
    console.log('✅ Connection successful!');
    console.log('⏰ Server time:', result.rows[0].current_time);

    console.log('\n📊 Database tables and record counts:');
    const tables = ['audit_logs', 'query_cache', 'query_history', 'user_sessions'];
    
    for (const table of tables) {
      const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table};`);
      console.log(`  • ${table}: ${countResult.rows[0].count} records`);
    }

    console.log('\n✨ Sample audit log:');
    const sampleResult = await pool.query('SELECT action, user_id, status FROM audit_logs LIMIT 1;');
    console.log('  ', sampleResult.rows[0]);

    console.log('\n✅ All tests passed! Database is ready.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
