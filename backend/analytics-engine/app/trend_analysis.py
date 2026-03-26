"""
Advanced Trend Analysis Module
Time-series analysis and trend detection
"""

import numpy as np
import pandas as pd
from scipy import signal, stats
from typing import Dict, List, Tuple, Any
from datetime import datetime, timedelta


class TrendAnalyzer:
    """Analyze trends in time-series data"""

    @staticmethod
    def detect_seasonality(
        values: List[float], period: int = 12
    ) -> Dict[str, Any]:
        """Detect seasonal patterns"""
        try:
            data = np.array(values)
            
            # Compute seasonal decomposition
            if len(data) < 2 * period:
                return {"error": "Not enough data for seasonality analysis"}
            
            # Simple seasonal average
            seasonal = np.zeros(period)
            for i in range(period):
                seasonal[i] = np.mean(data[i::period])
            
            return {
                "seasonal_pattern": seasonal.tolist(),
                "period": period,
                "seasonal_strength": float(np.std(seasonal) / np.std(data)),
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def change_point_detection(values: List[float]) -> Dict[str, Any]:
        """Detect significant change points in time series"""
        try:
            data = np.array(values)
            
            # Use Ramer-Douglas-Peucker algorithm concept
            changes = []
            
            for i in range(1, len(data) - 1):
                # Calculate local change
                prev_change = data[i] - data[i - 1]
                next_change = data[i + 1] - data[i]
                
                # Detect reversals (change points)
                if np.sign(prev_change) != np.sign(next_change):
                    magnitude = abs(prev_change) + abs(next_change)
                    if magnitude > np.std(data):
                        changes.append({
                            "index": i,
                            "value": float(data[i]),
                            "magnitude": float(magnitude),
                        })
            
            return {
                "change_points": changes,
                "count": len(changes),
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def volatility_analysis(values: List[float], window: int = 20) -> Dict[str, Any]:
        """Analyze volatility over time"""
        try:
            data = np.array(values)
            returns = np.diff(data) / data[:-1]
            
            volatility = pd.Series(returns).rolling(window=window).std()
            
            return {
                "average_volatility": float(np.nanmean(volatility)),
                "volatility_trend": volatility.tolist(),
                "high_volatility_periods": np.where(volatility > np.nanmean(volatility) * 1.5)[0].tolist(),
                "sharpe_ratio": float(np.mean(returns) / np.std(returns)) if np.std(returns) > 0 else 0,
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def growth_rate(values: List[float], period: int = 1) -> Dict[str, Any]:
        """Calculate growth rates"""
        try:
            data = np.array(values)
            growth_rates = (data[period:] - data[:-period]) / data[:-period] * 100
            
            return {
                "growth_rates": growth_rates.tolist(),
                "average_growth": float(np.mean(growth_rates)),
                "growth_volatility": float(np.std(growth_rates)),
                "trend": "positive" if np.mean(growth_rates) > 0 else "negative",
            }
        except Exception as e:
            return {"error": str(e)}
