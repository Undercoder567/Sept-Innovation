"""
Insight Generation from Statistical Analysis
Transforms raw statistics into actionable business insights
"""

from typing import Dict, List, Any
import json


class InsightFormatter:
    """Format statistical results into business-friendly insights"""

    @staticmethod
    def format_correlation_insight(
        col1: str, col2: str, correlation: float
    ) -> str:
        """Format correlation as business insight"""
        strength = "very strong" if abs(correlation) > 0.8 else \
                   "strong" if abs(correlation) > 0.6 else \
                   "moderate" if abs(correlation) > 0.4 else \
                   "weak"
        
        direction = "positive" if correlation > 0 else "negative"
        
        return (
            f"{strength.capitalize()} {direction} correlation between {col1} and {col2} "
            f"({correlation:.2f}), suggesting {'increase' if correlation > 0 else 'decrease'} "
            f"in one reflects {'increase' if correlation > 0 else 'decrease'} in the other"
        )

    @staticmethod
    def format_trend_insight(
        metric: str, slope: float, r_squared: float, period: str
    ) -> str:
        """Format trend as business insight"""
        trend = "increasing" if slope > 0 else "decreasing"
        
        strength = "strong" if r_squared > 0.7 else \
                   "moderate" if r_squared > 0.5 else \
                   "weak"
        
        return (
            f"{metric} shows {strength} {trend} trend ({r_squared:.1%} explained variance) "
            f"over {period}"
        )

    @staticmethod
    def format_growth_insight(metric: str, growth_rate: float, period: str) -> str:
        """Format growth rate as insight"""
        magnitude = "explosive" if abs(growth_rate) > 50 else \
                    "significant" if abs(growth_rate) > 20 else \
                    "moderate" if abs(growth_rate) > 10 else \
                    "slight"
        
        direction = "growth" if growth_rate > 0 else "decline"
        
        return (
            f"{metric} experienced {magnitude} {direction} "
            f"({growth_rate:+.1f}%) during {period}"
        )

    @staticmethod
    def format_volatility_insight(metric: str, volatility: float) -> str:
        """Format volatility as insight"""
        stability = "highly volatile" if volatility > 30 else \
                    "moderately volatile" if volatility > 15 else \
                    "stable"
        
        return (
            f"{metric} is {stability} (coefficient of variation: {volatility:.1f}%), "
            f"indicating {'unpredictable' if volatility > 20 else 'stable'} performance"
        )

    @staticmethod
    def format_anomaly_insight(
        metric: str, anomaly_count: int, total: int
    ) -> str:
        """Format anomaly detection as insight"""
        percentage = (anomaly_count / total * 100) if total > 0 else 0
        
        severity = "critical" if percentage > 5 else \
                   "significant" if percentage > 2 else \
                   "minor"
        
        return (
            f"{severity.capitalize()} anomalies detected in {metric}: "
            f"{anomaly_count} out of {total} values ({percentage:.1f}%) "
            f"are statistical outliers"
        )

    @staticmethod
    def format_performance_insight(
        metric: str, actual: float, target: float, unit: str = ""
    ) -> str:
        """Format performance vs target as insight"""
        variance = ((actual - target) / target * 100) if target != 0 else 0
        
        status = "exceeding" if variance > 0 else "below"
        
        return (
            f"{metric} is {status} target by {abs(variance):.1f}% "
            f"(actual: {actual}{unit}, target: {target}{unit})"
        )
