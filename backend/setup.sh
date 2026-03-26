#!/bin/bash

# Installation and Setup Script
# Run this to set up the backend environment

set -e

echo "🚀 Sept Innovation Backend Setup"
echo "=================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo ""
echo "📦 Installing Node.js dependencies..."
npm install

# Check TypeScript compilation
echo ""
echo "🔨 Building TypeScript..."
npm run build

# Database setup
echo ""
echo "🗄️  Database Setup"
echo "Please ensure PostgreSQL is running and create the database:"
echo ""
echo "  psql -U postgres -c 'CREATE DATABASE analytics_db;'"
echo "  psql -U postgres -d analytics_db < database/schema.sql"
echo "  psql -U postgres -d analytics_db < database/read_only_role.sql"
echo ""
read -p "Press Enter after database setup is complete..."

# Environment configuration
echo ""
echo "⚙️  Configuration Setup"
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp config/env.example .env
    echo "✅ Created .env file. Please edit with your values:"
    echo "   - JWT_SECRET"
    echo "   - Database credentials"
    echo "   - Ollama configuration"
else
    echo "✅ .env file already exists"
fi

# Python analytics engine (optional)
echo ""
echo "🐍 Python Analytics Engine (Optional)"
read -p "Install Python analytics engine? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if ! command -v python3 &> /dev/null; then
        echo "❌ Python 3 is not installed"
    else
        echo "Installing Python dependencies..."
        python3 -m pip install -r analytics-engine/requirements.txt
        echo "✅ Python dependencies installed"
    fi
fi

echo ""
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Review and update .env file with your configuration"
echo "2. Start Ollama: ollama serve"
echo "3. Run the backend: npm run dev"
echo ""
echo "For production deployment, see docs/deployment.md"
