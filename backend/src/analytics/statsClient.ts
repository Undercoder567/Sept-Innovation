/**
 * Statistics Client
 * Performs statistical analysis on query results
 * Handles correlation, trend analysis, anomaly detection, and more
 */

export interface CorrelationResult {
  [key: string]: number;
}

export interface TrendAnalysis {
  slope: number;
  intercept: number;
  rSquared: number;
  direction: 'increasing' | 'decreasing' | 'flat';
  strength: 'strong' | 'moderate' | 'weak';
  periodCount: number;
  averageValue: number;
}

export interface AnomalyResult {
  outliers: number[];
  mean: number;
  stdDev: number;
  threshold: number;
  outlierCount: number;
  outlierPercentage: number;
}

export interface CompositionAnalysis {
  categories: string[];
  values: number[];
  percentages: number[];
  topCategory: { name: string; value: number; percentage: number };
  concentration: 'high' | 'moderate' | 'distributed';
}

export interface GrowthMetrics {
  periods: number;
  totalGrowth: number;
  averageGrowthRate: number;
  cagr: number; // Compound Annual Growth Rate
  volatility: number;
  trend: 'positive' | 'negative' | 'flat';
}

class StatsClient {
  /**
   * Calculates Pearson correlation coefficients between numeric columns
   */
  calculateCorrelations(
    data: Record<string, unknown>[],
    columns: string[]
  ): CorrelationResult {
    if (data.length < 2 || columns.length < 2) {
      return {};
    }

    const correlations: CorrelationResult = {};

    for (let i = 0; i < columns.length; i++) {
      for (let j = i + 1; j < columns.length; j++) {
        const col1 = columns[i];
        const col2 = columns[j];
        const correlation = this.pearsonCorrelation(data, col1, col2);

        if (!isNaN(correlation) && Math.abs(correlation) > 0.1) {
          correlations[`${col1}_vs_${col2}`] = correlation;
        }
      }
    }

    return correlations;
  }

  /**
   * Analyzes trend in data over time
   */
  analyzeTrend(
    data: Record<string, unknown>[],
    dateColumn: string,
    valueColumn: string
  ): TrendAnalysis {
    const points = data
      .map(row => ({
        x: new Date(row[dateColumn] as string).getTime(),
        y: Number(row[valueColumn]) || 0
      }))
      .sort((a, b) => a.x - b.x);

    if (points.length < 2) {
      return {
        slope: 0,
        intercept: 0,
        rSquared: 0,
        direction: 'flat',
        strength: 'weak',
        periodCount: points.length,
        averageValue: 0
      };
    }

    // Linear regression
    const regression = this.linearRegression(points);
    const averageValue = this.mean(points.map(p => p.y));

    return {
      slope: regression.slope,
      intercept: regression.intercept,
      rSquared: regression.rSquared,
      direction: regression.slope > 0.01 ? 'increasing' : regression.slope < -0.01 ? 'decreasing' : 'flat',
      strength: regression.rSquared > 0.7 ? 'strong' : regression.rSquared > 0.4 ? 'moderate' : 'weak',
      periodCount: points.length,
      averageValue
    };
  }

  /**
   * Detects anomalies using z-score method
   */
  detectAnomalies(
    data: Record<string, unknown>[],
    column: string,
    threshold = 2.5
  ): AnomalyResult {
    const values = data
      .map(row => Number(row[column]))
      .filter(v => !isNaN(v));

    if (values.length < 3) {
      return {
        outliers: [],
        mean: 0,
        stdDev: 0,
        threshold,
        outlierCount: 0,
        outlierPercentage: 0
      };
    }

    const mean = this.mean(values);
    const stdDev = this.standardDeviation(values, mean);

    const outliers = values.filter(v => Math.abs((v - mean) / (stdDev || 1)) > threshold);

    return {
      outliers,
      mean,
      stdDev,
      threshold,
      outlierCount: outliers.length,
      outlierPercentage: (outliers.length / values.length) * 100
    };
  }

  /**
   * Analyzes composition of data by category
   */
  analyzeComposition(
    data: Record<string, unknown>[],
    categoryColumn: string,
    valueColumn: string
  ): CompositionAnalysis {
    const groups = new Map<string, number>();

    data.forEach(row => {
      const category = String(row[categoryColumn]);
      const value = Number(row[valueColumn]) || 0;
      groups.set(category, (groups.get(category) || 0) + value);
    });

    const categories = Array.from(groups.keys());
    const values = Array.from(groups.values());
    const total = values.reduce((a, b) => a + b, 0);
    const percentages = values.map(v => (v / (total || 1)) * 100);

    const topIndex = values.indexOf(Math.max(...values));
    const topPercentage = percentages[topIndex];

    // Herfindahl-Hirschman Index for concentration
    const hhi = percentages.reduce((sum, p) => sum + Math.pow(p / 100, 2), 0);
    const concentration = hhi > 0.25 ? 'high' : hhi > 0.15 ? 'moderate' : 'distributed';

    return {
      categories,
      values,
      percentages,
      topCategory: {
        name: categories[topIndex],
        value: values[topIndex],
        percentage: topPercentage
      },
      concentration
    };
  }

  /**
   * Calculates growth metrics
   */
  calculateGrowth(
    data: Record<string, unknown>[],
    dateColumn: string,
    valueColumn: string
  ): GrowthMetrics {
    const sorted = data
      .map(row => ({
        date: new Date(row[dateColumn] as string),
        value: Number(row[valueColumn]) || 0
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (sorted.length < 2) {
      return {
        periods: sorted.length,
        totalGrowth: 0,
        averageGrowthRate: 0,
        cagr: 0,
        volatility: 0,
        trend: 'flat'
      };
    }

    const values = sorted.map(s => s.value);
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const totalGrowth = ((lastValue - firstValue) / (firstValue || 1)) * 100;

    // Calculate period-over-period growth rates
    const growthRates: number[] = [];
    for (let i = 1; i < values.length; i++) {
      const rate = ((values[i] - values[i - 1]) / (values[i - 1] || 1)) * 100;
      growthRates.push(rate);
    }

    const averageGrowthRate = this.mean(growthRates);
    const volatility = this.standardDeviation(growthRates, averageGrowthRate);

    // CAGR calculation
    const periods = sorted.length - 1;
    const cagr = periods > 0 ? (Math.pow(lastValue / (firstValue || 1), 1 / periods) - 1) * 100 : 0;

    return {
      periods,
      totalGrowth,
      averageGrowthRate,
      cagr,
      volatility,
      trend: averageGrowthRate > 1 ? 'positive' : averageGrowthRate < -1 ? 'negative' : 'flat'
    };
  }

  /**
   * Performs statistical hypothesis test (t-test)
   */
  tTest(group1: number[], group2: number[]): { tStatistic: number; pValue: number } {
    if (group1.length < 2 || group2.length < 2) {
      return { tStatistic: 0, pValue: 1 };
    }

    const mean1 = this.mean(group1);
    const mean2 = this.mean(group2);
    const std1 = this.standardDeviation(group1, mean1);
    const std2 = this.standardDeviation(group2, mean2);
    const n1 = group1.length;
    const n2 = group2.length;

    const pooledStd = Math.sqrt(
      ((n1 - 1) * Math.pow(std1, 2) + (n2 - 1) * Math.pow(std2, 2)) / (n1 + n2 - 2)
    );
    const tStatistic =
      (mean1 - mean2) / (pooledStd * Math.sqrt(1 / n1 + 1 / n2));

    // Approximate p-value using t-distribution (simplified)
    const pValue = 2 * (1 - this.tCDF(Math.abs(tStatistic), n1 + n2 - 2));

    return { tStatistic, pValue };
  }

  /**
   * Calculates percentile
   */
  percentile(data: number[], p: number): number {
    if (data.length === 0) return 0;
    const sorted = [...data].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (lower === upper) {
      return sorted[lower];
    }

    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Calculates interquartile range
   */
  iqr(data: number[]): number {
    const q1 = this.percentile(data, 25);
    const q3 = this.percentile(data, 75);
    return q3 - q1;
  }

  // Private helper methods

  private pearsonCorrelation(
    data: Record<string, unknown>[],
    col1: string,
    col2: string
  ): number {
    const pairs = data
      .map(row => ({
        x: Number(row[col1]),
        y: Number(row[col2])
      }))
      .filter(pair => !isNaN(pair.x) && !isNaN(pair.y));

    if (pairs.length < 2) return 0;

    const meanX = this.mean(pairs.map(p => p.x));
    const meanY = this.mean(pairs.map(p => p.y));

    const numerator = pairs.reduce((sum, pair) => {
      return sum + (pair.x - meanX) * (pair.y - meanY);
    }, 0);

    const stdX = this.standardDeviation(pairs.map(p => p.x), meanX);
    const stdY = this.standardDeviation(pairs.map(p => p.y), meanY);

    return numerator / ((stdX * stdY * pairs.length) || 1);
  }

  private linearRegression(points: Array<{ x: number; y: number }>): {
    slope: number;
    intercept: number;
    rSquared: number;
  } {
    const n = points.length;
    const meanX = this.mean(points.map(p => p.x));
    const meanY = this.mean(points.map(p => p.y));

    const slope =
      points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) /
      (points.reduce((sum, p) => sum + Math.pow(p.x - meanX, 2), 0) || 1);

    const intercept = meanY - slope * meanX;

    const yMean = meanY;
    const ssTotal = points.reduce((sum, p) => sum + Math.pow(p.y - yMean, 2), 0);
    const ssResidual = points.reduce((sum, p) => {
      const predicted = slope * p.x + intercept;
      return sum + Math.pow(p.y - predicted, 2);
    }, 0);

    const rSquared = 1 - ssResidual / (ssTotal || 1);

    return { slope, intercept, rSquared: Math.max(0, rSquared) };
  }

  private mean(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
  }

  private standardDeviation(values: number[], mean?: number): number {
    const m = mean !== undefined ? mean : this.mean(values);
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length || 1);
    return Math.sqrt(variance);
  }

  private tCDF(t: number, df: number): number {
    // Simplified t-distribution CDF approximation
    // For production, use a proper statistics library
    const beta = df / (t * t + df);
    const incomplete = this.incompleteBeta(beta, df / 2, 0.5);
    return t >= 0 ? 1 - incomplete / 2 : incomplete / 2;
  }

  private incompleteBeta(x: number, a: number, b: number): number {
    // Simplified incomplete beta function
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x;
  }
}

export default StatsClient;
