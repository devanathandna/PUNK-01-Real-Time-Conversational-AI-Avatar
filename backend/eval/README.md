# Evaluation Framework

Production-ready evaluation framework for the Real-Time Conversational AI Avatar system. Measures both **RAG quality** using RAGAS metrics and **End-to-End latency** from input to audio output.

## Features

### RAG Quality Metrics (RAGAS)
- **Faithfulness**: Measures hallucination - ensures responses are grounded in retrieved context
- **Answer Relevancy**: Measures how well the answer addresses the question
- **Context Recall**: Measures retrieval coverage - are all relevant contexts retrieved?
- **Context Precision**: Measures retrieval relevance - are retrieved contexts actually relevant?

### Latency Metrics
- **Component-wise breakdown**: STT, RAG Retrieval, Agent (LLM), TTS
- **End-to-End latency**: Complete pipeline timing (text/audio → audio output)
- **Statistical analysis**: Mean, Median, Min, Max, Stdev, P95, P99
- **Stress testing**: Consistency under load (50+ requests)

## Installation

```bash
# Install evaluation dependencies
pip install -r eval/requirements.txt

# Ensure main backend dependencies are installed
pip install -r requirements.txt
```

## Usage

### Quick Start - Full Evaluation

Run both RAG quality and latency evaluation on all test samples:

```bash
cd backend
python eval/run_evaluation.py --mode full
```

### RAG Quality Only

Evaluate answer quality using RAGAS metrics:

```bash
python eval/run_evaluation.py --mode rag
```

### Latency Only

Measure end-to-end performance:

```bash
python eval/run_evaluation.py --mode latency
```

### Stress Test

Test latency under load (50 requests):

```bash
python eval/run_evaluation.py --mode latency --stress
```

### Limited Samples

Run on first N samples only (faster for quick tests):

```bash
python eval/run_evaluation.py --mode full --samples 10
```

### Custom Dataset

Use your own test dataset:

```bash
python eval/run_evaluation.py --dataset path/to/dataset.json
```

### Custom Output Directory

Specify where to save reports:

```bash
python eval/run_evaluation.py --output eval/reports/my_test
```

## Command-Line Options

```
--mode {full,rag,latency}   Evaluation mode (default: full)
--samples N                 Limit to first N test samples
--stress                    Enable stress testing for latency
--dataset PATH              Custom test dataset JSON file
--output DIR                Custom output directory for reports
```

## Test Dataset Format

The test dataset (`test_dataset.json`) contains question-answer pairs with ground truth:

```json
[
  {
    "question": "What is Sri Eshwar College of Engineering?",
    "ground_truth": "Sri Eshwar College is an autonomous institution...",
    "contexts": ["Overview.txt"]
  }
]
```

## Output Reports

All reports are saved to `eval/reports/TIMESTAMP/`:

### RAG Evaluation
- `rag_metrics.json` - Metric scores in JSON format
- `rag_detailed_results.csv` - Per-sample detailed results
- `rag_report.txt` - Human-readable formatted report

### Latency Evaluation
- `latency_stats.json` - Statistical data in JSON format
- `latency_report.txt` - Human-readable formatted report

### Combined
- `evaluation_summary.txt` - Overall summary with key metrics

## Example Output

```
==============================================================
RAG QUALITY METRICS (RAGAS)
==============================================================

Faithfulness:       0.8945
  (measures hallucination - higher is better)

Answer Relevancy:   0.9123
  (measures answer quality - higher is better)

Context Recall:     0.8756
  (measures retrieval coverage - higher is better)

Context Precision:  0.8834
  (measures retrieval relevance - higher is better)

--------------------------------------------------------------
Overall Score:      0.8915
==============================================================
```

```
================================================================================
END-TO-END LATENCY METRICS
================================================================================

COMPONENT-WISE LATENCY:
--------------------------------------------------------------------------------

RAG Retrieval:
  Count:   25 requests
  Mean:    145.23 ms
  Median:  142.18 ms
  P95:     189.45 ms
  P99:     201.34 ms

Agent (LLM):
  Count:   25 requests
  Mean:    892.45 ms
  Median:  876.23 ms
  P95:     1024.56 ms
  P99:     1089.12 ms

TTS (Text-to-Speech):
  Count:   25 requests
  Mean:    456.78 ms
  Median:  445.67 ms
  P95:     523.45 ms
  P99:     567.89 ms

================================================================================
END-TO-END LATENCY:
--------------------------------------------------------------------------------

Text Input → Audio Output:
  Count:   25 requests
  Mean:    1512.34 ms
  Median:  1489.67 ms
  P95:     1756.23 ms
  P99:     1823.45 ms
================================================================================
```

## Integration with Production

### Continuous Evaluation

Add to your CI/CD pipeline:

```bash
# In your CI script
python eval/run_evaluation.py --mode full --samples 10
```

### Monitoring

Track metrics over time to detect regressions:

```bash
# Run weekly full evaluation
python eval/run_evaluation.py --mode full --output eval/reports/weekly_$(date +%Y%m%d)
```

### Performance Benchmarking

Before/after optimization comparisons:

```bash
# Baseline
python eval/run_evaluation.py --mode latency --stress --output baseline

# After optimization
python eval/run_evaluation.py --mode latency --stress --output optimized

# Compare reports
```

## Extending the Framework

### Adding Custom Metrics

1. Create new metric in `eval/metrics/`
2. Add to appropriate evaluator in `eval/evaluators/`
3. Update `run_evaluation.py` to include new metric

### Custom Test Datasets

Create domain-specific test sets:

```python
import json

custom_tests = [
    {
        "question": "Your question",
        "ground_truth": "Expected answer",
        "contexts": ["source_file.txt"]
    }
]

with open("custom_dataset.json", "w") as f:
    json.dump(custom_tests, f, indent=2)
```

Run evaluation:

```bash
python eval/run_evaluation.py --dataset custom_dataset.json
```

## Troubleshooting

### RAGAS Installation Issues

If you encounter issues with RAGAS dependencies:

```bash
pip install --upgrade ragas datasets langchain openai
```

### API Rate Limits

For large test sets, RAGAS may hit API rate limits. Use `--samples` to test incrementally:

```bash
python eval/run_evaluation.py --mode rag --samples 5
```

### Memory Issues

For large evaluations, process in batches:

```bash
# Process first 25 samples
python eval/run_evaluation.py --samples 25 --output batch1

# Process next 25 samples (modify test_dataset.json or create subset)
python eval/run_evaluation.py --samples 25 --output batch2
```

## License

Part of the Real-Time Conversational AI Avatar project.
