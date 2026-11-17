"""
RAG System Evaluator
Runs test dataset through the agent and calculates RAGAS metrics
"""

import json
import sys
import os
import asyncio
from pathlib import Path
from typing import List, Dict

# Add backend to path
backend_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(backend_path))

from agent.groq_llama_agent import get_agent_response
from rag_faiss.retriever import retrieve
from eval.metrics.rag_metrics import RAGMetrics


class RAGEvaluator:
    """Evaluate RAG system quality using test dataset"""
    
    def __init__(self, test_dataset_path: str):
        self.test_dataset_path = test_dataset_path
        self.rag_metrics = RAGMetrics()
        self.test_data = self._load_test_data()
    
    def _load_test_data(self) -> List[Dict]:
        """Load test dataset from JSON file"""
        with open(self.test_dataset_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def run_evaluation(self, max_samples: int = None) -> Dict:
        """
        Run evaluation on test dataset
        
        Args:
            max_samples: Limit number of test samples (None for all)
            
        Returns:
            Dictionary with results and metrics
        """
        # Run async evaluation in sync context
        return asyncio.run(self._run_evaluation_async(max_samples))
    
    async def _run_evaluation_async(self, max_samples: int = None) -> Dict:
        """
        Run evaluation on test dataset
        
        Args:
            max_samples: Limit number of test samples (None for all)
            
        Returns:
            Dictionary with results and metrics
        """
        print(f"Loading test dataset from {self.test_dataset_path}")
        print(f"Total test samples: {len(self.test_data)}")
        
        if max_samples:
            test_samples = self.test_data[:max_samples]
            print(f"Running evaluation on first {max_samples} samples...")
        else:
            test_samples = self.test_data
            print("Running evaluation on all samples...")
        
        questions = []
        answers = []
        contexts = []
        ground_truths = []
        
        for i, sample in enumerate(test_samples, 1):
            question = sample["question"]
            ground_truth = sample["ground_truth"]
            
            print(f"\n[{i}/{len(test_samples)}] Processing: {question[:60]}...")
            
            try:
                # Get agent response (this includes RAG retrieval)
                response = await get_agent_response(question, is_audio_input=False)
                answer = response["response"]
                
                # Get contexts for this question
                retrieved_result = retrieve(question, top_k=3)
                context_list = [retrieved_result["context"]]  # Returns concatenated context
                
                questions.append(question)
                answers.append(answer)
                contexts.append(context_list)
                ground_truths.append(ground_truth)
                
                print(f"  ✓ Answer: {answer[:80]}...")
                print(f"  ✓ Retrieved {len(context_list)} contexts")
                
            except Exception as e:
                print(f"  ✗ Error: {str(e)}")
                # Skip this sample
                continue
        
        print(f"\n{'='*60}")
        print(f"Successfully processed {len(questions)}/{len(test_samples)} samples")
        print(f"{'='*60}\n")
        
        if not questions:
            raise ValueError("No samples were successfully processed")
        
        # Calculate RAGAS metrics
        print("Calculating RAGAS metrics...")
        results = self.rag_metrics.calculate_metrics(
            questions=questions,
            answers=answers,
            contexts=contexts,
            ground_truths=ground_truths
        )
        
        # Add sample details
        results["samples"] = {
            "total": len(test_samples),
            "processed": len(questions),
            "failed": len(test_samples) - len(questions)
        }
        
        return results
    
    def save_results(self, results: Dict, output_dir: str):
        """Save evaluation results to files"""
        os.makedirs(output_dir, exist_ok=True)
        
        # Save metrics as JSON
        metrics_file = os.path.join(output_dir, "rag_metrics.json")
        with open(metrics_file, 'w', encoding='utf-8') as f:
            json.dump(results["metrics"], f, indent=2)
        print(f"Saved metrics to {metrics_file}")
        
        # Save detailed results as CSV
        csv_file = os.path.join(output_dir, "rag_detailed_results.csv")
        results["detailed_results"].to_csv(csv_file, index=False)
        print(f"Saved detailed results to {csv_file}")
        
        # Save formatted report
        report_file = os.path.join(output_dir, "rag_report.txt")
        report = self.rag_metrics.format_report(results)
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(report)
        print(f"Saved report to {report_file}")
        
        return report
