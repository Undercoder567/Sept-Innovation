# Data Flow & Integration

## Request Processing Pipeline

### 1. Incoming Request
```
POST /api/analytics/query
{
  "query": "Show me top 5 products by revenue this month"
}
↓
JWT Token Validation (authMiddleware)
↓
RBAC Check - User Permissions (rbacMiddleware)
↓
Request Validation (Joi schema)
```

### 2. Natural Language Processing
```
Get Database Schema
↓
LLMClient.generate()
  - Build prompt with schema context
  - Ollama llama2 processes locally
  - Returns SQL query
↓
Output: "SELECT product_id, SUM(amount) FROM transactions WHERE date >= ... LIMIT 1000"
```

### 3. SQL Validation & Generation
```
SQLValidator.validate()
  - Syntax check
  - Security analysis
  - Performance review
  - Complexity assessment
↓
SQLGenerator.buildSelect() / buildAggregation()
  - Parameterization ($1, $2, ...)
  - Identifier escaping
  - Query formatting
↓
Output: Validated, parameterized SQL with type safety
```

### 4. Query Execution
```
DatabaseClient.query()
  - Connection pool (max 20)
  - Parameterized execution
  - Timeout enforcement (30s)
  - Result size limits (1MB)
↓
Output: Raw query results {rows, rowCount}
```

### 5. Response Enhancement
```
ResponseParser.parseQueryResult()
  ├─ Validation (empty check, error handling)
  ├─ AI Summary Generation (LLM)
  ├─ Insight Extraction (LLM)
  └─ Statistics Calculation

PIIMasker.maskObject()
  - Pattern-based detection
  - Deterministic hashing
  - Applied if user lacks FULL access
```

### 6. Visualization & Export
```
- Recommend visualization type (BAR, LINE, PIE, etc.)
- Format data for frontend rendering
- Calculate summary statistics
- Prepare export formats
```

### 7. Audit & Response
```
AuditLogger.log()
  - Query execution details
  - Record count
  - Execution time
  - User info
↓
Return response to frontend
```

## Database Integration

### Schema Discovery
```
GET /api/analytics/schema
↓
DatabaseClient.getTables()
  → Returns: ["sales", "customers", "products", ...]
↓
DatabaseClient.getTableSchema(tableName)
  → Returns: Columns, types, nullability, defaults
↓
ResponseParser uses for visualization recommendations
```

### Query Caching
```
Request comes in
↓
Calculate query hash (SHA256 of normalized query)
↓
Check query_cache table
  ├─ Hit: Return cached result (increment access_count)
  └─ Miss: Execute query, cache result with TTL
↓
Cache entries expire after 1 hour (configurable)
```

### Transaction Management
```
For multi-statement operations:
  ├─ BEGIN TRANSACTION
  ├─ SET ISOLATION LEVEL (configurable)
  ├─ Execute queries
  ├─ COMMIT (success) or ROLLBACK (error)
  └─ Log to audit_logs
```

## Security Integration Points

### Authentication Flow
```
Token received (header or cookie)
↓
JWT signature verification
↓
Extract claims: userId, roles, permissions
↓
Check expiration
↓
Attach to request.user
↓
Next middleware (RBAC)
```

### RBAC & Data Access
```
Request with user context
↓
RBAC middleware checks:
  ├─ User roles
  ├─ Required permissions
  ├─ Data access level (FULL, DEPARTMENT, PERSONAL, NONE)
  └─ Query limits (queries/hour)
↓
Attach rbac context to request
↓
Endpoint checks rbac before execution
↓
If denied → 403 Forbidden
```

### PII Protection
```
Query result received
↓
Check user.rbac.dataAccessLevel
  ├─ FULL: No masking
  └─ Other: Apply masking
↓
PIIMasker.maskObject()
  ├─ Email: user@example.com → u***@example.com
  ├─ Phone: +1(555)123-4567 → +1(****)***-****
  ├─ SSN: 123-45-6789 → ***-**-6789
  ├─ IDs: Deterministic hash
  └─ Names: Initial + ***
↓
Return masked result
```

## Analytics Engine Integration

### Python Analytics Module
```
Advanced analysis triggered from /api/analytics/query
↓
ResponseParser calls:
  ├─ AnalyticsEngine.load_data()
  ├─ AnalyticsEngine.correlation_analysis()
  ├─ AnalyticsEngine.trend_analysis()
  ├─ AnalyticsEngine.anomaly_detection()
  └─ AnalyticsEngine.forecasting()
↓
Results merged into API response
```

### Trend Detection
```
Time-series data
↓
TrendAnalyzer.detect_seasonality()
  - Identifies seasonal patterns
  - Calculates seasonal strength
↓
TrendAnalyzer.change_point_detection()
  - Finds significant changes
  - Magnitude quantification
↓
TrendAnalyzer.volatility_analysis()
  - Rolling window std dev
  - Identifies high volatility periods
↓
Included in insights
```

## Real-time Monitoring

### Health Checks
```
GET /health
↓
Checks:
  ├─ Server status
  ├─ Database connectivity
  ├─ LLM availability (Ollama)
  ├─ Cache status
  └─ Uptime metrics
↓
Returns: {status, timestamp, environment, uptime}
```

### Audit Trail Monitoring
```
Real-time audit events streamed to /logs/audit-trail.jsonl
↓
Each entry immutable (append-only)
↓
Queryable for:
  ├─ User activity
  ├─ Data access patterns
  ├─ Security events
  ├─ Query executions
  └─ Error tracking
```

## Error Handling & Fallbacks

### LLM Fallback
```
LLM error (Ollama unavailable)
↓
ResponseParser.generateBasicSummary()
  → "Query returned X records"
↓
ResponseParser.extractBasicInsights()
  → Basic statistics
```

### SQL Generation Issues
```
Validation fails
↓
Log error with details
↓
Return 400 with issues list:
  - Syntax errors
  - Security violations
  - Performance warnings
↓
User can adjust query
```

### Database Connection Issues
```
Pool error
↓
Auto-retry with exponential backoff
↓
After max retries: Return 500 error
↓
Log to error.log and audit_logs
```

## Performance Optimization

### Query Optimization
```
Generated SQL
↓
SQLValidator.analyzeComplexity()
  - Count JOINs
  - Count subqueries
  - Assess conditions
↓
If complex:
  → Suggest indexes
  → Recommend CTE
  → Propose optimization
```

### Connection Pooling
```
Request needs database connection
↓
Get from pool (if available)
↓
If no available:
  - Queue with timeout
  - Prevent connection exhaustion
↓
Return connection after use
```

### Caching Strategy
```
Query hash calculated
↓
Check cache:
  - Hit: Return + increment counter
  - Miss: Execute + cache with TTL
↓
Cache invalidation:
  - Time-based (1 hour default)
  - Manual via admin API
```
