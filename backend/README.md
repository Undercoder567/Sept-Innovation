# README - Sept Innovation Backend

## 🚀 Overview

A secure, locally-hosted AI-powered analytics platform that transforms natural language queries into SQL analysis while protecting sensitive company data.

**Key Features:**
- 🤖 **Local LLM Integration** - Ollama-powered NLP (no cloud APIs)
- 🔒 **Enterprise Security** - PII masking, RBAC, audit trails
- 📊 **Advanced Analytics** - Trend analysis, anomaly detection, forecasting
- ⚡ **High Performance** - Connection pooling, query caching, optimizations
- 📝 **Complete Audit Trail** - Immutable logging for compliance
- 🎯 **Smart Visualizations** - Auto-recommended chart types

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- Python 3.8+ (optional, for analytics engine)
- Ollama (for local LLM)

### Installation

```bash
# Clone and navigate
cd backend

# Run setup script
chmod +x setup.sh
./setup.sh

# Or manual setup
npm install
cp config/env.example .env
# Edit .env with your values

# Build TypeScript
npm run build
```

### Running Locally

```bash
# Terminal 1: Start Ollama
ollama serve

# Terminal 2: Start Backend
npm run dev

# Server runs on http://localhost:3001
# Health check: curl http://localhost:3001/health
```

## Architecture

```
Natural Language Query
    ↓
[LLM] Ollama - Convert to SQL (local)
    ↓
[Validator] Security & syntax check
    ↓
[Generator] Parameterized SQL
    ↓
[Database] Execute with pooling
    ↓
[Parser] AI-powered insights
    ↓
[Masker] PII protection
    ↓
[Logger] Immutable audit trail
    ↓
Response (JSON + Visualization)
```

## Core Modules

| Module | Purpose |
|--------|---------|
| `ai/` | LLM integration, prompts, response parsing |
| `sql/` | SQL generation, validation, database access |
| `security/` | Authentication, RBAC, PII masking |
| `api/` | Express routes and controllers |
| `logs/` | Audit logging and monitoring |
| `config/` | Permissions, query limits, environment |

## API Endpoints

### Analytics Queries
```bash
POST /api/analytics/query
{
  "query": "Show top 5 products by sales this month",
  "limit": 1000,
  "masked": true
}
```

### Schema Introspection
```bash
GET /api/analytics/schema
```

### Query Validation
```bash
POST /api/analytics/validate
{
  "query": "What's our customer retention rate?"
}
```

### Data Export
```bash
POST /api/analytics/export
{
  "query": "...",
  "format": "csv|json|xlsx"
}
```

## Security

- **Authentication**: JWT tokens (24h expiry)
- **Authorization**: Role-based access control (6 roles)
- **Data Protection**: 
  - Pattern-based PII masking
  - Deterministic hashing
  - Role-conditional masking
- **Query Security**:
  - Parameterized queries only
  - SQL injection prevention
  - Dangerous statement blocking
- **Audit Trail**: Immutable, append-only logging

## Configuration

### Environment Variables
```bash
# .env file
NODE_ENV=development
PORT=3001
JWT_SECRET=your-secret-key

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=analytics_db
DB_USER=postgres
DB_PASSWORD=postgres

# Ollama (Local LLM)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2

# Security
ENCRYPTION_KEY=your-key
ALLOWED_ORIGINS=http://localhost:5173
```

### Permissions (config/permissions.yaml)
- Define roles and permissions
- Set data access levels
- Configure query limits

### Query Limits (config/query_limits.yaml)
- Timeout: 30 seconds
- Result size: 1MB
- Rate limiting: 100 req/15min

## Database Setup

```bash
# Create database
createdb analytics_db

# Apply schema
psql analytics_db < database/schema.sql

# Create read-only role
psql analytics_db < database/read_only_role.sql
```

## Development

```bash
# Build TypeScript
npm run build

# Run tests
npm test

# Type checking
npm run type-check

# Linting
npm run lint

# Development server (auto-reload)
npm run dev
```

## Documentation

- **[Architecture](docs/architecture.md)** - System design and components
- **[Data Flow](docs/data-flow.md)** - Request processing pipeline
- **[Security Model](docs/security-model.md)** - Security architecture and best practices

## Production Deployment

1. **Environment**: Set NODE_ENV=production
2. **Secrets**: Configure strong JWT_SECRET, ENCRYPTION_KEY
3. **Database**: Enable encryption, backups, replication
4. **HTTPS**: Use TLS certificates
5. **Monitoring**: Set up logging, metrics, alerts
6. **Scaling**: Implement load balancing, read replicas

See `docs/deployment.md` for detailed guide.

## Troubleshooting

### Connection Issues
```bash
# Check database
psql -U postgres -c "SELECT NOW()"

# Check Ollama
curl http://localhost:11434/api/tags
```

### Query Errors
- Check SQL validation: POST `/api/analytics/validate`
- Review audit logs: `/logs/audit.log`
- Check error logs: `/logs/error.log`

### Performance
- Enable query caching
- Analyze slow queries: `EXPLAIN ANALYZE`
- Review index usage
- Check connection pool stats

## Support

For issues, questions, or security concerns:
- Issues: GitHub Issues
- Security: security@septinnovation.com
- Documentation: See `/docs` folder

## License

[Your License Here]

---

**Built with** ❤️ for secure enterprise analytics
