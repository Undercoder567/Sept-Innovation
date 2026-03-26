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

const router = Router();
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
    await dbClient.explainQuery(sql);
  } catch (explainError) {
    issues.push(buildSchemaIssue(explainError));
  }
  return issues;
}

function toIssueStrings(issues: ValidationIssue[]): string[] {
  return issues.map(issue => `${issue.code}: ${issue.message}`);
}

async function generateBestSQL(userQuery: string, dbSchema: string): Promise<{ sql: string; issues: ValidationIssue[] }> {
  const MAX_ATTEMPTS = 3;
  let candidate = '';
  let issues: ValidationIssue[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt === 1) {
      const prompt = promptBuilder.buildSQLGenerationPrompt(userQuery, dbSchema);
      const raw = await llmClient.generate(prompt, { temperature: 0.15 });
      candidate = extractSqlStatement(raw);
    } else {
      const repairPrompt = promptBuilder.buildSQLRepairPrompt(
        userQuery,
        dbSchema,
        candidate,
        toIssueStrings(issues)
      );
      const raw = await llmClient.generate(repairPrompt, { temperature: 0.05 });
      candidate = extractSqlStatement(raw);
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
    const directSqlCandidate = extractSqlStatement(query);
    const isDirectSql = /^(SELECT|WITH)\b/i.test(directSqlCandidate);
    const cachedValidatedSql = !isDirectSql ? getCachedValidatedSql(userId || 'UNKNOWN', query) : null;
    const generated = isDirectSql
      ? { sql: directSqlCandidate, issues: await validateGeneratedSQL(directSqlCandidate) }
      : cachedValidatedSql
        ? { sql: cachedValidatedSql, issues: await validateGeneratedSQL(cachedValidatedSql) }
        : await generateBestSQL(query, await getSchemaContextForRequest(req));
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
    const result = await dbClient.query(generatedSQL);
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
    // Get schema
    const ALL_TABLES = [
  "sales",
  "customers",
  "products",
  "employees",
  "financial_metrics",
  "inventory_movements",
  "customer_activity",
  "query_history",
  "query_cache",
  "user_sessions",
  "audit_logs"
];
function detectRelevantTables(query: string) {
  const q = query.toLowerCase();

  const mapping: Record<string, string[]> = {
    sales: ["sale", "revenue", "order", "purchase"],
    customers: ["customer", "client"],
    products: ["product", "item"],
    employees: ["employee", "staff"],
    financial_metrics: ["profit", "finance", "revenue", "cost"],
    inventory_movements: ["inventory", "stock"],
    customer_activity: ["activity", "login", "engagement"]
  };

  const selected = new Set<string>();

  for (const table in mapping) {
    for (const word of mapping[table]) {
      if (q.includes(word)) {
        selected.add(table);
      }
    }
  }

  if (selected.size === 0) {
    selected.add("sales");
    selected.add("customers");
  }

  return [...selected];
}
async function getFilteredSchema(req: any, tables: string[]) {
  const fullSchema = await getSchemaContextForRequest(req);

  const schemaParts = fullSchema.split("CREATE TABLE");

  const filtered = schemaParts
    .filter((block: string) =>
      tables.some((t) => block.includes(` ${t} `))
    )
    .map((b: string) => "CREATE TABLE " + b)
    .join("\n\n");

  return filtered;
}

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

     // 🔎 Detect relevant tables
  const relevantTables = detectRelevantTables(query);

  // 📦 Fetch only needed schema
  const dbSchema = await getFilteredSchema(req, relevantTables);

    // Generate SQL
    const generated = await generateBestSQL(query, dbSchema);
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
    const result = await dbClient.query(query);
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
      const dbSchema = await getSchemaContextForRequest(req);
      const sqlPrompt = promptBuilder.buildSQLGenerationPrompt(query, dbSchema);
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
