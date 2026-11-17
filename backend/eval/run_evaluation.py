"""
Main Evaluation Runner
Orchestrates RAG quality and latency evaluations with configurable modes
"""

import argparse
import sys
import os
from pathlib import Path
from datetime import datetime

# Add backend to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from eval.evaluators.rag_evaluator import RAGEvaluator
from eval.evaluators.latency_evaluator import LatencyEvaluator


def run_rag_evaluation(test_dataset_path: str, output_dir: str, max_samples: int = None):
    """Run RAG quality evaluation"""
    print("\n" + "="*80)
    print("STARTING RAG QUALITY EVALUATION")
    print("="*80)
    
    evaluator = RAGEvaluator(test_dataset_path)
    results = evaluator.run_evaluation(max_samples=max_samples)
    
    # Save results
    report = evaluator.save_results(results, output_dir)
    
    # Print report
    print("\n" + report)
    
    return results


def run_latency_evaluation(test_dataset_path: str, output_dir: str, max_samples: int = None, stress_test: bool = False):
    """Run end-to-end latency evaluation"""
    print("\n" + "="*80)
    print("STARTING LATENCY EVALUATION")
    print("="*80)
    
    evaluator = LatencyEvaluator(test_dataset_path)
    
    if stress_test:
        results = evaluator.run_stress_test(num_requests=50)
    else:
        results = evaluator.evaluate_text_to_audio_latency(max_samples=max_samples)
    
    # Save results
    report = evaluator.save_results(results, output_dir)
    
    # Print report
    print("\n" + report)
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate Real-Time Conversational AI Avatar system"
    )
    
    parser.add_argument(
        "--mode",
        type=str,
        choices=["full", "rag", "latency"],
        default="full",
        help="Evaluation mode: full (both), rag (quality only), latency (speed only)"
    )
    
    parser.add_argument(
        "--samples",
        type=int,
        default=None,
        help="Limit number of test samples (default: all)"
    )
    
    parser.add_argument(
        "--stress",
        action="store_true",
        help="Run stress test for latency (50 requests)"
    )
    
    parser.add_argument(
        "--dataset",
        type=str,
        default=None,
        help="Path to test dataset JSON file (default: eval/test_dataset.json)"
    )
    
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output directory for reports (default: eval/reports/TIMESTAMP/)"
    )
    
    args = parser.parse_args()
    
    # Setup paths
    eval_dir = Path(__file__).parent
    
    if args.dataset:
        test_dataset_path = args.dataset
    else:
        test_dataset_path = eval_dir / "test_dataset.json"
    
    if args.output:
        output_dir = args.output
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = eval_dir / "reports" / timestamp
    
    os.makedirs(output_dir, exist_ok=True)
    
    print("\n" + "="*80)
    print("REAL-TIME CONVERSATIONAL AI AVATAR - EVALUATION FRAMEWORK")
    print("="*80)
    print(f"\nMode:           {args.mode}")
    print(f"Dataset:        {test_dataset_path}")
    print(f"Output Dir:     {output_dir}")
    if args.samples:
        print(f"Max Samples:    {args.samples}")
    if args.stress:
        print(f"Stress Test:    Enabled (50 requests)")
    print()
    
    # Verify dataset exists
    if not os.path.exists(test_dataset_path):
        print(f"Error: Test dataset not found at {test_dataset_path}")
        sys.exit(1)
    
    # Run evaluations based on mode
    results = {}
    
    try:
        if args.mode in ["full", "rag"]:
            rag_results = run_rag_evaluation(
                test_dataset_path=str(test_dataset_path),
                output_dir=str(output_dir),
                max_samples=args.samples
            )
            results["rag"] = rag_results
        
        if args.mode in ["full", "latency"]:
            latency_results = run_latency_evaluation(
                test_dataset_path=str(test_dataset_path),
                output_dir=str(output_dir),
                max_samples=args.samples,
                stress_test=args.stress
            )
            results["latency"] = latency_results
        
        # Save combined summary
        summary_file = os.path.join(output_dir, "evaluation_summary.txt")
        with open(summary_file, 'w', encoding='utf-8') as f:
            f.write("="*80 + "\n")
            f.write("EVALUATION SUMMARY\n")
            f.write("="*80 + "\n\n")
            f.write(f"Timestamp:      {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Mode:           {args.mode}\n")
            f.write(f"Dataset:        {test_dataset_path}\n")
            if args.samples:
                f.write(f"Max Samples:    {args.samples}\n")
            f.write("\n")
            
            if "rag" in results:
                f.write("RAG METRICS:\n")
                f.write("-"*80 + "\n")
                metrics = results["rag"]["metrics"]
                f.write(f"  Faithfulness:      {metrics['faithfulness']:.4f}\n")
                f.write(f"  Answer Relevancy:  {metrics['answer_relevancy']:.4f}\n")
                f.write(f"  Context Recall:    {metrics['context_recall']:.4f}\n")
                f.write(f"  Context Precision: {metrics['context_precision']:.4f}\n")
                f.write(f"  Overall Score:     {metrics['overall_score']:.4f}\n")
                f.write("\n")
            
            if "latency" in results:
                f.write("LATENCY METRICS:\n")
                f.write("-"*80 + "\n")
                stats = results["latency"]["stats"]
                if stats.get("e2e_text"):
                    e2e = stats["e2e_text"]
                    f.write(f"  E2E Mean:          {e2e['mean']*1000:.2f} ms\n")
                    f.write(f"  E2E Median:        {e2e['median']*1000:.2f} ms\n")
                    f.write(f"  E2E P95:           {e2e['p95']*1000:.2f} ms\n")
                    f.write(f"  E2E P99:           {e2e['p99']*1000:.2f} ms\n")
                f.write("\n")
            
            f.write("="*80 + "\n")
            f.write(f"Reports saved to: {output_dir}\n")
            f.write("="*80 + "\n")
        
        print(f"\n{'='*80}")
        print(f"EVALUATION COMPLETE!")
        print(f"{'='*80}")
        print(f"\nAll reports saved to: {output_dir}")
        print(f"  - evaluation_summary.txt")
        if "rag" in results:
            print(f"  - rag_metrics.json")
            print(f"  - rag_detailed_results.csv")
            print(f"  - rag_report.txt")
        if "latency" in results:
            print(f"  - latency_stats.json")
            print(f"  - latency_report.txt")
        print()
        
    except Exception as e:
        print(f"\n{'='*80}")
        print(f"ERROR DURING EVALUATION")
        print(f"{'='*80}")
        print(f"\n{str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
