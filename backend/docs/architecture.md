# Sept Innovation - Backend Architecture

## Overview

Sept Innovation is a secure, locally-hosted AI-powered analytics platform designed for enterprise data analysis without exposing sensitive company data to external services.

**Key Characteristics:**
- 🔒 Local-first architecture - all data stays in-house
- 🤖 Natural language query interface powered by local Ollama LLM
- 🛡️ Enterprise-grade security with PII masking and RBAC
- 📊 Advanced statistical analysis with Python analytics engine
- 📝 Complete audit trail for compliance
- ⚡ High-performance SQL generation and query execution

## Architecture Components

### 1. API Layer (`src/api/`)
- **analytics.controller.ts**: Main API endpoints for query handling
  - `/api/analytics/query` - Natural language to SQL conversion and execution
  - `/api/analytics/validate` - Query validation without execution
  - `/api/analytics/schema` - Database schema introspection
  - `/api/analytics/export` - Data export (CSV, JSON, XLSX)

### 2. AI/LLM Layer (`src/ai/`)

#### llmClient.ts
- Local Ollama integration (no external API calls)
- Features:
  - Text generation for SQL understanding
  - Semantic embeddings for query similarity
  - Text classification and summarization
  - Insight generation from data
- **Security**: All processing happens locally

#### promptBuilder.ts
- Constructs optimized prompts for SQL generation
- Few-shot learning with business context
- Handles:
  - SQL generation prompts with schema context
  - Intent understanding
  - Data interpretation
  - Insight generation
  - Query explanation
  - Optimization suggestions

#### responseParser.ts
- Parses and enriches query results
- Generates AI-powered summaries
- Automatic insight extraction
- Visualization recommendations (BAR, LINE, PIE, SCATTER, TABLE, HEATMAP)
- Statistical calculations

### 3. Security Layer (`src/security/`)

#### authMiddleware.ts
- JWT token validation
- User context extraction
- Token expiry checking
- Support for Bearer tokens and cookie-based auth

#### rbac.ts (Role-Based Access Control)
- **Roles**:
  - ADMIN: Full system access
  - MANAGER: Team/department analytics
  - ANALYST: Deep data analysis
  - EXECUTIVE: High-level dashboards
  - USER: Basic analytics
  - GUEST: Public reports only

- **Data Access Levels**:
  - FULL: All data
  - DEPARTMENT: Department-scoped data
  - PERSONAL: Personal data only
  - NONE: No data access

- **Permissions Framework**:
  - Granular permission checking
  - Resource-based access control
  - Data classification integration

#### piiMasker.ts
- **Pattern-based masking** for:
  - Email addresses
  - Phone numbers
  - Credit cards
  - Social security numbers
  - Generic IDs and names
- **Deterministic hashing** for consistent masking across requests
- Recursive object/array masking
- PII detection and reporting

### 4. SQL Layer (`src/sql/`)

#### dbClient.ts
- PostgreSQL connection pooling
- **Features**:
  - Connection management
  - Parameterized query execution
  - Transaction support with isolation levels
  - Batch operations
  - Schema introspection
  - Query execution plans (EXPLAIN)
  - Database stats

#### sqlGenerator.ts
- Type-safe SQL generation
- **Methods**:
  - `buildSelect()` - Safe SELECT queries
  - `buildJoin()` - Multi-table JOINs
  - `buildAggregation()` - COUNT, SUM, AVG, etc.
- **Security**:
  - Identifier escaping (prevents injection)
  - Parameterized values (all queries use $1, $2, etc.)
  - SQL formatting for readability

#### sqlValidator.ts
- Comprehensive query validation
- **Checks**:
  - Basic syntax validation
  - Security analysis (dangerous keywords, injection patterns)
  - Performance optimization suggestions
  - Parameterization verification
  - Complexity analysis
- **Output**: Categorized issues with suggestions

### 5. Logging & Audit (`src/logs/`)

#### auditLogger.ts
- **Immutable audit trail** (append-only JSON lines)
- Winston-based structured logging
- **Logged events**:
  - User authentication
  - Data access (READ, WRITE, DELETE, EXPORT)
  - Query execution
  - Permission checks
  - Security events
  - Errors and warnings
- **Retention**: 5 rotating files per log type
- Audit entries include: timestamp, user ID, action, resource, severity, details

### 6. Middleware (`src/middleware/`)

#### requestLogger.ts
- Tracks all HTTP requests
- Records response status and execution time
- Audit trail for API usage

#### errorHandler.ts
- Global error handling
- Consistent error responses
- Stack traces in development mode

## Data Flow

```
User Query
    ↓
[API] /api/analytics/query
    ↓
[Auth] JWT validation + RBAC
    ↓
[LLM] Natural language → SQL (Ollama)
    ↓
[Validator] SQL security & syntax check
    ↓
[Generator] SQL formatting & parameterization
    ↓
[Database] Execute with connection pool
    ↓
[Parser] Enhance results + AI summaries
    ↓
[Masker] PII masking (if needed)
    ↓
[Audit] Log query execution
    ↓
Response → Frontend
```

## Security Model

### Multi-Layer Defense

1. **Authentication**
   - JWT tokens (configurable expiry)
   - Bearer token or cookie-based
   - Token validation on all protected routes

2. **Authorization (RBAC)**
   - Role-based permission checks
   - Resource-specific access control
   - Data classification levels

3. **Data Protection**
   - PII masking by default
   - Deterministic hashing for consistency
   - Pattern-based detection

4. **Query Security**
   - Parameterized queries only
   - SQL injection prevention
   - Dangerous statement blocking
   - Validation before execution

5. **Audit Trail**
   - Immutable logging
   - All data access tracked
   - Security events recorded
   - User action history

### PII Masking Patterns

```
email: user@example.com → u***@example.com
phone: +1(555)123-4567 → +1(****)***-****
SSN: 123-45-6789 → ***-**-6789
credit_card: 1234 5678 9012 3456 → **** **** **** 3456
person_id: person_id: ABC12345 → person_id: ****
name: John Smith → J*** S***
```

## Configuration

### Environment Variables
See `config/env.example` for all variables:

```bash
# Server
NODE_ENV=development
PORT=3001
JWT_SECRET=<your-secret>

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=analytics_db
DB_USER=postgres
DB_PASSWORD=<password>

# Ollama (Local LLM)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# Security
ENCRYPTION_KEY=<your-key>
ALLOWED_ORIGINS=http://localhost:5173
```

### Permissions Config (`config/permissions.yaml`)
- Role definitions and permissions
- Resource access control
- Data classification levels
- Query limits per role

### Query Limits (`config/query_limits.yaml`)
- Global query timeout (30s)
- Result set size limits
- Rate limiting (100 req/15min)
- Per-role query quotas
- Table access patterns

## Database Setup

### Schema Creation
```bash
psql analytics_db < database/schema.sql
```

### Read-Only Role
```bash
psql analytics_db < database/read_only_role.sql
```

Tables created:
- `audit_logs` - Security audit trail
- `query_cache` - Query result caching
- `query_history` - User query history
- `user_sessions` - Session management

### Row-Level Security (RLS)
- Department-based data isolation
- User-specific data filtering
- Admin overrides

## API Endpoints

### Analytics Queries

**POST /api/analytics/query**
```json
{
  "query": "What were total sales last month by region?",
  "limit": 1000,
  "offset": 0,
  "includeExplain": false,
  "masked": true
}
```

Response:
```json
{
  "success": true,
  "data": {
    "query": "...",
    "generatedSQL": "...",
    "result": [...],
    "summary": "...",
    "insights": [...],
    "statistics": {...},
    "visualization": {
      "type": "BAR",
      "data": {...}
    }
  }
}
```

**POST /api/analytics/validate**
```json
{
  "query": "Show me customer trends"
}
```

**GET /api/analytics/schema**
Returns available tables and their schemas.

**POST /api/analytics/export**
```json
{
  "query": "...",
  "format": "csv|json|xlsx"
}
```

## Performance Considerations

### Caching
- Query result caching (configurable TTL)
- Semantic query similarity for cache hits
- Automatic cache invalidation

### Optimization
- Connection pooling (max 20 connections)
- Index recommendations
- Query execution plan analysis
- Parameterized queries (prevent parser overhead)

### Monitoring
- Query execution metrics
- Database connection stats
- Request/response times
- Error rates

## Deployment

### Local Development
```bash
# Install dependencies
npm install

# Configure environment
cp config/env.example .env
# Edit .env with your values

# Start Ollama (separate terminal)
ollama serve

# Run server
npm run dev
```

### Production

1. **Security**
   - Enable HTTPS/TLS
   - Use strong JWT_SECRET
   - Configure firewall rules
   - Enable audit logging

2. **Database**
   - Configure backups
   - Enable encryption at rest
   - Set up read replicas
   - Implement maintenance windows

3. **LLM**
   - Run Ollama on separate machine
   - Configure resource limits
   - Monitor response times
   - Set up fallback behavior

## Compliance & Auditing

- **GDPR**: PII masking, audit trails, data access logs
- **SOX**: Immutable audit logs, access controls
- **HIPAA**: Encryption, access controls, audit trails
- **Custom**: Configurable audit logging, role-based controls

Audit logs include:
- User authentication events
- All data access (READ/WRITE/DELETE/EXPORT)
- Query executions with results counts
- Permission checks
- Security events and failures

## Monitoring & Troubleshooting

### Logs
- `/logs/audit.log` - All audit events
- `/logs/error.log` - Error events only
- `/logs/audit-trail.jsonl` - Immutable audit trail

### Health Checks
- `GET /health` - Server status
- LLM health via Ollama `/api/tags`
- Database connectivity test

### Metrics
- Query execution time
- Result set sizes
- Cache hit rates
- Error rates by type
