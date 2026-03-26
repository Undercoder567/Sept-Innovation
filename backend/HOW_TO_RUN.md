# 🚀 Sept Innovation Backend - How to Run

Complete guide to getting the backend up and running on your local machine.

---

## Quick Start (5 Minutes)

### Prerequisites Checklist
```powershell
# Windows PowerShell - Check all prerequisites
node --version          # Should be 18+
npm --version           # Should be 8+
psql --version          # PostgreSQL 12+
python --version        # Python 3.8+ (optional)
ollama --version        # Latest version
```

### 1. Install Dependencies
```powershell
cd backend
npm install             # Install Node.js packages
```

### 2. Start Ollama (Local LLM Server)
```powershell
# In a new PowerShell window
ollama serve

# Expected output:
# Listening on [::]:11434
# Keep this window open
```

### 3. Setup PostgreSQL Database
```powershell
# Create database
psql -U postgres -c "CREATE DATABASE analytics_db;"

# Load schema
psql -U postgres -d analytics_db -f database\schema.sql

# Load sample data
psql -U postgres -d analytics_db -f database\sample_data.sql

# Setup read-only role
psql -U postgres -d analytics_db -f database\read_only_role.sql
```

### 4. Configure Environment
```powershell
# Copy environment template
Copy-Item config\env.example .env

# Edit .env with your settings (see below)
notepad .env
```

### 5. Start Development Server
```powershell
npm run dev

# Expected output:
# ✓ TypeScript compiled successfully
# Server running on http://localhost:3001
# Health check: http://localhost:3001/health
```

### 6. Verify It's Working
```powershell
# In another PowerShell window, test the server
curl http://localhost:3001/health

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2025-03-05T...",
#   "environment": "development"
# }
```

✅ **You're done! Backend is running.**

---

## Detailed Setup Guide

### Step 1: Install System Dependencies

#### Windows

**Node.js 18+**
```powershell
# Option A: Download from https://nodejs.org (LTS version)

# Option B: Using Chocolatey
choco install nodejs

# Verify
node --version
npm --version
```

**PostgreSQL 12+**
```powershell
# Option A: Download from https://www.postgresql.org/download/windows/

# Option B: Using Chocolatey
choco install postgresql

# Verify
psql --version
```

**Ollama**
```powershell
# Download from https://ollama.ai/download

# Or use Chocolatey
choco install ollama

# Verify
ollama --version
```

**Python 3.8+ (Optional, for analytics)**
```powershell
# Download from https://python.org

# Or use Chocolatey
choco install python

# Verify
python --version
```

#### macOS

```bash
# Homebrew (install if needed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js
brew install node

# PostgreSQL
brew install postgresql@15

# Ollama
brew install ollama

# Python (optional)
brew install python@3.11

# Verify all
node --version
psql --version
ollama --version
python3 --version
```

#### Linux (Ubuntu/Debian)

```bash
# Update package manager
sudo apt update

# Node.js
curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Ollama
curl https://ollama.ai/install.sh | sh

# Python (optional)
sudo apt install -y python3 python3-pip

# Verify all
node --version
psql --version
ollama --version
python3 --version
```

### Step 2: Clone/Navigate to Project

```powershell
# Navigate to backend folder
cd e:\SeptInnovation\backend

# List files to verify
ls

# Expected output:
# src/
# database/
# analytics-engine/
# config/
# docs/
# package.json
# tsconfig.json
# ...
```

### Step 3: Install Node.js Dependencies

```powershell
# Install all npm packages
npm install

# Expected output:
# added 120+ packages in 2m
# npm notice ...

# Verify installation
npm list --depth=0

# Check key dependencies
npm list express typescript pg winston
```

### Step 4: Build TypeScript

```powershell
# Compile TypeScript to JavaScript
npm run build

# Expected output:
# ✓ Successfully compiled X files

# Verify build output
ls dist/          # Should contain compiled JS files
ls dist/src/      # Should have api, security, sql, etc.
```

### Step 5: Start Ollama Server

**Open a NEW PowerShell window and keep it open:**

```powershell
# Start Ollama server
ollama serve

# Expected output:
# Listening on [::]:11434

# In another window, verify it's running
curl http://localhost:11434/api/health

# Expected response:
# OK
```

**Download Models (one-time setup):**

```powershell
# In another PowerShell window
# Pull Llama2 (3.8GB)
ollama pull llama2

# Pull embeddings model (274MB)
ollama pull nomic-embed-text

# Verify models are installed
ollama list

# Expected output:
# NAME                SIZE      MODIFIED
# llama2              3.8GB     2 minutes ago
# nomic-embed-text    274MB     2 minutes ago
```

### Step 6: Setup PostgreSQL Database

```powershell
# Connect to PostgreSQL
psql -U postgres

# Create analytics database
CREATE DATABASE analytics_db;

# Exit psql
\q
```

**Or use direct commands:**

```powershell
# Create database in one command
psql -U postgres -c "CREATE DATABASE analytics_db;"

# Load schema
psql -U postgres -d analytics_db -f "database\schema.sql"

# Load sample data
psql -U postgres -d analytics_db -f "database\sample_data.sql"

# Setup read-only role
psql -U postgres -d analytics_db -f "database\read_only_role.sql"

# Verify database
psql -U postgres -d analytics_db -c "SELECT COUNT(*) FROM customers;"

# Expected output:
# count
# -------
#    10
# (1 row)
```

**If you get authentication errors:**

```powershell
# Start PostgreSQL service
# Windows: Services app → PostgreSQL → Start

# Or reset PostgreSQL password
psql -U postgres -c "ALTER USER postgres PASSWORD 'your_password';"

# Then update .env with new password
```

### Step 7: Configure Environment Variables

```powershell
# Copy template
Copy-Item config\env.example .env

# Edit with your settings
notepad .env

# Or use VS Code
code .env
```

**Edit `.env` with these values:**

```env
# Server
NODE_ENV=development
PORT=3001
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=analytics_db
DB_USER=postgres
DB_PASSWORD=postgres

# Ollama LLM
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# Security
ENCRYPTION_KEY=your_encryption_key_32_chars_min
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Features
ENABLE_PII_MASKING=true
AUDIT_LOGGING=true
QUERY_VALIDATION=true
RATE_LIMITING=true

# Logging
LOG_LEVEL=debug
```

**⚠️ Important: Change JWT_SECRET and ENCRYPTION_KEY in production!**

### Step 8: Start Development Server

```powershell
# Start backend with auto-reload
npm run dev

# Expected output:
# ✓ TypeScript compiled successfully
# 🚀 Sept Innovation Backend
# 📊 Server running on http://localhost:3001
# 🔍 Checking Ollama health...
# ✅ Ollama connected
# 📗 Health check: GET /health
# 
# Server ready! Press Ctrl+C to stop
```

**Keep this window open while developing.**

### Step 9: Verify Everything Works

**In a new PowerShell window:**

```powershell
# Health check
curl http://localhost:3001/health

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2025-03-05T14:30:45.123Z",
#   "environment": "development",
#   "uptime": 45
# }
```

**Test the API:**

```powershell
# Get database schema
curl http://localhost:3001/api/analytics/schema `
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Or test with sample request
$headers = @{
  "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  "Content-Type" = "application/json"
}

$body = @{
  query = "Show top 5 customers by revenue"
  limit = 5
} | ConvertTo-Json

curl -Method POST `
  -Uri "http://localhost:3001/api/analytics/query" `
  -Headers $headers `
  -Body $body
```

---

## Common Commands

```powershell
# Development
npm run dev              # Start with auto-reload
npm run build            # Compile TypeScript
npm run start            # Production start
npm test                 # Run tests (when available)
npm run lint             # Check code quality

# Database
npm run db:setup         # Create schema
npm run db:seed          # Load sample data
npm run db:reset         # Drop and recreate

# Debugging
npm run dev:debug        # Start with Node debugger
npm run inspect           # Inspect running process

# Analytics
npm run analytics:start  # Start Python engine (if setup)
```

---

## Development Workflow

### 1. File Watching & Auto-Reload

Terminal stays open with `npm run dev`. Changes auto-compile:

```powershell
npm run dev

# Edit a file in src/
# File is auto-compiled
# No need to restart server
```

### 2. Testing API Endpoints

```powershell
# Using curl (PowerShell)
$token = "your_jwt_token_here"

# Health check
curl http://localhost:3001/health

# Query endpoint
curl -X POST http://localhost:3001/api/analytics/query `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $token" `
  -d '{"query":"Show top 10 products"}'

# Validate query (no execution)
curl -X POST http://localhost:3001/api/analytics/validate `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $token" `
  -d '{"sql":"SELECT * FROM products LIMIT 10"}'

# Get database schema
curl http://localhost:3001/api/analytics/schema `
  -H "Authorization: Bearer $token"
```

### 3. Checking Logs

```powershell
# View real-time logs
tail -f logs/combined.log

# View error logs
tail -f logs/error.log

# View audit trail
tail -f logs/audit-trail.jsonl

# Filter logs
Select-String "ERROR" logs/error.log
Select-String "QUERY" logs/audit-trail.jsonl
```

### 4. Database Inspection

```powershell
# Connect to database
psql -U postgres -d analytics_db

# List tables
\dt

# View sales data
SELECT * FROM sales LIMIT 5;

# View audit logs
SELECT * FROM audit_logs LIMIT 5;

# Check user sessions
SELECT * FROM user_sessions;

# Exit
\q
```

---

## Production Deployment

### Step 1: Build for Production

```powershell
# Production build (minified, optimized)
npm run build

# Verify build
ls dist/src/
```

### Step 2: Start Production Server

```powershell
# Set environment
$env:NODE_ENV = "production"
$env:PORT = "3001"

# Start server (no auto-reload)
npm start

# Expected output:
# 🚀 Sept Innovation Backend
# 📊 Server running on http://localhost:3001
```

### Step 3: Setup Systemd Service (Linux)

Create `/etc/systemd/system/sept-innovation.service`:

```ini
[Unit]
Description=Sept Innovation Backend
After=network.target postgresql.service ollama.service

[Service]
Type=simple
User=sept-user
WorkingDirectory=/opt/sept-innovation/backend
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable sept-innovation
sudo systemctl start sept-innovation
sudo systemctl status sept-innovation
```

### Step 4: Setup Reverse Proxy (Nginx)

Create `/etc/nginx/sites-available/sept-innovation`:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/sept-innovation /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## Troubleshooting

### Problem: Port 3001 Already in Use

```powershell
# Find process using port
Get-NetTCPConnection -LocalPort 3001 | Select-Object -Property OwningProcess

# Kill process (replace PID with actual)
Stop-Process -Id PID -Force

# Or use different port
$env:PORT = 3002
npm run dev
```

### Problem: Cannot Connect to Ollama

```powershell
# Check if Ollama is running
curl http://localhost:11434/api/health

# Start Ollama
ollama serve

# Check firewall
# Ensure port 11434 is not blocked

# Verify in .env
# OLLAMA_BASE_URL=http://localhost:11434
```

### Problem: PostgreSQL Connection Failed

```powershell
# Check PostgreSQL is running
psql -U postgres -c "SELECT 1"

# Check credentials in .env
# Verify DB_HOST, DB_USER, DB_PASSWORD

# Check database exists
psql -l | Select-String analytics_db
```

### Problem: npm install Fails

```powershell
# Clear cache
npm cache clean --force

# Delete node_modules
Remove-Item -Path node_modules -Recurse -Force

# Reinstall
npm install
```

### Problem: TypeScript Compilation Error

```powershell
# Check TypeScript version
npm list typescript

# Rebuild
npm run build

# Check errors
npm run build 2>&1 | head -20
```

---

## Monitoring & Health Checks

### Health Check Endpoint

```powershell
curl http://localhost:3001/health

# Returns:
# {
#   "status": "ok",
#   "timestamp": "2025-03-05T14:30:45.123Z",
#   "environment": "development",
#   "uptime": 125
# }
```

### Metrics Endpoint (When Available)

```powershell
curl http://localhost:3001/metrics
```

### Log Monitoring

```powershell
# Watch all logs
Get-Content logs/combined.log -Wait

# Watch errors only
Get-Content logs/error.log -Wait -Tail 10 | Select-String "ERROR"

# Watch audit trail (JSON)
Get-Content logs/audit-trail.jsonl -Wait | ConvertFrom-Json
```

---

## Performance Tips

### 1. Connection Pooling

Already configured in `dbClient.ts`:
- **Max connections**: 20
- **Idle timeout**: 30 seconds
- **Connection timeout**: 30 seconds

### 2. Query Caching

Enable in `.env`:
```env
QUERY_CACHE_ENABLED=true
QUERY_CACHE_TTL=3600
```

### 3. Rate Limiting

Already enabled:
- **Limit**: 100 requests per 15 minutes
- **Window**: 15 minutes
- **Per IP**: Applied

### 4. PII Masking

Can be disabled if not needed:
```env
ENABLE_PII_MASKING=false
```

---

## Next Steps

1. **Read API Documentation**: `docs/architecture.md`
2. **Review Security**: `docs/security-model.md`
3. **Check Data Flow**: `docs/data-flow.md`
4. **Start Frontend**: `../frontend/` folder
5. **Setup Monitoring**: Configure logging & alerts

---

## Support

**Stuck?** Check:
- ✅ All prerequisites installed
- ✅ Ollama running on port 11434
- ✅ PostgreSQL running on port 5432
- ✅ Correct `.env` values
- ✅ Logs in `logs/` folder
- ✅ `docs/` folder for detailed guides

**Verify with:**
```powershell
# Check server
curl http://localhost:3001/health

# Check Ollama
curl http://localhost:11434/api/health

# Check PostgreSQL
psql -U postgres -c "SELECT 1"
```

Happy coding! 🚀
