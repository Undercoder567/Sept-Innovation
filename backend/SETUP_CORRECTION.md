# 🔧 Backend Setup - Correct Directory Structure

The `package.json` should be in the **backend root**, not in `src/`. Here's the correct setup:

## Directory Structure

```
backend/
  ├── package.json          ✅ HERE (root of backend)
  ├── tsconfig.json         ✅ HERE
  ├── .eslintrc.json        ✅ HERE
  ├── src/
  │   ├── server.ts
  │   ├── api/
  │   ├── security/
  │   ├── ai/
  │   ├── sql/
  │   ├── analytics/
  │   ├── logs/
  │   ├── middleware/
  │   └── semantic/
  ├── database/
  │   ├── schema.sql
  │   ├── sample_data.sql
  │   └── read_only_role.sql
  ├── config/
  │   ├── env.example
  │   ├── permissions.yaml
  │   └── query_limits.yaml
  ├── ai-engine/
  ├── analytics-engine/
  ├── docs/
  └── logs/
```

## Correct Installation Steps

### Step 1: Navigate to Backend Root (Not src/)

```powershell
# ❌ WRONG - Don't run npm here
cd e:\SeptInnovation\backend\src
npm install

# ✅ CORRECT - Run from backend root
cd e:\SeptInnovation\backend
npm install
```

### Step 2: Install Dependencies from Backend Root

```powershell
cd e:\SeptInnovation\backend

# Install all dependencies
npm install

# Expected output:
# added 120+ packages in 2m

# Verify it worked
npm list express typescript pg
```

### Step 3: Build TypeScript

```powershell
# Compile TypeScript to JavaScript
npm run build

# Check output
ls dist/src/       # Should see server.js and other compiled files
```

### Step 4: Start Development Server

```powershell
# From backend root
npm run dev

# Expected output:
# ✓ TypeScript compiled successfully
# 🚀 Sept Innovation Backend
# 📊 Server running on http://localhost:3001
```

## Verification

```powershell
# Check server is running
curl http://localhost:3001/health

# Should return:
# {
#   "status": "ok",
#   "timestamp": "2025-03-05T14:30:45Z",
#   "environment": "development"
# }
```

## All Available Commands

```powershell
# Development
npm run dev         # Start with auto-reload
npm run build       # Compile TypeScript
npm start           # Production start
npm test            # Run tests
npm run lint        # Check code quality
npm run type-check  # TypeScript validation

# Database
npm run db:setup    # Create schema
npm run db:seed     # Load sample data
npm run db:reset    # Drop and recreate

# Logs
npm run audit-logs  # View audit trail
```

## Troubleshooting

### Problem: "Cannot find module" or "No such file"

**Cause**: npm install run from wrong directory

**Solution**:
```powershell
# Delete wrong installation
cd backend\src
Remove-Item node_modules -Recurse -Force
cd ..

# Install from correct location (backend root)
npm install
```

### Problem: "ts-node: command not found"

**Cause**: TypeScript not installed

**Solution**:
```powershell
# From backend root
npm install --save-dev ts-node typescript

# Or just reinstall everything
npm install
```

### Problem: Port 3001 already in use

**Solution**:
```powershell
# Use different port
$env:PORT = 3002
npm run dev
```

## Summary

| Location | Correct? | What Goes Here |
|----------|----------|----------------|
| `backend/package.json` | ✅ YES | Root npm config |
| `backend/src/package.json` | ❌ NO | DELETE THIS |
| `backend/tsconfig.json` | ✅ YES | TypeScript config |
| `backend/.eslintrc.json` | ✅ YES | Linting config |
| `backend/src/server.ts` | ✅ YES | Main entry point |

**Run all npm commands from `backend/` directory!**
