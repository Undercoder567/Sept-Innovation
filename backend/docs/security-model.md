# Security Model & Best Practices

## Security Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS/TLS
                     ↓
┌─────────────────────────────────────────────────────────┐
│              API Gateway / Middleware                    │
│  • Rate Limiting (100 req/15min)                         │
│  • CORS Validation                                       │
│  • Request ID tracking                                   │
│  • TLS termination                                       │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────┐
│              Authentication Layer                        │
│  • JWT validation (Bearer token / Cookie)               │
│  • Token expiry check (24h default)                      │
│  • User context extraction                              │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────┐
│              Authorization Layer (RBAC)                 │
│  • Role permission validation                           │
│  • Resource access control                              │
│  • Data access level enforcement                        │
│  • Query quota checking                                 │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────┐
│           Business Logic & Validation                    │
│  • SQL generation & validation                          │
│  • Query complexity analysis                            │
│  • Injection prevention (parameterized queries)         │
│  • Timeout enforcement                                  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────┐
│                 PII Protection Layer                     │
│  • Pattern-based masking                                │
│  • Deterministic hashing                                │
│  • Conditional masking based on user role               │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────┐
│             Database Access Layer                        │
│  • Connection pooling (max 20)                           │
│  • Parameterized query execution                        │
│  • Transaction isolation levels                         │
│  • Read-only role enforcement                           │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────┐
│              Audit & Logging Layer                       │
│  • Immutable audit trail (append-only)                  │
│  • User action logging                                  │
│  • Data access tracking                                 │
│  • Error logging                                        │
└─────────────────────────────────────────────────────────┘
```

## Defense Layers

### 1. Network Security
- **HTTPS/TLS**: Encryption in transit
- **CORS**: Cross-origin request validation
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Request Size**: 10MB max payload

### 2. Authentication
- **JWT Tokens**: 24-hour expiry (configurable)
- **Token Storage**: 
  - Bearer token in Authorization header (preferred)
  - Secure cookie fallback (httpOnly, secure flags)
- **Token Validation**: Signature + expiry check

### 3. Authorization (RBAC)
- **Role-Based**: Predefined roles with permissions
- **Permission Checks**: Granular per endpoint
- **Data Access Levels**:
  - FULL: All data (Admin only)
  - DEPARTMENT: Team data (Manager, Analyst)
  - PERSONAL: User's own data
  - NONE: No access (Guests)

### 4. Query Security

#### SQL Injection Prevention
```typescript
// ❌ VULNERABLE
const sql = `SELECT * FROM users WHERE id = ${userId}`;

// ✅ SAFE (Our implementation)
const sql = "SELECT * FROM users WHERE id = $1";
const params = [userId];
await db.query(sql, params);
```

#### Dangerous Statements Blocked
- DROP TABLE, DELETE, INSERT, UPDATE, ALTER
- EXEC, EXECUTE statements
- Dynamic code execution

#### Validation Pipeline
1. Syntax validation (balanced parentheses, keywords)
2. Security analysis (dangerous patterns)
3. Performance review (SELECT *, missing LIMIT)
4. Complexity scoring

### 5. PII Protection

#### Masking Patterns
```
Email:        user@example.com     → u***@example.com
Phone:        +1(555)123-4567      → +1(****)***-****
SSN:          123-45-6789          → ***-**-6789
Credit Card:  1234 5678 9012 3456  → **** **** **** 3456
Names:        John Smith           → J*** S***
IDs:          person_id_ABC123     → person_id_****
```

#### Smart Masking
- **Deterministic**: Same input → same mask (join-safe)
- **Recursive**: Handles nested objects/arrays
- **Context-aware**: Applied based on user role
- **Audited**: Logged when masking occurs

### 6. Data Access Control

#### Row-Level Security (RLS)
```sql
CREATE POLICY sales_department_policy ON sales
  FOR SELECT USING (
    department_id = current_setting('app.current_department')::INT
    OR current_user = 'admin'
  );
```

#### Connection Pooling
- Max 20 concurrent connections
- Per-user isolation
- Connection timeout: 30 seconds
- Idle timeout: 30 seconds

### 7. Audit Logging

#### Immutable Audit Trail
```json
{
  "audit_id": "AUD_7G9Z3K2M",
  "timestamp": "2024-03-05T14:30:45Z",
  "action": "QUERY_EXECUTION",
  "userId": "user_123",
  "resource": "DATABASE",
  "details": {
    "query": "SELECT * FROM sales WHERE...",
    "executionTime": 245,
    "recordCount": 1250
  },
  "severity": "INFO"
}
```

#### Logged Events
- User login/logout
- Authentication failures
- Permission denials
- Query executions
- Data access (READ/WRITE/DELETE/EXPORT)
- Security events
- Errors and exceptions

#### Access Controls
- Audit logs read-only to authorized users
- Append-only (immutable)
- 5 rotating log files (10MB each)
- Separate critical error log

## Threat Model & Mitigations

### 1. SQL Injection
**Threat**: Attacker modifies queries to access unauthorized data
**Mitigation**:
- Parameterized queries only ($1, $2)
- Input validation & escaping
- SQL whitelist patterns
- Syntax validation before execution

### 2. Authentication Bypass
**Threat**: Unauthorized access via token manipulation
**Mitigation**:
- JWT signature validation (HMAC-SHA256)
- Token expiry enforcement
- Secure token storage (cookies: httpOnly, secure)
- Token refresh logic

### 3. Privilege Escalation
**Threat**: User gains higher-level access
**Mitigation**:
- RBAC role validation
- Permission inheritance rules
- Read-only database role
- Audit logging of privilege changes

### 4. Data Exposure (PII)
**Threat**: Sensitive data leaked to unauthorized users
**Mitigation**:
- Pattern-based masking
- Role-based masking application
- Deterministic hashing for joins
- PII detection & alerting

### 5. Brute Force Attacks
**Threat**: Attacker guesses credentials/tokens
**Mitigation**:
- Rate limiting (100 req/15 min)
- Account lockout (implement in auth service)
- JWT short expiry (24h)
- MFA for high-privilege roles

### 6. Denial of Service (DoS)
**Threat**: Resource exhaustion
**Mitigation**:
- Query timeout (30 seconds)
- Result set limits (1MB, 10k rows)
- Rate limiting
- Connection pooling (max 20)
- Query complexity scoring

### 7. Data Breach (Database Compromise)
**Threat**: Database is compromised
**Mitigation**:
- Encryption at rest (configure per DB)
- Backups encrypted
- Access logs (who accessed what)
- PII already masked in most cases
- Read-only connections for queries

### 8. Man-in-the-Middle (MITM)
**Threat**: Network traffic interception
**Mitigation**:
- HTTPS/TLS encryption (configure in production)
- HSTS header (1 year, preload)
- Secure cookie flags
- Certificate pinning (frontend)

## Compliance Requirements

### GDPR
- ✅ Data access logging
- ✅ PII masking
- ✅ Audit trail (30+ days)
- ✅ User data export
- ✅ Right to be forgotten (via delete query)

### SOX (Sarbanes-Oxley)
- ✅ Immutable audit logs
- ✅ Access controls (RBAC)
- ✅ User authentication (JWT)
- ✅ Query approval workflows

### HIPAA
- ✅ Encryption in transit (TLS)
- ✅ Access controls
- ✅ Audit logging
- ✅ PII protection

### Custom Requirements
- ✅ Configurable audit logging
- ✅ Role-based access control
- ✅ Data classification levels
- ✅ Query limits per role

## Security Configuration

### Environment Variables
```bash
# Critical
JWT_SECRET=<very-long-random-string>
ENCRYPTION_KEY=<another-random-string>
DB_PASSWORD=<strong-password>

# Security
NODE_ENV=production
ALLOWED_ORIGINS=https://yourdomain.com
LOG_LEVEL=info
```

### Production Checklist
- [ ] HTTPS/TLS enabled
- [ ] Strong JWT_SECRET (>32 chars)
- [ ] Database user has minimal privileges
- [ ] Firewall rules configured
- [ ] Backup strategy in place
- [ ] Log rotation configured
- [ ] Monitoring/alerts set up
- [ ] Regular security audits scheduled
- [ ] Dependency updates automated
- [ ] API keys rotated (if using external services)

## Best Practices for Developers

### Query Safety
```typescript
// ✅ Always parameterize
const result = await db.query(
  "SELECT * FROM users WHERE id = $1",
  [userId]
);

// ❌ Never concatenate
const result = await db.query(
  `SELECT * FROM users WHERE id = ${userId}`
);
```

### Permission Checking
```typescript
// ✅ Check permissions
if (!checkPermission(req, 'analytics:query:read')) {
  return res.status(403).json({error: 'FORBIDDEN'});
}

// ❌ Never skip checks
const result = await db.query(sql);
```

### Audit Logging
```typescript
// ✅ Log sensitive operations
auditLogger.log({
  timestamp: new Date(),
  action: 'DATA_ACCESS_READ',
  userId: req.user.userId,
  resource: 'CUSTOMER_DATA',
  details: {recordCount: 100}
});

// ❌ Don't skip audit logs
```

### Error Handling
```typescript
// ✅ Generic error messages
res.status(500).json({
  error: 'Internal Server Error'
});

// ❌ Never expose internals
res.status(500).json({
  error: error.message,
  stack: error.stack // Exposes system info!
});
```

## Testing Security

### Automated Tests
```bash
# SQL injection tests
npm test -- --testNamePattern="sql.injection"

# RBAC tests
npm test -- --testNamePattern="rbac"

# PII masking tests
npm test -- --testNamePattern="pii.masking"
```

### Manual Testing
1. Try SQL injection: `' OR '1'='1`
2. Use invalid tokens: expired, malformed
3. Access other user's department data
4. Try dangerous statements: DROP TABLE
5. Export large datasets (DOS test)

## Reporting Security Issues

If you discover a security vulnerability:
1. DO NOT publicly disclose
2. Email: security@septinnovation.com
3. Include: description, steps to reproduce, impact
4. Allow 30 days for response before disclosure
