"""
Growth Analysis Module
Revenue growth, customer growth, and expansion metrics
"""

from typing import Dict, List, Any
import statistics
from datetime import datetime


class GrowthAnalyzer:
    """Analyze growth metrics across dimensions"""

    @staticmethod
    def revenue_growth(
        data: List[Dict[str, Any]],
        date_field: str,
        revenue_field: str,
        period: str = 'monthly'
    ) -> Dict[str, Any]:
        """Analyze revenue growth patterns"""
        
        # Aggregate by period
        periods = {}
        
        for record in data:
            date_str = str(record.get(date_field, ''))
            revenue = record.get(revenue_field, 0)
            
            if isinstance(revenue, (int, float)):
                # Simplified period extraction
                period_key = date_str[:7] if period == 'monthly' else date_str[:4]
                
                if period_key not in periods:
                    periods[period_key] = 0
                periods[period_key] += revenue
        
        # Sort chronologically
        sorted_periods = sorted(periods.items())
        values = [v for _, v in sorted_periods]
        
        if len(values) < 2:
            return {"error": "Insufficient data for growth analysis"}
        
        # Calculate growth rates
        growth_rates = []
        for i in range(1, len(values)):
            if values[i-1] != 0:
                rate = ((values[i] - values[i-1]) / values[i-1]) * 100
                growth_rates.append(rate)
        
        return {
            "periods": [k for k, _ in sorted_periods],
            "values": values,
            "growth_rates": growth_rates,
            "average_growth": statistics.mean(growth_rates) if growth_rates else 0,
            "cagr": GrowthAnalyzer._calculate_cagr(values, len(sorted_periods)),
        }

    @staticmethod
    def customer_growth(
        data: List[Dict[str, Any]],
        date_field: str,
        customer_field: str
    ) -> Dict[str, Any]:
        """Analyze customer acquisition and retention"""
        
        # Track unique customers by period
        periods = {}
        all_customers = set()
        
        for record in data:
            date_str = str(record.get(date_field, ''))
            customer = str(record.get(customer_field, ''))
            
            period_key = date_str[:7]  # monthly
            
            if period_key not in periods:
                periods[period_key] = set()
            
            periods[period_key].add(customer)
            all_customers.add(customer)
        
        # Calculate cohort metrics
        sorted_periods = sorted(periods.items())
        
        new_customers_by_period = {}
        retained_customers_by_period = {}
        
        prev_customers = set()
        for period, customers in sorted_periods:
            new = len(customers - prev_customers)
            retained = len(customers & prev_customers)
            
            new_customers_by_period[period] = new
            retained_customers_by_period[period] = retained
            prev_customers = customers
        
        return {
            "total_customers": len(all_customers),
            "new_customers_by_period": new_customers_by_period,
            "retained_customers_by_period": retained_customers_by_period,
            "average_customer_lifetime": len(all_customers) / len(sorted_periods) if sorted_periods else 0,
        }

    @staticmethod
    def expansion_analysis(
        data: List[Dict[str, Any]],
        entity_field: str,
        value_field: str
    ) -> Dict[str, Any]:
        """Analyze expansion across categories/regions"""
        
        entities = {}
        
        for record in data:
            entity = str(record.get(entity_field, 'Unknown'))
            value = record.get(value_field, 0)
            
            if isinstance(value, (int, float)):
                if entity not in entities:
                    entities[entity] = 0
                entities[entity] += value
        
        # Sort by value (descending)
        sorted_entities = sorted(entities.items(), key=lambda x: x[1], reverse=True)
        
        # Calculate market share
        total = sum(v for _, v in sorted_entities)
        market_share = {
            entity: (value / total * 100) if total > 0 else 0
            for entity, value in sorted_entities
        }
        
        # HHI (Herfindahl-Hirschman Index)
        hhi = sum((v / total) ** 2 for v in entities.values() if total > 0)
        
        return {
            "entities": dict(sorted_entities),
            "market_share": market_share,
            "herfindahl_index": hhi,
            "concentration": "High" if hhi > 0.25 else "Moderate" if hhi > 0.15 else "Low",
            "top_3_share": sum(v for _, v in sorted_entities[:3]) / total * 100 if total > 0 else 0,
        }

    @staticmethod
    def _calculate_cagr(values: List[float], periods: int) -> float:
        """Calculate Compound Annual Growth Rate"""
        if len(values) < 2 or values[0] == 0 or periods <= 1:
            return 0.0
        
        try:
            cagr = (pow(values[-1] / values[0], 1 / (periods - 1)) - 1) * 100
            return cagr
        except:
            return 0.0
