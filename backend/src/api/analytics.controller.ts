import { Router, Request, Response } from 'express';
import Joi from 'joi';
import dotenv from 'dotenv';
import { LLMClient } from '../ai/llmClient';
import { PromptBuilder } from '../ai/promptBuilder';
import { ResponseParser } from '../ai/responseParser';
import { DatabaseClient } from '../sql/dbClient';
import { SQLGenerator } from '../sql/sqlGenerator';
import { SQLValidator } from '../sql/sqlValidator';
import { PIIMasker } from '../security/piiMasker';
import { requirePermission } from '../security/rbac';
import { AuditLogger } from '../logs/auditLogger';
import { tableTranslations } from '../semantic/tableTranslations';
import {
  getSchemaContextForQuery,
  getRelevantTranslations,
  translateTableNames,
  getTranslationForGermanName,
} from './analytics/schemaContext';
import {
  buildCacheKey,
  getCachedQuery,
  getCachedValidatedSql,
  setCachedValidatedSql,
  upsertQueryCache,
} from './analytics/cache';
import {
  ensureTopLimit,
  extractSqlStatement,
  generateBestSQL,
  generateSQLExplanation,
  validateGeneratedSQL,
  SQLWorkflowDeps,
} from './analytics/sqlWorkflow';

const router = Router();

dotenv.config();

const llmClient = new LLMClient();
const promptBuilder = new PromptBuilder(llmClient);
const responseParser = new ResponseParser(llmClient);
const sqlGenerator = new SQLGenerator();
const sqlValidator = new SQLValidator();
const piiMasker = new PIIMasker();
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

const sqlWorkflowDeps: SQLWorkflowDeps = {
  llmClient,
  promptBuilder,
  sqlValidator,
  dbClient,
};

const querySchema = Joi.object({
  query: Joi.string().required().min(3).max(1000),
  limit: Joi.number().optional().min(1).max(10000).default(1000),
  offset: Joi.number().optional().min(0).default(0),
  includeExplain: Joi.boolean().optional().default(false),
  masked: Joi.boolean().optional().default(true),
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
  const userId = req.user?.userId;
  const auditLogger = (req.app as any).auditLogger as AuditLogger;

  try {
    const { error, value } = querySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: error.details[0].message,
        requestId,
      });
    }

    const { query, limit, offset, masked } = value;
    const cacheKey = buildCacheKey(userId || 'UNKNOWN', query, { masked, limit, offset });
    const cached = await getCachedQuery(dbClient, cacheKey);
    if (cached?.result_data) {
      const cachedData = cached.result_data as Record<string, any>;
      cachedData.metadata = {
        ...(cachedData.metadata || {}),
        requestId,
        cacheHit: true,
        executionTime: 0,
      };

      await dbClient.query(
        `UPDATE query_cache SET access_count = access_count + 1 WHERE query_hash = $1`,
        [cacheKey]
      );

      auditLogger.log({
        timestamp: new Date(),
        action: 'QUERY_CACHE_HIT',
        userId: userId || 'UNKNOWN',
        resource: 'ANALYTICS_QUERY',
        details: {
          query: query.substring(0, 100),
          cacheKey,
        },
        severity: 'INFO',
      });

      return res.status(200).json({ success: true, data: cachedData });
    }

    auditLogger.log({
      timestamp: new Date(),
      action: 'QUERY_SUBMITTED',
      userId: userId || 'UNKNOWN',
      resource: 'ANALYTICS_QUERY',
      details: { query: query.substring(0, 100), userId: userId || 'UNKNOWN' },
      severity: 'INFO',
    });

    const rbac = (req as any).rbac;
    if (rbac && rbac.queryLimit && rbac.queryLimit > 0) {
      // TODO: enforce per-user rate limits
    }

    const normalizedQuery = query.trim();
    if (!/^(SELECT|WITH)\b/i.test(normalizedQuery)) {
      return res.status(400).json({
        error: 'INVALID_SQL',
        message: 'Only SELECT or WITH statements are supported in this endpoint.',
        requestId,
      });
    }

    const executableSQL = translateTableNames(normalizedQuery);
    const queryStart = Date.now();
    const paramMatches = Array.from(executableSQL.matchAll(/\$([1-9]\d*)/g)) as RegExpMatchArray[];
    const paramNumbers: number[] = paramMatches.map((m) => parseInt(m[1], 10));
    const maxParam = paramNumbers.length ? Math.max(...paramNumbers) : 0;
    const autoParams = maxParam > 0 ? Array.from({ length: maxParam }, () => null as null) : undefined;
    const result = await dbClient.query(executableSQL, autoParams);
    const queryDuration = Date.now() - queryStart;

    const parsedResponse = await responseParser.parseQueryResult(result.rows, query, query);
    let finalResult = parsedResponse.queryResult;
    let maskedApplied = false;
    if (masked && rbac?.dataAccessLevel !== 'FULL') {
      finalResult = piiMasker.maskObject(finalResult);
      maskedApplied = true;
    }

    const visualizationType = responseParser.recommendVisualization(finalResult);
    const statistics = responseParser.calculateStatistics(finalResult);
    const visualData = responseParser.formatForVisualization(finalResult, visualizationType);
    const response = {
      success: true,
      data: {
        query,
        generatedSQL: sqlGenerator.formatSQL(normalizedQuery),
        result: finalResult,
        summary: parsedResponse.summary,
        insights: parsedResponse.insights,
        statistics,
        visualization: {
          type: visualizationType,
          data: visualData,
        },
        metadata: {
          recordCount: Array.isArray(finalResult) ? finalResult.length : 1,
          executionTime: queryDuration,
          masked: maskedApplied,
          requestId,
        },
      },
    };

    await upsertQueryCache(
      dbClient,
      cacheKey,
      userId || 'UNKNOWN',
      query,
      normalizedQuery,
      response.data,
      response.data.metadata.executionTime,
      response.data.metadata.recordCount
    );

    auditLogger.log({
      timestamp: new Date(),
      action: 'QUERY_EXECUTED',
      userId: userId || 'UNKNOWN',
      resource: 'ANALYTICS_QUERY',
      details: {
        query: query.substring(0, 100),
        executionTime: queryDuration,
        recordCount: response.data.metadata.recordCount,
        masked: maskedApplied,
      },
      severity: 'INFO',
    });

    return res.status(200).json(response);
  } catch (error) {
    const errorMessage = (error as Error).message;
    auditLogger.log({
      timestamp: new Date(),
      action: 'QUERY_ERROR',
      userId: userId || 'UNKNOWN',
      resource: 'ANALYTICS_QUERY',
      details: { error: errorMessage },
      severity: 'ERROR',
    });

    return res.status(500).json({
      error: 'QUERY_EXECUTION_ERROR',
      message: errorMessage,
      requestId,
    });
  }
});

router.post('/validate', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  const requestId = (req as any).id;
  const userId = req.user?.userId || 'UNKNOWN';
  const startTime = Date.now();

  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      console.warn(`[validate][invalid_request] requestId=${requestId} userId=${userId} reason=query_missing_or_invalid`);
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Query parameter required',
      });
    }

    const includeExplanation = req.body?.includeExplanation === true;
    const { schema: dbSchema, tables: schemaTables } = await getSchemaContextForQuery(dbClient, query);
    const directSqlCandidate = ensureTopLimit(extractSqlStatement(query));
    const isDirectSql = /^(SELECT|WITH)\b/i.test(directSqlCandidate);
    const cachedValidatedSql = !isDirectSql ? getCachedValidatedSql(userId, query) : null;
    const generated = isDirectSql
      ? {
          sql: directSqlCandidate,
          issues: await validateGeneratedSQL(directSqlCandidate, { sqlValidator, dbClient }),
        }
      : cachedValidatedSql
        ? {
            sql: cachedValidatedSql,
            issues: await validateGeneratedSQL(cachedValidatedSql, { sqlValidator, dbClient }),
          }
        : await generateBestSQL(
            query,
            dbSchema,
            getRelevantTranslations(schemaTables),
            sqlWorkflowDeps
          );

    const generatedSQL = generated.sql;
    const issues = generated.issues;
    let explanation: string | undefined;
    if (includeExplanation) {
      explanation = await generateSQLExplanation(generatedSQL, { promptBuilder, llmClient });
    }

    if (issues.every((issue) => issue.type !== 'ERROR')) {
      setCachedValidatedSql(userId, query, generatedSQL);
    }

    return res.status(200).json({
      success: true,
      query,
      generatedSQL: sqlGenerator.formatSQL(generatedSQL),
      validation: {
        issues,
        valid: issues.every((issue) => issue.type !== 'ERROR'),
      },
      explanation,
    });
  } catch (error) {
    console.error(`[validate][error] requestId=${requestId} userId=${userId} totalMs=${Date.now() - startTime} message=${(error as Error).message}`);
    console.error(error);
    return res.status(500).json({
      error: 'VALIDATION_ERROR',
      message: (error as Error).message,
    });
  }
});

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
