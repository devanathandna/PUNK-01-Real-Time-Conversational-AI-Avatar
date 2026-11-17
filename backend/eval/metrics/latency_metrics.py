"""
End-to-End Latency Metrics
Measures timing from text input → audio output and component-wise breakdown
"""

import time
import statistics
from typing import Dict, List, Callable
from functools import wraps
import asyncio


class LatencyMetrics:
    """Track and calculate latency metrics for the conversational pipeline"""
    
    def __init__(self):
        self.timings = {
            "stt": [],           # Speech-to-Text
            "retrieval": [],     # RAG retrieval
            "agent": [],         # LLM generation
            "tts": [],           # Text-to-Speech (complete)
            "tts_ttfb": [],      # Time to First Byte for TTS
            "e2e_text": [],      # End-to-end for text input
            "e2e_audio": []      # End-to-end for audio input
        }
    
    def record(self, component: str, duration: float):
        """Record timing for a component"""
        if component in self.timings:
            self.timings[component].append(duration)
    
    def calculate_stats(self) -> Dict:
        """Calculate statistics for all recorded timings"""
        stats = {}
        
        for component, times in self.timings.items():
            if times:
                stats[component] = {
                    "count": len(times),
                    "mean": statistics.mean(times),
                    "median": statistics.median(times),
                    "min": min(times),
                    "max": max(times),
                    "stdev": statistics.stdev(times) if len(times) > 1 else 0,
                    "p95": self._percentile(times, 95),
                    "p99": self._percentile(times, 99)
                }
            else:
                stats[component] = None
        
        return stats
    
    def _percentile(self, data: List[float], percentile: int) -> float:
        """Calculate percentile value"""
        sorted_data = sorted(data)
        index = int(len(sorted_data) * percentile / 100)
        return sorted_data[min(index, len(sorted_data) - 1)]
    
    def format_report(self, stats: Dict) -> str:
        """Format latency statistics into readable report"""
        report = "=" * 80 + "\n"
        report += "END-TO-END LATENCY METRICS\n"
        report += "=" * 80 + "\n\n"
        
        # Component-wise breakdown
        components = [
            ("STT (Speech-to-Text)", "stt"),
            ("RAG Retrieval", "retrieval"),
            ("Agent (LLM)", "agent"),
            ("TTS (Text-to-Speech)", "tts"),
            ("TTS TTFB (Time to First Byte)", "tts_ttfb")
        ]
        
        report += "COMPONENT-WISE LATENCY:\n"
        report += "-" * 80 + "\n"
        
        for label, key in components:
            if stats.get(key):
                s = stats[key]
                report += f"\n{label}:\n"
                report += f"  Count:   {s['count']} requests\n"
                report += f"  Mean:    {s['mean']*1000:.2f} ms\n"
                report += f"  Median:  {s['median']*1000:.2f} ms\n"
                report += f"  Min:     {s['min']*1000:.2f} ms\n"
                report += f"  Max:     {s['max']*1000:.2f} ms\n"
                report += f"  Stdev:   {s['stdev']*1000:.2f} ms\n"
                report += f"  P95:     {s['p95']*1000:.2f} ms\n"
                report += f"  P99:     {s['p99']*1000:.2f} ms\n"
        
        # End-to-end metrics
        report += "\n" + "=" * 80 + "\n"
        report += "END-TO-END LATENCY:\n"
        report += "-" * 80 + "\n"
        
        e2e_keys = [
            ("Text Input → Audio Output", "e2e_text"),
            ("Audio Input → Audio Output", "e2e_audio")
        ]
        
        for label, key in e2e_keys:
            if stats.get(key):
                s = stats[key]
                report += f"\n{label}:\n"
                report += f"  Count:   {s['count']} requests\n"
                report += f"  Mean:    {s['mean']*1000:.2f} ms\n"
                report += f"  Median:  {s['median']*1000:.2f} ms\n"
                report += f"  Min:     {s['min']*1000:.2f} ms\n"
                report += f"  Max:     {s['max']*1000:.2f} ms\n"
                report += f"  P95:     {s['p95']*1000:.2f} ms\n"
                report += f"  P99:     {s['p99']*1000:.2f} ms\n"
        
        report += "\n" + "=" * 80 + "\n"
        
        return report
    
    def reset(self):
        """Clear all recorded timings"""
        for key in self.timings:
            self.timings[key] = []


def timer(component: str):
    """Decorator to measure function execution time"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start = time.time()
            result = func(*args, **kwargs)
            duration = time.time() - start
            return result, duration
        return wrapper
    return decorator


def async_timer(component: str):
    """Decorator to measure async function execution time"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            start = time.time()
            result = await func(*args, **kwargs)
            duration = time.time() - start
            return result, duration
        return wrapper
    return decorator


class LatencyTracker:
    """Context manager for tracking end-to-end latency"""
    
    def __init__(self, metrics: LatencyMetrics, metric_name: str):
        self.metrics = metrics
        self.metric_name = metric_name
        self.start_time = None
    
    def __enter__(self):
        self.start_time = time.time()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.start_time:
            duration = time.time() - self.start_time
            self.metrics.record(self.metric_name, duration)
