import { LLMClient } from './llmClient';
import { TableTranslation, tableTranslations } from '../semantic/tableTranslations';

interface SystemContext {
  businessDictionary: Record<string, string>;
  queryRules: string[];
  examples: QueryExample[];
}

interface QueryExample {
  userQuery: string;
  intent: string;
  sqlGenerated: string;
  expectedResult: string;
}

interface PromptOptions {
  temperature?: number;
  maxTokens?: number;
  includeExamples?: boolean;
  includeRules?: boolean;
  translationHints?: TableTranslation[];
}

/**
 * Prompt Builder
 * Constructs optimized prompts for SQL generation and intent understanding
 * Uses prompt engineering best practices:
 * - Clear system context
 * - Few-shot learning examples
 * - Explicit constraints
 * - Chain-of-thought reasoning
 */
class PromptBuilder {
  private llmClient: LLMClient;
  private systemContext: SystemContext;

  constructor(
    llmClient: LLMClient,
    systemContext?: SystemContext
  ) {
    this.llmClient = llmClient;
    this.systemContext = systemContext || this.getDefaultContext();
  }

  /**
   * Build SQL generation prompt
   * Transforms natural language query into SQL with clear instructions
   */
/*   buildSQLGenerationPrompt(
    userQuery: string,
    schemaContext: string,
    options: PromptOptions = {}
  ): string {
    const {
      includeExamples = true,
      includeRules = true,
    } = options;

    let prompt = `You are an expert SQL query generator. Your task is to convert natural language requests into SQL queries.

IMPORTANT CONSTRAINTS:
1. ALWAYS use parameterized queries - never include literal values in SELECT/WHERE clauses
2. Use parameter placeholders: $1, $2, $3, etc.
3. Return ONLY the SQL query, no explanations
4. Never use SELECT *, always specify column names
5. Include appropriate JOINs based on schema context
6. Add WHERE clauses for filtering and security
7. Use aggregate functions (COUNT, SUM, AVG) when appropriate
8. Sort results in logical order (by date DESC for time-series)
9. Limit results appropriately (use TOP 1000 or OFFSET/FETCH by default)
10. Handle NULL values appropriately with COALESCE or IS NOT NULL
11. Use ONLY tables and columns that exist in DATABASE SCHEMA below
12. Never invent tables/columns (e.g., transactions, is_test) if they are not present
13. Do not add filters/conditions that the user did not request

DATABASE SCHEMA:
\`\`\`
${schemaContext}
\`\`\`

BUSINESS RULES AND DEFINITIONS:
${this.formatBusinessRules()}

`;

    if (includeExamples && this.systemContext.examples.length > 0) {
      prompt += this.buildExamplesSection();
    }

    if (includeRules && this.systemContext.queryRules.length > 0) {
      prompt += `\nQUERY RULES:
${this.systemContext.queryRules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}
`;
    }

    prompt += `\nNOW, convert this user query to SQL:
"${userQuery}"

OUTPUT RULES (MANDATORY):
- Return exactly ONE SQL statement
- Start with SELECT or WITH
- End with semicolon
- Do NOT include markdown/code fences
- Do NOT include explanations, notes, examples, or extra text

Return ONLY the SQL query:`;

    return prompt;
  } */

    buildSQLGenerationPrompt(
  userQuery: string,
  schemaContext: string,
  options: PromptOptions = {}
): string {

  const { includeExamples = true, translationHints } = options;
  const translationSection = this.buildTranslationSection(translationHints);

  let prompt = `You are an expert SQL Server (T-SQL) query builder.

Convert the user request into ONE valid SQL query.

DATABASE SCHEMA:
${schemaContext}

${translationSection ? `TABLE TRANSLATIONS:\n${translationSection}\n` : ''}

`;

  if (includeExamples && this.systemContext.examples.length > 0) {
    prompt += `
EXAMPLES:
${this.buildExamplesSection()}
`;
  }

  prompt += `
RULES:
1. Use ONLY tables and columns from DATABASE SCHEMA.
2. Never invent tables or columns.
3. Never use SELECT * — always list columns explicitly.
4. Use proper JOIN conditions when multiple tables are needed.
5. Use aggregate functions (COUNT, SUM, AVG) when appropriate.
6. Use GROUP BY when using aggregates.
7. Use ORDER BY for ranking or sorting.
8. Limit result sets using TOP or OFFSET/FETCH (default to 100 rows unless the user requests otherwise).

USER QUESTION:
${userQuery}

OUTPUT:
Return exactly ONE SQL query.
Start with SELECT or WITH.
End with a semicolon.
Do not include explanations or markdown.

SQL:
`;

  return prompt;
}

  /**
   * Build SQL repair prompt
   * Rewrites a previously generated SQL query using concrete validation errors.
   */
  buildSQLRepairPrompt(
    userQuery: string,
    schemaContext: string,
    previousSQL: string,
    issues: string[]
  ): string {
    return `You are fixing a SQL query that failed validation/explain checks.

USER QUERY:
"${userQuery}"

DATABASE SCHEMA:
\`\`\`
${schemaContext}
\`\`\`

PREVIOUS SQL (INVALID):
\`\`\`sql
${previousSQL}
\`\`\`

VALIDATION ERRORS TO FIX:
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

REPAIR RULES:
- Return exactly ONE corrected SQL statement
- Start with SELECT or WITH
- End with semicolon
- Use only tables/columns from the schema
- Do not include markdown, explanations, comments, or extra text
- Keep intent aligned to the user query

Return ONLY the corrected SQL query:`;
  }

  /**
   * Build intent understanding prompt
   * Determines what the user is trying to accomplish
   */
  buildIntentPrompt(userQuery: string): string {
    return `Analyze the following user query and determine their intent. Classify into one of:
- TREND_ANALYSIS: Looking for patterns over time
- COMPARISON: Comparing values across categories
- AGGREGATION: Summarizing data (totals, averages, counts)
- FILTERING: Finding specific records matching criteria
- RANKING: Sorting and finding top/bottom performers
- FORECASTING: Predicting future values
- ANOMALY_DETECTION: Finding outliers or unusual patterns
- CUSTOM_ANALYSIS: Other analytical needs

Query: "${userQuery}"

Respond with ONLY the intent category.`;
  }

  /**
   * Build data interpretation prompt
   * Helps LLM understand what data means in business context
   */
  buildDataInterpretationPrompt(
    data: Record<string, any>,
    queryContext: string
  ): string {
    return `You are a business data analyst. Interpret the following query result and explain its business significance.

Query Context: ${queryContext}

Data Result:
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

Provide a clear, concise business interpretation suitable for executive presentation.`;
  }

  /**
   * Build insight generation prompt
   * Generates actionable insights from query results
   */
  buildInsightPrompt(
    queryResult: Record<string, any>,
    metrics: string[],
    context: string
  ): string {
    return `Generate 3-5 actionable business insights from the following analytics result.

Context: ${context}
Key Metrics: ${metrics.join(', ')}

Data:
\`\`\`json
${JSON.stringify(queryResult, null, 2)}
\`\`\`

Format response as a JSON array of insight objects:
[
  {
    "title": "Insight Title",
    "description": "Detailed explanation",
    "impact": "HIGH|MEDIUM|LOW",
    "recommendation": "Suggested action"
  }
]`;
  }

  /**
   * Build data validation prompt
   * Validates that SQL query makes sense for the intent
   */
  buildValidationPrompt(
    userQuery: string,
    sqlQuery: string,
    intent: string
  ): string {
    return `Validate if the SQL query correctly addresses the user's query intent.

User Query: "${userQuery}"
Intent: ${intent}
SQL Query: 
\`\`\`sql
${sqlQuery}
\`\`\`

Respond with ONLY:
- VALID if the query addresses the intent correctly
- INVALID if the query doesn't match the intent
- NEEDS_ADJUSTMENT with brief reason if minor fixes needed`;
  }

  /**
   * Build query explanation prompt
   * Helps users understand what a query does
   */
  buildExplanationPrompt(sqlQuery: string): string {
    return `Explain what this SQL query does in simple business terms, suitable for a non-technical user.

\`\`\`sql
${sqlQuery}
\`\`\`

Provide a concise explanation (1-2 sentences) of:
1. What data it retrieves
2. How it filters/aggregates the data
3. How results are sorted`;
  }

  /**
   * Build query optimization suggestion prompt
   */
  buildOptimizationPrompt(sqlQuery: string, schema: string): string {
    return `Suggest optimizations for this SQL query based on the database schema.

Database Schema:
\`\`\`
${schema}
\`\`\`

Current Query:
\`\`\`sql
${sqlQuery}
\`\`\`

Provide suggestions for:
1. Adding indexes
2. Restructuring JOINs
3. Using subqueries or CTEs
4. Query result caching strategies

Format as JSON with "suggestion" and "reason" fields.`;
  }

  /**
   * Build few-shot learning examples section
   */
  private buildExamplesSection(): string {
    if (this.systemContext.examples.length === 0) {
      return '';
    }

    let section = '\nEXAMPLES:\n';

    this.systemContext.examples.forEach((example, index) => {
      section += `
Example ${index + 1}:
User: "${example.userQuery}"
Intent: ${example.intent}
SQL:
\`\`\`sql
${example.sqlGenerated}
\`\`\`
`;
    });

    return section;
  }

  private buildTranslationSection(translations?: TableTranslation[]): string {
    const list = translations && translations.length > 0
      ? translations
      : tableTranslations.slice(0, 12);

    if (list.length === 0) {
      return '';
    }

    return list
      .map((translation) => {
        const alias = translation.englishAlias || translation.germanName;
        return `- ${alias} -> ${translation.germanName}: ${translation.description}`;
      })
      .join('\n');
  }

  /**
   * Format business rules from dictionary
   */
  private formatBusinessRules(): string {
    const entries = Object.entries(this.systemContext.businessDictionary);
    
    if (entries.length === 0) {
      return 'No custom business rules defined.';
    }

    return entries
      .map(([term, definition]) => `- ${term}: ${definition}`)
      .join('\n');
  }

  /**
   * Get default system context
   */
  private getDefaultContext(): SystemContext {
    return {
      businessDictionary: {
        'Revenue': 'Total money received from sales',
        'COGS': 'Cost of Goods Sold - direct costs of producing goods',
        'Profit Margin': '(Revenue - COGS) / Revenue',
        'Active Customer': 'Customer with purchase in last 90 days',
        'Churn Rate': 'Percentage of customers lost in period',
        'Cohort': 'Group of customers from same time period',
      },
      queryRules: [
        'Always validate dates are within last 5 years where relevant',
        'Use only tables/columns that exist in the schema context',
        'Prefer explicit JOIN ... ON conditions',
        'Round currency to 2 decimal places',
        'Handle NULL values with COALESCE defaults',
      ],
      examples: [
        {
          userQuery: 'Give me customer names',
          intent: 'FILTERING',
          sqlGenerated: `SELECT TOP 100
  k.Name
FROM kunde k
ORDER BY k.Name ASC;`,
          expectedResult: 'Customer Name',
        },
        {
          userQuery: 'What were total sales by region last quarter?',
          intent: 'AGGREGATION',
          sqlGenerated: `SELECT 
  s.region,
  SUM(s.amount) as total_sales,
  COUNT(*) as order_count
FROM sales s
WHERE 
  s.order_date >= DATEADD(MONTH, -3, GETDATE())
GROUP BY s.region
ORDER BY total_sales DESC
OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;`,
          expectedResult: 'Region | Total Sales | Order Count',
        },
        {
          userQuery: 'Show me the top 10 products by revenue this year',
          intent: 'RANKING',
          sqlGenerated: `SELECT TOP 10
  ap.Artikelnum,
  COUNT(*) AS line_count,
  SUM(ap.Summe) AS total_revenue
FROM anposten ap
JOIN rechnung r ON ap.Nummer = r.Nummer
WHERE 
  YEAR(r.Datum) = YEAR(GETDATE())
GROUP BY ap.Artikelnum
ORDER BY total_revenue DESC;`,
          expectedResult: 'Artikelnum | Total Revenue | Line Count',
        },
        {
          userQuery: 'Calculate the total profit we made with software Y in 2025',
          intent: 'AGGREGATION',
          sqlGenerated: `SELECT
  SUM(ap.Summe - COALESCE(ap.Fremdsumme, 0)) AS total_profit
FROM anposten ap
JOIN rechnung r ON ap.Nummer = r.Nummer
WHERE
  ap.Artikelnum LIKE $1
  AND YEAR(r.Datum) = $2;`,
          expectedResult: 'Total profit for Software Y in 2025',
        },
        {
          userQuery: 'What is the expected interval for maintenance at company Z',
          intent: 'STATISTICS',
          sqlGenerated: `WITH maintenance_events AS (
  SELECT
    w.Kundennumm,
    w.Name,
    w.Datum,
    LEAD(w.Datum) OVER (PARTITION BY w.Kundennumm ORDER BY w.Datum) AS next_datum
  FROM wartung w
  WHERE w.Name LIKE $1
     OR w.Kundennumm IN (SELECT k.Kundennumm FROM kunde k WHERE k.Name LIKE $1)
)
SELECT
  AVG(DATEDIFF(DAY, Datum, next_datum)) AS avg_maintenance_interval
FROM maintenance_events
WHERE next_datum IS NOT NULL;`,
          expectedResult: 'Average days between maintenance events for Company Z',
        },
      ],
    };
  }

  /**
   * Update system context with new business rules
   */
  updateBusinessDictionary(
    term: string,
    definition: string
  ): void {
    this.systemContext.businessDictionary[term] = definition;
  }

  /**
   * Add new query rule
   */
  addQueryRule(rule: string): void {
    if (!this.systemContext.queryRules.includes(rule)) {
      this.systemContext.queryRules.push(rule);
    }
  }

  /**
   * Add example query pair
   */
  addExample(example: QueryExample): void {
    this.systemContext.examples.push(example);
  }
}

export { PromptBuilder, SystemContext, QueryExample, PromptOptions };
