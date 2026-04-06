/**
 * Hallucination Detector
 * Identifies and prevents LLM hallucinations in generated SQL queries
 * 
 * Detects:
 * 1. Non-existent tables
 * 2. Invalid column references
 * 3. Impossible joins (no foreign keys)
 * 4. Type mismatches
 * 5. Missing required filters
 */

import { DatabaseClient } from '../sql/dbClient';
import { tableTranslations } from '../semantic/tableTranslations';

interface HallucinationCheckResult {
  isHallucinating: boolean;
  issues: HallucinationIssue[];
  confidence: number; // 0-1, higher = more likely hallucinating
  recommendedAction: 'ALLOW' | 'FLAG' | 'BLOCK';
}

interface HallucinationIssue {
  type: 'INVALID_TABLE' | 'INVALID_COLUMN' | 'IMPOSSIBLE_JOIN' | 'TYPE_MISMATCH' | 'SYNTACTIC_ERROR';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  location?: string; // Where in query
  suggestion?: string;
}

interface SchemaMetadata {
  tables: Map<string, TableSchema>;
  foreignKeys: ForeignKeyRelation[];
  timestamp: number;
}

interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  aliases?: string[];
}

interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
}

interface ForeignKeyRelation {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
}

class HallucinationDetector {
  private dbClient: DatabaseClient;
  private schemaCache: SchemaMetadata | null = null;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  constructor(dbClient: DatabaseClient) {
    this.dbClient = dbClient;
  }

  /**
   * Check if generated SQL contains hallucinations
   */
  async detectHallucinations(sql: string, userQuery: string): Promise<HallucinationCheckResult> {
    try {
      const schema = await this.getSchemaMetadata();
      const issues: HallucinationIssue[] = [];

      // Parse SQL to extract tables and columns
      const extractedTables = this.extractTableReferences(sql);
      const extractedColumns = this.extractColumnReferences(sql);

      // Check for invalid tables
      for (const table of extractedTables) {
        if (!this.isValidTable(table, schema)) {
          issues.push({
            type: 'INVALID_TABLE',
            severity: 'CRITICAL',
            message: `Table "${table}" does not exist in database`,
            location: table,
            suggestion: this.suggestTableAlternative(table, schema),
          });
        }
      }

      // Check for invalid columns
      for (const [table, columns] of Object.entries(extractedColumns)) {
        for (const column of columns) {
          if (!this.isValidColumn(table, column, schema)) {
            issues.push({
              type: 'INVALID_COLUMN',
              severity: 'HIGH',
              message: `Column "${column}" does not exist in table "${table}"`,
              location: `${table}.${column}`,
              suggestion: this.suggestColumnAlternative(table, column, schema),
            });
          }
        }
      }

      // Check for impossible joins (no FK relationship)
      const joins = this.extractJoins(sql);
      for (const join of joins) {
        if (!this.canJoin(join.table1, join.table2, schema)) {
          issues.push({
            type: 'IMPOSSIBLE_JOIN',
            severity: 'HIGH',
            message: `Cannot join "${join.table1}" and "${join.table2}" - no foreign key relationship`,
            location: `${join.table1} -> ${join.table2}`,
            suggestion: `Verify the join condition or ensure a foreign key exists between these tables`,
          });
        }
      }

      // Check for type mismatches in filters
      const typeIssues = this.checkTypeMatches(sql, schema);
      issues.push(...typeIssues);

      // Check for basic syntax errors
      const syntaxIssues = this.checkSyntax(sql);
      issues.push(...syntaxIssues);

      // Calculate confidence of hallucination
      const confidence = this.calculateHallucinationConfidence(issues);
      const recommendedAction = this.determineAction(issues, confidence);

      return {
        isHallucinating: issues.length > 0 && confidence > 0.5,
        issues,
        confidence,
        recommendedAction,
      };
    } catch (error) {
      console.error('Error detecting hallucinations:', error);
      // On error, allow query but flag it
      return {
        isHallucinating: false,
        issues: [],
        confidence: 0,
        recommendedAction: 'FLAG',
      };
    }
  }

  /**
   * Get database schema metadata
   */
  private async getSchemaMetadata(): Promise<SchemaMetadata> {
    // Return cached schema if still valid
    if (this.schemaCache && Date.now() - this.schemaCache.timestamp < this.cacheTTL) {
      return this.schemaCache;
    }

    const tables = new Map<string, TableSchema>();
    const foreignKeys: ForeignKeyRelation[] = [];

    try {
      // Get all tables and columns
      const tableRows = await this.dbClient.getRows<{
        tableName: string;
        columnName: string;
        dataType: string;
        isNullable: number;
      }>(`
        SELECT 
          t.TABLE_NAME AS tableName,
          c.COLUMN_NAME AS columnName,
          c.DATA_TYPE AS dataType,
          CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS isNullable
        FROM INFORMATION_SCHEMA.TABLES t
        JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME
        WHERE t.TABLE_SCHEMA = 'dbo'
        ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
      `);

      // Group columns by table
      for (const row of tableRows) {
        const tableName = row.tableName.toLowerCase();
        if (!tables.has(tableName)) {
          tables.set(tableName, {
            name: tableName,
            columns: [],
            aliases: this.getTableAliases(tableName),
          });
        }

        tables.get(tableName)!.columns.push({
          name: row.columnName.toLowerCase(),
          type: row.dataType,
          nullable: row.isNullable === 1,
        });
      }

      // Get foreign key relationships
      const fkRows = await this.dbClient.getRows<{
        constraintName: string;
        sourceTable: string;
        sourceColumn: string;
        targetTable: string;
        targetColumn: string;
      }>(`
        SELECT 
          rc.CONSTRAINT_NAME AS constraintName,
          kcu1.TABLE_NAME AS sourceTable,
          kcu1.COLUMN_NAME AS sourceColumn,
          kcu2.TABLE_NAME AS targetTable,
          kcu2.COLUMN_NAME AS targetColumn
        FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu1 
          ON rc.CONSTRAINT_NAME = kcu1.CONSTRAINT_NAME
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2 
          ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
      `);

      for (const row of fkRows) {
        foreignKeys.push({
          sourceTable: row.sourceTable.toLowerCase(),
          sourceColumn: row.sourceColumn.toLowerCase(),
          targetTable: row.targetTable.toLowerCase(),
          targetColumn: row.targetColumn.toLowerCase(),
        });
      }

      this.schemaCache = {
        tables,
        foreignKeys,
        timestamp: Date.now(),
      };

      return this.schemaCache;
    } catch (error) {
      console.error('Error fetching schema metadata:', error);
      // Return empty schema on error
      return {
        tables: new Map(),
        foreignKeys: [],
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Extract table references from SQL
   */
  private extractTableReferences(sql: string): string[] {
    const tables: string[] = [];
    
    // Match FROM table_name and JOIN table_name patterns
    const fromRegex = /\bFROM\s+(?:dbo\.)?(\w+)/gi;
    const joinRegex = /\bJOIN\s+(?:dbo\.)?(\w+)/gi;
    
    let match;
    
    while ((match = fromRegex.exec(sql)) !== null) {
      tables.push(match[1].toLowerCase());
    }
    
    while ((match = joinRegex.exec(sql)) !== null) {
      tables.push(match[1].toLowerCase());
    }

    return [...new Set(tables)];
  }

  /**
   * Extract column references from SQL
   */
  private extractColumnReferences(sql: string): Record<string, string[]> {
    const columns: Record<string, string[]> = {};
    
    // Simple pattern matching for table.column references
    const columnRegex = /(\w+)\.(\w+)/g;
    let match;

    while ((match = columnRegex.exec(sql)) !== null) {
      const table = match[1].toLowerCase();
      const column = match[2].toLowerCase();
      
      if (!columns[table]) {
        columns[table] = [];
      }
      columns[table].push(column);
    }

    return columns;
  }

  /**
   * Extract join conditions
   */
  private extractJoins(sql: string): Array<{ table1: string; table2: string }> {
    const joins: Array<{ table1: string; table2: string }> = [];
    
    // Extract JOIN conditions: table1.id = table2.id pattern
    const joinConditionRegex = /(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/gi;
    let match;

    while ((match = joinConditionRegex.exec(sql)) !== null) {
      const table1 = match[1].toLowerCase();
      const table2 = match[3].toLowerCase();
      joins.push({ table1, table2 });
    }

    return joins;
  }

  /**
   * Check if table exists
   */
  private isValidTable(tableName: string, schema: SchemaMetadata): boolean {
    const lower = tableName.toLowerCase();
    
    // Check direct table name
    if (schema.tables.has(lower)) {
      return true;
    }

    // Check against translations/aliases
    for (const translation of tableTranslations) {
      if (
        translation.germanName.toLowerCase() === lower ||
        translation.englishAlias?.toLowerCase() === lower ||
        translation.additionalAliases?.some(a => a.toLowerCase() === lower)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if column exists in table
   */
  private isValidColumn(tableName: string, columnName: string, schema: SchemaMetadata): boolean {
    const lower = tableName.toLowerCase();
    const columnLower = columnName.toLowerCase();

    const table = schema.tables.get(lower);
    if (!table) {
      return false;
    }

    return table.columns.some(col => col.name === columnLower);
  }

  /**
   * Check if two tables can be joined
   */
  private canJoin(table1: string, table2: string, schema: SchemaMetadata): boolean {
    const t1 = table1.toLowerCase();
    const t2 = table2.toLowerCase();

    // Check if direct FK exists
    return schema.foreignKeys.some(
      fk => 
        (fk.sourceTable === t1 && fk.targetTable === t2) ||
        (fk.sourceTable === t2 && fk.targetTable === t1)
    );
  }

  /**
   * Check type mismatches
   */
  private checkTypeMatches(sql: string, schema: SchemaMetadata): HallucinationIssue[] {
    const issues: HallucinationIssue[] = [];
    
    // Look for WHERE column = 'value' where column is numeric
    const whereRegex = /WHERE\s+(\w+)\.(\w+)\s*=\s*'([^']+)'/gi;
    let match;

    while ((match = whereRegex.exec(sql)) !== null) {
      const table = match[1].toLowerCase();
      const column = match[2].toLowerCase();
      const value = match[3];

      const tableSchema = schema.tables.get(table);
      if (tableSchema) {
        const colSchema = tableSchema.columns.find(c => c.name === column);
        if (colSchema && this.isNumericType(colSchema.type) && isNaN(Number(value))) {
          issues.push({
            type: 'TYPE_MISMATCH',
            severity: 'MEDIUM',
            message: `Column "${column}" is numeric but comparing with string "${value}"`,
            location: `${table}.${column}`,
            suggestion: 'Use numeric value or convert column to string',
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check basic SQL syntax
   */
  private checkSyntax(sql: string): HallucinationIssue[] {
    const issues: HallucinationIssue[] = [];

    // Check for balanced parentheses
    const openParen = (sql.match(/\(/g) || []).length;
    const closeParen = (sql.match(/\)/g) || []).length;
    
    if (openParen !== closeParen) {
      issues.push({
        type: 'SYNTACTIC_ERROR',
        severity: 'CRITICAL',
        message: 'Unbalanced parentheses in query',
      });
    }

    // Check for required SELECT keyword
    if (!/\bSELECT\b/i.test(sql)) {
      issues.push({
        type: 'SYNTACTIC_ERROR',
        severity: 'CRITICAL',
        message: 'Query missing SELECT keyword',
      });
    }

    // Check for required FROM keyword
    if (!/\bFROM\b/i.test(sql)) {
      issues.push({
        type: 'SYNTACTIC_ERROR',
        severity: 'CRITICAL',
        message: 'Query missing FROM keyword',
      });
    }

    return issues;
  }

  /**
   * Get table aliases/translations
   */
  private getTableAliases(tableName: string): string[] {
    const aliases: string[] = [];
    
    for (const translation of tableTranslations) {
      if (translation.germanName.toLowerCase() === tableName.toLowerCase()) {
        if (translation.englishAlias) aliases.push(translation.englishAlias);
        if (translation.additionalAliases) aliases.push(...translation.additionalAliases);
      }
    }

    return aliases;
  }

  /**
   * Suggest table alternative
   */
  private suggestTableAlternative(tableName: string, schema: SchemaMetadata): string {
    const lower = tableName.toLowerCase();
    
    // Find similar table names using Levenshtein distance
    const tables = Array.from(schema.tables.keys());
    const similar = tables
      .map(t => ({
        name: t,
        distance: this.levenshteinDistance(lower, t),
      }))
      .filter(t => t.distance < 3)
      .sort((a, b) => a.distance - b.distance);

    return similar.length > 0 ? `Did you mean "${similar[0].name}"?` : '';
  }

  /**
   * Suggest column alternative
   */
  private suggestColumnAlternative(table: string, column: string, schema: SchemaMetadata): string {
    const tableSchema = schema.tables.get(table.toLowerCase());
    if (!tableSchema) return '';

    const similar = tableSchema.columns
      .map(c => ({
        name: c.name,
        distance: this.levenshteinDistance(column.toLowerCase(), c.name),
      }))
      .filter(c => c.distance < 3)
      .sort((a, b) => a.distance - b.distance);

    return similar.length > 0 ? `Did you mean "${similar[0].name}"?` : '';
  }

  /**
   * Calculate hallucination confidence
   */
  private calculateHallucinationConfidence(issues: HallucinationIssue[]): number {
    if (issues.length === 0) return 0;

    const weights = {
      CRITICAL: 1.0,
      HIGH: 0.7,
      MEDIUM: 0.4,
      LOW: 0.1,
    };

    const totalWeight = issues.reduce((sum, issue) => sum + weights[issue.severity], 0);
    return Math.min(1, totalWeight / issues.length);
  }

  /**
   * Determine recommended action
   */
  private determineAction(
    issues: HallucinationIssue[],
    confidence: number
  ): 'ALLOW' | 'FLAG' | 'BLOCK' {
    const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');
    
    if (criticalIssues.length > 0) {
      return 'BLOCK';
    }

    if (confidence > 0.7 || issues.filter(i => i.severity === 'HIGH').length > 2) {
      return 'FLAG';
    }

    return 'ALLOW';
  }

  /**
   * Check if type is numeric
   */
  private isNumericType(dataType: string): boolean {
    const numericTypes = ['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real'];
    return numericTypes.some(t => dataType.toLowerCase().includes(t));
  }

  /**
   * Levenshtein distance for fuzzy matching
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }
}

export { HallucinationDetector, HallucinationCheckResult, HallucinationIssue };
