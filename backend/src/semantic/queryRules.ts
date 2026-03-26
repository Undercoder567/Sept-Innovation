// Intent Resolution Rules
// Maps user query patterns to analytical intents and recommended approaches

export interface IntentPattern {
  name: string;
  keywords: string[];
  sqlPatterns: string[];
  visualization?: string;
  analysis?: string;
}

export interface QueryPattern {
  pattern: string;
  suggested_columns: string[];
  suggested_aggregation?: string;
  suggested_timeframe?: string;
  suggested_filters?: string;
  suggested_grouping?: string;
}

export const intentPatterns: IntentPattern[] = [
  {
    name: "Time Series Analysis",
    keywords: ["over time", "trend", "historical", "month over month", "year over year"],
    sqlPatterns: [
      "DATEPART to group by time period",
      "ORDER BY date column",
      "Include previous period for comparison",
      "LAG() for period-over-period comparison",
      "ROW_NUMBER() for ranking within periods"
    ],
    visualization: "LINE"
  },
  {
    name: "Top/Bottom Analysis",
    keywords: ["top", "bottom", "highest", "lowest", "best", "worst"],
      sqlPatterns: [
        "ORDER BY column DESC/ASC",
        "TOP 10",
        "Consider RANK() for ties"
      ],
    visualization: "BAR"
  },
  {
    name: "Composition Analysis",
    keywords: ["breakdown", "distribution", "composition", "by category", "split"],
    sqlPatterns: [
      "GROUP BY categorical field",
      "SUM or COUNT aggregation",
      "Calculate percentages"
    ],
    visualization: "PIE"
  },
  {
    name: "Performance Comparison",
    keywords: ["compare", "versus", "vs", "difference", "gap"],
    sqlPatterns: [
      "GROUP BY dimension",
      "Multiple WHERE conditions",
      "Calculate variance"
    ],
    visualization: "BAR"
  },
  {
    name: "Correlation Analysis",
    keywords: ["relationship", "correlation", "impact", "effect", "influence"],
    sqlPatterns: [
      "Join multiple fact tables",
      "Include both metrics",
      "Filter for time period"
    ],
    visualization: "SCATTER"
  },
  {
    name: "Forecasting",
    keywords: ["forecast", "predict", "next", "future", "projection"],
    sqlPatterns: [
      "Historical data only (no future dates)",
      "Include full time series",
      "Sort by date ascending"
    ],
    analysis: "exponential_smoothing"
  },
  {
    name: "Anomaly Detection",
    keywords: ["unusual", "abnormal", "outlier", "spike", "unexpected", "anomaly"],
    sqlPatterns: [
      "Include all records",
      "Full period for reference",
      "No aggregation initially"
    ],
    analysis: "z_score"
  },
  {
    name: "Cohort Analysis",
    keywords: ["cohort", "retention", "lifetime", "returning", "retention rate"],
    sqlPatterns: [
      "Group by first date",
      "Track across periods",
      "Calculate retention %"
    ]
  }
];

export const queryPatterns: Record<string, QueryPattern> = {
  revenue_query: {
    pattern: ".*(revenue|sales|income|earnings).*",
    suggested_columns: ["date", "amount", "product_id", "customer_id", "region"],
    suggested_aggregation: "SUM(amount)",
    suggested_timeframe: "last 12 months"
  },
  customer_query: {
    pattern: ".*(customer|user|account).*",
    suggested_columns: ["customer_id", "registration_date", "last_purchase", "total_spend", "segment"],
    suggested_filters: "WHERE is_active = 1"
  },
  product_query: {
    pattern: ".*(product|item|sku).*",
    suggested_columns: ["product_id", "category", "units_sold", "revenue"],
    suggested_grouping: "GROUP BY product_id"
  }
};

export const dateRangePatterns: Record<string, string> = {
  "last 7 days": "DATE >= DATEADD(DAY, -7, GETDATE())",
  "last 30 days": "DATE >= DATEADD(DAY, -30, GETDATE())",
  "last quarter": "DATE >= DATEADD(QUARTER, -1, GETDATE())",
  "year to date": "DATE >= DATEFROMPARTS(YEAR(GETDATE()), 1, 1)",
  "last 12 months": "DATE >= DATEADD(MONTH, -12, GETDATE())"
};

export function resolveIntent(query: string): IntentPattern | null {
  const lowerQuery = query.toLowerCase();
  
  for (const intent of intentPatterns) {
    for (const keyword of intent.keywords) {
      if (lowerQuery.includes(keyword)) {
        return intent;
      }
    }
  }
  
  return null;
}

export function getDateRangeCondition(rangePhrase: string): string | null {
  const lowerPhrase = rangePhrase.toLowerCase();
  
  for (const [phrase, condition] of Object.entries(dateRangePatterns)) {
    if (lowerPhrase.includes(phrase)) {
      return condition;
    }
  }
  
  return null;
}
