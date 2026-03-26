interface SQLGenerationOptions {
  includeLimit?: number;
  timeout?: number;
  readonly?: boolean;
}

interface SQLValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  riskLevel: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/**
 * SQL Generator
 * Converts validated LLM output to safe, parameterized SQL queries
 * Ensures type safety and proper escaping through parameterization
 */
class SQLGenerator {
  private parameterIndex: number = 0;
  private parameters: (string | number | boolean | null)[] = [];

  /**
   * Reset generator state for new query
   */
  reset(): void {
    this.parameterIndex = 0;
    this.parameters = [];
  }

  /**
   * Generate next parameter placeholder
   */
  private nextParam(): string {
    return `$${++this.parameterIndex}`;
  }

  /**
   * Add parameter and return its placeholder
   */
  addParameter(value: string | number | boolean | null): string {
    this.parameters.push(value);
    return this.nextParam();
  }

  /**
   * Get current parameters array
   */
  getParameters(): (string | number | boolean | null)[] {
    return this.parameters;
  }

  /**
   * Build a safe SELECT query
   */
  buildSelect(options: {
    columns: string[];
    from: string;
    where?: { [key: string]: any };
    groupBy?: string[];
    orderBy?: { column: string; direction: 'ASC' | 'DESC' }[];
    limit?: number;
    offset?: number;
  }): string {
    this.reset();

    // SELECT clause
    const selectClause = `SELECT ${this.escapeIdentifiers(options.columns).join(', ')}`;

    // FROM clause
    const fromClause = `FROM ${this.escapeIdentifier(options.from)}`;

    // WHERE clause
    let whereClause = '';
    if (options.where && Object.keys(options.where).length > 0) {
      const conditions = Object.entries(options.where).map(([key, value]) => {
        const col = this.escapeIdentifier(key);
        if (value === null) {
          return `${col} IS NULL`;
        }
        return `${col} = ${this.addParameter(value)}`;
      });
      whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    // GROUP BY clause
    let groupByClause = '';
    if (options.groupBy && options.groupBy.length > 0) {
      groupByClause = `GROUP BY ${this.escapeIdentifiers(options.groupBy).join(', ')}`;
    }

    // ORDER BY clause
    let orderByClause = '';
    if (options.orderBy && options.orderBy.length > 0) {
      const orders = options.orderBy.map(
        ob => `${this.escapeIdentifier(ob.column)} ${ob.direction}`
      );
      orderByClause = `ORDER BY ${orders.join(', ')}`;
    }

    // LIMIT/OFFSET clauses
    let limitClause = '';
    if (options.limit && options.limit > 0) {
      limitClause = `LIMIT ${Math.min(options.limit, 10000)}`;
    }

    let offsetClause = '';
    if (options.offset && options.offset > 0) {
      offsetClause = `OFFSET ${options.offset}`;
    }

    const sql = [selectClause, fromClause, whereClause, groupByClause, orderByClause, limitClause, offsetClause]
      .filter(clause => clause.length > 0)
      .join('\n');

    return sql;
  }

  /**
   * Build a safe JOIN query
   */
  buildJoin(options: {
    columns: string[];
    from: string;
    joins: Array<{
      type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
      table: string;
      on: string;
    }>;
    where?: { [key: string]: any };
    limit?: number;
  }): string {
    this.reset();

    const selectClause = `SELECT ${this.escapeIdentifiers(options.columns).join(', ')}`;
    const fromClause = `FROM ${this.escapeIdentifier(options.from)}`;

    const joinClauses = options.joins.map(join => {
      return `${join.type} JOIN ${this.escapeIdentifier(join.table)} ON ${join.on}`;
    });

    let whereClause = '';
    if (options.where && Object.keys(options.where).length > 0) {
      const conditions = Object.entries(options.where).map(([key, value]) => {
        const col = this.escapeIdentifier(key);
        return `${col} = ${this.addParameter(value)}`;
      });
      whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    const limitClause = options.limit ? `LIMIT ${Math.min(options.limit, 10000)}` : '';

    const sql = [
      selectClause,
      fromClause,
      ...joinClauses,
      whereClause,
      limitClause,
    ]
      .filter(clause => clause.length > 0)
      .join('\n');

    return sql;
  }

  /**
   * Build aggregation query (COUNT, SUM, AVG, etc)
   */
  buildAggregation(options: {
    aggregations: Array<{
      function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'STDDEV' | 'VARIANCE';
      column: string;
      alias?: string;
    }>;
    from: string;
    where?: { [key: string]: any };
    groupBy?: string[];
    having?: string;
  }): string {
    this.reset();

    const aggs = options.aggregations.map(agg => {
      const col = agg.column === '*' ? '*' : this.escapeIdentifier(agg.column);
      const alias = agg.alias ? ` AS ${this.escapeIdentifier(agg.alias)}` : '';
      return `${agg.function}(${col})${alias}`;
    });

    const selectClause = `SELECT ${aggs.join(', ')}`;

    if (options.groupBy && options.groupBy.length > 0) {
      selectClause.concat(`, ${this.escapeIdentifiers(options.groupBy).join(', ')}`);
    }

    const fromClause = `FROM ${this.escapeIdentifier(options.from)}`;

    let whereClause = '';
    if (options.where && Object.keys(options.where).length > 0) {
      const conditions = Object.entries(options.where).map(([key, value]) => {
        const col = this.escapeIdentifier(key);
        return `${col} = ${this.addParameter(value)}`;
      });
      whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    let groupByClause = '';
    if (options.groupBy && options.groupBy.length > 0) {
      groupByClause = `GROUP BY ${this.escapeIdentifiers(options.groupBy).join(', ')}`;
    }

    const havingClause = options.having ? `HAVING ${options.having}` : '';

    const sql = [selectClause, fromClause, whereClause, groupByClause, havingClause]
      .filter(clause => clause.length > 0)
      .join('\n');

    return sql;
  }

  /**
   * Escape single identifier (column/table name)
   * Prevents SQL injection via identifier names
   */
  private escapeIdentifier(name: string): string {
    // Remove any dangerous characters
    const sanitized = name
      .replace(/[^a-zA-Z0-9_]/g, '')
      .substring(0, 63); // PostgreSQL identifier limit

    if (sanitized.length === 0) {
      throw new Error('Invalid identifier');
    }

    // Quote identifier if it contains special chars or is reserved
    return `"${sanitized}"`;
  }

  /**
   * Escape multiple identifiers
   */
  private escapeIdentifiers(names: string[]): string[] {
    return names.map(name => this.escapeIdentifier(name));
  }

  /**
   * Validate SQL against common attack patterns and best practices
   */
  validateSQL(sql: string): SQLValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let riskLevel: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'SAFE';

    const upperSQL = sql.toUpperCase();

    // Check for dangerous patterns
    if (upperSQL.includes('DROP TABLE')) {
      errors.push('DROP TABLE statements are not allowed');
      riskLevel = 'CRITICAL';
    }

    if (upperSQL.includes('DELETE ') && !upperSQL.includes('WHERE')) {
      errors.push('DELETE without WHERE clause is dangerous');
      riskLevel = 'CRITICAL';
    }

    if (upperSQL.includes('TRUNCATE')) {
      errors.push('TRUNCATE statements are not allowed');
      riskLevel = 'CRITICAL';
    }

    if (upperSQL.includes('UPDATE ') && !upperSQL.includes('WHERE')) {
      errors.push('UPDATE without WHERE clause is dangerous');
      riskLevel = 'CRITICAL';
    }

    if (upperSQL.includes('INSERT ')) {
      errors.push('INSERT statements are not allowed for security');
      riskLevel = 'CRITICAL';
    }

    if (upperSQL.includes('EXEC ') || upperSQL.includes('EXECUTE ')) {
      errors.push('Dynamic execution is not allowed');
      riskLevel = 'CRITICAL';
    }

    // Check for SQL injection patterns
    if (/['";]/g.test(sql) && !sql.includes('$')) {
      errors.push('Unparameterized string literals detected');
      riskLevel = 'CRITICAL';
    }

    // Warnings
    if (!sql.includes('LIMIT') && upperSQL.includes('SELECT')) {
      warnings.push('Consider adding LIMIT to prevent large result sets');
      if (riskLevel === 'SAFE') riskLevel = 'LOW';
    }

    if (upperSQL.includes('SELECT *')) {
      warnings.push('SELECT * returns unnecessary columns; consider specifying columns');
      if (riskLevel === 'SAFE') riskLevel = 'LOW';
    }

    if (upperSQL.includes('OR ') && !upperSQL.includes('WHERE')) {
      warnings.push('Complex OR conditions may indicate unclear logic');
      if (riskLevel === 'SAFE') riskLevel = 'MEDIUM';
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      riskLevel,
    };
  }

  /**
   * Format SQL for readability
   */
  formatSQL(sql: string): string {
    return sql
      .replace(/\s+/g, ' ')
      .replace(/,/g, ',\n  ')
      .replace(/FROM/gi, '\nFROM')
      .replace(/WHERE/gi, '\nWHERE')
      .replace(/GROUP BY/gi, '\nGROUP BY')
      .replace(/ORDER BY/gi, '\nORDER BY')
      .replace(/LIMIT/gi, '\nLIMIT')
      .replace(/OFFSET/gi, '\nOFFSET')
      .replace(/JOIN/gi, '\nJOIN')
      .trim();
  }
}

export { SQLGenerator, SQLGenerationOptions, SQLValidationResult };
