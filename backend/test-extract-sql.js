// Test SQL extraction logic

function extractSQL(response) {
  let sql = response.trim();

  // Remove markdown code blocks
  sql = sql.replace(/```sql\n?/gi, '');
  sql = sql.replace(/```\n?/gi, '');

  // Remove common markdown markers
  sql = sql.replace(/^#+\s+.*$/gm, '');

  // Common explanation patterns that indicate end of SQL
  const explanationPatterns = [
    /the\s+result\s+is\s*:/i,
    /\n\s*the\s+above\s+query/i,
    /\n\s*this\s+query/i,
    /\n\s*explanation\s*:/i,
    /\n\s*note\s*:/i,
    /here\s+is\s+the\s+sql/i,
  ];

  // Stop at first explanation pattern found
  for (const pattern of explanationPatterns) {
    const match = sql.search(pattern);
    if (match !== -1) {
      sql = sql.substring(0, match);
    }
  }

  sql = sql.trim();

  // Extract lines and filter out junk
  const lines = sql.split('\n');
  const sqlLines = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip common non-SQL text patterns
    if (trimmed.toLowerCase().startsWith('result') ||
        trimmed.toLowerCase().startsWith('output') ||
        trimmed.toLowerCase().includes('---')) {
      break;
    }
    
    // Include line if it has SQL-like content or we've already started collecting SQL
    if (trimmed && (sqlLines.length > 0 || looksLikeSQLStart(trimmed))) {
      sqlLines.push(line);
    }
  }

  sql = sqlLines.join('\n').trim();

  // Remove trailing explanation on same line after semicolon
  const semiIndex = sql.indexOf(';');
  if (semiIndex !== -1) {
    sql = sql.substring(0, semiIndex + 1).trim();
  }

  return sql.trim();
}

function looksLikeSQLStart(line) {
  const sqlKeywords = ['select', 'insert', 'update', 'delete', 'create', 'alter', 'drop', 'with'];
  const lower = line.toLowerCase();
  return sqlKeywords.some(keyword => lower.startsWith(keyword));
}

// Test cases
const testCases = [
  {
    name: 'SQL with trailing explanation',
    input: `SELECT customer_id,
          COUNT(*)
FROM customers
GROUP BY customer_id

The result is:
    customer_id |`,
    expected: 'SELECT customer_id,\n          COUNT(*)\nFROM customers\nGROUP BY customer_id;'
  },
  {
    name: 'Clean SQL',
    input: `SELECT TOP 100 Kundennumm, Vorname, Name FROM kunde;`,
    expected: 'SELECT TOP 100 Kundennumm, Vorname, Name FROM kunde;'
  },
  {
    name: 'SQL with markdown',
    input: `\`\`\`sql
SELECT TOP 100 * FROM kunde;
\`\`\`

This query selects all customers.`,
    expected: 'SELECT TOP 100 * FROM kunde;'
  }
];

console.log('Testing SQL extraction logic:\n');

testCases.forEach((test, idx) => {
  const result = extractSQL(test.input);
  const passed = result === test.expected;
  
  console.log(`Test ${idx + 1}: ${test.name}`);
  console.log(`  Status: ${passed ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Input: ${test.input.substring(0, 50)}...`);
  console.log(`  Expected: ${test.expected.substring(0, 60)}...`);
  console.log(`  Got:      ${result.substring(0, 60)}...`);
  console.log();
});
