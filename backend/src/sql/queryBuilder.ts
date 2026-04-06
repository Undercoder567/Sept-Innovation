/**
 * Query Builder Service
 * Builds safe, parameterized SQL queries for specific analytical patterns
 * 
 * Supports:
 * 1. Search queries (with filters)
 * 2. Aggregation queries (with GROUP BY)
 * 3. Statistical queries (with window functions)
 */

import { tableTranslations } from '../semantic/tableTranslations';

interface QueryBuilderOptions {
  maxRows?: number;
  includeExplain?: boolean;
}

interface SearchQueryOptions extends QueryBuilderOptions {
  table: string;
  columns?: string[];
  filters?: Filter[];
  orderBy?: OrderBy[];
}

interface AggregationQueryOptions extends QueryBuilderOptions {
  table: string;
  aggregations: Aggregation[];
  groupBy?: string[];
  filters?: Filter[];
  having?: string;
}

interface StatisticsQueryOptions extends QueryBuilderOptions {
  table: string;
  metrics: string[];
  timeColumn?: string;
  period?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
  filters?: Filter[];
}

interface Filter {
  column: string;
  operator: 'EQ' | 'NE' | 'GT' | 'LT' | 'GTE' | 'LTE' | 'IN' | 'BETWEEN' | 'LIKE' | 'NULL' | 'NOT_NULL';
  value?: any;
  values?: any[];
}

interface OrderBy {
  column: string;
  direction: 'ASC' | 'DESC';
}

interface Aggregation {
  function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'STDDEV' | 'VARIANCE';
  column: string;
  alias: string;
}

class QueryBuilder {
  /**
   * Build a safe search query
   * Use case: "find all orders of customer X from 2024"
   */
  buildSearchQuery(options: SearchQueryOptions): { sql: string; params: any[] } {
    const params: any[] = [];
    const table = this.escapeIdentifier(options.table);

    // Default to specific columns instead of SELECT *
    const columns = options.columns && options.columns.length > 0
      ? options.columns.map(c => this.escapeIdentifier(c)).join(', ')
      : `TOP 5 *`; // Limit columns in default case

    const selectClause = `SELECT ${columns} FROM ${table}`;

    // Build WHERE clause from filters
    let whereClause = '';
    if (options.filters && options.filters.length > 0) {
      const conditions = options.filters.map((filter, idx) => {
        return this.buildFilterCondition(filter, params, idx);
      });
      whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    // Build ORDER BY clause
    let orderByClause = '';
    if (options.orderBy && options.orderBy.length > 0) {
      const orders = options.orderBy.map(ob =>
        `${this.escapeIdentifier(ob.column)} ${ob.direction}`
      );
      orderByClause = `ORDER BY ${orders.join(', ')}`;
    }

    // Add LIMIT
    const limit = options.maxRows || 100;
    const limitClause = `OFFSET 0 ROWS FETCH NEXT ${limit} ROWS ONLY`;

    const sql = [selectClause, whereClause, orderByClause, limitClause]
      .filter(clause => clause.length > 0)
      .join('\n');

    return { sql, params };
  }

  /**
   * Build aggregation query
   * Use case: "calculate the total profit we made with software Y in 2025"
   */
  buildAggregationQuery(
    options: AggregationQueryOptions
  ): { sql: string; params: any[] } {
    const params: any[] = [];
    const table = this.escapeIdentifier(options.table);

    // Build SELECT clause with aggregations
    const selectParts: string[] = [];

    for (const agg of options.aggregations) {
      const col = this.escapeIdentifier(agg.column);
      const alias = this.escapeIdentifier(agg.alias);
      selectParts.push(`${agg.function}(${col}) AS ${alias}`);
    }

    // Add GROUP BY columns to SELECT
    if (options.groupBy && options.groupBy.length > 0) {
      for (const groupCol of options.groupBy) {
        selectParts.unshift(this.escapeIdentifier(groupCol));
      }
    }

    const selectClause = `SELECT ${selectParts.join(', ')} FROM ${table}`;

    // Build WHERE clause
    let whereClause = '';
    if (options.filters && options.filters.length > 0) {
      const conditions = options.filters.map((filter, idx) => {
        return this.buildFilterCondition(filter, params, idx);
      });
      whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    // Build GROUP BY clause
    let groupByClause = '';
    if (options.groupBy && options.groupBy.length > 0) {
      const groupCols = options.groupBy.map(col => this.escapeIdentifier(col));
      groupByClause = `GROUP BY ${groupCols.join(', ')}`;
    }

    // Build HAVING clause
    let havingClause = '';
    if (options.having) {
      havingClause = `HAVING ${options.having}`;
    }

    const sql = [selectClause, whereClause, groupByClause, havingClause]
      .filter(clause => clause.length > 0)
      .join('\n');

    return { sql, params };
  }

  /**
   * Build statistics query with window functions
   * Use case: "what is the expected interval for maintenance at company Z"
   */
  buildStatisticsQuery(
    options: StatisticsQueryOptions
  ): { sql: string; params: any[] } {
    const params: any[] = [];
    const table = this.escapeIdentifier(options.table);

    const selectParts: string[] = [];

    // Add time column if specified
    if (options.timeColumn) {
      if (options.period && options.period !== 'DAY') {
        const timeGrouping = this.getTimeGrouping(options.timeColumn, options.period);
        selectParts.push(`${timeGrouping} AS period`);
      } else {
        selectParts.push(this.escapeIdentifier(options.timeColumn));
      }
    }

    // Add metrics with window functions
    for (const metric of options.metrics) {
      selectParts.push(
        `AVG(${this.escapeIdentifier(metric)}) OVER () AS avg_${metric}`
      );
      selectParts.push(
        `STDDEV(${this.escapeIdentifier(metric)}) OVER () AS stddev_${metric}`
      );
      selectParts.push(
        `MIN(${this.escapeIdentifier(metric)}) OVER () AS min_${metric}`
      );
      selectParts.push(
        `MAX(${this.escapeIdentifier(metric)}) OVER () AS max_${metric}`
      );
    }

    const selectClause = `SELECT ${selectParts.join(', ')} FROM ${table}`;

    // Build WHERE clause
    let whereClause = '';
    if (options.filters && options.filters.length > 0) {
      const conditions = options.filters.map((filter, idx) => {
        return this.buildFilterCondition(filter, params, idx);
      });
      whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    // Add DISTINCT if grouping by time
    let groupByClause = '';
    if (options.timeColumn && options.period && options.period !== 'DAY') {
      const timeGrouping = this.getTimeGrouping(options.timeColumn, options.period);
      groupByClause = `GROUP BY ${timeGrouping}`;
    }

    const sql = [selectClause, whereClause, groupByClause]
      .filter(clause => clause.length > 0)
      .join('\n');

    return { sql, params };
  }

  /**
   * Build a filter condition
   */
  private buildFilterCondition(
    filter: Filter,
    params: any[],
    idx: number
  ): string {
    const col = this.escapeIdentifier(filter.column);

    switch (filter.operator) {
      case 'EQ':
        params.push(filter.value);
        return `${col} = @p${params.length}`;

      case 'NE':
        params.push(filter.value);
        return `${col} != @p${params.length}`;

      case 'GT':
        params.push(filter.value);
        return `${col} > @p${params.length}`;

      case 'LT':
        params.push(filter.value);
        return `${col} < @p${params.length}`;

      case 'GTE':
        params.push(filter.value);
        return `${col} >= @p${params.length}`;

      case 'LTE':
        params.push(filter.value);
        return `${col} <= @p${params.length}`;

      case 'IN':
        if (filter.values && filter.values.length > 0) {
          filter.values.forEach(v => params.push(v));
          const placeholders = filter.values
            .map((_, i) => `@p${params.length - filter.values!.length + i + 1}`)
            .join(', ');
          return `${col} IN (${placeholders})`;
        }
        return '1=1';

      case 'BETWEEN':
        params.push(filter.value);
        params.push(filter.values?.[0]);
        return `${col} BETWEEN @p${params.length - 1} AND @p${params.length}`;

      case 'LIKE':
        params.push(`%${filter.value}%`);
        return `${col} LIKE @p${params.length}`;

      case 'NULL':
        return `${col} IS NULL`;

      case 'NOT_NULL':
        return `${col} IS NOT NULL`;

      default:
        return '1=1';
    }
  }

  /**
   * Get time grouping expression
   */
  private getTimeGrouping(column: string, period: string): string {
    const col = this.escapeIdentifier(column);

    switch (period) {
      case 'YEAR':
        return `DATEPART(YEAR, ${col})`;
      case 'QUARTER':
        return `DATEPART(QUARTER, ${col})`;
      case 'MONTH':
        return `FORMAT(${col}, 'yyyy-MM')`;
      case 'WEEK':
        return `DATEPART(WEEK, ${col})`;
      case 'DAY':
      default:
        return `CAST(${col} AS DATE)`;
    }
  }

  /**
   * Escape SQL identifier
   */
  private escapeIdentifier(identifier: string): string {
    // Remove any existing brackets
    let cleaned = identifier.replace(/[\[\]]/g, '');

    // Handle aliases (e.g., "t1.column" -> "[t1].[column]")
    if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      return parts.map(p => `[${p.trim()}]`).join('.');
    }

    return `[${cleaned}]`;
  }

  /**
   * Get table name from alias
   */
  getActualTableName(alias: string): string | null {
    const lower = alias.toLowerCase();

    for (const translation of tableTranslations) {
      if (
        translation.englishAlias?.toLowerCase() === lower ||
        translation.germanName.toLowerCase() === lower ||
        translation.additionalAliases?.some(a => a.toLowerCase() === lower)
      ) {
        return translation.germanName;
      }
    }

    return null;
  }

  /**
   * Validate filter values
   */
  validateFilter(filter: Filter): { valid: boolean; error?: string } {
    if (!filter.column || filter.column.trim().length === 0) {
      return { valid: false, error: 'Column name is required' };
    }

    if (filter.operator === 'BETWEEN' && (!filter.values || filter.values.length < 2)) {
      return { valid: false, error: 'BETWEEN requires two values' };
    }

    if (filter.operator === 'IN' && (!filter.values || filter.values.length === 0)) {
      return { valid: false, error: 'IN requires at least one value' };
    }

    return { valid: true };
  }

  /**
   * Build comment explaining the query
   */
  buildQueryComment(intent: string, tables: string[]): string {
    return `-- Query: ${intent}\n-- Tables: ${tables.join(', ')}`;
  }
}

export {
  QueryBuilder,
  SearchQueryOptions,
  AggregationQueryOptions,
  StatisticsQueryOptions,
  Filter,
  OrderBy,
  Aggregation,
};
