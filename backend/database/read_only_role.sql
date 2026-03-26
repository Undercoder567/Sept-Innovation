-- Create read-only role for analytics
CREATE ROLE analytics_readonly;

-- Grant minimal permissions
GRANT CONNECT ON DATABASE analytics_db TO analytics_readonly;
GRANT USAGE ON SCHEMA public TO analytics_readonly;

-- Grant SELECT on specific tables
GRANT SELECT ON sales TO analytics_readonly;
GRANT SELECT ON customers TO analytics_readonly;
GRANT SELECT ON products TO analytics_readonly;
GRANT SELECT ON orders TO analytics_readonly;
GRANT SELECT ON transactions TO analytics_readonly;

-- Deny INSERT, UPDATE, DELETE
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM analytics_readonly;

-- Row-level security policies
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Create policies for department-based access
CREATE POLICY sales_department_policy ON sales
  FOR SELECT USING (
    department_id = current_setting('app.current_department')::INT
    OR current_user = 'admin'
  );

CREATE POLICY customers_department_policy ON customers
  FOR SELECT USING (
    department_id = current_setting('app.current_department')::INT
    OR current_user = 'admin'
  );

-- Set up role hierarchies
GRANT analytics_readonly TO app_user;

-- Create audit trigger for data access
CREATE OR REPLACE FUNCTION audit_data_access() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (action, user_id, resource, details)
  VALUES ('DATA_ACCESS', current_user, TG_TABLE_NAME, 
    jsonb_build_object('operation', TG_OP, 'row_id', NEW.id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply audit triggers
CREATE TRIGGER audit_sales_access AFTER SELECT ON sales
  FOR EACH ROW EXECUTE FUNCTION audit_data_access();

-- For PostgreSQL 13+, use more granular audit logging
-- CREATE POLICY audit_select_policy ON sales
--   FOR SELECT USING (true)
--   WITH (log_statement = 'all', log_min_error_statement = 'debug');
