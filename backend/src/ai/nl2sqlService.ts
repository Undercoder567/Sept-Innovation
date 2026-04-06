/**
 * Natural Language to SQL Service
 * Converts natural language queries to executable SQL with hallucination detection
 * 
 * Features:
 * 1. Schema-aware SQL generation
 * 2. Hallucination detection
 * 3. Query execution
 * 4. Fallback handling
 * 5. Result caching
 * 6. Query validation
 */
/* eslint-disable no-console */

import { LLMClient } from './llmClient';
import { DatabaseClient } from '../sql/dbClient';
import { HallucinationDetector, HallucinationCheckResult } from './hallucinationDetector';
import { PromptBuilder } from './promptBuilder';
import { SQLValidator, ValidationIssue } from '../sql/sqlValidator';
import { tableTranslations } from '../semantic/tableTranslations';
import crypto from 'crypto';

interface NL2SQLRequest {
  query: string;
  userId: string;
  maxRows?: number;
  allowFallback?: boolean;
  temperature?: number;
}

interface NL2SQLResponse {
  success: boolean;
  query: string;
  sql?: string;
  results?: Record<string, unknown>[];
  resultCount?: number;
  executionTime?: number;
  cached?: boolean;
  warnings?: string[];
  error?: {
    type: 'HALLUCINATION' | 'VALIDATION' | 'EXECUTION' | 'PARSE_ERROR' | 'SCHEMA_ERROR';
    message: string;
    details?: Record<string, unknown>;
    fallbackAvailable?: boolean;
  };
}

interface CacheEntry {
  sql: string;
  results: Record<string, unknown>[];
  timestamp: number;
  userId: string;
  executionTime: number;
}

interface QueryAnalysis {
  intent: 'SEARCH' | 'AGGREGATION' | 'STATISTICS';
  tables: string[];
  filters: string[];
  confidence: number;
}

class NL2SQLService {
  private llmClient: LLMClient;
  private dbClient: DatabaseClient;
  private hallucinationDetector: HallucinationDetector;
  private promptBuilder: PromptBuilder;
  private sqlValidator: SQLValidator;
  private queryCache: Map<string, CacheEntry> = new Map();
  private cacheTTL: number = 15 * 60 * 1000; // 15 minutes
  private maxRetries: number = 2;

  constructor(
    llmClient: LLMClient,
    dbClient: DatabaseClient
  ) {
    this.llmClient = llmClient;
    this.dbClient = dbClient;
    this.hallucinationDetector = new HallucinationDetector(dbClient);
    this.promptBuilder = new PromptBuilder();
    this.sqlValidator = new SQLValidator();
  }

  /**
   * Main entry point: Convert NL to SQL and execute
   */
  async queryFromNaturalLanguage(
    request: NL2SQLRequest
  ): Promise<NL2SQLResponse> {
    const startTime = Date.now();
    const requestId = crypto.randomBytes(8).toString('hex');

    console.log(`[${requestId}] ===== NL2SQL REQUEST START =====`);
    console.log(`[${requestId}] Query: "${request.query}"`);
    console.log(`[${requestId}] User: ${request.userId}`);

    try {
      // Analyze query intent
      console.log(`[${requestId}] Step 1: Analyzing query intent...`);
      const analysis = await this.analyzeQuery(request.query);
      console.log(`[${requestId}] ✓ Intent: ${analysis.intent}`);
      console.log(`[${requestId}] ✓ Tables detected: ${analysis.tables.join(', ') || 'NONE'}`);
      console.log(`[${requestId}] ✓ Filters: ${analysis.filters.join(', ') || 'NONE'}`);
      console.log(`[${requestId}] ✓ Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);

      // Check cache first
      console.log(`[${requestId}] Step 2: Checking cache...`);
      const cacheKey = this.getCacheKey(request.query, request.userId);
      const cached = this.queryCache.get(cacheKey);
      
      if (cached && this.isCacheValid(cached)) {
        console.log(`[${requestId}] ✓ Cache hit! Returning cached results (${cached.results.length} rows)`);
        return {
          success: true,
          query: request.query,
          results: cached.results,
          resultCount: cached.results.length,
          executionTime: cached.executionTime,
          cached: true,
        };
      }
      console.log(`[${requestId}] ✗ Cache miss`);

      // Generate SQL with retries
      console.log(`[${requestId}] Step 3: Generating SQL (${this.maxRetries} attempts max)...`);
      let sql: string | null = null;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          console.log(`[${requestId}]   Attempt ${attempt + 1}/${this.maxRetries}...`);
          sql = await this.generateSQL(request.query, analysis, request.temperature, request.maxRows);
          console.log(`[${requestId}] ✓ SQL Generated (${sql.length} chars)`);
          console.log(`[${requestId}] SQL Preview: ${sql.substring(0, 100)}...`);

          if (sql) break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.log(`[${requestId}] ✗ Attempt ${attempt + 1} failed: ${(error as Error).message}`);
          if (attempt < this.maxRetries - 1) {
            console.log(`[${requestId}]   Retrying...`);
          }
        }
      }

      if (!sql) {
        console.log(`[${requestId}] ✗ SQL generation failed after ${this.maxRetries} attempts`);
        return this.handleSQLGenerationFailure(request, lastError);
      }

      // Detect hallucinations
      console.log(`[${requestId}] Step 4: Detecting hallucinations...`);
      const hallucination = await this.hallucinationDetector.detectHallucinations(
        sql,
        request.query
      );
      console.log(`[${requestId}] ✓ Hallucination check complete`);
      console.log(`[${requestId}]   Issues found: ${hallucination.issues.length}`);
      console.log(`[${requestId}]   Confidence: ${(hallucination.confidence * 100).toFixed(1)}%`);
      console.log(`[${requestId}]   Recommended action: ${hallucination.recommendedAction}`);

      if (hallucination.recommendedAction === 'BLOCK') {
        console.log(`[${requestId}] ✗ Query BLOCKED due to hallucinations`);
        hallucination.issues.forEach((issue, idx) => {
          console.log(`[${requestId}]   Issue ${idx + 1}: ${issue.type} - ${issue.message}`);
        });
        return {
          success: false,
          query: request.query,
          error: {
            type: 'HALLUCINATION',
            message: 'Generated query contains invalid table/column references',
            details: {
              issues: hallucination.issues,
              confidence: hallucination.confidence,
            },
            fallbackAvailable: request.allowFallback === true,
          },
        };
      }

      // Validate SQL
      console.log(`[${requestId}] Step 5: Validating SQL...`);
      const validationIssues = this.sqlValidator.validate(sql);
      console.log(`[${requestId}] ✓ Validation complete`);
      console.log(`[${requestId}]   Total issues: ${validationIssues.length}`);
      
      const criticalIssues = validationIssues.filter(i => i.type === 'ERROR');
      const warningIssues = validationIssues.filter(i => i.type === 'WARNING');
      console.log(`[${requestId}]   Errors: ${criticalIssues.length}`);
      console.log(`[${requestId}]   Warnings: ${warningIssues.length}`);

      if (criticalIssues.length > 0) {
        console.log(`[${requestId}] ✗ Query validation FAILED`);
        criticalIssues.forEach((issue, idx) => {
          console.log(`[${requestId}]   Error ${idx + 1}: [${issue.code}] ${issue.message}`);
        });
        return {
          success: false,
          query: request.query,
          sql,
          error: {
            type: 'VALIDATION',
            message: 'Generated SQL failed validation',
            details: { issues: criticalIssues },
            fallbackAvailable: request.allowFallback === true,
          },
        };
      }

      // Execute query
      console.log(`[${requestId}] Step 6: Executing SQL...`);
      console.log(`[${requestId}] SQL: ${sql}`);
      try {
        const results = await this.dbClient.getRows(sql, []);
        const executionTime = Date.now() - startTime;

        console.log(`[${requestId}] ✓ Query executed successfully`);
        console.log(`[${requestId}]   Rows returned: ${results.length}`);
        console.log(`[${requestId}]   Total time: ${executionTime}ms`);

        // Cache results
        this.queryCache.set(cacheKey, {
          sql,
          results,
          timestamp: Date.now(),
          userId: request.userId,
          executionTime,
        });
        console.log(`[${requestId}] ✓ Results cached`);

        const warnings = this.collectWarnings(
          validationIssues,
          hallucination
        );

        console.log(`[${requestId}] ===== NL2SQL REQUEST COMPLETE =====`);
        return {
          success: true,
          query: request.query,
          sql,
          results,
          resultCount: results.length,
          executionTime,
          cached: false,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      } catch (execError) {
        console.log(`[${requestId}] ✗ Query execution FAILED`);
        console.log(`[${requestId}] Error: ${(execError as Error).message}`);
        console.log(`[${requestId}] SQL that failed: ${sql}`);
        return {
          success: false,
          query: request.query,
          sql,
          error: {
            type: 'EXECUTION',
            message: `Failed to execute generated query: ${(execError as Error).message}`,
            fallbackAvailable: request.allowFallback === true,
          },
        };
      }
    } catch (error) {
      console.error(`[${requestId}] ✗ NL2SQL Service error:`, error);
      return {
        success: false,
        query: request.query,
        error: {
          type: 'PARSE_ERROR',
          message: `Service error: ${(error as Error).message}`,
        },
      };
    }
  }

  /**
   * Analyze user query to understand intent
   */
  private async analyzeQuery(query: string): Promise<QueryAnalysis> {
    const lower = query.toLowerCase();

    // Detect intent patterns
    let intent: 'SEARCH' | 'AGGREGATION' | 'STATISTICS' = 'SEARCH';

    if (/total|sum|count|average|mean|median|min|max|revenue|profit/i.test(lower)) {
      intent = 'AGGREGATION';
    } else if (/expected|trend|pattern|average|forecast|growth|rate|interval|maintenance/i.test(lower)) {
      intent = 'STATISTICS';
    }

    // Extract table references
    const tables = this.extractReferencedTables(query);

    // Extract filter keywords
    const filters = this.extractFilters(query);

    const confidence = this.calculateConfidence(lower, tables);
    
    // Debug logging
    console.log('[ANALYZE] Query:', query);
    console.log('[ANALYZE] Intent:', intent);
    console.log('[ANALYZE] Tables found:', tables);
    console.log('[ANALYZE] Filters:', filters);
    console.log('[ANALYZE] Confidence:', confidence);

    return {
      intent,
      tables,
      filters,
      confidence,
    };
  }

  /**
   * Generate SQL from natural language query
   */
  private async generateSQL(
    userQuery: string,
    analysis: QueryAnalysis,
    temperature: number = 0.3,
    maxRows: number = 100
  ): Promise<string> {
    try {
      console.log('[GENERATE_SQL] User query:', userQuery);
      console.log('[GENERATE_SQL] Intent:', analysis.intent);
      console.log('[GENERATE_SQL] Tables:', analysis.tables);

      // Get relevant schema context
      const schema = await this.getSchemaContext(analysis.tables);
      console.log('[GENERATE_SQL] Schema context length:', schema.length);
      console.log('[GENERATE_SQL] Schema preview:', schema.substring(0, 200));

      // Build prompt with strong constraints
      const prompt = this.buildOptimizedPrompt(userQuery, schema, analysis, maxRows);
      console.log('[GENERATE_SQL] Prompt length:', prompt.length);
      console.log('[GENERATE_SQL] Prompt:', prompt);

      // Generate SQL with low temperature for accuracy
      console.log('[GENERATE_SQL] Calling LLM with temperature:', temperature || 0.3);
      const response = await this.llmClient.generate(prompt, {
        temperature: temperature || 0.3,
        topK: 20,
        topP: 0.8,
      });

      console.log('[GENERATE_SQL] LLM Response length:', response.length);
      console.log('[GENERATE_SQL] LLM Response:', response);

      // Extract SQL from response (it might have markdown code blocks)
      const sql = this.extractSQL(response);

      console.log('[GENERATE_SQL] Extracted SQL length:', sql.length);
      console.log('[GENERATE_SQL] Extracted SQL:', sql);

      if (!sql || sql.trim().length === 0) {
        throw new Error('LLM returned empty SQL');
      }

      return sql;
    } catch (error) {
      console.error('[GENERATE_SQL] ✗ Error:', (error as Error).message);
      throw error;
    }
  }

  /**
   * Build optimized prompt for accurate SQL generation - COMPACT for Phi model
   */
  private buildOptimizedPrompt(
    userQuery: string,
    schemaContext: string,
    analysis: QueryAnalysis,
    maxRows: number = 100
  ): string {
    const prompt = `SQL Server T-SQL expert. Generate ONLY the SQL query.

RULES:
1. Output ONLY SQL - no markdown
2. Use exact table/column names from schema
3. Specify columns (no SELECT *)
4. Use WHERE, JOIN, GROUP BY as needed
5. TOP ${maxRows} to limit results
6. Read-only SELECT only

SCHEMA: ${schemaContext}

USER: "${userQuery}"

SQL:`;

    return prompt;
  }

  /**
   * Get schema context for relevant tables - OPTIMIZED for smaller models
   * Only includes essential columns to reduce token count
   */
  private async getSchemaContext(_tables: string[]): Promise<string> {
    try {
      // Common columns that should be included for analysis
      const essentialColumns = [
        'id', 'auftragid', 'postenid', 'kundennumm', 'nummer', 
        'datum', 'name', 'vorname', 'email',
        'anzahl', 'betrag', 'summe', 'fremdsumme', 'mwst', 'rabatt',
        'artikel', 'bezeichnung', 'artikelnum',
        'status', 'typ', 'code', 'art',
        'erstellt', 'bearbeitet', 'liefertag', 'lieferdatum', 'wunschterm'
      ];

      // Get columns for relevant tables, but only key columns
      const querySQL = `
        SELECT 
          t.TABLE_NAME,
          c.COLUMN_NAME,
          c.DATA_TYPE
        FROM INFORMATION_SCHEMA.TABLES t
        JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME
        WHERE t.TABLE_SCHEMA = 'dbo'
        AND (
          LOWER(c.COLUMN_NAME) IN ('${essentialColumns.join("','")}')
          OR c.COLUMN_NAME LIKE '%id%'
          OR c.COLUMN_NAME LIKE '%num%'
          OR c.COLUMN_NAME LIKE '%datum%'
          OR c.COLUMN_NAME LIKE '%summe%'
          OR c.COLUMN_NAME LIKE '%betrag%'
        )
        ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
      `;

      const rows = await this.dbClient.getRows<{
        TABLE_NAME: string;
        COLUMN_NAME: string;
        DATA_TYPE: string;
      }>(querySQL);

      // Format schema - compact format
      let schema = '';
      let currentTable = '';

      for (const row of rows) {
        if (row.TABLE_NAME !== currentTable) {
          schema += `${row.TABLE_NAME}: `;
          currentTable = row.TABLE_NAME;
        }
        schema += `${row.COLUMN_NAME}(${row.DATA_TYPE}), `;
      }

      return schema || 'Schema unavailable - use table names from user query';
    } catch (error) {
      console.error('Error fetching schema context:', error);
      return 'Schema unavailable - use table names from user query';
    }
  }

  /**
   * Build mapping hints from table translations
   */
  private buildMappingHints(_tables: string[]): string {
    const hints: string[] = [];

    for (const translation of tableTranslations.slice(0, 15)) {
      hints.push(`${translation.englishAlias || translation.germanName} = ${translation.germanName}`);
    }

    return hints.join('\n');
  }

  /**
   * Extract SQL from LLM response (remove markdown code blocks)
   */
  private extractSQL(response: string): string {
    let sql = response.trim();

    // Remove markdown code blocks
    sql = sql.replace(/```sql\n?/gi, '');
    sql = sql.replace(/```\n?/gi, '');

    // Remove common markdown markers
    sql = sql.replace(/^#+\s+.*$/gm, '');

    return sql.trim();
  }

  /**
   * Extract referenced tables from user query
   */
  private extractReferencedTables(query: string): string[] {
    const tables: string[] = [];
    const lower = query.toLowerCase();

    console.log('[EXTRACT_TABLES] Input query:', query);

    // Check against known table translations
    for (const translation of tableTranslations) {
      const germanNameMatch = lower.includes(translation.germanName.toLowerCase());
      const englishAliasMatch = translation.englishAlias?.toLowerCase() && lower.includes(translation.englishAlias.toLowerCase());
      const additionalMatch = translation.additionalAliases?.some(a => lower.includes(a.toLowerCase()));

      if (germanNameMatch || englishAliasMatch || additionalMatch) {
        console.log(`[EXTRACT_TABLES] ✓ Matched: "${translation.germanName}" (English: ${translation.englishAlias})`);
        tables.push(translation.germanName);
      }
    }

    console.log('[EXTRACT_TABLES] Final tables:', tables.length > 0 ? tables : 'NONE FOUND');
    return [...new Set(tables)];
  }

  /**
   * Extract filter keywords
   */
  private extractFilters(query: string): string[] {
    const filters: string[] = [];
    const filterKeywords = [
      'where', 'filter', 'between', 'from', 'to', 'in', 'equals', '=',
      'greater', 'less', 'before', 'after', 'since', 'until', 'during',
    ];

    for (const keyword of filterKeywords) {
      if (query.toLowerCase().includes(keyword)) {
        filters.push(keyword);
      }
    }

    return filters;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(lower: string, tables: string[]): number {
    let confidence = 0.5;

    // Increase confidence if tables found
    if (tables.length > 0) confidence += 0.2;

    // Increase confidence if clear intent keywords
    if (/all|find|show|list|get|retrieve/i.test(lower)) confidence += 0.15;
    if (/total|sum|count|average/i.test(lower)) confidence += 0.15;

    return Math.min(1, confidence);
  }

  /**
   * Handle SQL generation failure
   */
  private handleSQLGenerationFailure(
    request: NL2SQLRequest,
    error: unknown
  ): NL2SQLResponse {
    console.error('SQL generation failed:', error);

    return {
      success: false,
      query: request.query,
      error: {
        type: 'PARSE_ERROR',
        message: 'Failed to generate SQL from natural language query',
        details: {
          originalError: (error as Error).message,
          suggestion: 'Try being more specific about which tables and operations you need',
        },
        fallbackAvailable: request.allowFallback === true,
      },
    };
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < this.cacheTTL;
  }

  /**
   * Generate cache key
   */
  private getCacheKey(query: string, userId: string): string {
    return crypto
      .createHash('sha256')
      .update(`${query}:${userId}`)
      .digest('hex');
  }

  /**
   * Collect warnings from validation
   */
  private collectWarnings(
    validationIssues: ValidationIssue[],
    hallucination: HallucinationCheckResult
  ): string[] {
    const warnings: string[] = [];

    // Add validation warnings
    const warnings_from_validation = validationIssues
      .filter(i => i.type === 'WARNING')
      .map(i => i.message);
    warnings.push(...warnings_from_validation);

    // Add hallucination flags
    if (hallucination.recommendedAction === 'FLAG') {
      warnings.push('Query flagged for potential issues - results may need verification');
    }

    return warnings;
  }

  /**
   * Clear cache for user
   */
  clearUserCache(userId: string): void {
    for (const [key, value] of this.queryCache.entries()) {
      if (value.userId === userId) {
        this.queryCache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.queryCache.clear();
  }
}

export { NL2SQLService, NL2SQLRequest, NL2SQLResponse, QueryAnalysis };
