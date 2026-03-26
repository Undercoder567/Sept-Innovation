-- Database Schema SQL
-- Complete schema for analytics platform + demo business data tables

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Core Analytics Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action VARCHAR(100) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  resource VARCHAR(255) NOT NULL,
  details JSONB,
  severity VARCHAR(20) DEFAULT 'INFO',
  ip_address INET,
  status VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS query_cache (
  cache_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(255) NOT NULL,
  original_query TEXT NOT NULL,
  generated_sql TEXT NOT NULL,
  result_data JSONB,
  execution_time INT,
  record_count INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  access_count INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS query_history (
  query_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  original_query TEXT NOT NULL,
  generated_sql TEXT NOT NULL,
  execution_time INT,
  record_count INT,
  success BOOLEAN,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address INET,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true,
  logout_time TIMESTAMP
);

-- ============================================================================
-- Business Demo Tables (used by sample_data.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  customer_id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  company VARCHAR(255),
  industry VARCHAR(100),
  country VARCHAR(100),
  created_at DATE,
  lifetime_value NUMERIC(14,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  product_id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  price NUMERIC(12,2) NOT NULL,
  cost NUMERIC(12,2) NOT NULL,
  stock_quantity INT DEFAULT 0,
  supplier_id VARCHAR(32)
);

CREATE TABLE IF NOT EXISTS sales (
  order_id VARCHAR(32) PRIMARY KEY,
  customer_id VARCHAR(32) NOT NULL,
  product_id VARCHAR(32) NOT NULL,
  quantity INT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  order_date DATE NOT NULL,
  status VARCHAR(32),
  region VARCHAR(100),
  channel VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  movement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(32) NOT NULL,
  movement_type VARCHAR(32) NOT NULL,
  quantity INT NOT NULL,
  reference_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  department VARCHAR(100),
  role VARCHAR(100),
  hire_date DATE,
  salary NUMERIC(12,2),
  manager_id VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS financial_metrics (
  metric_id BIGSERIAL PRIMARY KEY,
  metric_date DATE NOT NULL,
  metric_type VARCHAR(64) NOT NULL,
  value NUMERIC(14,2) NOT NULL,
  category VARCHAR(64),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_activity (
  activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id VARCHAR(32) NOT NULL,
  activity_type VARCHAR(64) NOT NULL,
  activity_date DATE NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_cache_hash ON query_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_cache_user ON query_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_query_cache_expires ON query_cache(expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_history_user ON query_history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON query_history(created_at);
CREATE INDEX IF NOT EXISTS idx_query_history_user_created ON query_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_session_active ON user_sessions(is_active);

CREATE INDEX IF NOT EXISTS idx_sales_order_date ON sales(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_region ON sales(region);

CREATE INDEX IF NOT EXISTS idx_inventory_product_date ON inventory_movements(product_id, reference_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_metric_date ON financial_metrics(metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_metric_type ON financial_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_customer_activity_customer_date ON customer_activity(customer_id, activity_date DESC);

-- ============================================================================
-- Read-only role
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_readonly') THEN
    CREATE ROLE analytics_readonly WITH LOGIN PASSWORD 'secure_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE analytics_db TO analytics_readonly;
GRANT USAGE ON SCHEMA public TO analytics_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO analytics_readonly;

COMMENT ON TABLE audit_logs IS 'Immutable security audit trail for all system actions';
COMMENT ON TABLE query_cache IS 'Caches executed queries for performance';
COMMENT ON TABLE query_history IS 'History of user queries for analysis';
COMMENT ON TABLE user_sessions IS 'User session management and tracking';
