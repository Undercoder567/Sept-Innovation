import { Router, Request, Response } from 'express';
import dotenv from 'dotenv';
import { LLMClient } from '../ai/llmClient';
import { DatabaseClient } from '../sql/dbClient';
import { requirePermission } from '../security/rbac';
import { tableTranslations } from '../semantic/tableTranslations';
import {
  getTranslationForGermanName,
} from './analytics/schemaContext';
import axios from 'axios';

const router = Router();

dotenv.config();

const llmClient = new LLMClient();

const dbClient = new DatabaseClient({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME || 'ERP42test',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  trustedConnection: process.env.DB_TRUSTED_CONNECTION === 'true',
  encrypt: process.env.DB_ENCRYPT === 'true',
  trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
});

export const analyticsSchemaReady = dbClient
  .ensureAnalyticsSchema()
  .then(() => console.log('Analytics helper tables ensured'))
  .catch((err) => {
    console.error('Failed to ensure analytics helper tables', err);
    throw err;
  });


router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, temperature = 0.7 } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Message is required',
      });
    }

    const response = await llmClient.chat(
      [{ role: 'user', content: message }],
      { temperature }
    );

    return res.json({ success: true, data: { message, response } });
  } catch (error) {
    console.error('Chat route error:', error);
    return res.status(500).json({
      error: 'CHAT_ERROR',
      message: (error as Error).message,
    });
  }
});

router.get('/table-usage', requirePermission('analytics:query:read'), async (req, res) => {
  try {
    const rows = await dbClient.getRows<{ name: string; row_count: number }>(`
      SELECT TOP 50
        t.name,
        SUM(p.rows) AS row_count
      FROM sys.tables t
      JOIN sys.partitions p ON p.object_id = t.object_id
      WHERE p.index_id IN (0, 1)
      GROUP BY t.name
      ORDER BY SUM(p.rows) DESC;
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
    console.error('Table usage fetch failed', error);
    res.status(500).json({
      success: false,
      error: 'TABLE_USAGE_ERROR',
      message: (error as Error).message,
    });
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
  const startTime = Date.now();

  try {
    let query = '';
    switch (metric) {
      case 'revenue':
        query = `
          SELECT TOP 30 metric_date AS date, value
          FROM financial_metrics
          WHERE metric_type = 'REVENUE'
          ORDER BY metric_date DESC;
        `;
        break;
      case 'queries':
        query = `
          SELECT TOP 30 CAST(created_at AS DATE) AS date,
                 COUNT(*) AS value
          FROM query_history
          GROUP BY CAST(created_at AS DATE)
          ORDER BY date DESC;
        `;
        break;
      case 'latency':
        query = `
          SELECT TOP 30 CAST(created_at AS DATE) AS date,
                 ROUND(AVG(execution_time), 0) AS value
          FROM query_history
          GROUP BY CAST(created_at AS DATE)
          ORDER BY date DESC;
        `;
        break;
      case 'users':
        query = `
          SELECT TOP 30 CAST(login_time AS DATE) AS date,
                 COUNT(DISTINCT user_id) AS value
          FROM user_sessions
          GROUP BY CAST(login_time AS DATE)
          ORDER BY date DESC;
        `;
        break;
      default:
        console.error(`[CHART] Invalid metric requested: ${metric}`);
        return res.status(400).json({ error: 'Invalid metric' });
    }

    const result = await dbClient.query(query);
    if (!result.rows || result.rows.length === 0) {
      console.warn(`[CHART] Empty result set | metric=${metric}`);
    }

    return res.json({ success: true, data: result.rows });
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error(`[CHART] ERROR | metric=${metric} | duration=${duration}ms`);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    return res.status(500).json({
      error: 'CHART_ERROR',
      message: err.message,
    });
  }
});
router.post('/query', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  const requestId = (req as any).id;

  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Query is required',
        requestId,
      });
    }

    const sql = query.trim();

    // optional basic safety (can remove if you want 100% raw)
    if (!/^(SELECT|WITH)\b/i.test(sql)) {
      return res.status(400).json({
        error: 'INVALID_SQL',
        message: 'Only SELECT/WITH allowed',
        requestId,
      });
    }
    console.log(`[QUERY][SQL]`, sql);

    const start = Date.now();

    const result = await dbClient.query(sql);

    const duration = Date.now() - start;


    return res.status(200).json({
      success: true,
      data: {
        result: result.rows,
        metadata: {
          recordCount: result.rows.length,
          executionTime: duration,
          requestId,
        },
      },
    });

  } catch (error) {
    console.error(`[QUERY][ERROR] requestId=${requestId}`, error);

    return res.status(500).json({
      error: 'QUERY_ERROR',
      message: (error as Error).message,
      requestId,
    });
  }
});

router.post(
  '/validate',
  requirePermission('analytics:query:read'),
  async (req: Request, res: Response) => {
    const requestId = (req as any).id;

    try {
      const { query } = req.body;

      console.log(`[VALIDATE][START]`, query);

      if (!query) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Query is required',
          requestId,
        });
      }

      const q = query.toLowerCase();

      // -----------------------------------------
      // 1. INTENT DETECTION
      // -----------------------------------------
      let intent: 'search' | 'math' | 'stats' = 'search';

      if (q.includes('profit') || q.includes('total') || q.includes('calculate')) {
        intent = 'math';
      }

      if (q.includes('expected') || q.includes('interval')) {
        intent = 'stats';
      }

      console.log(`[VALIDATE][INTENT]`, intent);

      // -----------------------------------------
      // 2. INTENT → TABLE FILTER (ONLY IMPORTANT TABLES)
      // -----------------------------------------
      const intentTableMap: Record<string, string[]> = {
        search: ['auftrag', 'kunde'],
        math: ['anposten', 'rechnung'],
        stats: ['auftrag', 'kunde'],
      };

      const allowedTables = intentTableMap[intent];

      console.log(`[VALIDATE][TABLE_FILTER]`, allowedTables);

      // -----------------------------------------
      // 3. BUILD SAFE IN CLAUSE (SQL SERVER FIX)
      // -----------------------------------------
      const tableList = allowedTables.map(t => `'${t}'`).join(',');

      // -----------------------------------------
      // 4. FETCH SCHEMA
      // -----------------------------------------
      const schemaResult = await dbClient.query(`
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME IN (${tableList})
      `);

      console.log(`[VALIDATE][SCHEMA_LOADED]`, schemaResult.rows.length);

      // -----------------------------------------
      // 5. BUILD SCHEMA TEXT (KEEP IT SHORT)
      // -----------------------------------------
      const schemaMap: Record<string, string[]> = {};

      for (const row of schemaResult.rows) {
        if (!schemaMap[row.TABLE_NAME]) {
          schemaMap[row.TABLE_NAME] = [];
        }

        // LIMIT columns per table (IMPORTANT for LLM)
        if (schemaMap[row.TABLE_NAME].length < 25) {
          schemaMap[row.TABLE_NAME].push(
            `${row.COLUMN_NAME} (${row.DATA_TYPE})`
          );
        }
      }

      const schemaText = Object.entries(schemaMap)
        .map(([table, cols]) => {
          return `${table}:\n${cols.join('\n')}`;
        })
        .join('\n\n');

      // -----------------------------------------
      // 6. STRONG PROMPT (CRITICAL FIX)
      // -----------------------------------------
      const prompt = `
You are a SQL Server expert.

STRICT RULES:
- Output ONLY ONE SQL query
- No explanation
- No markdown
- Must end with ;

TABLES:
auftrag = orders
kunde = customers
anposten = invoice_lines
rechnung = invoices

SCHEMA:
${schemaText}

EXAMPLES:
User: show customer names
SQL: SELECT TOP 100 Name FROM kunde;

User: find orders of customer X in 2024
SQL: SELECT * FROM auftrag WHERE Name LIKE '%X%' AND YEAR(Datum)=2024;

USER:
${query}

SQL:
`.trim();

      console.log(`[VALIDATE][PROMPT_SENT]`);

      // -----------------------------------------
      // 7. CALL LLM
      // -----------------------------------------
      const response = await axios.post(
        'http://localhost:11434/api/generate',
        {
          model: 'phi',
          prompt,
          stream: false,
          temperature: 0,
        }
      );

      const raw = response.data.response;

      console.log(`[VALIDATE][RAW_OUTPUT]`, raw);

      // -----------------------------------------
      // 8. SAFE SQL EXTRACTION (FIXED)
      // -----------------------------------------
      let sql = raw
        .replace(/```sql|```/g, '')
        .replace(/[\s\S]*?(SELECT|WITH)/i, '$1')
        .trim();

      if (sql && !sql.endsWith(';')) {
        sql += ';';
      }

      // -----------------------------------------
      // 9. FALLBACK (VERY IMPORTANT)
      // -----------------------------------------
      if (
        !sql ||
        (!sql.toLowerCase().startsWith('select') &&
          !sql.toLowerCase().startsWith('with'))
      ) {
        console.log(`[VALIDATE][FALLBACK_TRIGGERED]`);

        if (intent === 'search') {
          sql = `SELECT TOP 100 Name FROM kunde;`;
        } else if (intent === 'math') {
          sql = `SELECT SUM(Summe) AS total_profit FROM anposten;`;
        } else {
          sql = `SELECT TOP 100 Datum FROM auftrag ORDER BY Datum DESC;`;
        }
      }

      console.log(`[VALIDATE][FINAL_SQL]`, sql);

      // -----------------------------------------
      // 10. RESPONSE
      // -----------------------------------------
      return res.json({
        success: true,
        requestId,
        query,
        intent,
        tablesUsed: allowedTables,
        generatedSQL: sql,
      });
    } catch (err) {
      console.error(`[VALIDATE][ERROR]`, err);

      return res.status(500).json({
        error: 'VALIDATION_ERROR',
        message: (err as Error).message,
        requestId,
      });
    }
  }
);

router.get(
  '/analytics/insights',
  requirePermission('analytics:query:read'),
  async (req: Request, res: Response) => {
    try {
      const totalQueries = await dbClient.query('SELECT COUNT(*) AS count FROM query_history');
      const activeSessions = await dbClient.query(
        `
        SELECT COUNT(*) AS count
        FROM user_sessions
        WHERE is_active = 1
      `
      );
      const avgQueryTime = await dbClient.query(
        `
        SELECT AVG(execution_time) AS avg
        FROM query_history
        WHERE execution_time IS NOT NULL
      `
      );
      const successRate = await dbClient.query(
        `
        SELECT 
          ROUND((SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0)) * 100, 2) AS rate
        FROM query_history;
      `
      );

      return res.json({
        success: true,
        data: {
          totalQueries: totalQueries.rows[0].count,
          activeSessions: activeSessions.rows[0].count,
          avgQueryTime: Math.round(avgQueryTime.rows[0].avg || 0),
          successRate: successRate.rows[0].rate || 0,
        },
      });
    } catch (error) {
      return res.status(500).json({
        error: 'INSIGHTS_ERROR',
        message: (error as Error).message,
      });
    }
  }
);

export default router;
