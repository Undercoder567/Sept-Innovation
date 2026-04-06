import { Router, Request, Response } from 'express';
import dotenv from 'dotenv';
import { LLMClient } from '../ai/llmClient';
import { NL2SQLService } from '../ai/nl2sqlService';
import { DatabaseClient } from '../sql/dbClient';
import { requirePermission } from '../security/rbac';
import { tableTranslations } from '../semantic/tableTranslations';
import { getTranslationForGermanName } from './analytics/schemaContext';
import axios from 'axios';

const router = Router();
dotenv.config();

const llmClient = new LLMClient();

export const dbClient = new DatabaseClient({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME || 'ERP42test',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  trustedConnection: process.env.DB_TRUSTED_CONNECTION === 'true',
  encrypt: process.env.DB_ENCRYPT === 'true',
  trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
});

const nl2sqlService = new NL2SQLService(llmClient, dbClient);

export const analyticsSchemaReady = dbClient
  .ensureAnalyticsSchema()
  .then(() => console.log('Analytics helper tables ensured'))
  .catch((err) => {
    console.error('Failed to ensure analytics helper tables', err);
    throw err;
  });

// ─────────────────────────────────────────────────────────────
// STANDARD API ROUTES
// ─────────────────────────────────────────────────────────────

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, temperature = 0.7 } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'INVALID_REQUEST', message: 'Message is required' });
    }
    const response = await llmClient.chat([{ role: 'user', content: message }], { temperature });
    return res.json({ success: true, data: { message, response } });
  } catch (error) {
    console.error('Chat route error:', error);
    return res.status(500).json({ error: 'CHAT_ERROR', message: (error as Error).message });
  }
});

router.get('/table-usage', requirePermission('analytics:query:read'), async (req, res) => {
  try {
    const rows = await dbClient.getRows<{ name: string; row_count: number }>(`
      SELECT TOP 50 t.name, SUM(p.rows) AS row_count
      FROM sys.tables t
      JOIN sys.partitions p ON p.object_id = t.object_id
      WHERE p.index_id IN (0, 1)
      GROUP BY t.name ORDER BY SUM(p.rows) DESC;
    `);

    const translations = tableTranslations.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.germanName.toLowerCase()] = entry.englishAlias;
      return acc;
    }, {});

    const payload = rows.map((row) => ({
      name: row.name,
      englishAlias: translations[row.name.toLowerCase()] || '',
      rowCount: Number(row.row_count ?? 0),
    }));

    res.status(200).json({ success: true, data: payload });
  } catch (error) {
    res.status(500).json({ success: false, error: 'TABLE_USAGE_ERROR', message: (error as Error).message });
  }
});

router.get('/table-relationships', requirePermission('analytics:query:read'), async (req, res) => {

  try {

    const fkRows = await dbClient.getRows<{

      constraintName: string;

      parentTable: string;

      referencedTable: string;

      parentColumns: string;

      referencedColumns: string;

      onDelete: string;

      onUpdate: string;

    }>(`

      SELECT

        fk.name AS constraintName,

        parentTab.name AS parentTable,

        referencedTab.name AS referencedTable,

        fk.delete_referential_action_desc AS onDelete,

        fk.update_referential_action_desc AS onUpdate,

        STRING_AGG(parentCol.name, ', ') AS parentColumns,

        STRING_AGG(refCol.name, ', ') AS referencedColumns

      FROM sys.foreign_keys fk

      INNER JOIN sys.tables parentTab ON fk.parent_object_id = parentTab.object_id

      INNER JOIN sys.tables referencedTab ON fk.referenced_object_id = referencedTab.object_id

      INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id

      INNER JOIN sys.columns parentCol ON parentCol.object_id = parentTab.object_id AND parentCol.column_id = fkc.parent_column_id

      INNER JOIN sys.columns refCol ON refCol.object_id = referencedTab.object_id AND refCol.column_id = fkc.referenced_column_id

      GROUP BY fk.name, parentTab.name, referencedTab.name, fk.delete_referential_action_desc, fk.update_referential_action_desc

      ORDER BY fk.name;

    `);



    const nodeMap = new Map<string, { id: string; name: string; englishAlias: string }>();

    const edgeKeySet = new Set<string>();

    const edges: Array<{

      id: string;

      source: string;

      target: string;

      parentColumns: string;

      referencedColumns: string;

      onDelete: string;

      onUpdate: string;

      type: 'fk' | 'inferred';

      inferredReason?: string;

    }> = [];



    const ensureNode = (tableName: string) => {

      const normalized = tableName.toLowerCase();

      if (nodeMap.has(normalized)) return;

      const translation = getTranslationForGermanName(tableName);

      nodeMap.set(normalized, {

        id: normalized,

        name: tableName,

        englishAlias: translation?.englishAlias || translation?.germanName || tableName,

      });

    };



    fkRows.forEach((row) => {

      const parentKey = row.parentTable.toLowerCase();

      const referencedKey = row.referencedTable.toLowerCase();

      ensureNode(row.parentTable);

      ensureNode(row.referencedTable);

      const key = `${parentKey}-${referencedKey}-${row.parentColumns}`;

      edgeKeySet.add(key);

      edges.push({

        id: `${row.constraintName}_${parentKey}_${referencedKey}`,

        source: parentKey,

        target: referencedKey,

        parentColumns: row.parentColumns,

        referencedColumns: row.referencedColumns,

        onDelete: row.onDelete,

        onUpdate: row.onUpdate,

        type: 'fk',

      });

    });



    const keyColumnRows = await dbClient.getRows<{

      tableName: string;

      columnName: string;

      isKey: number;

    }>(`

      SELECT

        kcu.TABLE_NAME AS tableName,

        kcu.COLUMN_NAME AS columnName,

        CASE WHEN tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE') THEN 1 ELSE 0 END AS isKey

      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu

      JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc

        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME

        AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA

      WHERE kcu.TABLE_SCHEMA = 'dbo'

        AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE');

    `);



    const columnTableMap = new Map<string, { table: string; isKey: boolean }[]>();

    keyColumnRows.forEach((row) => {

      const key = row.columnName.toLowerCase();

      const entries = columnTableMap.get(key) || [];

      entries.push({ table: row.tableName.toLowerCase(), isKey: Boolean(row.isKey) });

      columnTableMap.set(key, entries);

    });



    columnTableMap.forEach((entries, column) => {

      if (entries.length < 2) return;

      entries.forEach((entry) => ensureNode(entry.table));

      const keyTables = entries.filter((entry) => entry.isKey);

      const otherTables = entries.filter((entry) => !entry.isKey);



      const children = otherTables.length > 0 ? otherTables : entries;

      const parents = keyTables.length > 0 ? keyTables : entries;



      children.forEach((child) => {

        parents.forEach((parent) => {

          if (child.table === parent.table) return;

          const edgeKey = `${child.table}-${parent.table}-${column}`;

          if (edgeKeySet.has(edgeKey)) return;

          edgeKeySet.add(edgeKey);

          edges.push({

            id: `inferred_${column}_${child.table}_${parent.table}`,

            source: child.table,

            target: parent.table,

            parentColumns: column,

            referencedColumns: column,

            onDelete: 'INFERRED',

            onUpdate: 'INFERRED',

            type: 'inferred',

            inferredReason: `Shared key column ${column}`,

          });

        });

      });

    });



    res.status(200).json({

      success: true,

      data: {

        nodes: Array.from(nodeMap.values()),

        edges,

      },

    });

  } catch (error) {

    console.error('Table relationships fetch failed', error);

    res.status(500).json({

      success: false,

      error: 'TABLE_RELATIONSHIP_ERROR',

      message: (error as Error).message,

    });

  }

});

router.get('/chart/:metric', async (req: Request, res: Response) => {
  const { metric } = req.params;
  try {
    let query = '';
    switch (metric) {
      case 'revenue': query = `SELECT TOP 30 CAST(Datum AS DATE) AS date, SUM(Summe) AS value FROM rechnung WHERE Summe IS NOT NULL GROUP BY CAST(Datum AS DATE) ORDER BY date DESC;`; break;
      case 'queries': query = `SELECT TOP 30 CAST(created_at AS DATE) AS date, COUNT(*) AS value FROM query_history GROUP BY CAST(created_at AS DATE) ORDER BY date DESC;`; break;
      case 'latency': query = `SELECT TOP 30 CAST(created_at AS DATE) AS date, ROUND(AVG(execution_time), 0) AS value FROM query_history GROUP BY CAST(created_at AS DATE) ORDER BY date DESC;`; break;
      case 'users': query = `SELECT TOP 30 CAST(login_time AS DATE) AS date, COUNT(DISTINCT user_id) AS value FROM user_sessions GROUP BY CAST(login_time AS DATE) ORDER BY date DESC;`; break;
      default: return res.status(400).json({ error: 'Invalid metric' });
    }
    const result = await dbClient.query(query);
    return res.json({ success: true, data: result.rows });
  } catch (err: any) {
    return res.status(500).json({ error: 'CHART_ERROR', message: err.message });
  }
});
async function logQueryHistory(params: any): Promise<void> {
  try {
    await dbClient.query(`INSERT INTO query_history (user_id, original_query, generated_sql, execution_time, record_count, success, error_message) VALUES ($1, $2, $3, $4, $5, $6, $7);`, [params.userId, params.originalQuery, params.generatedSql, params.executionTime, params.recordCount, params.success ? 1 : 0, params.errorMessage ?? null]);
  } catch (error) {
    console.warn('Failed to log query history', error);
  }
}
router.post('/query', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  const requestId = (req as any).id;
  let sql = '';
  let start = 0;
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'INVALID_REQUEST', message: 'Query is required', requestId });
    sql = query.trim();
    if (!/^(SELECT|WITH)\b/i.test(sql)) return res.status(400).json({ error: 'INVALID_SQL', message: 'Only SELECT/WITH allowed', requestId });
    
    start = Date.now();
    const result = await dbClient.query(sql);
    const duration = Date.now() - start;

    await logQueryHistory({ userId: (req as any).user?.userId ?? 'anonymous', originalQuery: query, generatedSql: sql, executionTime: duration, recordCount: result.rows.length, success: true });
    return res.status(200).json({ success: true, data: { result: result.rows, metadata: { recordCount: result.rows.length, executionTime: duration, requestId } } });
  } catch (error) {
    await logQueryHistory({ userId: (req as any).user?.userId ?? 'anonymous', originalQuery: req.body.query, generatedSql: sql, executionTime: start ? Date.now() - start : 0, recordCount: 0, success: false, errorMessage: (error as Error).message });
    return res.status(500).json({ error: 'QUERY_ERROR', message: (error as Error).message, requestId });
  }
});

router.get('/analytics/insights', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  try {
    const totalQueries = await dbClient.query('SELECT COUNT(*) AS count FROM query_history');
    const activeSessions = await dbClient.query(`SELECT COUNT(*) AS count FROM user_sessions WHERE is_active = 1`);
    const avgQueryTime = await dbClient.query(`SELECT AVG(execution_time) AS avg FROM query_history WHERE execution_time IS NOT NULL`);
    const successRate = await dbClient.query(`SELECT ROUND((SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0)) * 100, 2) AS rate FROM query_history;`);
    return res.json({ success: true, data: { totalQueries: totalQueries.rows[0].count, activeSessions: activeSessions.rows[0].count, avgQueryTime: Math.round(avgQueryTime.rows[0].avg || 0), successRate: successRate.rows[0].rate || 0 } });
  } catch (error) {
    return res.status(500).json({ error: 'INSIGHTS_ERROR', message: (error as Error).message });
  }
});

router.post('/logout-session', async (req: Request, res: Response) => {
  try {
    const sessionId = (req as any).user?.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'MISSING_SESSION', message: 'Session identifier is missing' });
    await dbClient.query(`UPDATE user_sessions SET is_active = 0, logout_time = SYSUTCDATETIME() WHERE session_id = $1;`, [sessionId]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'LOGOUT_ERROR', message: (error as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────
// NATURAL LANGUAGE TO SQL ENDPOINTS
// ─────────────────────────────────────────────────────────────

/**
 * POST /analytics/nl-query
 * Convert natural language to SQL and execute
 * 
 * Request:
 * {
 *   "query": "find all orders of customer X from 2024",
 *   "maxRows": 100,
 *   "allowFallback": true,
 *   "temperature": 0.3
 * }
 */
router.post('/nl-query', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  try {
    const { query, maxRows = 100, allowFallback = true, temperature = 0.3 } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Natural language query is required',
      });
    }

    const userId = (req as any).user?.userId || 'anonymous';

    // Call NL2SQL service
    const response = await nl2sqlService.queryFromNaturalLanguage({
      query,
      userId,
      maxRows,
      allowFallback,
      temperature,
    });

    // Log the query
    await logQueryHistory({
      userId,
      originalQuery: query,
      generatedSql: response.sql || 'Failed to generate',
      executionTime: response.executionTime || 0,
      recordCount: response.resultCount || 0,
      success: response.success,
      errorMessage: response.error?.message || undefined,
    });

    // Return response
    if (response.success) {
      return res.status(200).json({
        success: true,
        data: {
          query: response.query,
          sql: response.sql,
          results: response.results,
          resultCount: response.resultCount,
          executionTime: response.executionTime,
          cached: response.cached,
          warnings: response.warnings,
        },
      });
    } else {
      // Handle error with fallback suggestion
      const status = response.error?.type === 'HALLUCINATION' ? 400 : 500;
      return res.status(status).json({
        success: false,
        error: response.error?.type || 'UNKNOWN_ERROR',
        message: response.error?.message || 'Failed to process query',
        details: response.error?.details,
        fallbackAvailable: response.error?.fallbackAvailable,
        suggestions: generateFallbackSuggestions(query, response.error),
      });
    }
  } catch (error) {
    console.error('NL-Query endpoint error:', error);
    return res.status(500).json({
      error: 'NL_QUERY_ERROR',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /analytics/nl-query-validate
 * Validate natural language query without executing
 */
router.post('/nl-query-validate', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Query is required',
      });
    }

    // Analyze query without executing
    const response = await nl2sqlService.queryFromNaturalLanguage({
      query,
      userId: (req as any).user?.userId || 'anonymous',
      maxRows: 1, // Don't actually fetch data
      allowFallback: true,
    });

    return res.status(200).json({
      success: response.success,
      sql: response.sql,
      error: response.error,
      warnings: response.warnings,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'VALIDATION_ERROR',
      message: (error as Error).message,
    });
  }
});

/**
 * Generate fallback suggestions when NL2SQL fails
 */
function generateFallbackSuggestions(
  query: string,
  error: Record<string, unknown>
): string[] {
  const suggestions: string[] = [];

  if (error?.type === 'HALLUCINATION') {
    suggestions.push('Try specifying exact table names (e.g., "orders" instead of "sales data")');
    suggestions.push('Check if the columns you mentioned actually exist');
    const issues = error?.details as Record<string, unknown> | undefined;
    if (Array.isArray(issues?.issues)) {
      for (const issue of issues.issues.slice(0, 2)) {
        const issueRecord = issue as Record<string, string>;
        if (issueRecord.suggestion) {
          suggestions.push(issueRecord.suggestion);
        }
      }
    }
  } else if (error?.type === 'PARSE_ERROR') {
    suggestions.push('Try rephrasing your question more clearly');
    suggestions.push('Use common keywords like "find", "calculate", "count", "total"');
  } else if (error?.type === 'VALIDATION') {
    suggestions.push('The generated query has syntax errors');
    suggestions.push('Try asking about a different time period or metric');
  }

  suggestions.push('Contact your administrator for manual query assistance');
  return suggestions.slice(0, 3); // Return top 3 suggestions
}

export default router;