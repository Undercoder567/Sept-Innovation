#!/usr/bin/env node
/**
 * Test NL2SQL endpoint with debugging
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3001/api/analytics';

async function testNL2SQL() {
  const queries = [
    'Give me name of customers',
    'find all orders from 2024',
    'show me list of customers',
    'what is total revenue',
  ];

  for (const query of queries) {
    console.log('\n' + '='.repeat(80));
    console.log(`Testing: "${query}"`);
    console.log('='.repeat(80));

    try {
      const response = await axios.post(`${API_BASE}/nl-query`, {
        query,
        userId: 'test-user',
        maxRows: 10,
        allowFallback: true,
        temperature: 0.3,
      }, {
        timeout: 30000,
      });

      if (response.data.success) {
        console.log('✓ SUCCESS');
        console.log('SQL:', response.data.sql);
        console.log('Rows:', response.data.resultCount);
      } else {
        console.log('✗ FAILED');
        console.log('Error:', response.data.error?.message);
        console.log('Details:', response.data.error?.details);
      }
    } catch (error) {
      console.log('✗ ERROR');
      if (error.response) {
        console.log('Status:', error.response.status);
        console.log('Data:', error.response.data);
      } else {
        console.log('Message:', error.message);
      }
    }
  }
}

testNL2SQL().catch(console.error);
