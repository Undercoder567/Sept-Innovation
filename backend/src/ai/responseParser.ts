import { LLMClient } from '../ai/llmClient';

interface AnalyticsResponse {
  rawData: any;
  summary: string;
  insights: string[];
  recommendations: string[];
  metrics: Record<string, number | string>;
  visualization: {
    type: 'BAR' | 'LINE' | 'PIE' | 'TABLE' | 'HEATMAP' | 'SCATTER';
    data: any;
  };
}

interface ParsedResponse {
  queryResult: any;
  summary: string;
  insights: string[];
  isValid: boolean;
  errors: string[];
}

/**
 * Response Parser
 * Processes raw query results and enhances them with:
 * - AI-generated summaries and insights
 * - Automatic visualization recommendations
 * - Statistical analysis
 * - Business context
 */
class ResponseParser {
  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }

  /**
   * Parse and enhance query results
   */
  async parseQueryResult(
    result: any,
    queryContext: string,
    userQuery: string
  ): Promise<ParsedResponse> {
    try {
      const isValid = this.validateResult(result);

      if (!isValid.valid) {
        return {
          queryResult: result,
          summary: 'Query returned invalid or empty results',
          insights: [],
          isValid: false,
          errors: isValid.errors,
        };
      }

      // Generate AI-powered summary
      const summary = await this.generateSummary(result, userQuery);

      // Extract insights
      const insights = await this.extractInsights(result, queryContext);

      return {
        queryResult: result,
        summary,
        insights,
        isValid: true,
        errors: [],
      };
    } catch (error) {
      console.error('Error parsing response:', error);
      return {
        queryResult: result,
        summary: 'Error processing results',
        insights: [],
        isValid: false,
        errors: [(error as Error).message],
      };
    }
  }

  /**
   * Validate query results
   */
  private validateResult(result: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!result) {
      errors.push('No result returned');
      return { valid: false, errors };
    }

    if (Array.isArray(result) && result.length === 0) {
      errors.push('Query returned empty result set');
      return { valid: false, errors };
    }

    if (typeof result === 'object' && Object.keys(result).length === 0) {
      errors.push('Query returned empty object');
      return { valid: false, errors };
    }

    return { valid: true, errors };
  }

  /**
   * Generate summary using LLM
   */
  private async generateSummary(result: any, userQuery: string): Promise<string> {
    try {
      const prompt = `Summarize this query result in 1-2 sentences for a business user.

User Query: "${userQuery}"

Result:
${JSON.stringify(result, null, 2).substring(0, 1000)}

Summary (concise, business-friendly):`;

      const summary = await this.llmClient.generate(prompt, {
        temperature: 0.5,
        maxTokens: 150,
      });

      return summary.trim();
    } catch (error) {
      console.error('Error generating summary:', error);
      return this.generateBasicSummary(result);
    }
  }

  /**
   * Generate basic summary as fallback
   */
  private generateBasicSummary(result: any): string {
    if (Array.isArray(result)) {
      return `Query returned ${result.length} records.`;
    }

    if (typeof result === 'object') {
      const keys = Object.keys(result);
      return `Query returned data with ${keys.length} fields.`;
    }

    return 'Query completed successfully.';
  }

  /**
   * Extract insights from results
   */
  private async extractInsights(result: any, context: string): Promise<string[]> {
    try {
      const insights = await this.llmClient.generateInsights(
        JSON.stringify(result).substring(0, 2000),
        context
      );
      return insights.filter(insight => insight && insight.length > 0);
    } catch (error) {
      console.error('Error extracting insights:', error);
      return this.extractBasicInsights(result);
    }
  }

  /**
   * Extract basic insights as fallback
   */
  private extractBasicInsights(result: any): string[] {
    const insights: string[] = [];

    if (Array.isArray(result) && result.length > 0) {
      // Detect numeric fields for basic statistics
      const firstRecord = result[0];
      const numericFields = Object.entries(firstRecord)
        .filter(([_, value]) => typeof value === 'number')
        .map(([key, value]) => ({ key, value: value as number }));

      if (numericFields.length > 0) {
        // Calculate basic statistics
        for (const field of numericFields) {
          const values = result.map((r: any) => r[field.key]).filter((v: any) => typeof v === 'number');
          if (values.length > 0) {
            const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
            const max = Math.max(...values);
            const min = Math.min(...values);

            insights.push(`${field.key}: Average ${avg.toFixed(2)}, Range [${min}, ${max}]`);
          }
        }
      }
    }

    if (insights.length === 0) {
      insights.push('Data retrieved successfully');
    }

    return insights;
  }

  /**
   * Recommend visualization type based on data
   */
  recommendVisualization(
    result: any
  ): 'BAR' | 'LINE' | 'PIE' | 'TABLE' | 'HEATMAP' | 'SCATTER' {
    if (!Array.isArray(result) || result.length === 0) {
      return 'TABLE';
    }

    const firstRecord = result[0];
    const fieldCount = Object.keys(firstRecord).length;
    const recordCount = result.length;

    // Count numeric and date fields
    let numericCount = 0;
    let dateCount = 0;
    let stringCount = 0;

    Object.values(firstRecord).forEach(value => {
      if (typeof value === 'number') numericCount++;
      else if (value instanceof Date || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value as string)) dateCount++;
      else stringCount++;
    });

    // Heuristic-based recommendation
    if (dateCount > 0 && numericCount > 0 && recordCount > 10) {
      return 'LINE'; // Time series
    }

    if (numericCount >= 2 && recordCount < 50) {
      return 'SCATTER'; // Correlation analysis
    }

    if (stringCount > 0 && numericCount === 1 && recordCount < 20) {
      return 'BAR'; // Categories with values
    }

    if (numericCount === 1 && stringCount === 1 && recordCount <= 10) {
      return 'PIE'; // Part of whole
    }

    return 'TABLE'; // Default to table
  }

  /**
   * Format result for visualization
   */
  formatForVisualization(result: any, visualizationType: string): any {
    if (!Array.isArray(result)) {
      return result;
    }

    switch (visualizationType) {
      case 'BAR':
        return this.formatForBar(result);
      case 'LINE':
        return this.formatForLine(result);
      case 'PIE':
        return this.formatForPie(result);
      case 'SCATTER':
        return this.formatForScatter(result);
      case 'TABLE':
      default:
        return result;
    }
  }

  private formatForBar(data: any[]): any {
    if (data.length === 0) return data;

    const labels: string[] = [];
    const datasets: { label: string; data: number[] }[] = [];

    const firstRecord = data[0];
    const [labelField, ...valueFields] = Object.keys(firstRecord);

    data.forEach(record => {
      labels.push(String(record[labelField]));
    });

    valueFields.forEach(field => {
      const values = data.map(r => r[field]).filter((v: any) => typeof v === 'number');
      if (values.length > 0) {
        datasets.push({
          label: field,
          data: values,
        });
      }
    });

    return { labels, datasets };
  }

  private formatForLine(data: any[]): any {
    return this.formatForBar(data); // Similar structure
  }

  private formatForPie(data: any[]): any {
    if (data.length === 0) return data;

    const firstRecord = data[0];
    const [labelField, valueField] = Object.keys(firstRecord);

    return {
      labels: data.map(r => String(r[labelField])),
      datasets: [
        {
          label: valueField,
          data: data.map(r => r[valueField]).filter((v: any) => typeof v === 'number'),
        },
      ],
    };
  }

  private formatForScatter(data: any[]): any {
    if (data.length < 2) return data;

    const firstRecord = data[0];
    const [xField, yField] = Object.keys(firstRecord);

    return {
      datasets: [
        {
          label: `${xField} vs ${yField}`,
          data: data.map(r => ({
            x: r[xField],
            y: r[yField],
          })),
        },
      ],
    };
  }

  /**
   * Calculate summary statistics
   */
  calculateStatistics(result: any): Record<string, number | string> {
    const stats: Record<string, number | string> = {};

    if (!Array.isArray(result) || result.length === 0) {
      return stats;
    }

    stats['recordCount'] = result.length;

    const firstRecord = result[0];
    const numericFields = Object.entries(firstRecord)
      .filter(([_, value]) => typeof value === 'number')
      .map(([key, value]) => ({ key, value: value as number }));

    for (const field of numericFields) {
      const values = result
        .map((r: any) => r[field.key])
        .filter((v: any) => typeof v === 'number') as number[];

      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        const max = Math.max(...values);
        const min = Math.min(...values);

        stats[`${field.key}_sum`] = parseFloat(sum.toFixed(2));
        stats[`${field.key}_avg`] = parseFloat(avg.toFixed(2));
        stats[`${field.key}_max`] = max;
        stats[`${field.key}_min`] = min;
      }
    }

    return stats;
  }
}

export { ResponseParser, AnalyticsResponse, ParsedResponse };
