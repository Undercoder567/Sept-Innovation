/**
 * SQL Validator
 * Comprehensive validation for SQL queries
 * - Syntax checking
 * - Security analysis
 * - Performance considerations
 * - Permission checking
 */

interface ValidationConfig {
  maxQueryTimeout?: number;
  maxResultSize?: number;
  allowedTables?: string[];
  allowedFunctions?: string[];
  requireParameterization?: boolean;
  strictMode?: boolean;
}

interface ValidationIssue {
  type: 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  message: string;
  suggestion?: string;
  line?: number;
}

class SQLValidator {
  private config: ValidationConfig;

  constructor(config: ValidationConfig = {}) {
    this.config = {
      maxQueryTimeout: config.maxQueryTimeout || 30000,
      maxResultSize: config.maxResultSize || 1000000, // 1MB
      allowedTables: config.allowedTables || [],
      allowedFunctions: config.allowedFunctions || [
        'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STDDEV', 'VARIANCE',
        'COALESCE', 'CASE', 'CAST', 'EXTRACT',
        'DATEPART', 'DATEADD', 'DATEDIFF', 'YEAR', 'GETDATE', 'DATEFROMPARTS',
        'CONVERT', 'FORMAT',
        'CONCAT', 'SUBSTRING', 'ROUND', 'ABS', 'FLOOR', 'CEILING',
        'LEAD', 'LAG', 'OVER', 'AS', 'IN'
      ],
      requireParameterization: config.requireParameterization ?? true,
      strictMode: config.strictMode ?? true,
    };
  }

  /**
   * Comprehensive SQL validation
   */
  validate(sql: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Basic syntax checks
    issues.push(...this.checkBasicSyntax(sql));

    // Security checks
    issues.push(...this.checkSecurity(sql));

    // Performance checks
    issues.push(...this.checkPerformance(sql));

    // Parameterization checks
    if (this.config.requireParameterization) {
      issues.push(...this.checkParameterization(sql));
    }

    return issues;
  }

  /**
   * Check basic SQL syntax
   */
  private checkBasicSyntax(sql: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!sql || sql.trim().length === 0) {
      issues.push({
        type: 'ERROR',
        code: 'EMPTY_QUERY',
        message: 'Query is empty',
      });
      return issues;
    }

    const upperSQL = sql.toUpperCase();

    // Check for balanced parentheses
    if ((sql.match(/\(/g) || []).length !== (sql.match(/\)/g) || []).length) {
      issues.push({
        type: 'ERROR',
        code: 'UNBALANCED_PARENS',
        message: 'Unbalanced parentheses in query',
      });
    }

    // Check for required keywords
    if (!upperSQL.includes('SELECT')) {
      issues.push({
        type: 'ERROR',
        code: 'MISSING_SELECT',
        message: 'Query must contain SELECT statement',
      });
    }

    if (!upperSQL.includes('FROM')) {
      issues.push({
        type: 'ERROR',
        code: 'MISSING_FROM',
        message: 'SELECT query must contain FROM clause',
      });
    }

    // Check query starts with allowed statement
    const firstKeyword = sql.trim().toUpperCase().split(/\s+/)[0];
    if (!['SELECT', 'WITH'].includes(firstKeyword)) {
      issues.push({
        type: 'ERROR',
        code: 'INVALID_STATEMENT',
        message: `Queries must start with SELECT or WITH; found ${firstKeyword}`,
      });
    }

    return issues;
  }

  /**
   * Security checks
   */
  private checkSecurity(sql: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const upperSQL = sql.toUpperCase();

    // Dangerous keywords
    const dangerousKeywords = [
      'DROP', 'DELETE', 'INSERT', 'UPDATE', 'TRUNCATE',
      'ALTER', 'CREATE', 'EXEC', 'EXECUTE', 'GRANT', 'REVOKE',
    ];

    dangerousKeywords.forEach(keyword => {
      if (upperSQL.includes(keyword)) {
        issues.push({
          type: 'ERROR',
          code: 'DANGEROUS_STATEMENT',
          message: `${keyword} statements are not allowed`,
          suggestion: 'Only SELECT queries are permitted',
        });
      }
    });

    // Check for SQL injection patterns
    if (sql.includes("'") && !sql.includes('$')) {
      issues.push({
        type: 'WARNING',
        code: 'UNESCAPED_STRINGS',
        message: 'String literals should be parameterized, not hardcoded',
        suggestion: 'Use parameterized queries with $1, $2, etc. (they will be mapped to @p1/@p2 for SQL Server)',
      });
    }

    // Check for comments which could hide malicious code
    if (sql.includes('--') || sql.includes('/*')) {
      issues.push({
        type: 'WARNING',
        code: 'SQL_COMMENTS',
        message: 'SQL comments detected - ensure they do not hide injection attempts',
      });
    }

    // Check for function calls
    const functionPattern = /\b([A-Z_]+)\s*\(/gi;
    const matches = sql.matchAll(functionPattern);
    
    for (const match of matches) {
      const functionName = match[1].toUpperCase();
      if (!this.config.allowedFunctions!.includes(functionName)) {
        issues.push({
          type: 'WARNING',
          code: 'UNKNOWN_FUNCTION',
          message: `Function ${functionName} not in allowed list`,
          line: sql.substring(0, match.index).split('\n').length,
        });
      }
    }

    return issues;
  }

  /**
   * Performance checks
   */
  private checkPerformance(sql: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const upperSQL = sql.toUpperCase();

    // Check for SELECT *
    if (upperSQL.includes('SELECT *')) {
      issues.push({
        type: 'WARNING',
        code: 'SELECT_STAR',
        message: 'Using SELECT * returns unnecessary columns',
        suggestion: 'Specify only needed columns for better performance',
      });
    }

    const hasLimitLikeClause =
      /\bLIMIT\b/i.test(upperSQL) ||
      /\bTOP\s+\d+/i.test(upperSQL) ||
      /\bFETCH\b/i.test(upperSQL);

    if (upperSQL.includes('SELECT') && !hasLimitLikeClause) {
      issues.push({
        type: 'WARNING',
        code: 'NO_LIMIT',
        message: 'Query lacks a TOP/FETCH limit and may return very large result sets',
        suggestion: 'Use TOP or OFFSET/FETCH to cap result sizes',
      });
    }

    // Check for JOINs without explicit ON conditions
    // Split by JOIN to check each join has ON
    const joinMatches = sql.match(/JOIN\s+\w+\s*\w*\s+(?:ON|WHERE|GROUP|ORDER|LIMIT|;|$)/gi);
    if (joinMatches) {
      for (const match of joinMatches) {
        if (!match.toUpperCase().includes('ON') && !match.toUpperCase().includes('WHERE')) {
          // Only report if it's truly a missing ON (not followed by WHERE/GROUP etc)
          const matchUpper = match.toUpperCase();
          if (!/(WHERE|GROUP|ORDER|LIMIT)/i.test(match)) {
            issues.push({
              type: 'WARNING',
              code: 'IMPLICIT_JOIN',
              message: 'JOIN may lack explicit ON condition',
              suggestion: 'Ensure all JOINs have explicit ON conditions',
            });
          }
        }
      }
    }

    // Check for OR conditions
    if (upperSQL.includes(' OR ')) {
      issues.push({
        type: 'INFO',
        code: 'OR_CONDITION',
        message: 'Query uses OR conditions which may impact performance',
        suggestion: 'Consider using IN or JOIN instead of OR',
      });
    }

    // Check for LIKE with wildcard at start
    if (/%/.test(sql.split('LIKE')[1] || '')) {
      const likePattern = /%\w/;
      if (likePattern.test(sql)) {
        issues.push({
          type: 'INFO',
          code: 'LEADING_WILDCARD',
          message: 'LIKE pattern starts with %, may not use indexes efficiently',
        });
      }
    }

    // Check for subqueries
    if (sql.includes('(SELECT')) {
      issues.push({
        type: 'INFO',
        code: 'SUBQUERY',
        message: 'Query uses subquery, ensure it is optimized',
      });
    }

    return issues;
  }

  /**
   * Check parameterization
   */
  private checkParameterization(sql: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for unparameterized values
    const numberPattern = /=\s*(\d+)/g;
    const numberMatches = Array.from(sql.matchAll(numberPattern));

    for (const match of numberMatches) {
      // Allow specific numbers like LIMIT 100
      const context = sql.substring(match.index! - 10, match.index).toUpperCase();
      if (!context.includes('LIMIT') && !context.includes('TOP')) {
        issues.push({
          type: 'WARNING',
          code: 'HARDCODED_VALUE',
          message: `Hardcoded value ${match[1]} should be parameterized`,
          suggestion: `Replace with parameter placeholder like $1 (SQL Server will convert to @p1)`,
          line: sql.substring(0, match.index).split('\n').length,
        });
      }
    }

    // Check for parameter usage only when literals exist
    const paramPattern = /\$\d+/g;
    const stringLiteralPattern = /'[^']*'/g;
    const hasStringLiterals = stringLiteralPattern.test(sql);
    const shouldParameterize = hasStringLiterals || numberMatches.length > 0;

    if (shouldParameterize && !paramPattern.test(sql)) {
      issues.push({
        type: 'INFO',
        code: 'NO_PARAMETERS',
        message: 'Query does not use parameterized values',
      });
    }

    return issues;
  }

  /**
   * Analyze query complexity
   */
  analyzeComplexity(sql: string): {
    complexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'VERY_COMPLEX';
    score: number;
    factors: string[];
  } {
    let score = 0;
    const factors: string[] = [];
    const upperSQL = sql.toUpperCase();

    // Count JOINs
    const joinCount = (upperSQL.match(/JOIN/g) || []).length;
    score += joinCount * 2;
    if (joinCount > 2) {
      factors.push(`Multiple JOINs (${joinCount})`);
    }

    // Count WHERE conditions
    const whereCount = (sql.match(/AND|OR/g) || []).length;
    score += whereCount;
    if (whereCount > 3) {
      factors.push(`Complex WHERE clause (${whereCount} conditions)`);
    }

    // Count subqueries
    const subqueryCount = (sql.match(/\(SELECT/g) || []).length;
    score += subqueryCount * 3;
    if (subqueryCount > 0) {
      factors.push(`Subqueries (${subqueryCount})`);
    }

    // Window functions
    if (upperSQL.includes('OVER (')) {
      score += 2;
      factors.push('Window functions');
    }

    // CTEs
    if (upperSQL.includes('WITH ')) {
      score += 1;
      factors.push('Common Table Expressions');
    }

    // Determine complexity level
    let complexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'VERY_COMPLEX';
    if (score <= 2) complexity = 'SIMPLE';
    else if (score <= 5) complexity = 'MODERATE';
    else if (score <= 10) complexity = 'COMPLEX';
    else complexity = 'VERY_COMPLEX';

    return { complexity, score, factors };
  }

  /**
   * Format validation issues for display
   */
  formatIssues(issues: ValidationIssue[]): string {
    if (issues.length === 0) {
      return '✓ Query validation passed';
    }

    return issues
      .map(issue => {
        const prefix = {
          ERROR: '✗',
          WARNING: '⚠',
          INFO: 'ℹ',
        }[issue.type];

        let message = `${prefix} [${issue.code}] ${issue.message}`;
        if (issue.line) {
          message += ` (line ${issue.line})`;
        }
        if (issue.suggestion) {
          message += `\n  → ${issue.suggestion}`;
        }

        return message;
      })
      .join('\n');
  }
}

export { SQLValidator, ValidationConfig, ValidationIssue };
