# NL2SQL Quick Reference - User Guide

## How to Use Natural Language Queries

### Switch to Query Mode

1. Open the ChatBox (bottom right)
2. Click **"Query"** button (next to Chat)
3. Start typing your question

### Supported Query Types

#### 🔍 Search Queries
Find specific records:

```
"find all orders from 2024"
"show me invoices from customer ABC"
"list all products in category Electronics"
"find orders between January and March"
```

#### 📊 Aggregation Queries
Get totals and summaries:

```
"total revenue by region"
"how many orders per month?"
"average order value by customer"
"total profit from software products"
```

#### 📈 Statistical Queries
Analyze trends and patterns:

```
"what is the expected maintenance interval?"
"average delivery time trend"
"standard deviation of order amounts"
"expected maintenance schedule"
```

## Best Practices

### Do's ✅
- **Be specific**: "orders from customer ABC" not just "orders"
- **Include time periods**: "from 2024" or "from January to March"
- **Use actual table names**: "invoices" instead of "documents"
- **Use common keywords**: "find", "show", "calculate", "count", "total"
- **Ask one thing at a time**: Break complex questions into separate queries

### Don'ts ❌
- **Avoid vague terms**: "data" instead of "customer sales"
- **Don't ask for INSERT/UPDATE**: Only SELECT queries supported
- **Avoid very complex questions**: "top 10 customers with most orders including their products and regions" might fail
- **Don't use abbreviations**: Use full names like "invoice" not "inv"
- **Avoid multiple questions**: Ask one query per request

## Example Conversations

### Example 1: Find Orders
```
You: "find all orders from 2024"

System:
Generated SQL: SELECT TOP 100 id, amount, created_at FROM auftrag 
              WHERE YEAR(created_at) = 2024

Results: Found 245 records in 234ms
```

### Example 2: Calculate Revenue
```
You: "what is total revenue by region in 2024?"

System:
Generated SQL: SELECT TOP 50 region, SUM(amount) AS total_revenue 
              FROM auftrag 
              WHERE YEAR(created_at) = 2024 
              GROUP BY region

Results: Found 8 records in 567ms
```

### Example 3: Error with Suggestions
```
You: "show data from sales_data"

System:
❌ Table 'sales_data' does not exist

💡 Suggestions:
1. Did you mean 'auftrag' (orders)?
2. Try specifying exact table names
3. Contact your administrator
```

## Understanding Results

### Success Screen

```
Found 45 records in 234ms          ← Result summary
┌─────────────────────────┐
│ SQL Query               │        ← Generated SQL (for reference)
│ SELECT TOP 100 ...      │
│ FROM auftrag            │
│ WHERE ...               │
└─────────────────────────┘

[Results displayed as table or chart]
```

### Error Screen with Fallback

```
❌ Generated query contains errors

💡 Suggestions:
1. Try using 'orders' instead of 'sales'
2. Check if columns mentioned exist
3. Contact your administrator
```

## Common Questions

### Q: Why is my query returning no results?

**A:** Possible reasons:
- Time period has no data (try different date range)
- Customer/product doesn't exist (check exact name)
- Filter too restrictive (broaden criteria)

**Solution:** Remove or relax filters

### Q: Can I use dates like "last month" or "yesterday"?

**A:** Not directly. Use specific dates:
- ❌ "orders from last month"
- ✅ "orders from March 2024"
- ✅ "orders from 2024-03-01 to 2024-03-31"

### Q: Why did I get an error about table names?

**A:** The table name doesn't exist in the database.

**Solutions:**
- Use English aliases: "orders" instead of "auftrag"
- Check the suggested correct names
- Contact your admin for available tables

### Q: Can I ask complex multi-part questions?

**A:** Not recommended. Break them down:

❌ "Show me top customers with their total orders and revenue"

✅ Split into:
1. "total revenue by customer"
2. "count of orders per customer"

### Q: Is my data secure?

**A:** Yes! 
- Only SELECT (read-only) queries allowed
- All values parameterized (prevent SQL injection)
- User ID logged for audit trail
- Permissions checked for each query

### Q: How long does a query take?

**A:** 
- **First time**: 3-7 seconds (generating SQL + executing)
- **Repeat query**: <50ms (cached result)

## Table Reference

### Common Business Tables

| User Says | System Uses | What It Contains |
|-----------|------------|------------------|
| orders | auftrag | Sales order headers |
| order details/lines | lsposten | Line items in orders |
| invoices | rechnung | Invoice headers |
| invoice lines | anposten | Line items in invoices |
| customers | kunde | Customer master data |
| products | artbest | Product information |
| maintenance | wartung | Maintenance schedule |
| warehouses | lager | Warehouse definitions |

## Tips & Tricks

### Tip 1: Use Date Filters
Queries are faster with date filters:
```
"find orders from January 2024"  ← Fast
"find all orders ever"           ← Slow (larger result set)
```

### Tip 2: Be Specific with Names
```
"orders from customer ABC"       ← Good (specific ID)
"orders from a company"          ← Vague (might return nothing)
```

### Tip 3: Use Meaningful Aggregations
```
"total revenue by month"         ← Clear grouping
"how much did we sell?"          ← No grouping (single number)
```

### Tip 4: Start Simple
```
First query: "find orders from 2024"
Once that works, try: "total revenue by region in 2024"
```

### Tip 5: Check Generated SQL
The generated SQL is shown for verification:
- Review it before trusting results
- Use it to understand the data better
- Share it with your team for validation

## Troubleshooting

| Issue | Try This |
|-------|----------|
| No results | Broaden date range, remove filters |
| "Table not found" | Use English name (e.g., "orders" not "sales") |
| "Column not found" | Check spelling, use simpler column names |
| Timeout | Use date filter to reduce data, try simpler query |
| Unexpected results | Verify generated SQL, check data |

## Getting Help

### If Query Fails
1. Read the error message
2. Try the suggested alternatives
3. Contact your administrator with:
   - Original question you asked
   - Error message received
   - Generated SQL (if visible)

### For Data Questions
1. Check available tables (ask admin)
2. Verify exact names/IDs you're searching for
3. Ask simpler questions first

### For Feature Requests
- Request more table mappings
- Suggest new query types
- Report bugs or unexpected behavior

## Example Workflow

### Scenario: "What happened to our revenue in Q1 2024?"

**Step 1:** Ask simple question first
```
"total revenue in Q1 2024?"
→ Success: See $X in total
```

**Step 2:** Drill down by dimension
```
"total revenue by product in Q1 2024?"
→ See which products drove revenue
```

**Step 3:** Further analysis
```
"total revenue by customer in Q1 2024?"
→ See which customers bought most
```

**Step 4:** Find outliers
```
"revenue trend by month in 2024?"
→ Compare Q1 to other quarters

## Limitations

### What's NOT Supported Yet

❌ JOIN multiple tables (uses main table only)
❌ Complex window functions (PARTITION BY, LAG, LEAD)
❌ INSERT, UPDATE, DELETE operations
❌ Creating views or stored procedures
❌ Multi-step workflows
❌ Real-time streaming data

### When to Use Other Tools

| Use NL2SQL For | Use SQL Editor For |
|---------------|--------------------|
| Quick exploration | Complex multi-join analysis |
| Familiar business questions | Ad-hoc technical queries |
| Simple aggregations | Complex calculations |
| Standard reports | Custom reports/views |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send query |
| `Shift+Enter` | New line in query |
| `Escape` (fullscreen) | Exit fullscreen |
| ↑/↓ | Navigate message history (if supported) |

## Performance Tips

### For Faster Results

1. **Add date filters**: Reduces data scanned
   ```
   "revenue from 2024" (vs all time)
   ```

2. **Limit results**:
   ```
   "top 10 customers" (vs all customers)
   ```

3. **Be specific**:
   ```
   "customer ABC orders" (vs all customers)
   ```

4. **Reuse queries**: Cached results load instantly
   ```
   Same query twice = first slow, second fast
   ```

## Summary

**3-Step Process:**

1. **Type** → Natural language question
2. **System** → Generates SQL, checks for errors
3. **View** → Results with SQL for verification

**Remember:** 
- Start simple, build up complexity
- Use exact names when possible
- Include time periods for context
- Check generated SQL before trusting results

Enjoy exploring your data! 📊✨
