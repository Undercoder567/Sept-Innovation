"""
Advanced Analytics Engine
Statistical analysis and advanced insights generation
"""

import numpy as np
import pandas as pd
from scipy import stats
from typing import List, Dict, Tuple, Any
import json
from datetime import datetime, timedelta

class AnalyticsEngine:
    """
    Python-based analytics engine for:
    - Statistical analysis
    - Trend detection
    - Anomaly detection
    - Forecasting
    - Cohort analysis
    """

    def __init__(self):
        self.data: pd.DataFrame = None
        self.results: Dict[str, Any] = {}

    def load_data(self, data: List[Dict[str, Any]]) -> None:
        """Load data from query results"""
        self.data = pd.DataFrame(data)
        # Parse dates automatically
        for col in self.data.columns:
            try:
                self.data[col] = pd.to_datetime(self.data[col])
            except (ValueError, TypeError):
                pass

    def describe_data(self) -> Dict[str, Any]:
        """Get statistical summary of data"""
        return {
            "shape": self.data.shape,
            "columns": list(self.data.columns),
            "dtypes": self.data.dtypes.astype(str).to_dict(),
            "null_counts": self.data.isnull().sum().to_dict(),
            "numeric_summary": self.data.describe().to_dict(),
        }

    def correlation_analysis(self) -> Dict[str, Dict[str, float]]:
        """Calculate correlation matrix for numeric columns"""
        numeric_data = self.data.select_dtypes(include=[np.number])
        corr_matrix = numeric_data.corr()
        
        # Find significant correlations
        correlations = {}
        for col1 in corr_matrix.columns:
            correlations[col1] = {}
            for col2 in corr_matrix.columns:
                if col1 != col2:
                    corr_val = corr_matrix.loc[col1, col2]
                    if abs(corr_val) > 0.5:  # Threshold
                        correlations[col1][col2] = float(corr_val)
        
        return correlations

    def trend_analysis(self, date_col: str, value_col: str) -> Dict[str, Any]:
        """Analyze trends over time"""
        try:
            df = self.data.copy()
            df[date_col] = pd.to_datetime(df[date_col])
            df = df.sort_values(date_col)
            
            # Calculate trend
            x = np.arange(len(df))
            y = df[value_col].values
            
            # Linear regression
            slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
            
            # Moving average
            ma_7 = df[value_col].rolling(window=7, min_periods=1).mean()
            ma_30 = df[value_col].rolling(window=30, min_periods=1).mean()
            
            return {
                "slope": float(slope),
                "intercept": float(intercept),
                "r_squared": float(r_value ** 2),
                "p_value": float(p_value),
                "trend": "INCREASING" if slope > 0 else "DECREASING",
                "moving_average_7": ma_7.tolist(),
                "moving_average_30": ma_30.tolist(),
            }
        except Exception as e:
            return {"error": str(e)}

    def anomaly_detection(self, value_col: str, threshold: float = 2.5) -> Dict[str, Any]:
        """Detect anomalies using z-score"""
        try:
            values = self.data[value_col].values
            mean = np.mean(values)
            std = np.std(values)
            
            z_scores = np.abs((values - mean) / std)
            anomalies = np.where(z_scores > threshold)[0].tolist()
            
            return {
                "anomaly_indices": anomalies,
                "anomaly_count": len(anomalies),
                "mean": float(mean),
                "std": float(std),
                "threshold": threshold,
                "anomaly_values": [float(values[i]) for i in anomalies[:10]],  # Top 10
            }
        except Exception as e:
            return {"error": str(e)}

    def cohort_analysis(self, date_col: str, user_col: str, value_col: str) -> Dict[str, Any]:
        """Analyze cohorts and retention"""
        try:
            df = self.data.copy()
            df[date_col] = pd.to_datetime(df[date_col])
            
            # Group by month
            df['cohort_month'] = df[date_col].dt.to_period('M')
            
            # Get first purchase month per user
            cohort_data = df.groupby([user_col, 'cohort_month'])[value_col].sum().reset_index()
            cohort_pivot = cohort_data.pivot_table(
                index=user_col,
                columns='cohort_month',
                values=value_col,
                aggfunc='sum'
            )
            
            # Calculate retention
            cohort_sizes = cohort_pivot.iloc[:, 0]
            retention = cohort_pivot.divide(cohort_sizes, axis=0)
            
            return {
                "cohort_analysis": retention.fillna(0).to_dict(),
                "cohort_sizes": cohort_sizes.to_dict(),
            }
        except Exception as e:
            return {"error": str(e)}

    def forecasting(self, date_col: str, value_col: str, periods: int = 7) -> Dict[str, Any]:
        """Simple forecasting using exponential smoothing"""
        try:
            df = self.data.copy()
            df[date_col] = pd.to_datetime(df[date_col])
            df = df.sort_values(date_col)
            
            values = df[value_col].values
            
            # Exponential smoothing
            alpha = 0.3
            forecast = [values[0]]
            for val in values[1:]:
                forecast.append(alpha * val + (1 - alpha) * forecast[-1])
            
            # Project forward
            last_value = forecast[-1]
            future_forecast = []
            for i in range(periods):
                next_val = alpha * last_value + (1 - alpha) * last_value
                future_forecast.append(next_val)
                last_value = next_val
            
            return {
                "historical_forecast": forecast,
                "future_forecast": future_forecast,
                "periods": periods,
                "method": "exponential_smoothing",
            }
        except Exception as e:
            return {"error": str(e)}

    def segmentation(self, features: List[str], n_clusters: int = 3) -> Dict[str, Any]:
        """K-means clustering for segmentation"""
        try:
            from sklearn.cluster import KMeans
            from sklearn.preprocessing import StandardScaler
            
            X = self.data[features].select_dtypes(include=[np.number]).values
            
            # Standardize features
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)
            
            # K-means clustering
            kmeans = KMeans(n_clusters=n_clusters, random_state=42)
            clusters = kmeans.fit_predict(X_scaled)
            
            return {
                "clusters": clusters.tolist(),
                "n_clusters": n_clusters,
                "inertia": float(kmeans.inertia_),
                "centroids": kmeans.cluster_centers_.tolist(),
            }
        except ImportError:
            return {"error": "scikit-learn not installed"}
        except Exception as e:
            return {"error": str(e)}

    def statistical_test(self, col1: str, col2: str) -> Dict[str, Any]:
        """Perform t-test between two groups"""
        try:
            group1 = self.data[self.data[col1].notna()][col1].values
            group2 = self.data[self.data[col2].notna()][col2].values
            
            t_stat, p_value = stats.ttest_ind(group1, group2)
            
            return {
                "test": "independent_t_test",
                "t_statistic": float(t_stat),
                "p_value": float(p_value),
                "significant": p_value < 0.05,
                "group1_mean": float(np.mean(group1)),
                "group2_mean": float(np.mean(group2)),
            }
        except Exception as e:
            return {"error": str(e)}

    def export_analysis(self) -> str:
        """Export analysis results as JSON"""
        return json.dumps(self.results, indent=2, default=str)
