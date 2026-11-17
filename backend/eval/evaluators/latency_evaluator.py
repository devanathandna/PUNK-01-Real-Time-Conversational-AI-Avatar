"""
End-to-End Latency Evaluator
Measures timing through the complete pipeline: text/audio → STT → agent → TTS → audio
"""

import sys
import time
import json
import os
import asyncio
from pathlib import Path
from typing import Dict, List
import base64

# Add backend to path
backend_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(backend_path))

from agent.groq_llama_agent import get_agent_response
from rag_faiss.retriever import retrieve
from audio.groq_tts import GroqTTSProcessor
from eval.metrics.latency_metrics import LatencyMetrics


class LatencyEvaluator:
    """Evaluate end-to-end latency of the conversational pipeline"""
    
    def __init__(self, test_dataset_path: str):
        self.test_dataset_path = test_dataset_path
        self.latency_metrics = LatencyMetrics()
        self.tts_processor = GroqTTSProcessor()
        self.test_data = self._load_test_data()
    
    def _load_test_data(self) -> List[Dict]:
        """Load test dataset from JSON file"""
        with open(self.test_dataset_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def evaluate_text_to_audio_latency(self, max_samples: int = None) -> Dict:
        """
        Measure latency for text input → audio output pipeline
        
        Args:
            max_samples: Limit number of test samples (None for all)
            
        Returns:
            Dictionary with timing statistics
        """
        return asyncio.run(self._evaluate_text_to_audio_latency_async(max_samples))
    
    async def _evaluate_text_to_audio_latency_async(self, max_samples: int = None) -> Dict:
        """
        Measure latency for text input → audio output pipeline
        
        Args:
            max_samples: Limit number of test samples (None for all)
            
        Returns:
            Dictionary with timing statistics
        """
        print(f"\n{'='*80}")
        print("TEXT-TO-AUDIO LATENCY EVALUATION")
        print(f"{'='*80}\n")
        
        if max_samples:
            test_samples = self.test_data[:max_samples]
            print(f"Testing {max_samples} samples...")
        else:
            test_samples = self.test_data
            print(f"Testing all {len(test_samples)} samples...")
        
        for i, sample in enumerate(test_samples, 1):
            question = sample["question"]
            print(f"\n[{i}/{len(test_samples)}] {question[:60]}...")
            
            try:
                # Start end-to-end timer
                e2e_start = time.time()
                
                # 1. RAG Retrieval
                retrieval_start = time.time()
                contexts = retrieve(question, top_k=3)
                retrieval_time = time.time() - retrieval_start
                self.latency_metrics.record("retrieval", retrieval_time)
                print(f"  ✓ Retrieval: {retrieval_time*1000:.2f} ms")
                
                # 2. Agent (LLM) generation
                agent_start = time.time()
                response = await get_agent_response(question, is_audio_input=False)
                agent_time = time.time() - agent_start
                self.latency_metrics.record("agent", agent_time)
                print(f"  ✓ Agent:     {agent_time*1000:.2f} ms")
                
                answer_text = response["response"]
                
                # 3. TTS generation with TTFB tracking
                tts_start = time.time()
                tts_result = await self.tts_processor.synthesize_speech(answer_text, track_ttfb=True)
                tts_time = time.time() - tts_start
                self.latency_metrics.record("tts", tts_time)
                
                # Record TTFB if available
                if tts_result.get("ttfb_ms"):
                    ttfb_seconds = tts_result["ttfb_ms"] / 1000
                    self.latency_metrics.record("tts_ttfb", ttfb_seconds)
                    print(f"  ✓ TTS:       {tts_time*1000:.2f} ms (TTFB: {tts_result['ttfb_ms']:.2f} ms)")
                else:
                    print(f"  ✓ TTS:       {tts_time*1000:.2f} ms")
                
                # End-to-end time
                e2e_time = time.time() - e2e_start
                self.latency_metrics.record("e2e_text", e2e_time)
                print(f"  ✓ E2E:       {e2e_time*1000:.2f} ms")
                
                # Component breakdown
                component_sum = retrieval_time + agent_time + tts_time
                overhead = e2e_time - component_sum
                print(f"  ℹ Overhead:  {overhead*1000:.2f} ms")
                
            except Exception as e:
                print(f"  ✗ Error: {str(e)}")
                continue
        
        # Calculate statistics
        stats = self.latency_metrics.calculate_stats()
        
        return {
            "stats": stats,
            "samples_tested": len(test_samples)
        }
    
    def run_stress_test(self, num_requests: int = 50) -> Dict:
        """
        Run stress test with repeated requests to measure consistency
        
        Args:
            num_requests: Number of requests to send
            
        Returns:
            Dictionary with timing statistics
        """
        return asyncio.run(self._run_stress_test_async(num_requests))
    
    async def _run_stress_test_async(self, num_requests: int = 50) -> Dict:
        """
        Run stress test with repeated requests to measure consistency
        
        Args:
            num_requests: Number of requests to send
            
        Returns:
            Dictionary with timing statistics
        """
        print(f"\n{'='*80}")
        print(f"STRESS TEST - {num_requests} REQUESTS")
        print(f"{'='*80}\n")
        
        # Use a subset of questions for stress test
        test_questions = [sample["question"] for sample in self.test_data[:10]]
        
        for i in range(num_requests):
            question = test_questions[i % len(test_questions)]
            
            if (i + 1) % 10 == 0:
                print(f"Progress: {i+1}/{num_requests} requests completed...")
            
            try:
                e2e_start = time.time()
                
                # Retrieval
                retrieval_start = time.time()
                contexts = retrieve(question, top_k=3)
                self.latency_metrics.record("retrieval", time.time() - retrieval_start)
                
                # Agent
                agent_start = time.time()
                response = await get_agent_response(question, is_audio_input=False)
                self.latency_metrics.record("agent", time.time() - agent_start)
                
                # TTS
                tts_start = time.time()
                tts_result = await self.tts_processor.synthesize_speech(response["response"], track_ttfb=True)
                tts_time = time.time() - tts_start
                self.latency_metrics.record("tts", tts_time)
                
                # Record TTFB if available
                if tts_result.get("ttfb_ms"):
                    ttfb_seconds = tts_result["ttfb_ms"] / 1000
                    self.latency_metrics.record("tts_ttfb", ttfb_seconds)
                
                # E2E
                self.latency_metrics.record("e2e_text", time.time() - e2e_start)
                
            except Exception as e:
                print(f"Request {i+1} failed: {str(e)}")
                continue
        
        stats = self.latency_metrics.calculate_stats()
        
        print(f"\n✓ Completed {num_requests} requests")
        
        return {
            "stats": stats,
            "requests": num_requests
        }
    
    def save_results(self, results: Dict, output_dir: str):
        """Save latency evaluation results"""
        os.makedirs(output_dir, exist_ok=True)
        
        # Save statistics as JSON
        stats_file = os.path.join(output_dir, "latency_stats.json")
        with open(stats_file, 'w', encoding='utf-8') as f:
            json.dump(results["stats"], f, indent=2)
        print(f"\nSaved statistics to {stats_file}")
        
        # Save formatted report
        report_file = os.path.join(output_dir, "latency_report.txt")
        report = self.latency_metrics.format_report(results["stats"])
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(report)
        print(f"Saved report to {report_file}")
        
        return report
