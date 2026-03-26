/**
 * Intent Resolver
 * Analyzes user queries to determine analytical intent and recommend SQL approaches
 * Bridges natural language to structured analytical patterns
 */

import businessDictionary from './businessDictionary.json';

export enum AnalyticalIntent {
  TIME_SERIES = 'TIME_SERIES',
  TOP_BOTTOM = 'TOP_BOTTOM',
  COMPOSITION = 'COMPOSITION',
  COMPARISON = 'COMPARISON',
  CORRELATION = 'CORRELATION',
  ANOMALY = 'ANOMALY',
  FORECAST = 'FORECAST',
  AGGREGATION = 'AGGREGATION'
}

export interface IntentResolution {
  intent: AnalyticalIntent;
  confidence: number; // 0-1
  suggestedFields: string[];
  recommendedVisualization: 'BAR' | 'LINE' | 'PIE' | 'SCATTER' | 'HEATMAP' | 'TABLE';
  sqlPatterns: string[];
  sqlFunctions: string[];
  dateRangePreset?: 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'LAST_QUARTER' | 'YTD' | 'LAST_12_MONTHS';
}

interface IntentPattern {
  intent: AnalyticalIntent;
  keywords: string[];
  weight: number;
  visualization: 'BAR' | 'LINE' | 'PIE' | 'SCATTER' | 'HEATMAP' | 'TABLE';
  sqlPatterns: string[];
  sqlFunctions: string[];
}

const intentPatterns: IntentPattern[] = [
  {
    intent: AnalyticalIntent.TIME_SERIES,
    keywords: [
      'over time', 'trend', 'historical', 'month over month', 'year over year',
      'how has', 'growing', 'declining', 'progression', 'timeline'
    ],
    weight: 0.9,
    visualization: 'LINE',
    sqlPatterns: [
      'DATEPART(period, date_column) GROUP BY period',
      'ORDER BY date_column ASC',
      'Include multiple periods for comparison'
    ],
    sqlFunctions: [
      'LAG() for period-over-period changes',
      'ROW_NUMBER() for period ranking',
      'DATEPART() for time grouping'
    ]
  },
  {
    intent: AnalyticalIntent.TOP_BOTTOM,
    keywords: [
      'top', 'bottom', 'highest', 'lowest', 'best', 'worst',
      'leading', 'lagging', 'rank', 'maximum', 'minimum'
    ],
    weight: 0.85,
    visualization: 'BAR',
    sqlPatterns: [
      'ORDER BY metric DESC/ASC',
      'TOP 10',
      'GROUP BY dimension if needed'
    ],
    sqlFunctions: [
      'RANK() for handling ties',
      'DENSE_RANK() for consecutive ranking',
      'ROW_NUMBER() for unique ranking'
    ]
  },
  {
    intent: AnalyticalIntent.COMPOSITION,
    keywords: [
      'breakdown', 'distribution', 'composition', 'by category', 'split',
      'segment', 'slice', 'how much', 'percentage of'
    ],
    weight: 0.8,
    visualization: 'PIE',
    sqlPatterns: [
      'GROUP BY categorical_field',
      'SUM(metric) or COUNT(*)',
      'Calculate percentages: metric / SUM(metric) * 100'
    ],
    sqlFunctions: [
      'SUM() for totals',
      'COUNT() for frequencies',
      'CAST as NUMERIC for percentage calculation'
    ]
  },
  {
    intent: AnalyticalIntent.COMPARISON,
    keywords: [
      'compare', 'versus', 'vs', 'difference', 'compared to',
      'better than', 'worse than', 'against'
    ],
    weight: 0.8,
    visualization: 'BAR',
    sqlPatterns: [
      'JOIN same table with different filters',
      'UNION for parallel groups',
      'Calculate differences: value1 - value2'
    ],
    sqlFunctions: [
      'CASE WHEN for conditional grouping',
      'SUM() for aggregation',
      'COALESCE() for null handling'
    ]
  },
  {
    intent: AnalyticalIntent.CORRELATION,
    keywords: [
      'relationship', 'correlated', 'affects', 'impacts', 'influences',
      'together', 'associated', 'related'
    ],
    weight: 0.7,
    visualization: 'SCATTER',
    sqlPatterns: [
      'SELECT metric1, metric2 WHERE both exist',
      'ORDER BY metric1 for scatter positioning'
    ],
    sqlFunctions: [
      'COUNT(*) for point density',
      'Avoid aggregation for raw correlation'
    ]
  },
  {
    intent: AnalyticalIntent.ANOMALY,
    keywords: [
      'unusual', 'outlier', 'abnormal', 'unexpected', 'spike',
      'drop', 'unusual spike', 'unexpected drop', 'deviation'
    ],
    weight: 0.75,
    visualization: 'LINE',
    sqlPatterns: [
      'Get all data points over time period',
      'Calculate mean and standard deviation',
      'Identify points > 2 standard deviations from mean'
    ],
    sqlFunctions: [
      'AVG() for mean',
      'STDDEV() for standard deviation',
      'ABS() for absolute difference'
    ]
  },
  {
    intent: AnalyticalIntent.FORECAST,
    keywords: [
      'predict', 'forecast', 'expect', 'next', 'future',
      'project', 'estimate', 'will'
    ],
    weight: 0.7,
    visualization: 'LINE',
    sqlPatterns: [
      'Get historical data with consistent time periods',
      'Recent data weighted more heavily',
      'Include trend and seasonality patterns'
    ],
    sqlFunctions: [
      'LAG() for previous periods',
      'AVG() for moving averages',
      'Recent data handling'
    ]
  },
  {
    intent: AnalyticalIntent.AGGREGATION,
    keywords: [
      'total', 'sum', 'count', 'average', 'mean',
      'aggregate', 'overall', 'combined', 'all together'
    ],
    weight: 0.9,
    visualization: 'TABLE',
    sqlPatterns: [
      'SUM/COUNT/AVG without GROUP BY for single row',
      'Optional filters for scope'
    ],
    sqlFunctions: [
      'SUM() for totals',
      'COUNT() for counts',
      'AVG() for averages',
      'MAX/MIN() for extremes'
    ]
  }
];

const dateRangeKeywords = {
  'LAST_7_DAYS': ['past week', 'last 7 days', 'last week', 'this week'],
  'LAST_30_DAYS': ['past month', 'last 30 days', 'last month', 'this month'],
  'LAST_QUARTER': ['last quarter', 'past quarter', 'quarterly'],
  'YTD': ['year to date', 'ytd', 'this year'],
  'LAST_12_MONTHS': ['last 12 months', 'past year', 'annual', 'yearly']
};

/**
 * Resolves user query to analytical intent
 */
export class IntentResolver {
  /**
   * Analyzes query text and determines analytical intent
   */
  static resolveIntent(query: string): IntentResolution {
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(/\s+/);

    // Score each intent based on keyword matches
    const scores = intentPatterns.map(pattern => {
      const matchCount = pattern.keywords.filter(keyword =>
        lowerQuery.includes(keyword)
      ).length;

      const score = (matchCount / pattern.keywords.length) * pattern.weight;
      return { pattern, score };
    });

    // Find highest scoring intent
    const bestMatch = scores.reduce((prev, current) =>
      current.score > prev.score ? current : prev
    );

    const pattern = bestMatch.pattern;
    const confidence = Math.min(bestMatch.score, 1);

    // Detect date range preset
    let dateRangePreset: IntentResolution['dateRangePreset'] | undefined;
    for (const [preset, keywords] of Object.entries(dateRangeKeywords)) {
      if (keywords.some(keyword => lowerQuery.includes(keyword))) {
        dateRangePreset = preset as IntentResolution['dateRangePreset'];
        break;
      }
    }

    // Extract suggested fields from business dictionary
    const suggestedFields = this.extractSuggestedFields(query, pattern.intent);

    return {
      intent: pattern.intent,
      confidence,
      suggestedFields,
      recommendedVisualization: pattern.visualization,
      sqlPatterns: pattern.sqlPatterns,
      sqlFunctions: pattern.sqlFunctions,
      dateRangePreset
    };
  }

  /**
   * Extracts field suggestions based on intent and business dictionary
   */
  private static extractSuggestedFields(
    query: string,
    intent: AnalyticalIntent
  ): string[] {
    const lowerQuery = query.toLowerCase();
    const suggestedFields: Set<string> = new Set();

    // Check business dictionary for mentioned terms
    const terms = (businessDictionary as any).terms || {};
    for (const [term, config] of Object.entries(terms)) {
      const termPatterns = (config as any).patterns || [];
      if (termPatterns.some((pattern: string) => lowerQuery.includes(pattern))) {
        const fields = (config as any).database_fields || [];
        fields.forEach((field: string) => suggestedFields.add(field));
      }
    }

    // Intent-specific field suggestions
    const intentFieldSuggestions: Record<AnalyticalIntent, string[]> = {
      [AnalyticalIntent.TIME_SERIES]: ['date', 'timestamp', 'created_at', 'order_date'],
      [AnalyticalIntent.TOP_BOTTOM]: ['amount', 'count', 'revenue', 'sales'],
      [AnalyticalIntent.COMPOSITION]: ['category', 'type', 'status', 'segment'],
      [AnalyticalIntent.COMPARISON]: ['amount', 'metric', 'value', 'count'],
      [AnalyticalIntent.CORRELATION]: ['amount', 'count', 'value', 'metric'],
      [AnalyticalIntent.ANOMALY]: ['amount', 'value', 'metric', 'price'],
      [AnalyticalIntent.FORECAST]: ['amount', 'count', 'revenue', 'date'],
      [AnalyticalIntent.AGGREGATION]: ['amount', 'count', 'revenue', 'sales']
    };

    intentFieldSuggestions[intent].forEach(field => suggestedFields.add(field));

    return Array.from(suggestedFields);
  }

  /**
   * Builds SQL pattern recommendation based on intent
   */
  static buildSQLRecommendation(resolution: IntentResolution): string {
    const patterns = resolution.sqlPatterns;
    const functions = resolution.sqlFunctions;

    const recommendation = `
Based on detected intent: ${resolution.intent} (confidence: ${(resolution.confidence * 100).toFixed(0)}%)

SQL Patterns:
${patterns.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}

Recommended Functions:
${functions.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}

Suggested Fields: ${resolution.suggestedFields.join(', ')}
Visualization: ${resolution.recommendedVisualization}
${resolution.dateRangePreset ? `Date Range: ${resolution.dateRangePreset}` : ''}
    `.trim();

    return recommendation;
  }

  /**
   * Validates if query matches expected intent pattern
   */
  static validateIntentMatch(query: string, intent: AnalyticalIntent): boolean {
    const resolution = this.resolveIntent(query);
    return resolution.intent === intent && resolution.confidence > 0.5;
  }

  /**
   * Gets all available intents
   */
  static getAvailableIntents(): AnalyticalIntent[] {
    return Object.values(AnalyticalIntent);
  }

  /**
   * Gets keywords for specific intent
   */
  static getIntentKeywords(intent: AnalyticalIntent): string[] {
    const pattern = intentPatterns.find(p => p.intent === intent);
    return pattern ? pattern.keywords : [];
  }

  /**
   * Analyzes multiple queries and returns dominant intent
   */
  static resolveDominantIntent(queries: string[]): AnalyticalIntent {
    const resolutions = queries.map(q => this.resolveIntent(q));
    const intentCounts = new Map<AnalyticalIntent, number>();

    resolutions.forEach(r => {
      const count = intentCounts.get(r.intent) || 0;
      intentCounts.set(r.intent, count + 1);
    });

    let dominant = AnalyticalIntent.AGGREGATION;
    let maxCount = 0;

    intentCounts.forEach((count, intent) => {
      if (count > maxCount) {
        maxCount = count;
        dominant = intent;
      }
    });

    return dominant;
  }

  /**
   * Suggests query improvements based on intent
   */
  static suggestQueryImprovement(query: string, resolution: IntentResolution): string[] {
    const suggestions: string[] = [];

    // Time series should have time range
    if (resolution.intent === AnalyticalIntent.TIME_SERIES && !resolution.dateRangePreset) {
      suggestions.push('Consider specifying a time period (e.g., "last 30 days")');
    }

    // Top/bottom should have limit
    if (resolution.intent === AnalyticalIntent.TOP_BOTTOM) {
      if (!query.toLowerCase().includes('top') && !query.toLowerCase().includes('bottom')) {
        suggestions.push('Specify "top N" or "bottom N" for clearer intent');
      }
    }

    // Low confidence suggests clarification
    if (resolution.confidence < 0.5) {
      suggestions.push('Query is ambiguous - try being more specific about what you want to analyze');
    }

    // No date range for time series
    if (
      resolution.intent === AnalyticalIntent.TIME_SERIES &&
      resolution.dateRangePreset === undefined
    ) {
      suggestions.push('Add a time period for better results (e.g., "over the last 90 days")');
    }

    return suggestions;
  }
}

export default IntentResolver;
