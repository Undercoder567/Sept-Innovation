function extractSQL(response) {
  let sql = response.trim();
  sql = sql.replace(/```sql\n?/gi, '');
  sql = sql.replace(/```\n?/gi, '');
  sql = sql.replace(/^#+\s+.*$/gm, '');
  
  const explanationPatterns = [
    /the\s+result\s+is\s*:/i,
    /\n\s*the\s+above\s+query/i,
    /\n\s*this\s+query/i,
    /\n\s*explanation\s*:/i,
    /\n\s*note\s*:/i,
    /here\s+is\s+the\s+sql/i,
  ];

  for (const pattern of explanationPatterns) {
    const match = sql.search(pattern);
    if (match !== -1) {
      sql = sql.substring(0, match);
    }
  }

  sql = sql.trim();
  const semiIndex = sql.indexOf(';');
  if (semiIndex !== -1) {
    sql = sql.substring(0, semiIndex + 1).trim();
  }
  return sql.trim();
}

// Simulate the problematic response from the logs
const problemInput = `SELECT customer_id,
          COUNT(*)
FROM customers
GROUP BY customer_id

The result is:
    customer_id |`;

const result = extractSQL(problemInput);
console.log('✓ Successfully removed extra text');
console.log('Clean SQL:', result);
console.log('Contains "The result is":', result.includes('The result'));
console.log('Valid structure preserved:', result.includes('FROM'));
