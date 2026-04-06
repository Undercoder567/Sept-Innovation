# NL2SQL Architecture & Data Flow

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React/TypeScript)                  │
├─────────────────────────────────────────────────────────────────┤
│  ChatBox Component (Query Mode)                                  │
│  ├─ User Input: Natural Language Query                          │
│  ├─ API Call: queryNaturalLanguage()                            │
│  └─ Display: Results + SQL + Warnings/Errors                   │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTP POST /analytics/nl-query
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                    BACKEND (Express/TypeScript)                  │
├─────────────────────────────────────────────────────────────────┤
│  Analytics Controller                                            │
│  └─ POST /analytics/nl-query                                    │
│     ├─ Permission Check (analytics:query:read)                 │
│     └─ Call NL2SQLService                                       │
└─────────────────────┬───────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
┌──────────────────────┐   ┌──────────────────────┐
│   NL2SQL Service     │   │  Query Cache (Map)   │
│                      │   │ SHA256(q+userId)→   │
│ ┌──────────────────┐ │   │ {sql,results,time}   │
│ │1. Cache Check   │◄┼─┬─┤ (TTL: 15 min)        │
│ │2. Query Analysis│ │ │  └──────────────────────┘
│ │3. SQL Generation│ │ │
│ │4. Hallucination │ │ │  ┌──────────────────────┐
│ │   Detection     │ │ │  │ Hallucination        │
│ │5. Validation    │ │ │  │ Detector             │
│ │6. Execution     │ │ │  │                      │
│ │7. Error Handling│ │ │  │ ┌─ Schema Cache      │
│ └──────────────────┘ │ │  │ │ (TTL: 5 min)      │
│                      │ │  │ │                    │
│                      │ │  │ ├─ Table Extractor  │
│                      │ │  │ ├─ Column Validator │
│                      │ │  │ ├─ Join Checker    │
│                      │ │  │ ├─ Type Analyzer   │
│                      │ │  │ └─ Confidence Score │
│                      │ │  └──────────────────────┘
│                      │ │
│                      │ │  ┌──────────────────────┐
│                      │ │  │ Prompt Builder       │
│                      │ │  │                      │
│                      │ │  ├─ Rules injection    │
│                      │ │  ├─ Schema context    │
│                      │ │  ├─ Translations     │
│                      │ │  └─ Intent hints     │
│                      │ │  └──────────────────────┘
│                      │ │
│                      │ └─ SQLValidator
│                      │    ├─ Syntax check
│                      │    ├─ Security check
│                      │    └─ Performance check
└──────────┬───────────┘
           │
        ┌──┴──┬──┐
        │     │  │
        ▼     ▼  ▼
    ┌────────────────┐      ┌──────────────────┐
    │  LLM Client    │      │ SQL Validator    │
    │  (Ollama)      │      │                  │
    │                │      │ ┌─ Rules Check   │
    │ ┌─ Generate    │      │ ├─ Syntax Valid  │
    │ ├─ Chat        │      │ └─ Safe Query    │
    │ └─ Models API  │      └──────────────────┘
    └────────────────┘
           │
           ▼
    ┌──────────────────┐
    │  Ollama Server   │
    │  (Local LLM)     │
    │                  │
    │ Model: llama2    │ (or mistral, neural-chat, etc.)
    │ (or other)       │
    └──────────────────┘


    ┌──────────────────────────────────────────┐
    │        DATABASE (SQL Server)              │
    │                                           │
    │  ┌─ Metadata Tables (INFORMATION_SCHEMA) │
    │  │  ├─ TABLES                           │
    │  │  ├─ COLUMNS                          │
    │  │  └─ REFERENTIAL_CONSTRAINTS          │
    │  │                                       │
    │  ├─ Business Tables                     │
    │  │  ├─ auftrag (orders)                │
    │  │  ├─ rechnung (invoices)             │
    │  │  ├─ kunde (customers)               │
    │  │  ├─ artbest (products)              │
    │  │  └─ [100+ more tables]              │
    │  │                                       │
    │  └─ Audit Tables                        │
    │     ├─ query_history                    │
    │     ├─ audit_logs                       │
    │     └─ query_cache                      │
    └──────────────────────────────────────────┘
```

## Request/Response Flow

### Success Path: "find all orders from 2024"

```
1. USER INPUT
   ├─ Query: "find all orders from 2024"
   ├─ User ID: "user123"
   └─ Max Rows: 100

2. CACHE CHECK
   ├─ Calculate: SHA256("find all orders from 2024:user123")
   ├─ Lookup: queryCache.get(hash)
   └─ Result: Cache Miss ❌

3. QUERY ANALYSIS
   ├─ Intent: SEARCH
   ├─ Tables: ["auftrag"]
   ├─ Filters: ["2024"]
   └─ Confidence: 0.9

4. SCHEMA RETRIEVAL
   ├─ Fetch: Table structure for "auftrag"
   ├─ Columns: id, customer_id, amount, created_at, ...
   ├─ Foreign Keys: auftrag → kunde (customer_id)
   └─ Cache: Store for 5 minutes

5. SQL GENERATION
   ├─ Input Prompt:
   │  - Rules: Use TOP 100, specify columns, no SELECT *
   │  - Schema: auftrag table structure
   │  - Mapping: German→English translation
   │  - Intent: SEARCH hints
   │
   ├─ LLM Response:
   │  "SELECT TOP 100 id, customer_id, amount, created_at
   │   FROM auftrag WHERE YEAR(created_at) = 2024"
   │
   └─ Extract: Clean SQL

6. HALLUCINATION DETECTION
   ├─ Extract Tables: ["auftrag"] ✅ Valid
   ├─ Extract Columns: All exist ✅
   ├─ Check Syntax: Balanced parens ✅
   ├─ Type Checking: No mismatches ✅
   ├─ Confidence: 0.05 (low = good!)
   └─ Action: ALLOW

7. VALIDATION
   ├─ Syntax: Valid SQL ✅
   ├─ Security: SELECT only ✅
   ├─ Functions: Allowed ✅
   ├─ Parameterization: Not needed (constants only)
   └─ Issues: [] (none)

8. EXECUTION
   ├─ Query: "SELECT TOP 100 id, customer_id, amount, created_at
   │           FROM auftrag WHERE YEAR(created_at) = 2024"
   ├─ Time: 234ms
   ├─ Rows: 245 records returned
   └─ Cache: Store result for 15 minutes

9. RESPONSE (200 OK)
   {
     "success": true,
     "data": {
       "query": "find all orders from 2024",
       "sql": "SELECT TOP 100 ...",
       "results": [
         {id: 1001, customer_id: "ABC", amount: 1000.00, ...},
         {id: 1002, customer_id: "XYZ", amount: 2500.50, ...},
         ...
       ],
       "resultCount": 245,
       "executionTime": 234,
       "cached": false,
       "warnings": []
     }
   }

10. LOGGING
    ├─ Audit Log:
    │  - user_id: user123
    │  - query: "find all orders from 2024"
    │  - sql: "SELECT TOP 100 ..."
    │  - execution_time: 234ms
    │  - record_count: 245
    │  - success: true
    │  - timestamp: 2024-01-15 14:30:45
    │
    └─ Cache: queryCache[hash] = {sql, results, time, expiry}
```

### Error Path: "show data from invalid_table"

```
1. USER INPUT
   ├─ Query: "show data from invalid_table"
   ├─ User ID: "user123"
   └─ Max Rows: 100

2. CACHE CHECK
   └─ Result: Cache Miss

3. QUERY ANALYSIS
   ├─ Intent: SEARCH
   ├─ Tables: ["invalid_table"]
   ├─ Filters: []
   └─ Confidence: 0.8

4. SCHEMA RETRIEVAL
   ├─ All tables cached
   ├─ Check: "invalid_table" exists?
   └─ Result: NOT FOUND

5. SQL GENERATION
   ├─ LLM generates (doesn't know it's invalid):
   │  "SELECT * FROM invalid_table"
   │
   └─ Extract: Clean SQL

6. HALLUCINATION DETECTION ⚠️
   ├─ Extract Tables: ["invalid_table"]
   ├─ Check: Valid table? ❌ NO
   ├─ Fuzzy Match: Did you mean...?
   │  - "artbest" (products) - distance: 12
   │  - "lsposten" (ledger) - distance: 11
   │  - "kunde" (customers) - distance: 14
   │
   ├─ Issues:
   │  [{
   │    type: 'INVALID_TABLE',
   │    severity: 'CRITICAL',
   │    message: "Table 'invalid_table' does not exist",
   │    suggestion: "Did you mean 'artbest'?",
   │    confidence: 0.92
   │  }]
   │
   └─ Action: BLOCK (confidence > 0.8 + CRITICAL issue)

7. RESPONSE (400 Bad Request)
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
             "message": "Table 'invalid_table' does not exist",
             "suggestion": "Did you mean 'artbest'?"
           }
         ],
         "confidence": 0.92
       },
       "fallbackAvailable": true
     },
     "suggestions": [
       "Try specifying exact table names (e.g., 'orders' instead of 'sales data')",
       "Did you mean 'artbest' (products)?",
       "Contact your administrator"
     ]
   }

8. LOGGING
   ├─ Audit Log:
   │  - user_id: user123
   │  - query: "show data from invalid_table"
   │  - sql: "SELECT * FROM invalid_table"
   │  - success: false
   │  - error_type: "HALLUCINATION"
   │  - timestamp: 2024-01-15 14:31:00
   │
   └─ NOT CACHED (failed query)
```

## Data Structures

### Request

```typescript
interface NL2SQLRequest {
  query: string;              // "find all orders from 2024"
  userId: string;             // "user123"
  maxRows?: number;           // 100 (default)
  allowFallback?: boolean;    // true (default)
  temperature?: number;       // 0.3 (default) - LLM creativity
}
```

### Response (Success)

```typescript
interface NL2SQLResponse {
  success: true;
  data: {
    query: string;           // Original user query
    sql: string;             // Generated SQL
    results: object[];       // Query results
    resultCount: number;     // Row count
    executionTime: number;   // ms
    cached?: boolean;        // true if from cache
    warnings?: string[];     // Optional warnings
  };
}
```

### Response (Error)

```typescript
interface NL2SQLResponse {
  success: false;
  error: {
    type: string;            // HALLUCINATION, VALIDATION, etc.
    message: string;         // Error description
    details?: object;        // Detailed error info
    fallbackAvailable?: boolean;
  };
  suggestions?: string[];    // Recovery suggestions
}
```

### Hallucination Result

```typescript
interface HallucinationCheckResult {
  isHallucinating: boolean;
  issues: [
    {
      type: string;          // INVALID_TABLE, INVALID_COLUMN, etc.
      severity: string;      // CRITICAL, HIGH, MEDIUM, LOW
      message: string;
      suggestion?: string;   // How to fix
    }
  ];
  confidence: number;        // 0-1 (likelihood of hallucination)
  recommendedAction: string; // BLOCK, FLAG, or ALLOW
}
```

## Performance Characteristics

### Timing Breakdown (Cache Miss)

```
Input Query
    ↓
Cache Check (1-2ms)
    ├─ Hash calculation: 0.5ms
    └─ Map lookup: 0.5ms

Query Analysis (5-10ms)
    ├─ Intent detection: 2ms
    ├─ Table extraction: 2ms
    └─ Filter analysis: 1-6ms

Schema Retrieval (100-200ms)
    ├─ Cache hit: Use stored (500ms first time)
    └─ DB query on miss

SQL Generation (2-5s via LLM)
    ├─ Prompt building: 20ms
    ├─ Ollama API call: 2-5s
    └─ Response parsing: 50ms

Hallucination Detection (500-1000ms)
    ├─ Table validation: 100ms
    ├─ Column validation: 200ms
    ├─ Join checking: 100ms
    ├─ Type analysis: 100ms
    └─ Scoring: 50ms

SQL Validation (100-200ms)
    ├─ Syntax check: 30ms
    ├─ Security check: 50ms
    └─ Performance check: 20-120ms

Query Execution (varies)
    ├─ Database time: 100-2000ms
    └─ Result marshaling: 20-100ms

Cache Store (1-2ms)

─────────────────────────────
TOTAL (Cache Miss): 3-7 seconds

TOTAL (Cache Hit): 10-50ms
```

### Memory Usage

```
Per-User Cache Entry:
├─ SQL String: ~500 bytes
├─ Results Array: ~50KB (typical)
└─ Metadata: ~100 bytes

Total per entry: ~50KB

Cache Capacity (15min TTL):
├─ Max entries: 1000s (depends on system)
├─ Total memory: ~50MB (manageable)
└─ Auto-cleanup: Old entries removed

Schema Cache:
├─ Tables metadata: ~10MB
├─ Columns: ~20MB
├─ Foreign keys: ~5MB
└─ Total: ~35MB (5-min TTL, global)
```

## Error Recovery Path

```
Query Submitted
      ↓
[Attempt 1] Generate SQL
      ├─ Success → Continue to validation
      └─ Fail → Log attempt 1 error
           ↓
      [Attempt 2] Generate SQL (with different prompt)
           ├─ Success → Continue to validation
           └─ Fail → Log attempt 2 error
                ↓
           Return Error Response
           ├─ Type: PARSE_ERROR
           ├─ Message: "Failed after 2 attempts"
           ├─ Details: [errors from attempts]
           └─ Suggestions: [rephrasing hints]
```

## Security Flow

```
Request → Permission Check
            ├─ User authenticated? ✓
            ├─ Has analytics:query:read? ✓
            └─ → Continue

         → SQL Validation
            ├─ Read-only (SELECT only)? ✓
            ├─ Parameterized values? ✓
            ├─ Dangerous functions? ✓
            └─ → Continue

         → Execution
            ├─ With user context (audit log)
            ├─ Timeout: 30s
            ├─ Result limit: 100,000 rows
            └─ → Log everything

         → Response
            └─ User ID stored in audit trail
```

## Caching Strategy

```
Query Cache (Per User)
├─ Key: SHA256(query + userId)
├─ TTL: 15 minutes
├─ Storage: In-memory Map
├─ Eviction: LRU on timeout
│
└─ Hit: Return cached results + "cached": true

Schema Cache (Global)
├─ Key: SCHEMA_CACHE_KEY (constant)
├─ TTL: 5 minutes
├─ Storage: In-memory (HallucinationDetector)
├─ Eviction: Auto-refresh on expiry
│
└─ Hit: Fast validation without DB query
```

This architecture provides:
- ✅ Fast SQL generation via LLM
- ✅ Hallucination prevention
- ✅ Query caching for performance
- ✅ Secure execution
- ✅ Comprehensive logging
- ✅ Graceful error handling
