# Natural Language to SQL (NL2SQL) Service

## Overview

The NL2SQL service enables users to query databases using natural English questions instead of writing SQL. The service automatically converts questions to SQL, detects hallucinations (impossible queries), and executes them safely.

## Architecture

```
User Query (English)
    ↓
Query Analysis (detect intent, tables, filters)
    ↓
Schema Context Retrieval (get relevant table structures)
    ↓
LLM SQL Generation (use Ollama with optimized prompt)
    ↓
Hallucination Detection (validate tables, columns, joins)
    ↓
SQL Validation (syntax, security, performance checks)
    ↓
Query Execution (with result caching)
    ↓
Response with Results, Warnings, and Fallback Suggestions
```

## Core Components

### 1. **NL2SQLService** (`src/ai/nl2sqlService.ts`)

Main service orchestrating the entire pipeline.

**Key Features:**
- Query intent analysis (SEARCH, AGGREGATION, STATISTICS)
- Schema-aware SQL generation
- Result caching (15-minute TTL)
- Retry mechanism (up to 2 attempts)
- Query history logging

**Methods:**
```typescript
async queryFromNaturalLanguage(request: NL2SQLRequest): Promise<NL2SQLResponse>
```

### 2. **HallucinationDetector** (`src/ai/hallucinationDetector.ts`)

Prevents invalid queries by detecting:
- **Invalid Tables**: Non-existent tables with fuzzy matching suggestions
- **Invalid Columns**: References to columns that don't exist
- **Impossible Joins**: Join conditions between unrelated tables
- **Type Mismatches**: String values compared to numeric columns
- **Syntactic Errors**: Unbalanced parentheses, missing keywords

**Methods:**
```typescript
async detectHallucinations(sql: string, userQuery: string): Promise<HallucinationCheckResult>
```

**Severity Levels:**
- `CRITICAL`: Blocks query execution
- `HIGH`: Flags for review but may execute
- `MEDIUM/LOW`: Warnings only

### 3. **QueryBuilder** (`src/sql/queryBuilder.ts`)

Builds safe, parameterized SQL queries for three analytical patterns:

#### Search Queries
```typescript
buildSearchQuery(options: SearchQueryOptions): { sql: string; params: any[] }
```
**Use Case:** "find all orders of customer X from 2024"

#### Aggregation Queries
```typescript
buildAggregationQuery(options: AggregationQueryOptions): { sql: string; params: any[] }
```
**Use Case:** "calculate the total profit we made with software Y in 2025"

#### Statistics Queries
```typescript
buildStatisticsQuery(options: StatisticsQueryOptions): { sql: string; params: any[] }
```
**Use Case:** "what is the expected interval for maintenance at company Z"

### 4. **PromptBuilder** (`src/ai/promptBuilder.ts`)

Creates optimized prompts for the LLM with:
- Strict rules to enforce correct SQL generation
- Schema context (tables and columns)
- Table name mappings
- Intent-specific hints

## API Endpoints

### POST `/analytics/nl-query`

Convert natural language to SQL and execute.

**Request:**
```json
{
  "query": "find all orders from 2024",
  "maxRows": 100,
  "allowFallback": true,
  "temperature": 0.3
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "query": "find all orders from 2024",
    "sql": "SELECT TOP 100 ... FROM auftrag WHERE YEAR(created_at) = 2024",
    "results": [...],
    "resultCount": 45,
    "executionTime": 234,
    "cached": false,
    "warnings": []
  }
}
```

**Error Response (400/500):**
```json
{
  "success": false,
  "error": {
    "type": "HALLUCINATION",
    "message": "Generated query contains invalid table/column references",
    "details": {
      "issues": [
        {
          "type": "INVALID_TABLE",
          "severity": "CRITICAL",
          "message": "Table 'sales' does not exist in database",
          "suggestion": "Did you mean 'auftrag'?"
        }
      ],
      "confidence": 0.85
    },
    "fallbackAvailable": true
  },
  "suggestions": [
    "Try specifying exact table names (e.g., 'orders' instead of 'sales data')",
    "Check if the columns you mentioned actually exist"
  ]
}
```

### POST `/analytics/nl-query-validate`

Validate a query without executing.

**Request:**
```json
{
  "query": "find all orders from 2024"
}
```

**Response:**
```json
{
  "success": true,
  "sql": "SELECT TOP 100 ... FROM auftrag WHERE YEAR(created_at) = 2024",
  "warnings": []
}
```

## Supported Query Patterns

### 1. Search Queries
- "find all orders from customer X"
- "show me invoices from January 2024"
- "list products in category electronics"

### 2. Aggregation Queries
- "total revenue by region"
- "count of orders per month"
- "average order value for each customer"

### 3. Statistical Queries
- "what is the average maintenance interval?"
- "expected trend for next quarter"
- "standard deviation of order amounts"

## Schema Mapping

Table translations are defined in `src/semantic/tableTranslations.ts`. Example:

```typescript
{
  germanName: 'auftrag',
  englishAlias: 'orders',
  additionalAliases: ['order', 'auftrags'],
  description: 'Sales order headers'
}
```

This allows users to query using either German or English names.

## Frontend Integration

### ChatBox Component (`src/components/ChatBox.tsx`)

Two modes:
- **Chat Mode**: Regular AI conversation
- **Query Mode**: Natural language to SQL conversion

**Features:**
- Shows generated SQL query
- Displays results in charts/tables
- Shows warnings and error suggestions
- Provides fallback suggestions on failure

### API Client (`src/api/analytics.ts`)

```typescript
// Execute NL2SQL query
await queryNaturalLanguage({
  query: "find all orders from 2024",
  maxRows: 100,
  allowFallback: true,
  temperature: 0.3
})

// Validate without executing
await validateNaturalLanguageQuery("find all orders from 2024")
```

## Hallucination Detection Strategy

### Detection Approach

1. **Schema Validation**: Compare table/column names against actual database schema
2. **Relationship Validation**: Check if joins are supported by foreign keys
3. **Type Checking**: Verify filter values match column data types
4. **Fuzzy Matching**: Suggest correct names for misspelled references
5. **Confidence Scoring**: Calculate likelihood of hallucination (0-1)

### Action Recommendations

| Confidence | Issues | Action |
|-----------|--------|--------|
| > 0.8 | Multiple CRITICAL | `BLOCK` - Don't execute |
| 0.5-0.8 | HIGH issues | `FLAG` - Execute with warnings |
| < 0.5 | LOW issues | `ALLOW` - Execute normally |

### Example Detection

```typescript
const result = await hallucinationDetector.detectHallucinations(
  "SELECT * FROM sales WHERE customer = 'John'",
  "find orders from customer John"
);

// Result:
{
  isHallucinating: true,
  issues: [
    {
      type: 'INVALID_TABLE',
      severity: 'CRITICAL',
      message: "Table 'sales' does not exist",
      suggestion: "Did you mean 'auftrag' (orders)?"
    }
  ],
  confidence: 0.92,
  recommendedAction: 'BLOCK'
}
```

## Caching Strategy

- **TTL**: 15 minutes
- **Key**: SHA256 hash of `query:userId`
- **Cached Data**: Full result set + execution time
- **Per-user Cache**: Each user has separate cache

```typescript
nl2sqlService.clearUserCache(userId)  // Clear user's cache
nl2sqlService.clearAllCache()          // Clear all cache
```

## Error Handling & Fallback

### Error Types

1. **HALLUCINATION**: Invalid table/column references
   - **Fallback**: Show suggestions to rephrase
   - **Example**: "Try using 'orders' instead of 'sales'"

2. **VALIDATION**: SQL syntax errors
   - **Fallback**: Ask user to try different metrics
   - **Example**: "Try asking about a different time period"

3. **EXECUTION**: Query runtime errors
   - **Fallback**: Contact administrator
   - **Example**: "Database connection timeout"

4. **PARSE_ERROR**: LLM generation failed
   - **Fallback**: Suggest clearer phrasing
   - **Example**: "Use keywords like 'find', 'calculate', 'count'"

### Fallback Flow

```
User Query
  ↓
Generate SQL (attempt 1-2)
  ↓
If failed → Return error with suggestions:
  - Try rephrasing more specifically
  - Use exact table names
  - Check column names
  - Contact administrator
```

## Performance Optimization

1. **Low Temperature Setting** (0.3 default)
   - Reduces hallucinations
   - More consistent SQL generation
   - Less creative but more accurate

2. **Prompt Constraints**
   - Explicit rules for column specifications
   - Limit results with TOP clause
   - Enforce proper JOIN syntax

3. **Result Caching**
   - 15-minute TTL per query+user
   - Reduces LLM calls and database load

4. **Schema Caching**
   - 5-minute TTL in HallucinationDetector
   - Reduces metadata queries

## Security Measures

1. **Read-Only Enforcement**
   - Only SELECT queries allowed
   - Blocks DML (INSERT, UPDATE, DELETE)

2. **Parameterization**
   - All values use parameters (@p1, @p2, etc.)
   - Prevents SQL injection

3. **Permission Checking**
   - Requires `analytics:query:read` permission
   - User ID tracked in audit logs

4. **Query Validation**
   - Checks for dangerous functions
   - Validates result size limits
   - Enforces timeout policies

5. **Audit Logging**
   - All queries logged with timestamps
   - Execution time and record count tracked
   - Success/failure status recorded

## Configuration

**Environment Variables:**

```bash
# LLM Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_TIMEOUT_MS=45000

# Database
DB_HOST=localhost
DB_PORT=1433
DB_NAME=ERP42test
DB_USER=...
DB_PASSWORD=...

# Cache
NL2SQL_CACHE_TTL=900000  # 15 minutes
NL2SQL_MAX_RETRIES=2
NL2SQL_DEFAULT_TEMP=0.3
```

## Usage Examples

### Example 1: Search Query

**User Query:** "Show me all orders from customer ABC from 2024"

```typescript
const response = await queryNaturalLanguage({
  query: "Show me all orders from customer ABC from 2024",
  maxRows: 100
});

// Generated SQL:
// SELECT TOP 100 id, order_date, amount FROM auftrag 
// WHERE customer_id = 'ABC' AND YEAR(order_date) = 2024

// Result: 23 records, 145ms execution time
```

### Example 2: Aggregation Query

**User Query:** "What is our total revenue by region in 2025?"

```typescript
const response = await queryNaturalLanguage({
  query: "What is our total revenue by region in 2025?",
  maxRows: 50
});

// Generated SQL:
// SELECT TOP 50 region, SUM(amount) AS total_revenue 
// FROM auftrag 
// WHERE YEAR(order_date) = 2025 
// GROUP BY region 
// ORDER BY total_revenue DESC

// Result: 8 records (regions), 267ms execution time
```

### Example 3: Hallucination Detection

**User Query:** "Get all sales from the sales_data table"

```typescript
const response = await queryNaturalLanguage({
  query: "Get all sales from the sales_data table"
});

// Result: Error
{
  "success": false,
  "error": {
    "type": "HALLUCINATION",
    "message": "Table 'sales_data' does not exist",
    "suggestions": [
      "Did you mean 'auftrag' (orders)?",
      "Did you mean 'rechnung' (invoices)?",
      "Contact your administrator"
    ]
  }
}
```

## Troubleshooting

### Issue: "Query returned empty result set"
- **Cause**: Filters too restrictive, table empty
- **Solution**: Remove or broaden filters, check data availability

### Issue: "Table/Column not found"
- **Cause**: Hallucination detected
- **Solution**: Use exact table names, check schema mappings

### Issue: "Timeout"
- **Cause**: Query too complex or large result set
- **Solution**: Add time filter, reduce time range, limit maxRows

### Issue: "LLM not responding"
- **Cause**: Ollama service down
- **Solution**: Check Ollama health at `GET /health`, restart service

## Best Practices

1. **User Phrasing**
   - Be specific about tables and time periods
   - Use standard keywords: find, show, calculate, count
   - Include year/date range when applicable

2. **System Administration**
   - Monitor cache hit rates
   - Regularly review error logs
   - Keep table translations updated
   - Update schema cache if DB structure changes

3. **Performance**
   - Use reasonable maxRows values (100-1000)
   - Cache frequently asked queries
   - Profile slow queries in audit logs

4. **Accuracy**
   - Start with low temperature (0.2-0.3)
   - Validate generated SQL in Query mode
   - Add specific column hints for ambiguous queries

## Future Enhancements

- [ ] Support for complex window functions
- [ ] Chart generation from results
- [ ] Query optimization suggestions
- [ ] Multi-step query workflows
- [ ] Saved query templates
- [ ] User feedback loop for query improvement
- [ ] Advanced aggregation (pivot tables)
- [ ] Time series forecasting
