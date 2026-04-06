# NL2SQL Implementation Guide

## Quick Start

### 1. Backend Setup

The NL2SQL service is already integrated into the analytics controller. Just ensure your environment is configured:

**Backend Environment Variables:**
```bash
# Ollama LLM Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2                          # or mistral, neural-chat, etc.
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_TIMEOUT_MS=45000

# Database
DB_HOST=localhost
DB_PORT=1433
DB_NAME=ERP42test
DB_USER=your_user
DB_PASSWORD=your_password

# Optional
NL2SQL_CACHE_TTL=900000                     # 15 minutes
```

### 2. Start the Service

```bash
# Backend
cd backend
npm install
npm run build
npm run dev

# Verify NL2SQL endpoints are available
curl http://localhost:3001/health
```

### 3. Test via Frontend

1. Navigate to the chat component
2. Switch to "Query" mode
3. Try natural language queries

**Test Queries:**
```
- find all orders from 2024
- how many invoices in January?
- total revenue by product
```

## Core Workflow

### Query Processing Pipeline

```
1. INPUT: Natural Language Query
   ↓
2. ANALYSIS: Detect intent (SEARCH/AGGREGATION/STATISTICS)
   ↓
3. SCHEMA: Fetch table/column metadata
   ↓
4. GENERATION: LLM generates SQL with optimized prompt
   ↓
5. DETECTION: Check for hallucinations
   ↓
6. VALIDATION: Syntax and security checks
   ↓
7. EXECUTION: Run query with timeout
   ↓
8. OUTPUT: Return results with metadata
```

### Key Services

#### NL2SQLService

Main orchestrator - handles the entire pipeline:

```typescript
const nl2sqlService = new NL2SQLService(llmClient, dbClient);

const response = await nl2sqlService.queryFromNaturalLanguage({
  query: "find all orders from 2024",
  userId: "user123",
  maxRows: 100,
  allowFallback: true,
  temperature: 0.3  // Low for better accuracy
});

if (response.success) {
  console.log("SQL:", response.sql);
  console.log("Results:", response.results);
  console.log("Execution Time:", response.executionTime);
} else {
  console.log("Error:", response.error);
  console.log("Suggestions:", response.error.details);
}
```

#### HallucinationDetector

Validates generated SQL:

```typescript
const detector = new HallucinationDetector(dbClient);

const hallucination = await detector.detectHallucinations(
  "SELECT * FROM invalid_table WHERE id = 1",
  "find records from invalid table"
);

// hallucination.isHallucinating: true
// hallucination.issues: [...]
// hallucination.recommendedAction: 'BLOCK'
```

#### QueryBuilder

Builds safe parameterized queries:

```typescript
const builder = new QueryBuilder();

// Search query
const search = builder.buildSearchQuery({
  table: 'auftrag',
  columns: ['id', 'customer_id', 'amount'],
  filters: [
    { column: 'customer_id', operator: 'EQ', value: 'ABC' },
    { column: 'order_date', operator: 'GTE', value: '2024-01-01' }
  ],
  maxRows: 100
});

// Aggregation query
const agg = builder.buildAggregationQuery({
  table: 'auftrag',
  aggregations: [
    { function: 'SUM', column: 'amount', alias: 'total_revenue' },
    { function: 'COUNT', column: 'id', alias: 'order_count' }
  ],
  groupBy: ['region'],
  maxRows: 50
});

// Statistics query
const stats = builder.buildStatisticsQuery({
  table: 'wartung',
  metrics: ['interval_days', 'cost'],
  timeColumn: 'scheduled_date',
  period: 'MONTH',
  maxRows: 100
});
```

## Customization

### 1. Adjust LLM Parameters

**For more accuracy (less hallucination):**
```typescript
// Lower temperature = more deterministic
temperature: 0.2  // Default 0.3
topK: 20          // Limit token choices
topP: 0.8         // Nucleus sampling
```

**For more creativity (diverse results):**
```typescript
temperature: 0.7
topK: 40
topP: 0.95
```

### 2. Add Custom Table Mappings

Edit `src/semantic/tableTranslations.ts`:

```typescript
{
  germanName: 'meine_tabelle',
  englishAlias: 'my_table',
  additionalAliases: ['custom_name', 'alternate_name'],
  description: 'My custom table for specific data'
}
```

### 3. Modify Prompt Template

Edit `src/ai/promptBuilder.ts` method `buildOptimizedPrompt()`:

```typescript
private buildOptimizedPrompt(
  userQuery: string,
  schemaContext: string,
  analysis: QueryAnalysis
): string {
  const prompt = `
    [Customize your instructions here]
    
    SCHEMA:
    ${schemaContext}
    
    USER QUERY:
    "${userQuery}"
    
    SQL:
  `;
  return prompt;
}
```

### 4. Configure Cache TTL

In `nl2sqlService.ts`:

```typescript
private cacheTTL: number = 15 * 60 * 1000;  // Change this value

// Or clear cache programmatically
nl2sqlService.clearUserCache(userId);
nl2sqlService.clearAllCache();
```

## Error Scenarios & Handling

### Scenario 1: Invalid Table Reference

**User Query:** "show me data from sales_data"

**Detection:**
- HallucinationDetector finds no table named "sales_data"
- Suggests "auftrag" or "rechnung" via fuzzy matching
- Confidence: 0.92 (very likely hallucinating)

**Response:**
```json
{
  "success": false,
  "error": {
    "type": "HALLUCINATION",
    "message": "Table 'sales_data' does not exist",
    "suggestions": [
      "Did you mean 'auftrag' (orders)?",
      "Did you mean 'rechnung' (invoices)?"
    ]
  }
}
```

### Scenario 2: Column Type Mismatch

**Generated SQL:** `SELECT * FROM auftrag WHERE order_date = '12345'`

**Detection:**
- Column `order_date` is DATE type
- Value '12345' is numeric/string
- Type mismatch detected

**Action:** Flag with warning

### Scenario 3: Missing Foreign Key

**Generated SQL:** `SELECT * FROM auftrag JOIN invalid_table ON auftrag.id = invalid_table.order_id`

**Detection:**
- No foreign key between auftrag and invalid_table
- Join condition is impossible

**Action:** Block query

### Scenario 4: Syntax Error

**Generated SQL:** `SELECT * FROM auftrag WHERE (`

**Detection:**
- Unbalanced parentheses
- Missing SELECT keyword check fails

**Action:** Block query, suggest rephrasing

## Frontend Integration

### ChatBox Component

**Query Mode (NL2SQL):**

```typescript
// User enters: "find all orders from 2024"

// Component calls:
const response = await queryNaturalLanguage({
  query: "find all orders from 2024",
  maxRows: 100,
  allowFallback: true
});

// If success: Display results + SQL + chart
// If error: Display error message + suggestions
```

**Response Handling:**

```typescript
if (response.success && response.data) {
  // Show results
  message.content = `Found ${response.data.resultCount} records`;
  message.sqlQuery = response.data.sql;
  message.chartData = response.data.results.slice(0, 5);
} else {
  // Show error with suggestions
  message.content = `❌ ${response.error?.message}`;
  message.content += `\n💡 Suggestions:\n${response.error?.suggestions?.join('\n')}`;
}
```

## Monitoring & Debugging

### Enable Debug Logging

```typescript
// In nl2sqlService.ts
console.log('Query Analysis:', analysis);
console.log('Generated SQL:', sql);
console.log('Hallucination Check:', hallucination);
console.log('Validation Issues:', validationIssues);
```

### Query Performance Profiling

```typescript
const startTime = Date.now();
const response = await nl2sqlService.queryFromNaturalLanguage(request);
console.log(`Total time: ${Date.now() - startTime}ms`);
console.log(`Execution time: ${response.executionTime}ms`);
```

### Check Cache Effectiveness

```typescript
// Monitor cache hits in production
if (response.cached) {
  cacheHitCounter++;
}

const hitRate = (cacheHitCounter / totalQueries) * 100;
console.log(`Cache hit rate: ${hitRate}%`);
```

## Testing

### Unit Tests for HallucinationDetector

```typescript
import { HallucinationDetector } from './hallucinationDetector';

describe('HallucinationDetector', () => {
  let detector: HallucinationDetector;

  beforeEach(() => {
    detector = new HallucinationDetector(dbClient);
  });

  it('should detect invalid table', async () => {
    const result = await detector.detectHallucinations(
      'SELECT * FROM invalid_table',
      'query'
    );
    expect(result.isHallucinating).toBe(true);
    expect(result.issues[0].type).toBe('INVALID_TABLE');
  });

  it('should allow valid queries', async () => {
    const result = await detector.detectHallucinations(
      'SELECT id, amount FROM auftrag WHERE year(created_at) = 2024',
      'find orders from 2024'
    );
    expect(result.isHallucinating).toBe(false);
  });
});
```

### Integration Tests

```typescript
import { NL2SQLService } from './nl2sqlService';

describe('NL2SQLService', () => {
  let service: NL2SQLService;

  beforeEach(() => {
    service = new NL2SQLService(llmClient, dbClient);
  });

  it('should handle search queries', async () => {
    const response = await service.queryFromNaturalLanguage({
      query: 'find all orders from 2024',
      userId: 'test-user'
    });

    expect(response.success).toBe(true);
    expect(response.results?.length).toBeGreaterThan(0);
    expect(response.sql).toBeDefined();
  });

  it('should return suggestions on hallucination', async () => {
    const response = await service.queryFromNaturalLanguage({
      query: 'find data from nonexistent_table'
    });

    expect(response.success).toBe(false);
    expect(response.error?.type).toBe('HALLUCINATION');
    expect(response.error?.suggestions?.length).toBeGreaterThan(0);
  });
});
```

## Troubleshooting Guide

| Issue | Cause | Solution |
|-------|-------|----------|
| **"LLM returned empty SQL"** | Ollama timeout or model issue | Increase OLLAMA_TIMEOUT_MS, restart Ollama |
| **"Table does not exist"** | Hallucination (real issue) | Update table translations or use exact table name |
| **"Query timed out"** | Complex query, large dataset | Reduce time range, add filters, increase DB timeout |
| **"Unbalanced parentheses"** | LLM generation error | Retry, try different phrasing |
| **"Empty result set"** | No matching data | Broaden filters, check data availability |
| **"Connection refused"** | Database offline | Check DB connection, verify credentials |
| **"Cache not working"** | Cache cleared or expired | Clear and retry, check cache TTL setting |

## Performance Tuning

### Reduce Hallucinations
- Lower temperature (0.2-0.3)
- Add explicit constraints to prompt
- Use exact table/column names in examples

### Improve Speed
- Enable caching (enabled by default)
- Reduce maxRows parameter
- Use simpler queries
- Add date filters to limit scope

### Optimize Resources
- Monitor query history for patterns
- Pre-compute common aggregations
- Use database indexes on filter columns
- Consider query result caching

## Deployment Checklist

- [ ] Ollama service running and healthy
- [ ] Database connection tested
- [ ] Environment variables configured
- [ ] LLM model downloaded (e.g., `ollama pull llama2`)
- [ ] Schema cache initialized
- [ ] Audit logging enabled
- [ ] Rate limiting configured
- [ ] Error handling tested
- [ ] Frontend ChatBox in Query mode
- [ ] Documentation accessible to users

## Support & Resources

**Common Questions:**

Q: Why is the query different from what I expected?
- A: LLM interpretation depends on phrasing. Try being more specific.

Q: Can I trust the results?
- A: Validate critical queries. NL2SQL is best for exploratory analysis.

Q: How do I add new table mappings?
- A: Edit `src/semantic/tableTranslations.ts` and redeploy.

Q: Can I modify the generated SQL?
- A: Yes, shown SQL can be copied/edited before execution in advanced mode.

## Advanced Features (Future)

- Multi-step query workflows
- Query optimization recommendations
- Natural language explanations of queries
- Automated query template suggestions
- User feedback loop for learning
