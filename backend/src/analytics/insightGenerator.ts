/**
 * Insight Generator
 * Transforms raw query results into actionable business insights using AI and statistics
 * Integrates with Python analytics engine for advanced analysis
 */

import axios from 'axios';
import { LLMClient } from '../ai/llmClient';
import StatsClient from './statsClient';

export interface QueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
  executionTime: number;
  rowCount: number;
}

export interface AnalysisResult {
  type: 'CORRELATION' | 'TREND' | 'GROWTH' | 'ANOMALY' | 'PERFORMANCE' | 'COMPOSITION';
  confidence: number;
  summary: string;
  details: Record<string, unknown>;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation?: string;
}

export interface InsightPackage {
  query: string;
  generatedSql: string;
  resultCount: number;
  insights: AnalysisResult[];
  visualizationRecommendation: {
    type: 'LINE' | 'BAR' | 'PIE' | 'SCATTER' | 'HEATMAP' | 'TABLE';
    rationale: string;
  };
  summary: string;
  executionStats: {
    queryTime: number;
    analysisTime: number;
    totalTime: number;
  };
}

interface PythonAnalysisResponse {
  status: 'success' | 'error';
  analysis: Record<string, unknown>;
  error?: string;
}

export class InsightGenerator {
  private llmClient: LLMClient;
  private statsClient: StatsClient;
  private pythonEngineUrl: string;

  constructor(
    llmClient: LLMClient,
    pythonEngineUrl = process.env.PYTHON_ENGINE_URL || 'http://localhost:5000'
  ) {
    this.llmClient = llmClient;
    this.statsClient = new StatsClient();
    this.pythonEngineUrl = pythonEngineUrl;
  }

  /**
   * Generates comprehensive insight package from query results
   */
  async generateInsights(
    query: string,
    generatedSql: string,
    result: QueryResult,
    userContext?: { userId: string; role: string }
  ): Promise<InsightPackage> {
    const startTime = Date.now();
    const analysisStartTime = Date.now();

    try {
      // Validate result
      if (!result.rows || result.rows.length === 0) {
        return this.generateEmptyResultInsight(query, generatedSql, result, startTime);
      }

      // Parallel analysis: statistical + Python analytics + LLM
      const [statisticalInsights, pythonAnalysis, aiInsight] = await Promise.allSettled([
        this.performStatisticalAnalysis(result, query),
        this.callPythonAnalyticsEngine(result, query),
        this.generateAIInsight(query, result)
      ]);

      const insights: AnalysisResult[] = [];

      // Collect statistical insights
      if (statisticalInsights.status === 'fulfilled') {
        insights.push(...statisticalInsights.value);
      }

      // Collect Python analytics insights
      if (pythonAnalysis.status === 'fulfilled' && pythonAnalysis.value) {
        insights.push(...this.parseVythonAnalysis(pythonAnalysis.value));
      }

      // Collect AI insight
      if (aiInsight.status === 'fulfilled' && aiInsight.value) {
        insights.push(aiInsight.value);
      }

      // Determine visualization
      const visualization = this.recommendVisualization(result, insights);

      // Generate summary
      const summary = await this.generateExecutiveSummary(insights, result);

      const analysisTime = Date.now() - analysisStartTime;
      const totalTime = Date.now() - startTime;

      const insightPackage: InsightPackage = {
        query,
        generatedSql,
        resultCount: result.rowCount,
        insights: this.rankInsights(insights),
        visualizationRecommendation: visualization,
        summary,
        executionStats: {
          queryTime: result.executionTime,
          analysisTime,
          totalTime
        }
      };

      return insightPackage;
    } catch (error) {
      console.error('Analysis error:', error);
      throw error;
    }
  }

  /**
   * Performs statistical analysis on results
   */
  private async performStatisticalAnalysis(
    result: QueryResult,
    query: string
  ): Promise<AnalysisResult[]> {
    const insights: AnalysisResult[] = [];

    // Identify numeric columns
    const numericColumns = this.identifyNumericColumns(result);

    // Correlation analysis
    if (numericColumns.length >= 2) {
      const correlations = this.statsClient.calculateCorrelations(result.rows, numericColumns);
      if (Object.keys(correlations).length > 0) {
        insights.push({
          type: 'CORRELATION',
          confidence: 0.85,
          summary: this.formatCorrelationSummary(correlations),
          details: { correlations },
          impact: this.determineCorrelationImpact(correlations),
          recommendation: this.generateCorrelationRecommendation(correlations)
        });
      }
    }

    // Trend analysis
    const dateColumns = this.identifyDateColumns(result);
    const numericColumn = numericColumns[0];
    if (dateColumns.length > 0 && numericColumn) {
      const trend = this.statsClient.analyzeTrend(result.rows, dateColumns[0], numericColumn);
      if (trend.slope !== 0) {
        insights.push({
          type: 'TREND',
          confidence: trend.rSquared,
          summary: this.formatTrendSummary(trend),
          details: trend as unknown as Record<string, unknown>,
          impact: this.determineTrendImpact(trend),
          recommendation: this.generateTrendRecommendation(trend)
        });
      }
    }

    // Anomaly detection
    if (numericColumns.length > 0) {
      const anomalies = this.statsClient.detectAnomalies(result.rows, numericColumns[0]);
      if (anomalies.outliers.length > 0) {
        insights.push({
          type: 'ANOMALY',
          confidence: 0.9,
          summary: `Found ${anomalies.outliers.length} anomalies in data`,
          details: anomalies as unknown as Record<string, unknown>,
          impact: anomalies.outliers.length > 5 ? 'HIGH' : 'MEDIUM'
        });
      }
    }

    // Composition analysis
    const categoryColumns = this.identifyCategoryColumns(result);
    if (categoryColumns.length > 0 && numericColumns.length > 0) {
      const composition = this.statsClient.analyzeComposition(
        result.rows,
        categoryColumns[0],
        numericColumns[0]
      );
      insights.push({
        type: 'COMPOSITION',
        confidence: 0.8,
        summary: this.formatCompositionSummary(composition),
        details: composition as unknown as Record<string, unknown>,
        impact: 'MEDIUM'
      });
    }

    return insights;
  }

  /**
   * Calls Python analytics engine for advanced analysis
   */
  private async callPythonAnalyticsEngine(
    result: QueryResult,
    query: string
  ): Promise<PythonAnalysisResponse | null> {
    try {
      const response = await axios.post<PythonAnalysisResponse>(
        `${this.pythonEngineUrl}/api/analyze`,
        {
          data: result.rows,
          query,
          columns: result.columns
        },
        { timeout: 10000 }
      );

      return response.data.status === 'success' ? response.data : null;
    } catch (error) {
      console.warn('Python analytics engine unavailable:', error);
      return null;
    }
  }

  /**
   * Parses Python analytics response into insights
   */
  private parseVythonAnalysis(analysis: PythonAnalysisResponse): AnalysisResult[] {
    const insights: AnalysisResult[] = [];

    const analysisData = analysis.analysis as Record<string, any>;

    // Growth analysis
    if (analysisData.growth_rate) {
      insights.push({
        type: 'GROWTH',
        confidence: 0.85,
        summary: `Growth rate: ${(analysisData.growth_rate * 100).toFixed(2)}% per period`,
        details: analysisData,
        impact: Math.abs(analysisData.growth_rate) > 0.1 ? 'HIGH' : 'MEDIUM',
        recommendation: analysisData.growth_rate > 0 ? 'Capitalize on growth momentum' : 'Investigate decline'
      });
    }

    // Performance metrics
    if (analysisData.avg && analysisData.std) {
      insights.push({
        type: 'PERFORMANCE',
        confidence: 0.8,
        summary: `Average: ${analysisData.avg.toFixed(2)}, Std Dev: ${analysisData.std.toFixed(2)}`,
        details: analysisData,
        impact: 'MEDIUM'
      });
    }

    return insights;
  }

  /**
   * Generates AI-powered insight
   */
  private async generateAIInsight(
    query: string,
    result: QueryResult
  ): Promise<AnalysisResult | null> {
    try {
      const summary = await this.llmClient.summarize(
        JSON.stringify(result.rows.slice(0, 10))
      );

      return {
        type: 'PERFORMANCE',
        confidence: 0.75,
        summary,
        details: { aiGenerated: true, rowsSummarized: Math.min(10, result.rows.length) },
        impact: 'MEDIUM'
      };
    } catch (error) {
      console.warn('AI insight generation failed:', error);
      return null;
    }
  }

  /**
   * Ranks insights by impact and confidence
   */
  private rankInsights(insights: AnalysisResult[]): AnalysisResult[] {
    const impactScore = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return insights.sort((a, b) => {
      const scoreA = impactScore[a.impact] * a.confidence;
      const scoreB = impactScore[b.impact] * b.confidence;
      return scoreB - scoreA;
    });
  }

  /**
   * Recommends visualization type
   */
  private recommendVisualization(
    result: QueryResult,
    insights: AnalysisResult[]
  ): InsightPackage['visualizationRecommendation'] {
    const numericCols = this.identifyNumericColumns(result);
    const dateCols = this.identifyDateColumns(result);
    const categoryCols = this.identifyCategoryColumns(result);

    if (dateCols.length > 0 && numericCols.length > 0) {
      return {
        type: 'LINE',
        rationale: 'Time series data detected - line chart shows trends over time'
      };
    }

    if (categoryCols.length > 0 && numericCols.length > 0) {
      if (result.rows.length <= 10) {
        return {
          type: 'PIE',
          rationale: 'Categorical breakdown with few categories'
        };
      }
      return {
        type: 'BAR',
        rationale: 'Comparison across multiple categories'
      };
    }

    if (numericCols.length >= 2 && result.rows.length < 1000) {
      return {
        type: 'SCATTER',
        rationale: 'Multiple numeric fields - scatter plot shows relationships'
      };
    }

    return {
      type: 'TABLE',
      rationale: 'Detailed data view'
    };
  }

  /**
   * Generates executive summary from insights
   */
  private async generateExecutiveSummary(
    insights: AnalysisResult[],
    result: QueryResult
  ): Promise<string> {
    if (insights.length === 0) {
      return `Query returned ${result.rowCount} rows with no significant patterns detected.`;
    }

    const topInsights = insights.slice(0, 3);
    const summaries = topInsights.map(i => `• ${i.summary}`).join('\n');

    return `Analysis of ${result.rowCount} records identified ${insights.length} insights:\n\n${summaries}`;
  }

  /**
   * Generates empty result insight
   */
  private generateEmptyResultInsight(
    query: string,
    generatedSql: string,
    result: QueryResult,
    startTime: number
  ): InsightPackage {
    return {
      query,
      generatedSql,
      resultCount: 0,
      insights: [
        {
          type: 'PERFORMANCE',
          confidence: 1,
          summary: 'No results returned. Try adjusting filters or expanding date range.',
          details: { emptyResult: true },
          impact: 'MEDIUM'
        }
      ],
      visualizationRecommendation: {
        type: 'TABLE',
        rationale: 'No data to visualize'
      },
      summary: 'Query returned no results.',
      executionStats: {
        queryTime: result.executionTime,
        analysisTime: 0,
        totalTime: Date.now() - startTime
      }
    };
  }

  // Helper methods for analysis

  private identifyNumericColumns(result: QueryResult): string[] {
    if (result.rows.length === 0) return [];
    const firstRow = result.rows[0];
    return Object.entries(firstRow)
      .filter(([_, value]) => typeof value === 'number')
      .map(([key, _]) => key);
  }

  private identifyDateColumns(result: QueryResult): string[] {
    if (result.rows.length === 0) return [];
    const firstRow = result.rows[0];
    return Object.entries(firstRow)
      .filter(([_, value]) => value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)))
      .map(([key, _]) => key);
  }

  private identifyCategoryColumns(result: QueryResult): string[] {
    if (result.rows.length === 0) return [];
    const firstRow = result.rows[0];
    const uniqueValues = new Map<string, Set<unknown>>();

    result.rows.forEach(row => {
      Object.entries(row).forEach(([key, value]) => {
        if (typeof value === 'string' || typeof value === 'number') {
          if (!uniqueValues.has(key)) {
            uniqueValues.set(key, new Set());
          }
          uniqueValues.get(key)!.add(value);
        }
      });
    });

    return Array.from(uniqueValues.entries())
      .filter(([_, values]) => values.size < 50 && values.size > 1)
      .map(([key, _]) => key);
  }

  private formatCorrelationSummary(correlations: Record<string, number>): string {
    const strongest = Object.entries(correlations).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    if (!strongest) return 'No significant correlations found.';
    return `Strong correlation detected between ${strongest[0]} (${(strongest[1] * 100).toFixed(0)}% relationship)`;
  }

  private formatTrendSummary(trend: any): string {
    const direction = trend.slope > 0 ? 'increasing' : 'decreasing';
    return `${direction} trend with R² of ${(trend.rSquared * 100).toFixed(1)}%`;
  }

  private formatCompositionSummary(composition: any): string {
    return `Data distributed across multiple categories`;
  }

  private determineCorrelationImpact(correlations: Record<string, number>): 'HIGH' | 'MEDIUM' | 'LOW' {
    const maxCorr = Math.max(...Object.values(correlations).map(Math.abs));
    return maxCorr > 0.7 ? 'HIGH' : maxCorr > 0.4 ? 'MEDIUM' : 'LOW';
  }

  private determineTrendImpact(trend: any): 'HIGH' | 'MEDIUM' | 'LOW' {
    return trend.rSquared > 0.7 ? 'HIGH' : trend.rSquared > 0.4 ? 'MEDIUM' : 'LOW';
  }

  private generateCorrelationRecommendation(correlations: Record<string, number>): string {
    return 'Investigate the causal relationship to understand drivers';
  }

  private generateTrendRecommendation(trend: any): string {
    return trend.slope > 0 ? 'Continue current strategy' : 'Review and adjust approach';
  }
}

export default InsightGenerator;
