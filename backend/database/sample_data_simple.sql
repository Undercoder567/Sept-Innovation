-- ============================================================================
-- Sept Innovation: Sample Data for Audit and Session Tables
-- ============================================================================

-- Sample audit log entries
INSERT INTO audit_logs (action, user_id, resource, details, severity, status) VALUES
('LOGIN', 'user-001', 'AUTH', '{"method":"jwt","ip":"192.168.1.100"}', 'INFO', 'SUCCESS'),
('QUERY_EXECUTE', 'user-001', 'ANALYTICS_API', '{"query":"SELECT revenue FROM sales","duration_ms":145}', 'INFO', 'SUCCESS'),
('DATA_ACCESS', 'user-002', 'ANALYTICS_API', '{"resource":"customer_data","access_level":"READ"}', 'INFO', 'SUCCESS'),
('FAILED_AUTH', 'user-003', 'AUTH', '{"reason":"invalid_token"}', 'WARNING', 'FAILURE'),
('PII_MASKED', 'user-001', 'SECURITY', '{"field":"email","pattern":"email"}', 'INFO', 'SUCCESS'),
('QUERY_CACHE_HIT', 'user-001', 'CACHE', '{"query_hash":"abc123def456"}', 'INFO', 'SUCCESS'),
('ROLE_CHECK', 'user-002', 'SECURITY', '{"role":"ANALYST","permission":"analytics:query:read"}', 'INFO', 'SUCCESS'),
('RATE_LIMIT_HIT', 'user-004', 'SECURITY', '{"limit":"100/15min","current":"101"}', 'WARNING', 'FAILURE'),
('EXPORT_REQUEST', 'user-001', 'ANALYTICS_API', '{"format":"csv","rows":5000}', 'INFO', 'SUCCESS'),
('SCHEMA_INTROSPECTION', 'user-002', 'ANALYTICS_API', '{"tables":4,"columns":32}', 'DEBUG', 'SUCCESS');

-- Sample user sessions
INSERT INTO user_sessions (user_id, ip_address, user_agent, is_active) VALUES
('user-001', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', true),
('user-002', '192.168.1.101', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true),
('user-003', '192.168.1.102', 'Mozilla/5.0 (X11; Linux x86_64)', true),
('user-004', '192.168.1.103', 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)', false);

-- Sample query cache entries
INSERT INTO query_cache (query_hash, user_id, original_query, generated_sql, result_data, execution_time, record_count) VALUES
('hash_001', 'user-001', 'Show me sales trends', 'SELECT DATE_TRUNC(''month'', created_at) as month, SUM(amount) FROM sales GROUP BY month ORDER BY month', '{"rows":12,"avg":45000}', 234, 12),
('hash_002', 'user-002', 'Top customers by revenue', 'SELECT customer_id, SUM(amount) as total FROM sales GROUP BY customer_id ORDER BY total DESC LIMIT 10', '{"rows":10,"max":500000}', 156, 10),
('hash_003', 'user-001', 'Product performance', 'SELECT product_id, COUNT(*) as sales_count, SUM(amount) as revenue FROM sales GROUP BY product_id', '{"rows":3,"total_revenue":1200000}', 89, 3),
('hash_004', 'user-003', 'Regional breakdown', 'SELECT region, SUM(amount) as revenue FROM sales GROUP BY region ORDER BY revenue DESC', '{"rows":5}', 112, 5);

-- Sample query history entries
INSERT INTO query_history (user_id, original_query, generated_sql, execution_time, record_count, success) VALUES
('user-001', 'sales by month', 'SELECT DATE_TRUNC(''month'', created_at) as month, SUM(amount) FROM sales GROUP BY month', 234, 12, true),
('user-001', 'top products', 'SELECT product_id, COUNT(*) as count FROM sales GROUP BY product_id ORDER BY count DESC', 145, 3, true),
('user-002', 'customer acquisition', 'SELECT DATE_TRUNC(''month'', created_at) as month, COUNT(DISTINCT customer_id) FROM sales GROUP BY month', 267, 12, true),
('user-002', 'churn analysis', 'SELECT * FROM sales WHERE status = ''cancelled''', 89, 5, true),
('user-003', 'invalid query', 'SELECT * FROM nonexistent_table', 0, 0, false);

-- Verify data loaded
SELECT 'Data loaded successfully' as status;
SELECT COUNT(*) as audit_records FROM audit_logs;
SELECT COUNT(*) as session_records FROM user_sessions;
SELECT COUNT(*) as cache_records FROM query_cache;
SELECT COUNT(*) as history_records FROM query_history;
