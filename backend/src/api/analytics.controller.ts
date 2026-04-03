import { Router, Request, Response } from 'express';
import dotenv from 'dotenv';
import { LLMClient } from '../ai/llmClient';
import { DatabaseClient, QueryResult } from '../sql/dbClient';
import { requirePermission } from '../security/rbac';
import { tableTranslations } from '../semantic/tableTranslations';
import {
  getSchemaContextForQuery,
  getTranslationForGermanName,
  translateTableNames,
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

type ValidationIntent = 'search' | 'math' | 'stats';

interface TableColumnInfo {
  columns: string[];
  columnNames: string[];
  numericColumns: string[];
}

type ColumnMetadataRow = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
};

const TABLE_PROMPT_LIMIT = 6;

const intentTableDefaults: Record<ValidationIntent, string[]> = {
  search: ['auftrag', 'kunde', 'kontakt'],
  math: ['anposten', 'rechnung', 'artbest', 'auposten', 'lsposten'],
  stats: ['wartung', 'zeitraum', 'datum', 'kunde'],
};

const statsIndicators = [
  'expected',
  'interval',
  'maintenance',
  'forecast',
  'predict',
  'trend',
  'estimate',
  'frequency',
  'confidence',
  'probability',
  'variance',
];

const mathIndicators = [
  'profit',
  'total',
  'calculate',
  'sum',
  'revenue',
  'earnings',
  'cost',
  'margin',
  'average',
  'growth',
];

function detectIntent(query: string): ValidationIntent {
  const normalized = query.toLowerCase();
  if (statsIndicators.some((term) => normalized.includes(term))) {
    return 'stats';
  }
  if (mathIndicators.some((term) => normalized.includes(term))) {
    return 'math';
  }
  return 'search';
}

function isNumericType(dataType?: string): boolean {
  if (!dataType) {
    return false;
  }
  const normalized = dataType.toLowerCase();
  return /^(bigint|int|smallint|tinyint|decimal|numeric|float|real|money|smallmoney)/.test(
    normalized
  );
}

function quoteTableName(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildAliasSection(tables: string[]): string {
  if (tables.length === 0) {
    return 'No table aliases available.';
  }

  return tables
    .map((table) => {
      const translation = getTranslationForGermanName(table);
      const aliasSet = new Set<string>();
      if (translation?.englishAlias) {
        aliasSet.add(translation.englishAlias);
      }
      translation?.additionalAliases?.forEach((alias) => aliasSet.add(alias));
      const aliasList = aliasSet.size ? Array.from(aliasSet).join(', ') : table;
      const description = translation?.description ? ` - ${translation.description}` : '';
      return `${table} = ${aliasList}${description}`;
    })
    .join('\n');
}

function findNumericColumn(
  schemaMap: Record<string, TableColumnInfo>,
  preferredTable: string
): { table: string; column: string } | null {
  const primary = schemaMap[preferredTable];
  if (primary?.numericColumns?.length) {
    return {
      table: preferredTable,
      column: primary.numericColumns[0],
    };
  }

  for (const [tableName, info] of Object.entries(schemaMap)) {
    if (info.numericColumns.length) {
      return {
        table: tableName,
        column: info.numericColumns[0],
      };
    }
  }

  return null;
}

function buildFallbackSQL(
  intent: ValidationIntent,
  table: string,
  schemaMap: Record<string, TableColumnInfo>
): string {
  const tableInfo: TableColumnInfo = schemaMap[table] ?? {
    columns: [],
    columnNames: [],
    numericColumns: [],
  };

  if (intent === 'math') {
    const numericCandidate = findNumericColumn(schemaMap, table);
    if (numericCandidate) {
      return `SELECT SUM(${numericCandidate.column}) AS computed_value FROM ${numericCandidate.table};`;
    }
    if (tableInfo.columnNames.length) {
      return `SELECT SUM(${tableInfo.columnNames[0]}) AS computed_value FROM ${table};`;
    }
    return `SELECT TOP 100 * FROM ${table};`;
  }

  const selectColumn = tableInfo.columnNames[0] || '*';
  const orderClause = tableInfo.columnNames[0] ? ` ORDER BY ${selectColumn} DESC` : '';
  return `SELECT TOP 100 ${selectColumn} FROM ${table}${orderClause};`;
}


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
      const trimmedQuery = typeof query === 'string' ? query.trim() : '';

      console.log(`[VALIDATE][START] requestId=${requestId}`, trimmedQuery);

      if (!trimmedQuery) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Query is required',
          requestId,
        });
      }

      const intent = detectIntent(trimmedQuery);
      const translatedQuery = translateTableNames(trimmedQuery);
      console.log(`[VALIDATE][INTENT] requestId=${requestId}`, intent);
      console.log(
        `[VALIDATE][TRANSLATED_QUERY] requestId=${requestId}`,
        translatedQuery
      );

      const schemaContext = await getSchemaContextForQuery(dbClient, translatedQuery);

      const tableCandidates = [...schemaContext.tables];
      for (const fallbackTable of intentTableDefaults[intent]) {
        if (!tableCandidates.includes(fallbackTable)) {
          tableCandidates.push(fallbackTable);
        }
      }

      let tablesForPrompt = tableCandidates.slice(0, TABLE_PROMPT_LIMIT);
      if (tablesForPrompt.length === 0) {
        tablesForPrompt = [...intentTableDefaults.search];
      }

      console.log(
        `[VALIDATE][TABLES] requestId=${requestId}`,
        tablesForPrompt
      );

      const tableList = tablesForPrompt.map(quoteTableName).join(', ');
      const schemaQuery = tablesForPrompt.length
        ? `
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME IN (${tableList})
      `
        : null;

      const schemaResult: QueryResult<ColumnMetadataRow> = schemaQuery
        ? await dbClient.query<ColumnMetadataRow>(schemaQuery)
        : ({ rows: [] } as QueryResult<ColumnMetadataRow>);

      console.log(
        `[VALIDATE][SCHEMA_LOADED] requestId=${requestId}`,
        schemaResult.rows.length,
        tablesForPrompt
      );

      const schemaMap: Record<string, TableColumnInfo> = {};
      tablesForPrompt.forEach((table) => {
        schemaMap[table] = {
          columns: [],
          columnNames: [],
          numericColumns: [],
        };
      });

      schemaResult.rows.forEach((row) => {
        const tableName = row.TABLE_NAME;
        if (!tableName) {
          return;
        }
        const bucket = schemaMap[tableName] || {
          columns: [],
          columnNames: [],
          numericColumns: [],
        };

        if (bucket.columns.length >= 25) {
          return;
        }

        bucket.columns.push(`${row.COLUMN_NAME} (${row.DATA_TYPE})`);
        bucket.columnNames.push(row.COLUMN_NAME);
        if (isNumericType(row.DATA_TYPE)) {
          bucket.numericColumns.push(row.COLUMN_NAME);
        }

        schemaMap[tableName] = bucket;
      });

      const schemaText = Object.entries(schemaMap)
        .map(([table, info]) => {
          const content = info.columns.length
            ? info.columns.join('\n')
            : 'No columns available';
          return `${table}:\n${content}`;
        })
        .join('\n\n');

      const schemaSection = [schemaText.trim(), schemaContext.schema?.trim()]
        .filter(Boolean)
        .join('\n\n') || 'Schema metadata is unavailable.';

      const aliasSection = buildAliasSection(tablesForPrompt);

      const promptSections = [
        'You are a SQL Server expert.',
        'STRICT RULES:\n- Output ONLY ONE SQL query\n- No explanation\n- No markdown\n- Must end with ;',
        `INTENT: ${intent}`,
        'KEY DATA SOURCES:',
        '- search: auftrag = orders, kunde = customers, kontakt = contacts',
        '- math: anposten = invoice_lines, rechnung = invoices, artbest = item_master',
        '- stats: wartung = maintenance, zeitraum = time_periods, datum = dates',
        'TABLE ALIASES:',
        aliasSection,
        'SCHEMA CONTEXT:',
        schemaSection,
        'USER QUERY:',
        translatedQuery,
      ];

      if (translatedQuery !== trimmedQuery) {
        promptSections.push('Original request:');
        promptSections.push(trimmedQuery);
      }

      promptSections.push('SQL:');

      const prompt = promptSections.join('\n\n').trim();

      console.log(`[VALIDATE][PROMPT_SENT] requestId=${requestId}`);

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

      console.log(`[VALIDATE][RAW_OUTPUT] requestId=${requestId}`, raw);

      let sql = raw
        .replace(/```sql|```/g, '')
        .replace(/[\s\S]*?(SELECT|WITH)/i, '$1')
        .trim();

      if (sql && !sql.endsWith(';')) {
        sql += ';';
      }

      const isValidSql = !!sql && /^(SELECT|WITH)/i.test(sql);
      if (!isValidSql) {
        console.log(
          `[VALIDATE][FALLBACK_TRIGGERED] requestId=${requestId}`,
          `intent=${intent}`
        );
        const fallbackTable =
          tablesForPrompt[0] || intentTableDefaults.search[0];
        sql = buildFallbackSQL(intent, fallbackTable, schemaMap);
      }

      console.log(`[VALIDATE][FINAL_SQL] requestId=${requestId}`, sql);

      return res.json({
        success: true,
        requestId,
        query: trimmedQuery,
        intent,
        tablesUsed: tablesForPrompt,
        generatedSQL: sql,
      });
    } catch (err) {
      console.error(`[VALIDATE][ERROR] requestId=${requestId}`, err);

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
