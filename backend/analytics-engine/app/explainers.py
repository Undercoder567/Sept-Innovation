"""
Insight Generators for Analytics
Generates business-relevant insights from query results
"""

from typing import List, Dict, Any
import statistics


class InsightGenerator:
    """Generate actionable insights from analytics data"""

    @staticmethod
    def generate_performance_insights(data: List[Dict[str, Any]]) -> List[str]:
        """Generate insights about performance metrics"""
        insights = []
        
        if not data:
            return insights
        
        # Look for numeric fields
        first_record = data[0]
        numeric_fields = {
            k: v for k, v in first_record.items()
            if isinstance(v, (int, float))
        }
        
        for field, values_list in numeric_fields.items():
            values = [r.get(field, 0) for r in data if isinstance(r.get(field), (int, float))]
            if values and len(values) > 1:
                try:
                    avg = statistics.mean(values)
                    max_val = max(values)
                    min_val = min(values)
                    std_dev = statistics.stdev(values) if len(values) > 1 else 0
                    
                    # Generate insights
                    if std_dev > avg * 0.5:
                        insights.append(
                            f"{field} shows high variability (std dev: {std_dev:.2f}), "
                            f"indicating inconsistent performance"
                        )
                    
                    outliers = [v for v in values if abs(v - avg) > 2 * std_dev]
                    if outliers:
                        insights.append(
                            f"{field} has {len(outliers)} significant outliers, "
                            f"worth investigating"
                        )
                except:
                    pass
        
        return insights

    @staticmethod
    def generate_trend_insights(
        data: List[Dict[str, Any]], 
        date_field: str,
        value_field: str
    ) -> List[str]:
        """Generate insights about trends over time"""
        insights = []
        
        if len(data) < 2:
            return insights
        
        # Get values in order
        sorted_data = sorted(
            data, 
            key=lambda x: str(x.get(date_field, ''))
        )
        
        values = [
            r.get(value_field) for r in sorted_data
            if isinstance(r.get(value_field), (int, float))
        ]
        
        if len(values) < 2:
            return insights
        
        # Calculate growth rate
        first_val = values[0]
        last_val = values[-1]
        growth_rate = ((last_val - first_val) / first_val * 100) if first_val != 0 else 0
        
        if abs(growth_rate) > 20:
            direction = "increased" if growth_rate > 0 else "decreased"
            insights.append(
                f"{value_field} {direction} significantly ({abs(growth_rate):.1f}%) "
                f"during this period"
            )
        
        # Check volatility
        try:
            avg = statistics.mean(values)
            std = statistics.stdev(values)
            cv = (std / avg * 100) if avg != 0 else 0
            
            if cv > 30:
                insights.append(
                    f"High volatility detected in {value_field} (CV: {cv:.1f}%), "
                    f"suggesting external factors influencing results"
                )
        except:
            pass
        
        return insights

    @staticmethod
    def generate_comparison_insights(
        data: List[Dict[str, Any]],
        group_field: str,
        value_field: str
    ) -> List[str]:
        """Generate insights from group comparisons"""
        insights = []
        
        if not data:
            return insights
        
        # Group data
        groups = {}
        for record in data:
            group_key = str(record.get(group_field, 'Other'))
            value = record.get(value_field)
            
            if isinstance(value, (int, float)):
                if group_key not in groups:
                    groups[group_key] = []
                groups[group_key].append(value)
        
        if len(groups) < 2:
            return insights
        
        # Calculate averages
        group_avgs = {
            group: statistics.mean(values)
            for group, values in groups.items()
        }
        
        # Find best and worst
        best_group = max(group_avgs, key=group_avgs.get)
        worst_group = min(group_avgs, key=group_avgs.get)
        
        best_val = group_avgs[best_group]
        worst_val = group_avgs[worst_group]
        
        if worst_val != 0:
            gap_pct = ((best_val - worst_val) / worst_val * 100)
            
            insights.append(
                f"{best_group} outperforms {worst_group} by {gap_pct:.1f}% "
                f"in {value_field}, indicating significant performance gap"
            )
        
        return insights
