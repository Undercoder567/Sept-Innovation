BEGIN;

TRUNCATE TABLE
  customer_activity,
  financial_metrics,
  inventory_movements,
  sales,
  employees,
  products,
  customers,
  query_history,
  query_cache,
  user_sessions,
  audit_logs
RESTART IDENTITY;
-- ============================================================================
-- Sept Innovation: Sample Data
-- Realistic business data for development, testing, and demos
-- ============================================================================

-- ============================================================================
-- SALES DATA - Monthly sales transactions with products and customers
-- ============================================================================

INSERT INTO sales (order_id, customer_id, product_id, quantity, amount, order_date, status, region, channel) VALUES
-- Q1 2024 - Strong start
('ORD-2024-001', 'CUST-001', 'PROD-A01', 5, 2500.00, '2024-01-05', 'completed', 'North America', 'online'),
('ORD-2024-002', 'CUST-002', 'PROD-B02', 3, 1800.00, '2024-01-08', 'completed', 'Europe', 'retail'),
('ORD-2024-003', 'CUST-003', 'PROD-A01', 2, 1000.00, '2024-01-15', 'completed', 'Asia Pacific', 'online'),
('ORD-2024-004', 'CUST-001', 'PROD-C03', 1, 5000.00, '2024-01-20', 'completed', 'North America', 'retail'),
('ORD-2024-005', 'CUST-004', 'PROD-B02', 4, 2400.00, '2024-01-25', 'completed', 'Europe', 'online'),

-- Q1 continued
('ORD-2024-006', 'CUST-005', 'PROD-A01', 6, 3000.00, '2024-02-03', 'completed', 'North America', 'online'),
('ORD-2024-007', 'CUST-002', 'PROD-C03', 2, 10000.00, '2024-02-10', 'completed', 'Europe', 'enterprise'),
('ORD-2024-008', 'CUST-006', 'PROD-B02', 5, 3000.00, '2024-02-15', 'completed', 'Asia Pacific', 'retail'),
('ORD-2024-009', 'CUST-003', 'PROD-A01', 3, 1500.00, '2024-02-20', 'completed', 'North America', 'online'),
('ORD-2024-010', 'CUST-007', 'PROD-B02', 2, 1200.00, '2024-02-28', 'completed', 'Europe', 'online'),

-- Q2 2024 - Growth acceleration
('ORD-2024-011', 'CUST-004', 'PROD-A01', 8, 4000.00, '2024-03-05', 'completed', 'North America', 'retail'),
('ORD-2024-012', 'CUST-008', 'PROD-C03', 1, 5000.00, '2024-03-12', 'completed', 'Europe', 'enterprise'),
('ORD-2024-013', 'CUST-001', 'PROD-B02', 4, 2400.00, '2024-03-18', 'completed', 'Asia Pacific', 'online'),
('ORD-2024-014', 'CUST-005', 'PROD-A01', 7, 3500.00, '2024-03-25', 'completed', 'North America', 'retail'),

('ORD-2024-015', 'CUST-009', 'PROD-B02', 5, 3000.00, '2024-04-02', 'completed', 'Europe', 'online'),
('ORD-2024-016', 'CUST-002', 'PROD-A01', 10, 5000.00, '2024-04-10', 'completed', 'North America', 'enterprise'),
('ORD-2024-017', 'CUST-006', 'PROD-C03', 2, 10000.00, '2024-04-15', 'completed', 'Asia Pacific', 'enterprise'),
('ORD-2024-018', 'CUST-010', 'PROD-B02', 3, 1800.00, '2024-04-22', 'completed', 'Europe', 'retail'),
('ORD-2024-019', 'CUST-003', 'PROD-A01', 6, 3000.00, '2024-04-28', 'completed', 'North America', 'online'),

('ORD-2024-020', 'CUST-007', 'PROD-C03', 1, 5000.00, '2024-05-05', 'completed', 'Europe', 'enterprise'),
('ORD-2024-021', 'CUST-008', 'PROD-B02', 4, 2400.00, '2024-05-12', 'completed', 'Asia Pacific', 'online'),
('ORD-2024-022', 'CUST-004', 'PROD-A01', 9, 4500.00, '2024-05-18', 'completed', 'North America', 'retail'),
('ORD-2024-023', 'CUST-009', 'PROD-C03', 3, 15000.00, '2024-05-25', 'completed', 'Europe', 'enterprise'),

-- Q3 2024 - Peak season
('ORD-2024-024', 'CUST-001', 'PROD-B02', 6, 3600.00, '2024-06-03', 'completed', 'North America', 'online'),
('ORD-2024-025', 'CUST-005', 'PROD-A01', 12, 6000.00, '2024-06-10', 'completed', 'Europe', 'retail'),
('ORD-2024-026', 'CUST-010', 'PROD-C03', 2, 10000.00, '2024-06-17', 'completed', 'Asia Pacific', 'enterprise'),
('ORD-2024-027', 'CUST-002', 'PROD-B02', 5, 3000.00, '2024-06-25', 'completed', 'North America', 'online'),

('ORD-2024-028', 'CUST-006', 'PROD-A01', 11, 5500.00, '2024-07-03', 'completed', 'Europe', 'retail'),
('ORD-2024-029', 'CUST-003', 'PROD-C03', 1, 5000.00, '2024-07-08', 'completed', 'North America', 'enterprise'),
('ORD-2024-030', 'CUST-007', 'PROD-B02', 7, 4200.00, '2024-07-15', 'completed', 'Asia Pacific', 'online'),
('ORD-2024-031', 'CUST-008', 'PROD-A01', 10, 5000.00, '2024-07-22', 'completed', 'Europe', 'retail'),
('ORD-2024-032', 'CUST-004', 'PROD-B02', 4, 2400.00, '2024-07-28', 'completed', 'North America', 'online'),

('ORD-2024-033', 'CUST-009', 'PROD-A01', 13, 6500.00, '2024-08-05', 'completed', 'Europe', 'retail'),
('ORD-2024-034', 'CUST-001', 'PROD-C03', 2, 10000.00, '2024-08-12', 'completed', 'Asia Pacific', 'enterprise'),
('ORD-2024-035', 'CUST-005', 'PROD-B02', 8, 4800.00, '2024-08-18', 'completed', 'North America', 'online'),
('ORD-2024-036', 'CUST-010', 'PROD-A01', 9, 4500.00, '2024-08-25', 'completed', 'Europe', 'retail'),

-- Q4 2024 - Holiday surge
('ORD-2024-037', 'CUST-002', 'PROD-B02', 10, 6000.00, '2024-09-03', 'completed', 'North America', 'online'),
('ORD-2024-038', 'CUST-006', 'PROD-A01', 14, 7000.00, '2024-09-10', 'completed', 'Europe', 'retail'),
('ORD-2024-039', 'CUST-003', 'PROD-C03', 3, 15000.00, '2024-09-17', 'completed', 'Asia Pacific', 'enterprise'),
('ORD-2024-040', 'CUST-007', 'PROD-B02', 6, 3600.00, '2024-09-24', 'completed', 'North America', 'online'),

('ORD-2024-041', 'CUST-008', 'PROD-A01', 15, 7500.00, '2024-10-02', 'completed', 'Europe', 'retail'),
('ORD-2024-042', 'CUST-004', 'PROD-C03', 1, 5000.00, '2024-10-08', 'completed', 'North America', 'enterprise'),
('ORD-2024-043', 'CUST-009', 'PROD-B02', 9, 5400.00, '2024-10-15', 'completed', 'Asia Pacific', 'online'),
('ORD-2024-044', 'CUST-001', 'PROD-A01', 11, 5500.00, '2024-10-22', 'completed', 'Europe', 'retail'),

('ORD-2024-045', 'CUST-005', 'PROD-B02', 12, 7200.00, '2024-11-05', 'completed', 'North America', 'online'),
('ORD-2024-046', 'CUST-010', 'PROD-A01', 16, 8000.00, '2024-11-12', 'completed', 'Europe', 'retail'),
('ORD-2024-047', 'CUST-002', 'PROD-C03', 2, 10000.00, '2024-11-20', 'completed', 'Asia Pacific', 'enterprise'),
('ORD-2024-048', 'CUST-006', 'PROD-B02', 7, 4200.00, '2024-11-27', 'completed', 'North America', 'online'),

('ORD-2024-049', 'CUST-003', 'PROD-A01', 17, 8500.00, '2024-12-03', 'completed', 'Europe', 'retail'),
('ORD-2024-050', 'CUST-007', 'PROD-C03', 2, 10000.00, '2024-12-10', 'completed', 'North America', 'enterprise'),

-- 2025 Q1 - New year momentum
('ORD-2025-001', 'CUST-008', 'PROD-B02', 11, 6600.00, '2025-01-08', 'completed', 'Europe', 'online'),
('ORD-2025-002', 'CUST-004', 'PROD-A01', 18, 9000.00, '2025-01-15', 'completed', 'Asia Pacific', 'retail'),
('ORD-2025-003', 'CUST-009', 'PROD-C03', 1, 5000.00, '2025-01-22', 'completed', 'North America', 'enterprise'),
('ORD-2025-004', 'CUST-001', 'PROD-B02', 13, 7800.00, '2025-01-29', 'completed', 'Europe', 'online'),

('ORD-2025-005', 'CUST-010', 'PROD-A01', 19, 9500.00, '2025-02-05', 'completed', 'North America', 'retail'),
('ORD-2025-006', 'CUST-002', 'PROD-B02', 14, 8400.00, '2025-02-12', 'completed', 'Asia Pacific', 'online'),
('ORD-2025-007', 'CUST-005', 'PROD-C03', 3, 15000.00, '2025-02-19', 'completed', 'Europe', 'enterprise'),
('ORD-2025-008', 'CUST-006', 'PROD-A01', 20, 10000.00, '2025-02-26', 'completed', 'North America', 'retail'),

('ORD-2025-009', 'CUST-003', 'PROD-B02', 15, 9000.00, '2025-03-05', 'completed', 'Europe', 'online'),
('ORD-2025-010', 'CUST-007', 'PROD-A01', 21, 10500.00, '2025-03-12', 'completed', 'Asia Pacific', 'retail');

-- ============================================================================
-- CUSTOMER DATA
-- ============================================================================

INSERT INTO customers (customer_id, name, email, phone, company, industry, country, created_at, lifetime_value) VALUES
('CUST-001', 'Acme Corporation', 'contact@acme.com', '+1-555-001-0001', 'Acme Corp', 'Manufacturing', 'United States', '2023-01-15', 45000.00),
('CUST-002', 'TechStart Inc', 'sales@techstart.com', '+1-555-002-0002', 'TechStart', 'Technology', 'United States', '2023-02-20', 52000.00),
('CUST-003', 'Global Logistics Ltd', 'ops@globallog.com', '+44-555-003-0003', 'Global Log', 'Logistics', 'United Kingdom', '2023-03-10', 38000.00),
('CUST-004', 'CloudFirst Solutions', 'info@cloudfirst.com', '+1-555-004-0004', 'CloudFirst', 'Software', 'United States', '2023-04-05', 61000.00),
('CUST-005', 'European Finance Group', 'finance@eufin.com', '+33-555-005-0005', 'EuFin', 'Finance', 'France', '2023-05-12', 55000.00),
('CUST-006', 'Asia Pacific Retail', 'retail@apretail.com', '+65-555-006-0006', 'APR', 'Retail', 'Singapore', '2023-06-18', 48000.00),
('CUST-007', 'Energy Solutions Plus', 'info@energyplus.com', '+1-555-007-0007', 'EnergyPlus', 'Energy', 'United States', '2023-07-22', 42000.00),
('CUST-008', 'Medical Innovations Ltd', 'contact@medinno.com', '+44-555-008-0008', 'MedInno', 'Healthcare', 'United Kingdom', '2023-08-30', 67000.00),
('CUST-009', 'Fashion & Style Co', 'orders@fashionstyle.com', '+1-555-009-0009', 'F&S Co', 'Fashion', 'United States', '2023-09-14', 39000.00),
('CUST-010', 'Premium Beverages International', 'sales@prebev.com', '+1-555-010-0010', 'PreBev', 'Beverages', 'United States', '2023-10-25', 71000.00);

-- ============================================================================
-- PRODUCT DATA
-- ============================================================================

INSERT INTO products (product_id, name, category, price, cost, stock_quantity, supplier_id) VALUES
('PROD-A01', 'Standard Package', 'Service', 500.00, 200.00, 100, 'SUP-001'),
('PROD-B02', 'Professional Package', 'Service', 600.00, 250.00, 75, 'SUP-001'),
('PROD-C03', 'Enterprise Package', 'Service', 5000.00, 1800.00, 20, 'SUP-002'),
('PROD-D04', 'Premium Add-on', 'Add-on', 200.00, 50.00, 200, 'SUP-001'),
('PROD-E05', 'Support Plus', 'Service', 1000.00, 400.00, 50, 'SUP-002');

-- ============================================================================
-- INVENTORY TRACKING
-- ============================================================================

INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_date, notes) VALUES
('PROD-A01', 'PURCHASE', 100, '2024-01-01', 'Q1 initial stock'),
('PROD-A01', 'SALE', -20, '2024-01-31', 'January sales'),
('PROD-A01', 'SALE', -18, '2024-02-28', 'February sales'),
('PROD-A01', 'SALE', -22, '2024-03-31', 'March sales'),
('PROD-A01', 'PURCHASE', 50, '2024-04-01', 'Q2 replenishment'),

('PROD-B02', 'PURCHASE', 75, '2024-01-01', 'Q1 initial stock'),
('PROD-B02', 'SALE', -15, '2024-01-31', 'January sales'),
('PROD-B02', 'SALE', -16, '2024-02-28', 'February sales'),
('PROD-B02', 'SALE', -18, '2024-03-31', 'March sales'),
('PROD-B02', 'PURCHASE', 40, '2024-04-01', 'Q2 replenishment'),

('PROD-C03', 'PURCHASE', 20, '2024-01-01', 'Q1 initial stock'),
('PROD-C03', 'SALE', -2, '2024-01-31', 'January sales'),
('PROD-C03', 'SALE', -3, '2024-02-28', 'February sales'),
('PROD-C03', 'SALE', -2, '2024-03-31', 'March sales'),
('PROD-C03', 'PURCHASE', 15, '2024-04-01', 'Q2 replenishment');

-- ============================================================================
-- EMPLOYEE & REVENUE DATA
-- ============================================================================

INSERT INTO employees (employee_id, name, email, department, role, hire_date, salary, manager_id) VALUES
('EMP-001', 'Sarah Chen', 'sarah.chen@company.com', 'Sales', 'Sales Director', '2020-01-15', 95000.00, NULL),
('EMP-002', 'James Rodriguez', 'james.rodriguez@company.com', 'Sales', 'Account Executive', '2021-03-20', 65000.00, 'EMP-001'),
('EMP-003', 'Emily Watson', 'emily.watson@company.com', 'Sales', 'Account Executive', '2021-06-10', 65000.00, 'EMP-001'),
('EMP-004', 'Michael Chang', 'michael.chang@company.com', 'Operations', 'Operations Manager', '2020-09-01', 80000.00, NULL),
('EMP-005', 'Lisa Anderson', 'lisa.anderson@company.com', 'Finance', 'Finance Manager', '2019-11-15', 85000.00, NULL),
('EMP-006', 'Robert Taylor', 'robert.taylor@company.com', 'Engineering', 'Engineering Lead', '2020-02-01', 105000.00, NULL),
('EMP-007', 'Jennifer Lee', 'jennifer.lee@company.com', 'Marketing', 'Marketing Manager', '2021-01-20', 75000.00, NULL),
('EMP-008', 'David Martinez', 'david.martinez@company.com', 'Sales', 'Sales Development Rep', '2023-05-15', 45000.00, 'EMP-001'),
('EMP-009', 'Sophie Garcia', 'sophie.garcia@company.com', 'Operations', 'Operations Analyst', '2022-07-10', 55000.00, 'EMP-004'),
('EMP-010', 'Chris Thompson', 'chris.thompson@company.com', 'Engineering', 'Senior Engineer', '2019-08-01', 115000.00, 'EMP-006');

-- ============================================================================
-- FINANCIAL PERFORMANCE DATA
-- ============================================================================

INSERT INTO financial_metrics (metric_date, metric_type, value, category, notes) VALUES
-- Revenue by month 2024
('2024-01-31', 'REVENUE', 18700.00, 'Monthly', 'Q1 January revenue'),
('2024-02-29', 'REVENUE', 27200.00, 'Monthly', 'Q1 February revenue'),
('2024-03-31', 'REVENUE', 35000.00, 'Monthly', 'Q1 March revenue'),
('2024-04-30', 'REVENUE', 42100.00, 'Monthly', 'Q2 April revenue'),
('2024-05-31', 'REVENUE', 47500.00, 'Monthly', 'Q2 May revenue'),
('2024-06-30', 'REVENUE', 52300.00, 'Monthly', 'Q2 June revenue'),
('2024-07-31', 'REVENUE', 56800.00, 'Monthly', 'Q3 July revenue'),
('2024-08-31', 'REVENUE', 61200.00, 'Monthly', 'Q3 August revenue'),
('2024-09-30', 'REVENUE', 64500.00, 'Monthly', 'Q3 September revenue'),
('2024-10-31', 'REVENUE', 68900.00, 'Monthly', 'Q4 October revenue'),
('2024-11-30', 'REVENUE', 73200.00, 'Monthly', 'Q4 November revenue'),
('2024-12-31', 'REVENUE', 78400.00, 'Monthly', 'Q4 December revenue'),

-- COGS by month 2024
('2024-01-31', 'COGS', 6500.00, 'Monthly', 'Q1 January COGS'),
('2024-02-29', 'COGS', 9200.00, 'Monthly', 'Q1 February COGS'),
('2024-03-31', 'COGS', 11800.00, 'Monthly', 'Q1 March COGS'),
('2024-04-30', 'COGS', 13700.00, 'Monthly', 'Q2 April COGS'),
('2024-05-31', 'COGS', 15300.00, 'Monthly', 'Q2 May COGS'),
('2024-06-30', 'COGS', 16800.00, 'Monthly', 'Q2 June COGS'),
('2024-07-31', 'COGS', 18500.00, 'Monthly', 'Q3 July COGS'),
('2024-08-31', 'COGS', 19900.00, 'Monthly', 'Q3 August COGS'),
('2024-09-30', 'COGS', 21000.00, 'Monthly', 'Q3 September COGS'),
('2024-10-31', 'COGS', 22300.00, 'Monthly', 'Q4 October COGS'),
('2024-11-30', 'COGS', 23700.00, 'Monthly', 'Q4 November COGS'),
('2024-12-31', 'COGS', 25200.00, 'Monthly', 'Q4 December COGS'),

-- 2025 Q1
('2025-01-31', 'REVENUE', 81500.00, 'Monthly', 'Q1 January 2025 revenue'),
('2025-02-28', 'REVENUE', 85200.00, 'Monthly', 'Q1 February 2025 revenue'),
('2025-03-31', 'REVENUE', 89300.00, 'Monthly', 'Q1 March 2025 revenue'),
('2025-01-31', 'COGS', 26300.00, 'Monthly', 'Q1 January 2025 COGS'),
('2025-02-28', 'COGS', 27400.00, 'Monthly', 'Q1 February 2025 COGS'),
('2025-03-31', 'COGS', 28700.00, 'Monthly', 'Q1 March 2025 COGS'),

-- Operating expenses
('2024-01-31', 'OPEX', 8000.00, 'Monthly', 'Fixed operating expenses'),
('2024-02-28', 'OPEX', 8000.00, 'Monthly', 'Fixed operating expenses'),
('2024-03-31', 'OPEX', 8500.00, 'Monthly', 'Fixed + variable'),
('2024-04-30', 'OPEX', 9000.00, 'Monthly', 'Scaling operations'),
('2024-05-31', 'OPEX', 9200.00, 'Monthly', 'Scaling operations'),
('2024-06-30', 'OPEX', 9500.00, 'Monthly', 'Scaling operations'),
('2024-07-31', 'OPEX', 10000.00, 'Monthly', 'Peak season staffing'),
('2024-08-31', 'OPEX', 10200.00, 'Monthly', 'Peak season staffing'),
('2024-09-30', 'OPEX', 10500.00, 'Monthly', 'Peak season staffing'),
('2024-10-31', 'OPEX', 10800.00, 'Monthly', 'Holiday prep'),
('2024-11-30', 'OPEX', 11000.00, 'Monthly', 'Holiday season'),
('2024-12-31', 'OPEX', 11500.00, 'Monthly', 'Holiday season'),
('2025-01-31', 'OPEX', 11200.00, 'Monthly', 'Post-holiday normalization'),
('2025-02-28', 'OPEX', 11500.00, 'Monthly', 'Normal operations'),
('2025-03-31', 'OPEX', 11800.00, 'Monthly', 'Spring growth'),

-- Quarterly summaries
('2024-03-31', 'QUARTERLY_PROFIT', 20200.00, 'Quarterly', 'Q1 profit margin 25%'),
('2024-06-30', 'QUARTERLY_PROFIT', 27300.00, 'Quarterly', 'Q2 profit margin 23%'),
('2024-09-30', 'QUARTERLY_PROFIT', 31400.00, 'Quarterly', 'Q3 profit margin 22%'),
('2024-12-31', 'QUARTERLY_PROFIT', 35600.00, 'Quarterly', 'Q4 profit margin 21%'),
('2025-03-31', 'QUARTERLY_PROFIT', 38100.00, 'Quarterly', 'Q1 2025 profit margin 20%');

-- ============================================================================
-- CUSTOMER ACTIVITY & ENGAGEMENT
-- ============================================================================

INSERT INTO customer_activity (customer_id, activity_type, activity_date, details) VALUES
('CUST-001', 'LOGIN', '2025-03-05', '{"ip":"192.168.1.1","device":"chrome"}'),
('CUST-001', 'PURCHASE', '2025-03-05', '{"order_id":"ORD-2025-010","amount":9500}'),
('CUST-002', 'LOGIN', '2025-03-04', '{"ip":"192.168.1.2","device":"safari"}'),
('CUST-002', 'SUPPORT_TICKET', '2025-03-03', '{"issue":"billing","severity":"low"}'),
('CUST-003', 'LOGIN', '2025-03-05', '{"ip":"192.168.1.3","device":"chrome"}'),
('CUST-003', 'PAGE_VIEW', '2025-03-05', '{"page":"/pricing","time_on_page":180}'),
('CUST-004', 'LOGIN', '2025-03-02', '{"ip":"192.168.1.4","device":"mobile"}'),
('CUST-005', 'PURCHASE', '2025-03-04', '{"order_id":"ORD-2025-007","amount":15000}'),
('CUST-006', 'LOGIN', '2025-03-05', '{"ip":"192.168.1.5","device":"chrome"}'),
('CUST-007', 'SUPPORT_TICKET', '2025-03-01', '{"issue":"technical","severity":"high"}'),
('CUST-008', 'PURCHASE', '2025-03-05', '{"order_id":"ORD-2025-001","amount":6600}'),
('CUST-009', 'LOGIN', '2025-03-04', '{"ip":"192.168.1.9","device":"firefox"}'),
('CUST-010', 'PURCHASE', '2025-03-04', '{"order_id":"ORD-2025-002","amount":9500}');

-- ============================================================================
-- CONFIRM INSERTS
-- ============================================================================

SELECT 'Sample data loaded successfully' AS status;
SELECT COUNT(*) as sales_records FROM sales;
SELECT COUNT(*) as customer_records FROM customers;
SELECT COUNT(*) as product_records FROM products;
SELECT COUNT(*) as employee_records FROM employees;
SELECT COUNT(*) as financial_records FROM financial_metrics;

COMMIT;

