import { Router, Request, Response } from 'express';
import Joi from 'joi';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { LLMClient } from '../ai/llmClient';
import { PromptBuilder } from '../ai/promptBuilder';
import { ResponseParser } from '../ai/responseParser';
import { DatabaseClient } from '../sql/dbClient';
import { SQLGenerator } from '../sql/sqlGenerator';
import { SQLValidator, ValidationIssue } from '../sql/sqlValidator';
import { PIIMasker } from '../security/piiMasker';
import { checkPermission, checkDataAccess, requirePermission } from '../security/rbac';
import { AuditLogger } from '../logs/auditLogger';
import { TableTranslation, tableTranslations } from '../semantic/tableTranslations';

const router = Router();
const englishToGermanTableMap: Map<string, string> = new Map();
const germanToTranslation: Map<string, TableTranslation> = new Map();

function addAliasVariant(alias: string, target: string) {
  const normalized = alias.toLowerCase();
  englishToGermanTableMap.set(normalized, target);
  if (normalized.endsWith('s')) {
    englishToGermanTableMap.set(normalized.slice(0, -1), target);
  } else {
    englishToGermanTableMap.set(`${normalized}s`, target);
  }
}

tableTranslations.forEach((entry) => {
  const target = entry.germanName.toLowerCase();
  if (entry.englishAlias) {
    addAliasVariant(entry.englishAlias, target);
  }
  entry.additionalAliases?.forEach((alias) => {
    addAliasVariant(alias, target);
  });
  germanToTranslation.set(target, entry);
});

const translationOrder = Array.from(englishToGermanTableMap.keys()).sort((a, b) => b.length - a.length);

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function translateTableNames(sql: string): string {
  if (!sql) return sql;
  let translated = sql;
  for (const alias of translationOrder) {
    const germanName = englishToGermanTableMap.get(alias);
    if (!germanName) continue;
    const pattern = new RegExp(`\\b${escapeForRegExp(alias)}\\b`, 'gi');
    translated = translated.replace(pattern, germanName);
  }
  return translated;
}

async function describeTable(tableName: string): Promise<string> {
  try {
    const columns = await dbClient.getRows<{
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
    }>(`
      SELECT column_name, data_type, character_maximum_length
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE table_schema = 'dbo'
        AND LOWER(table_name) = $1
      ORDER BY ordinal_position;
    `, [tableName.toLowerCase()]);

    if (columns.length === 0) {
      return `Table: ${tableName} (no column metadata)`;
    }

    const columnDescs = columns
      .slice(0, 12)
      .map(col => {
        const length = col.character_maximum_length;
        const lenSuffix = length && length > 0 ? `(${length})` : '';
        return `${col.column_name} ${col.data_type}${lenSuffix}`;
      })
      .join(', ');

    return `Table: ${tableName} | Columns: ${columnDescs}`;
  } catch (error) {
    return `Table: ${tableName} (schema unavailable)`;
  }
}

function detectMentionedTables(query: string): string[] {
  const normalized = query.toLowerCase();
  const detected = new Set<string>();

  for (const entry of tableTranslations) {
    if (!entry.germanName) continue;
    const german = entry.germanName.toLowerCase();
    if (normalized.includes(german)) {
      detected.add(german);
      continue;
    }

    const aliasCandidates = [entry.englishAlias, ...(entry.additionalAliases || [])]
      .filter(Boolean)
      .flatMap((alias) => {
        const normalizedAlias = alias!.toLowerCase();
        const variants = normalizedAlias.endsWith('s')
          ? [normalizedAlias, normalizedAlias.slice(0, -1)]
          : [normalizedAlias, `${normalizedAlias}s`];
        return variants;
      });

    for (const alias of aliasCandidates) {
      const pattern = new RegExp(`\\b${escapeForRegExp(alias)}\\b`, 'i');
      if (pattern.test(normalized)) {
        detected.add(german);
        break;
      }
    }
  }

  if (detected.size === 0) {
    return ['kunde', 'auftrag', 'waren']; // fallback defaults
  }

  return Array.from(detected);
}

function filterSchemaByTableNames(schema: string, tableNames: string[]): string {
  if (!schema || tableNames.length === 0) {
    return schema;
  }

  const normalizedTargets = tableNames.map((t) => t.toLowerCase());
  const parts = schema
    .split(/(?=CREATE\s+TABLE)/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const filtered = parts.filter((part) =>
    normalizedTargets.some((name) => part.toLowerCase().includes(`[${name}]`) || part.toLowerCase().includes(` ${name}`))
  );

  return filtered.length > 0 ? filtered.join('\n\n') : schema;
}

function getRelevantTranslations(tableNames: string[]): TableTranslation[] {
  const normalized = new Set(tableNames.map((name) => name.toLowerCase()));
  return tableTranslations.filter((entry) => normalized.has(entry.germanName.toLowerCase()));
}

async function getSchemaContextForQuery(
  req: Request,
  userQuery: string
): Promise<{ schema: string; tables: string[] }> {
  const tableNames = detectMentionedTables(userQuery);
  const summaries = await Promise.all(tableNames.map(describeTable));
  return {
    schema: summaries.join('\n'),
    tables: tableNames,
  };
}
dotenv.config();

// Initialize services
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
export const analyticsSchemaReady = dbClient.ensureAnalyticsSchema()
  .then(() => {
    console.log('Analytics helper tables ensured');
  })
  .catch(err => {
    console.error('Failed to ensure analytics helper tables', err);
    throw err;
  });

// Query schema validation
const querySchema = Joi.object({
  query: Joi.string().required().min(3).max(1000),
  limit: Joi.number().optional().min(1).max(10000).default(1000),
  offset: Joi.number().optional().min(0).default(0),
  includeExplain: Joi.boolean().optional().default(false),
  masked: Joi.boolean().optional().default(true),
});
const QUERY_CACHE_TTL_SECONDS = parseInt(process.env.QUERY_CACHE_TTL_SECONDS || '300', 10);
const VALIDATED_SQL_TTL_MS = parseInt(process.env.VALIDATED_SQL_TTL_MS || '180000', 10);
const SCHEMA_CACHE_TTL_MS = parseInt(process.env.SCHEMA_CACHE_TTL_MS || '60000', 10);
const DEFAULT_TOP_LIMIT = parseInt(process.env.DEFAULT_TOP_LIMIT || '100', 10);
const FORCE_LLM_ONLY = (process.env.FORCE_LLM_ONLY || process.env.FORCE_LLM || 'true').toLowerCase() === 'true';

const validatedSqlCache = new Map<string, { sql: string; expiresAt: number }>();
let schemaCache: { schema: string; expiresAt: number } = { schema: '', expiresAt: 0 };

/**
 * Simple Chat with Model
 * POST /api/analytics/chat
 *
 * Just sends message to the LLM and returns the response
 */
router.post("/chat", async (req: Request, res: Response) => {
try {
const { message, temperature = 0.7 } = req.body;

if (!message || typeof message !== "string") {
  return res.status(400).json({
    error: "INVALID_REQUEST",
    message: "Message is required",
  });
}

const response = await llmClient.chat(
  [
    { role: "user", content: message }
  ],
  { temperature }
);

//console.log("LLM Response:", response);

return res.json({
  success: true,
  data: {
    message,
    response,
  },
});

} catch (error) {
console.error("Chat route error:", error);

return res.status(500).json({
  error: "CHAT_ERROR",
  message: (error as Error).message,
});


}
});


router.get('/table-usage', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
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


router.get('/table-relationships', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
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
      if (!nodeMap.has(normalized)) {
        const translation = germanToTranslation.get(normalized);
        nodeMap.set(normalized, {
          id: normalized,
          name: tableName,
          englishAlias: translation?.englishAlias || translation?.germanName || tableName,
        });
      }
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
      entries.push({
        table: row.tableName.toLowerCase(),
        isKey: Boolean(row.isKey),
      });
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


function buildSchemaIssue(error: unknown) {
  return {
    type: 'ERROR' as const,
    code: 'SCHEMA_MISMATCH',
    message: (error as Error).message,
    suggestion: 'Use only tables/columns that exist in the current database schema.',
  };
}

async function validateGeneratedSQL(sql: string): Promise<ValidationIssue[]> {
  const issues = sqlValidator.validate(sql);
  try {
    const sanitized = translateTableNames(sql.replace(/\$\d+/g, 'NULL'));
    await dbClient.explainQuery(sanitized);
  } catch (explainError) {
    issues.push(buildSchemaIssue(explainError));
  }
  return issues;
}

function toIssueStrings(issues: ValidationIssue[]): string[] {
  return issues.map(issue => `${issue.code}: ${issue.message}`);
}

function ensureTopLimit(sql: string, limit = DEFAULT_TOP_LIMIT): string {
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed)) {
    return sql;
  }

  if (/\boffset\s+\d+\s+rows\b/i.test(trimmed) || /\btop\s+\d+/i.test(trimmed)) {
    return sql;
  }

  const selectRegex = /^(\s*select\s+)(distinct\s+)?/i;
  if (!selectRegex.test(sql)) {
    return sql;
  }

  return sql.replace(selectRegex, (match, selectPart, distinctPart = '') => {
    return `${selectPart}${distinctPart}TOP ${limit} `;
  });
}

async function generateBestSQL(
  userQuery: string,
  dbSchema: string,
  translationHints: TableTranslation[] = []
): Promise<{ sql: string; issues: ValidationIssue[] }> {
  const MAX_ATTEMPTS = 3;
  let candidate = '';
  let issues: ValidationIssue[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt === 1) {
      const prompt = promptBuilder.buildSQLGenerationPrompt(userQuery, dbSchema, {
        translationHints,
      });
      const raw = await llmClient.generate(prompt, { temperature: 0.15 });
      candidate = ensureTopLimit(extractSqlStatement(raw));
    } else {
      const repairPrompt = promptBuilder.buildSQLRepairPrompt(
        userQuery,
        dbSchema,
        candidate,
        toIssueStrings(issues)
      );
      const raw = await llmClient.generate(repairPrompt, { temperature: 0.05 });
      candidate = ensureTopLimit(extractSqlStatement(raw));
    }

    issues = await validateGeneratedSQL(candidate);
    const hasErrors = issues.some(issue => issue.type === 'ERROR');
    if (!hasErrors) {
      return { sql: candidate, issues };
    }
  }

  return { sql: candidate, issues };
}

function buildValidatedSqlKey(userId: string, userQuery: string): string {
  return `${userId}|${normalizeQuery(userQuery)}`;
}

function getCachedValidatedSql(userId: string, userQuery: string): string | null {
  const key = buildValidatedSqlKey(userId, userQuery);
  const hit = validatedSqlCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    validatedSqlCache.delete(key);
    return null;
  }
  return hit.sql;
}

function setCachedValidatedSql(userId: string, userQuery: string, sql: string): void {
  const key = buildValidatedSqlKey(userId, userQuery);
  validatedSqlCache.set(key, { sql, expiresAt: Date.now() + VALIDATED_SQL_TTL_MS });
}

async function getSchemaContextCached(): Promise<string> {
  if (schemaCache.schema && Date.now() < schemaCache.expiresAt) {
    return schemaCache.schema;
  }
  const schema = await dbClient.getDatabaseSchema();
  schemaCache = { schema, expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS };
  return schema;
}

async function getSchemaContextForRequest(req: Request): Promise<string> {
  const reqAny = req as any;
  if (!reqAny._schemaContextPromise) {
    reqAny._schemaContextPromise = getSchemaContextCached();
  }
  return reqAny._schemaContextPromise;
}

async function attemptSimpleOrderQuery(
  userQuery: string,
  limit: number,
  offset: number
): Promise<{ rows: any[]; generatedSQL: string } | null> {
  const patterns = [
    /find all orders of\s+(.+)/i,
    /show me all orders of\s+(.+)/i,
    /all orders for\s+(.+)/i,
    /orders of\s+(.+)/i,
  ];

  let match: RegExpMatchArray | null = null;
  for (const pattern of patterns) {
    match = userQuery.match(pattern);
    if (match) break;
  }

  if (!match) {
    return null;
  }

  const customer = match[1].trim().replace(/[?.!]$/, '');
  const yearMatch = userQuery.match(/(19|20)\d{2}/);
  const yearFilter = yearMatch ? parseInt(yearMatch[0], 10) : null;
  const sql = `
    SELECT
      a.Nummer,
      a.Datum,
      a.Name,
      a.Kundennumm
    FROM auftrag a
    JOIN kunde k ON a.Kundennumm = k.Kundennumm
    WHERE k.Name LIKE $1
    ${yearFilter ? 'AND YEAR(a.Datum) = $4' : ''}
    ORDER BY a.Datum DESC
    OFFSET $2 ROWS FETCH NEXT $3 ROWS ONLY;
  `;

  const params = yearFilter
    ? [`%${customer}%`, offset, limit, yearFilter]
    : [`%${customer}%`, offset, limit];
  const result = await dbClient.query(sql, params);
  return { rows: result.rows, generatedSQL: sql };
}

async function attemptSimpleCompanyListQuery(
  userQuery: string,
  limit: number,
  offset: number
): Promise<{ rows: any[]; generatedSQL: string } | null> {
  const normalized = userQuery.toLowerCase();
  if (!/(list|show|give me|get|display|all).*(companies|clients|customers?)/.test(normalized)) {
    return null;
  }

  const sql = `
    SELECT
      k.Name,
      k.Kundennumm,
      k.Land,
      k.Ort
    FROM kunde k
    ORDER BY k.Name ASC
    OFFSET $1 ROWS FETCH NEXT $2 ROWS ONLY;
  `;

  const result = await dbClient.query(sql, [offset, limit]);
  return { rows: result.rows, generatedSQL: sql };
}

async function attemptSimpleCustomerNamesQuery(
  userQuery: string,
  limit: number,
  offset: number
): Promise<{ rows: any[]; generatedSQL: string } | null> {
  const normalized = userQuery.toLowerCase();
  if (
    !(
      /(name[s]?|list).*(customers?|clients)/.test(normalized) ||
      /(customers?|clients).*(name[s]?|list)/.test(normalized)
    )
  ) {
    return null;
  }

  const sql = `
    SELECT
      k.Name
    FROM kunde k
    ORDER BY k.Name ASC
    OFFSET $1 ROWS FETCH NEXT $2 ROWS ONLY;
  `;

  const result = await dbClient.query(sql, [offset, limit]);
  return { rows: result.rows, generatedSQL: sql };
}

async function attemptSimpleProfitQuery(
  userQuery: string,
  limit: number,
  offset: number
): Promise<{ rows: any[]; generatedSQL: string } | null> {
  const normalized = userQuery.toLowerCase();
  if (!/profit/.test(normalized)) return null;

  const yearMatch = userQuery.match(/(19|20)\d{2}/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  if (!year) return null;

  const productMatch =
    userQuery.match(/with\s+([^0-9]+?)(?:\s+in\s+(19|20)\d{2}|$)/i) ||
    userQuery.match(/profit\s+(?:for|from|of)\s+([^0-9]+?)(?:\s+in\s+(19|20)\d{2}|$)/i) ||
    userQuery.match(/software\s+([\w\s]+?)(?:\s+in\s+(19|20)\d{2}|$)/i);

  const product = productMatch ? productMatch[1].trim() : '%';

  const sql = `
    SELECT
      SUM(ap.Summe - COALESCE(ap.Fremdsumme, 0)) AS total_profit
    FROM anposten ap
    JOIN rechnung r ON ap.Nummer = r.Nummer
    WHERE ap.Artikelnum LIKE $1
      AND YEAR(r.Datum) = $2;
  `;

  const result = await dbClient.query(sql, [`${product}%`, year]);
  return { rows: result.rows, generatedSQL: sql };
}

async function attemptMaintenanceIntervalQuery(
  userQuery: string,
  limit: number,
  offset: number
): Promise<{ rows: any[]; generatedSQL: string } | null> {
  const normalized = userQuery.toLowerCase();
  if (!/maintenance/.test(normalized)) return null;

  const companyMatch = userQuery.match(/maintenance\s+(?:at|for)\s+(.+)/i);
  const company = companyMatch ? companyMatch[1].trim() : null;
  if (!company) return null;

  const sql = `
    WITH maintenance_events AS (
      SELECT
        w.Kundennumm,
        w.Name,
        w.Datum,
        LEAD(w.Datum) OVER (PARTITION BY w.Kundennumm ORDER BY w.Datum) AS next_datum
      FROM wartung w
      WHERE w.Name LIKE $1
         OR w.Kundennumm IN (
              SELECT k.Kundennumm FROM kunde k WHERE k.Name LIKE $1
           )
    )
    SELECT
      AVG(DATEDIFF(DAY, Datum, next_datum)) AS avg_days_between_maintenance
    FROM maintenance_events
    WHERE next_datum IS NOT NULL;
  `;

  const result = await dbClient.query(sql, [`%${company}%`]);
  return { rows: result.rows, generatedSQL: sql };
}

/**
 * Natural Language Analytics Query Endpoint
 * POST /api/analytics/query
 *
 * Converts natural language to SQL and executes safely
 */
router.post('/query', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  const requestId = (req as any).id;
  const userId = req.user?.userId;
  const auditLogger = (req.app as any).auditLogger as AuditLogger;

  try {
    // Validate request
    const { error, value } = querySchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: error.details[0].message,
        requestId,
      });
      return;
    }

    const { query, limit, offset, masked } = value;
    const cacheKey = buildCacheKey(userId || 'UNKNOWN', query, { masked, limit, offset });
    const cached = await getCachedQuery(cacheKey);
    if (cached?.result_data) {
      const cachedData = cached.result_data as Record<string, any>;
      cachedData.metadata = {
        ...(cachedData.metadata || {}),
        requestId,
        cacheHit: true,
        executionTime: 0,
      };

      await dbClient.query(
        `UPDATE query_cache
         SET access_count = access_count + 1
         WHERE query_hash = $1`,
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

      res.status(200).json({
        success: true,
        data: cachedData,
      });
      return;
    }

    // Log audit trail
    auditLogger.log({
      timestamp: new Date(),
      action: 'QUERY_SUBMITTED',
      userId: userId || 'UNKNOWN',
      resource: 'ANALYTICS_QUERY',
      details: { query: query.substring(0, 100), userId: req.user?.userId },
      severity: 'INFO',
    });

    // Check query limit
    const rbac = (req as any).rbac;
    if (rbac && rbac.queryLimit && rbac.queryLimit > 0) {
      // TODO: Implement query rate limiting per user/hour
    }

    // 1. Generate SQL using cached validated SQL, direct SQL, or LLM.
    const { schema: schemaForPrompt, tables: schemaTables } = await getSchemaContextForQuery(req, query);
    if (!FORCE_LLM_ONLY) {
      const simpleResult = await attemptSimpleOrderQuery(query, limit ?? 1000, offset ?? 0);
      if (simpleResult) {
        const visualizationType = responseParser.recommendVisualization(simpleResult.rows);
        res.status(200).json({
          success: true,
          data: {
            query,
            generatedSQL: simpleResult.generatedSQL,
            result: simpleResult.rows,
            summary: `Returned ${simpleResult.rows.length} order(s) matching your request`,
            insights: [] as string[],
            statistics: responseParser.calculateStatistics(simpleResult.rows),
            visualization: {
              type: visualizationType,
              data: responseParser.formatForVisualization(simpleResult.rows, visualizationType),
            },
            metadata: {
              recordCount: simpleResult.rows.length,
              executionTime: 0,
              masked: false,
              requestId,
            },
          },
        });
        return;
      }
  
      const companyResult = await attemptSimpleCompanyListQuery(query, limit ?? 1000, offset ?? 0);
      if (companyResult) {
        const visualizationType = responseParser.recommendVisualization(companyResult.rows);
        res.status(200).json({
          success: true,
          data: {
            query,
            generatedSQL: companyResult.generatedSQL,
            result: companyResult.rows,
            summary: `Returned ${companyResult.rows.length} companies`,
            insights: [] as string[],
            statistics: responseParser.calculateStatistics(companyResult.rows),
            visualization: {
              type: visualizationType,
              data: responseParser.formatForVisualization(companyResult.rows, visualizationType),
            },
            metadata: {
              recordCount: companyResult.rows.length,
              executionTime: 0,
              masked: false,
              requestId,
            },
          },
        });
        return;
      }
  
      const customerNamesResult = await attemptSimpleCustomerNamesQuery(query, limit ?? 1000, offset ?? 0);
      if (customerNamesResult) {
        const visualizationType = responseParser.recommendVisualization(customerNamesResult.rows);
        res.status(200).json({
          success: true,
          data: {
            query,
            generatedSQL: customerNamesResult.generatedSQL,
            result: customerNamesResult.rows,
            summary: `Returned ${customerNamesResult.rows.length} customer names`,
            insights: [] as string[],
            statistics: responseParser.calculateStatistics(customerNamesResult.rows),
            visualization: {
              type: visualizationType,
              data: responseParser.formatForVisualization(customerNamesResult.rows, visualizationType),
            },
            metadata: {
              recordCount: customerNamesResult.rows.length,
              executionTime: 0,
              masked: false,
              requestId,
            },
          },
        });
        return;
      }
  
      const profitResult = await attemptSimpleProfitQuery(query, limit ?? 1000, offset ?? 0);
      if (profitResult) {
        res.status(200).json({
          success: true,
          data: {
            query,
            generatedSQL: profitResult.generatedSQL,
            result: profitResult.rows,
            summary: 'Calculated total profit',
            insights: [],
            statistics: responseParser.calculateStatistics(profitResult.rows),
            visualization: {
              type: 'TABLE',
              data: responseParser.formatForVisualization(profitResult.rows, 'TABLE'),
            },
            metadata: {
              recordCount: profitResult.rows.length,
              executionTime: 0,
              masked: false,
              requestId,
            },
          },
        });
        return;
      }
  
      const maintenanceResult = await attemptMaintenanceIntervalQuery(query, limit ?? 1000, offset ?? 0);
      if (maintenanceResult) {
        res.status(200).json({
          success: true,
          data: {
            query,
            generatedSQL: maintenanceResult.generatedSQL,
            result: maintenanceResult.rows,
            summary: 'Calculated average maintenance interval',
            insights: [],
            statistics: responseParser.calculateStatistics(maintenanceResult.rows),
            visualization: {
              type: 'TABLE',
              data: responseParser.formatForVisualization(maintenanceResult.rows, 'TABLE'),
            },
            metadata: {
              recordCount: maintenanceResult.rows.length,
              executionTime: 0,
              masked: false,
              requestId,
            },
          },
        });
        return;
      }
    }
    const directSqlCandidate = ensureTopLimit(extractSqlStatement(query));
    const isDirectSql = /^(SELECT|WITH)\b/i.test(directSqlCandidate);
    const cachedValidatedSql = !isDirectSql ? getCachedValidatedSql(userId || 'UNKNOWN', query) : null;
    const generated = isDirectSql
      ? { sql: directSqlCandidate, issues: await validateGeneratedSQL(directSqlCandidate) }
      : cachedValidatedSql
        ? { sql: cachedValidatedSql, issues: await validateGeneratedSQL(cachedValidatedSql) }
        : await generateBestSQL(query, schemaForPrompt, getRelevantTranslations(schemaTables));
    const generatedSQL = generated.sql;

    // 2. Validate generated SQL
    const validationIssues = generated.issues;
    const hasErrors = validationIssues.some(issue => issue.type === 'ERROR');

    if (hasErrors) {
      auditLogger.log({
        timestamp: new Date(),
        action: 'QUERY_REJECTED',
        userId: userId || 'UNKNOWN',
        resource: 'ANALYTICS_QUERY',
        details: { reason: 'SQL_VALIDATION_FAILED', issues: validationIssues },
        severity: 'WARNING',
      });

      res.status(400).json({
        error: 'SQL_VALIDATION_FAILED',
        message: 'Generated SQL failed validation checks',
        issues: validationIssues,
        requestId,
      });
      return;
    }

    // 4. Execute query
    const queryStart = Date.now();
    const executableSQL = translateTableNames(generatedSQL);
    // If the SQL still contains positional placeholders ($1...), bind NULLs to avoid @pN declaration errors
    const paramMatches = Array.from(executableSQL.matchAll(/\$([1-9]\d*)/g)) as RegExpMatchArray[];
    const paramNumbers: number[] = paramMatches.map((m: RegExpMatchArray): number => parseInt(m[1], 10));
    const maxParam = paramNumbers.length ? Math.max(...paramNumbers) : 0;
    const autoParams = maxParam > 0
      ? Array.from({ length: maxParam }, () => null as null)
      : undefined;
    const result = await dbClient.query(executableSQL, autoParams);
    const queryDuration = Date.now() - queryStart;

    // 5. Parse and enhance response
    const parsedResponse = await responseParser.parseQueryResult(
      result.rows,
      query,
      query
    );

    // 6. Apply PII masking if requested and no FULL access
    let finalResult = parsedResponse.queryResult;
    let masked_applied = false;

    if (masked && rbac.dataAccessLevel !== 'FULL') {
      finalResult = piiMasker.maskObject(finalResult);
      masked_applied = true;
    }

    // 7. Prepare response
    const visualizationType = responseParser.recommendVisualization(finalResult);
    const statistics = responseParser.calculateStatistics(finalResult);
    const visualData = responseParser.formatForVisualization(finalResult, visualizationType);

    const response = {
      success: true,
      data: {
        query,
        generatedSQL: sqlGenerator.formatSQL(generatedSQL),
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
          masked: masked_applied,
          requestId,
        },
      },
    };
    await upsertQueryCache(
      cacheKey,
      userId || 'UNKNOWN',
      query,
      generatedSQL,
      response.data,
      response.data.metadata.executionTime,
      response.data.metadata.recordCount
    );

    // Log successful query
    auditLogger.log({
      timestamp: new Date(),
      action: 'QUERY_EXECUTED',
      userId: userId || 'UNKNOWN',
      resource: 'ANALYTICS_QUERY',
      details: {
        query: query.substring(0, 100),
        executionTime: queryDuration,
        recordCount: response.data.metadata.recordCount,
        masked: masked_applied,
      },
      severity: 'INFO',
    });

    res.status(200).json(response);
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

    res.status(500).json({
      error: 'QUERY_EXECUTION_ERROR',
      message: errorMessage,
      requestId,
    });
  }
});

router.get("/chart/:metric", async (req: Request, res: Response) => {
  const { metric } = req.params;
  const startTime = Date.now();


  try {
    let query = "";

    switch (metric) {
      case "revenue":
        query = `
          SELECT TOP 30 metric_date AS date, value
          FROM financial_metrics
          WHERE metric_type = 'REVENUE'
          ORDER BY metric_date DESC;
        `;
        break;

      case "queries":
        query = `
          SELECT TOP 30 CAST(created_at AS DATE) AS date,
                 COUNT(*) AS value
          FROM query_history
          GROUP BY CAST(created_at AS DATE)
          ORDER BY date DESC;
        `;
        break;

      case "latency":
        query = `
          SELECT TOP 30 CAST(created_at AS DATE) AS date,
                 ROUND(AVG(execution_time), 0) AS value
          FROM query_history
          GROUP BY CAST(created_at AS DATE)
          ORDER BY date DESC;
        `;
        break;

      case "users":
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
        return res.status(400).json({ error: "Invalid metric" });
    }


    const result = await dbClient.query(query);


    if (!result.rows || result.rows.length === 0) {
      console.warn(
        `[CHART] Empty result set | metric=${metric}`
      );
    }

    return res.json({
      success: true,
      data: result.rows,
    });

  } catch (err: any) {
    const duration = Date.now() - startTime;

    console.error(
      `[CHART] ERROR | metric=${metric} | duration=${duration}ms`
    );

    console.error("Message:", err.message);
    console.error("Stack:", err.stack);

    return res.status(500).json({
      error: "CHART_ERROR",
      message: err.message, // helpful during debugging (remove in prod if needed)
    });
  }
});
/**
 * Validate Natural Language Query
 * POST /api/analytics/validate
 *
 * Tests query without executing it
 */
router.post('/validate', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  const requestId = (req as any).id;
  const userId = req.user?.userId || 'UNKNOWN';
  const startTime = Date.now();

  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      console.warn(`[validate][invalid_request] requestId=${requestId} userId=${userId} reason=query_missing_or_invalid`);
      res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Query parameter required',
      });
      return;
    }

    const includeExplanation = req.body?.includeExplanation === true;
    const { schema: dbSchema, tables: schemaTables } = await getSchemaContextForQuery(req, query);
    if (!FORCE_LLM_ONLY) {
      const simpleOrderValidation = await attemptSimpleOrderQuery(query, 100, 0);
      if (simpleOrderValidation) {
        res.status(200).json({
          success: true,
          query,
          generatedSQL: simpleOrderValidation.generatedSQL,
          validation: {
            issues: [],
            valid: true,
          },
        });
        return;
      }
  
      const companyListValidation = await attemptSimpleCompanyListQuery(query, 100, 0);
      if (companyListValidation) {
        res.status(200).json({
          success: true,
          query,
          generatedSQL: companyListValidation.generatedSQL,
          validation: {
            issues: [],
            valid: true,
          },
        });
        return;
      }
  
      const customerNamesValidation = await attemptSimpleCustomerNamesQuery(query, 100, 0);
      if (customerNamesValidation) {
        res.status(200).json({
          success: true,
          query,
          generatedSQL: customerNamesValidation.generatedSQL,
          validation: {
            issues: [],
            valid: true,
          },
        });
        return;
      }
  
      const profitValidation = await attemptSimpleProfitQuery(query, 100, 0);
      if (profitValidation) {
        res.status(200).json({
          success: true,
          query,
          generatedSQL: profitValidation.generatedSQL,
          validation: {
            issues: [],
            valid: true,
          },
        });
        return;
      }
  
      const maintenanceValidation = await attemptMaintenanceIntervalQuery(query, 100, 0);
      if (maintenanceValidation) {
        res.status(200).json({
          success: true,
          query,
          generatedSQL: maintenanceValidation.generatedSQL,
          validation: {
            issues: [],
            valid: true,
          },
        });
        return;
      }
    }

    // Generate SQL
    const generated = await generateBestSQL(query, dbSchema, getRelevantTranslations(schemaTables));
    const generatedSQL = generated.sql;
    // Validate
    const issues = generated.issues;
    //const complexity = sqlValidator.analyzeComplexity(generatedSQL);
    let explanation: string | undefined;
    if (includeExplanation) {
      explanation = await generateSQLExplanation(generatedSQL);
    }

    if (issues.every(issue => issue.type !== 'ERROR')) {
      setCachedValidatedSql(userId, query, generatedSQL);
    }

    res.status(200).json({
      success: true,
      query,
      generatedSQL: sqlGenerator.formatSQL(generatedSQL),
      validation: {
        issues,
        valid: issues.every(issue => issue.type !== 'ERROR'),
      },
      //complexity,
      explanation,
    });
  } catch (error) {
    console.error(`[validate][error] requestId=${requestId} userId=${userId} totalMs=${Date.now() - startTime} message=${(error as Error).message}`);
    console.error(error);
    res.status(500).json({
      error: 'VALIDATION_ERROR',
      message: (error as Error).message,
    });
  }
});

/**
 * Direct SQL Query Execution (No LLM Required)
 * POST /api/analytics/direct-query
 *
 * Executes raw SQL directly without natural language processing.
 * Useful for testing and when Ollama is not available.
 */
router.post('/direct-query', requirePermission('analytics:query:read'), async (req: Request, res: Response) => {
  const requestId = (req as any).id;
  const userId = req.user?.userId;
  const auditLogger = (req.app as any).auditLogger as AuditLogger;
  const startTime = Date.now();

  try {
    const { error, value } = querySchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: error.details[0].message,
        requestId,
      });
      return;
    }

    const { query, limit = 1000, offset = 0, masked: mask_pii = true } = value;

    // Validate SQL syntax
    const validationIssues = sqlValidator.validate(query);
    const hasErrors = validationIssues.some(issue => issue.type === 'ERROR');

    if (hasErrors) {
      const errorMessages = validationIssues
        .filter(i => i.type === 'ERROR')
        .map(i => i.message);
      
      res.status(400).json({
        error: 'INVALID_SQL',
        message: 'SQL validation failed',
        issues: errorMessages,
        requestId,
      });
      return;
    }

    // Execute the query
    const queryStartTime = performance.now();
    const executableQuery = translateTableNames(query);
    const result = await dbClient.query(executableQuery);
    const executionTime = Math.round(performance.now() - queryStartTime);

    // Apply PII masking if requested
    const rows = mask_pii ? result.rows.map((row: any) => {
      const masked = { ...row };
      Object.keys(masked).forEach(key => {
        if (typeof masked[key] === 'string') {
          masked[key] = piiMasker.maskString(masked[key]);
        }
      });
      return masked;
    }) : result.rows;

    // Format response
    const columns = result.fields?.map((f: any) => f.name) || [];
    const rowCount = rows.length;

    auditLogger.log({
      timestamp: new Date(),
      action: 'DIRECT_QUERY_EXECUTED',
      userId: userId || 'UNKNOWN',
      resource: 'ANALYTICS_QUERY',
      details: {
        query: query.substring(0, 100),
        executionTime,
        recordCount: rowCount,
        masked: mask_pii,
      },
      severity: 'INFO',
    });

    res.status(200).json({
      success: true,
      data: {
        columns,
        rows,
        rowCount,
        metadata: {
          executionTime,
          recordCount: rowCount,
          limit,
          offset,
          totalTime: Date.now() - startTime,
        },
      },
    });
  } catch (error) {
    const errorMessage = (error as Error).message;

    auditLogger.log({
      timestamp: new Date(),
      action: 'DIRECT_QUERY_ERROR',
      userId: userId || 'UNKNOWN',
      resource: 'ANALYTICS_QUERY',
      details: { error: errorMessage },
      severity: 'ERROR',
    });

    res.status(500).json({
      error: 'QUERY_EXECUTION_ERROR',
      message: errorMessage,
      requestId,
    });
  }
});

/**
 * Get Available Tables and Schema
 * GET /api/analytics/schema
 */
router.get(
  "/analytics/insights",
  requirePermission("analytics:query:read"),
  async (req: Request, res: Response) => {
    try {
      const totalQueries = await dbClient.query(`
        SELECT COUNT(*) AS count FROM query_history
      `);

      const activeSessions = await dbClient.query(`
        SELECT COUNT(*) AS count FROM user_sessions
        WHERE is_active = 1
      `);

      const avgQueryTime = await dbClient.query(`
        SELECT AVG(execution_time) AS avg
        FROM query_history
        WHERE execution_time IS NOT NULL
      `);

      const successRate = await dbClient.query(`
        SELECT 
          ROUND(
            (SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 1.0 
             / NULLIF(COUNT(*), 0)) * 100, 2
          ) AS rate
        FROM query_history;
      `);

      res.json({
        success: true,
        data: {
          totalQueries: totalQueries.rows[0].count,
          activeSessions: activeSessions.rows[0].count,
          avgQueryTime: Math.round(avgQueryTime.rows[0].avg || 0),
          successRate: successRate.rows[0].rate || 0,
        },
      });
    } catch (error) {
      res.status(500).json({
        error: "INSIGHTS_ERROR",
        message: (error as Error).message,
      });
    }
  }
);

/**
 * Export Query Results
 * POST /api/analytics/export
 */
router.post(
  '/export',
  requirePermission('analytics:export:read'),
  async (req: Request, res: Response) => {
    try {
      const { query, format } = req.body;

      if (!query || !['csv', 'json', 'xlsx'].includes(format)) {
        res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Query and format (csv/json/xlsx) required',
        });
        return;
      }

      // Execute query
      const { schema: dbSchema, tables: schemaTables } = await getSchemaContextForQuery(req, query);
      const sqlPrompt = promptBuilder.buildSQLGenerationPrompt(query, dbSchema, {
        translationHints: getRelevantTranslations(schemaTables),
      });
      const rawGeneratedSQL = await llmClient.generate(sqlPrompt, { temperature: 0.2 });
      const generatedSQL = extractSqlStatement(rawGeneratedSQL);

      const result = await dbClient.query(generatedSQL);

      // Format based on request
      let exportData: string | Buffer;
      let contentType: string;

      if (format === 'json') {
        exportData = JSON.stringify(result.rows, null, 2);
        contentType = 'application/json';
      } else if (format === 'csv') {
        exportData = convertToCSV(result.rows);
        contentType = 'text/csv';
      } else {
        // xlsx would require additional library
        res.status(501).json({
          error: 'NOT_IMPLEMENTED',
          message: 'XLSX export coming soon',
        });
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="export.${format}"`);
      res.send(exportData);
    } catch (error) {
      res.status(500).json({
        error: 'EXPORT_ERROR',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * Helper: Generate SQL explanation
 */
async function generateSQLExplanation(sql: string): Promise<string> {
  try {
    const prompt = promptBuilder.buildExplanationPrompt(sql);
    return await llmClient.generate(prompt, { temperature: 0.3 });
  } catch {
    return 'Unable to generate explanation';
  }
}

function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildCacheKey(
  userId: string,
  query: string,
  options: { masked: boolean; limit: number; offset: number }
): string {
  const normalized = normalizeQuery(query);
  const raw = `${userId}|${normalized}|masked:${options.masked}|limit:${options.limit}|offset:${options.offset}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function getCachedQuery(queryHash: string): Promise<Record<string, any> | null> {
  const result = await dbClient.getRow<Record<string, any>>(
    `SELECT query_hash, result_data, generated_sql, execution_time, record_count, created_at, expires_at
     FROM query_cache
     WHERE query_hash = $1
       AND (expires_at IS NULL OR expires_at > GETUTCDATE())`,
    [queryHash]
  );

  if (result && typeof result.result_data === 'string') {
    try {
      result.result_data = JSON.parse(result.result_data);
    } catch {
      // Keep raw string if parsing fails
    }
  }

  return result || null;
}

async function upsertQueryCache(
  queryHash: string,
  userId: string,
  originalQuery: string,
  generatedSQL: string,
  responseData: Record<string, any>,
  executionTime: number,
  recordCount: number
): Promise<void> {
  await dbClient.query(
    `
      MERGE INTO query_cache AS target
      USING (SELECT $1 AS query_hash) AS source
      ON target.query_hash = source.query_hash
      WHEN MATCHED THEN
        UPDATE SET
          user_id = $2,
          original_query = $3,
          generated_sql = $4,
          result_data = $5,
          execution_time = $6,
          record_count = $7,
          expires_at = DATEADD(SECOND, $8, GETUTCDATE()),
          access_count = target.access_count + 1
      WHEN NOT MATCHED THEN
        INSERT (
          query_hash,
          user_id,
          original_query,
          generated_sql,
          result_data,
          execution_time,
          record_count,
          expires_at,
          access_count,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          DATEADD(SECOND, $8, GETUTCDATE()),
          1,
          GETUTCDATE()
        );
    `,
    [
      queryHash,
      userId,
      originalQuery,
      generatedSQL,
      JSON.stringify(responseData),
      executionTime,
      recordCount,
      QUERY_CACHE_TTL_SECONDS,
    ]
  );
}

/**
 * Helper: Extract first SQL statement from LLM output
 * Removes markdown/code-fences and trims noisy text before/after SQL.
 */
function extractSqlStatement(rawText: string): string {
  if (!rawText) return '';

  let text = rawText
    .replace(/```sql/gi, '')
    .replace(/```/g, '')
    .replace(/^SQL:\s*/i, '')
    .replace(/^ANSWER:\s*/i, '')
    .trim();

  const startMatch = text.match(/\b(SELECT|WITH)\b/i);
  if (!startMatch || startMatch.index === undefined) {
    return text;
  }

  text = text.slice(startMatch.index).trim();

  // Cut off common non-SQL narrative tails produced by LLMs.
  const stopMarkers = [
    /\bOutput\s+Explanation\s*:/i,
    /\bExplanation\s*:/i,
    /\bReasoning\s*:/i,
    /\bAnswer\s*:/i,
    /\bQuestion\s*:/i,
    /\bNotes?\s*:/i,
    /\bPlease\s+note\b/i,
    /\bYour\s+task\b/i,
    /\bRewrite\b/i,
    /\bAs\s+an\s+AI\b/i,
    /^##/im,
  ];

  let cutIndex = -1;
  for (const marker of stopMarkers) {
    const match = marker.exec(text);
    if (match && match.index >= 0) {
      cutIndex = cutIndex === -1 ? match.index : Math.min(cutIndex, match.index);
    }
  }
  if (cutIndex >= 0) {
    text = text.slice(0, cutIndex).trim();
  }

  // If model starts a new paragraph without SQL continuation, stop at that boundary.
  const paragraphBreak = /\n\s*\n/.exec(text);
  if (paragraphBreak && paragraphBreak.index >= 0) {
    const afterBreak = text.slice(paragraphBreak.index).trim().toUpperCase();
    const sqlClauseStarters = [
      'SELECT', 'WITH', 'FROM', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL',
      'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'HAVING', 'UNION'
    ];
    const isSqlContinuation = sqlClauseStarters.some(clause => afterBreak.startsWith(clause));
    if (!isSqlContinuation) {
      text = text.slice(0, paragraphBreak.index).trim();
    }
  }

  const semicolonIndex = text.indexOf(';');
  if (semicolonIndex >= 0) {
    return normalizeExtractedSql(text.slice(0, semicolonIndex + 1).trim());
  }

  return normalizeExtractedSql(text.trim());
}

/**
 * Helper: Normalize extracted SQL for common malformed endings.
 */
function normalizeExtractedSql(sql: string): string {
  let normalized = sql.trim();

  // Remove trailing markdown-like junk tokens.
  normalized = normalized.replace(/[`#]+$/g, '').trim();

  // Fix dangling LIMIT produced by some model outputs.
  if (/\bLIMIT\s*$/i.test(normalized)) {
    normalized = `${normalized} 100`;
  }

  // If LIMIT is followed by non-numeric/non-parameter text, normalize to LIMIT 100.
  normalized = normalized.replace(/\bLIMIT\s+(?!\d+\b|\$\d+\b)[\s\S]*$/i, 'LIMIT 100');

  // Fix common hallucinated product columns to actual schema.
  normalized = normalized
    .replace(/\bproducts\.product_name\b/gi, 'products.name')
    .replace(/\bp\.product_name\b/gi, 'p.name')
    .replace(/\bproducts\.category_name\b/gi, 'products.category')
    .replace(/\bp\.category_name\b/gi, 'p.category')
    .replace(/\bproducts\.product_category\b/gi, 'products.category')
    .replace(/\bp\.product_category\b/gi, 'p.category')
    .replace(/\bproducts\.service\b/gi, 'products.category')
    .replace(/\bp\.service\b/gi, 'p.category');

  // Fix malformed LIKE patterns: LIKE %foo% -> LIKE '%foo%'
  normalized = normalized.replace(
    /\b(LIKE|ILIKE)\s+%([A-Za-z0-9_\- ]+)%/gi,
    (_m, op, value) => `${op} '%${String(value).trim()}%'`
  );

  // Remove accidental trailing unmatched quote from model output.
  if ((normalized.match(/"/g) || []).length % 2 !== 0) {
    normalized = normalized.replace(/"\s*$/, '');
  }

  return normalized.trim();
}

/**
 * Helper: Convert to CSV
 */
function convertToCSV(data: any[]): string {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => JSON.stringify(row[h])).join(',')),
  ];

  return csv.join('\n');
}

export default router;
