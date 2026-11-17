"""
RAG Quality Metrics using RAGAS framework
Measures: Faithfulness, Context Precision, Context Recall, Answer Relevancy
"""

import os
import litellm
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_recall,
    context_precision
)
from ragas.llms import llm_factory
from ragas.embeddings import embedding_factory
from datasets import Dataset
import pandas as pd
from typing import List, Dict


class RAGMetrics:
    """Calculate RAGAS metrics for RAG system evaluation"""
    
    def __init__(self):
        # Use Groq API via litellm with custom base URL for OpenGPT-OSS
        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError("GROQ_API_KEY not found in environment")
        
        # Set API key for litellm OpenAI-compatible calls
        os.environ["OPENAI_API_KEY"] = groq_api_key
        os.environ["OPENAI_API_BASE"] = "https://api.groq.com/openai/v1"
        
        # Create evaluator LLM using litellm with OpenGPT-OSS 120B
        evaluator_llm = llm_factory(
            model="openai/gpt-oss-120b",
            provider="litellm",
            client=litellm.completion
        )
        
        # Create embeddings using sentence-transformers (local, no API needed)
        evaluator_embeddings = embedding_factory(
            provider="huggingface",
            model="sentence-transformers/all-MiniLM-L6-v2"
        )
        
        # Configure metrics
        self.metrics = [
            faithfulness,
            answer_relevancy,
            context_recall,
            context_precision
        ]
        
        self.llm = evaluator_llm
        self.embeddings = evaluator_embeddings
    
    def calculate_metrics(
        self,
        questions: List[str],
        answers: List[str],
        contexts: List[List[str]],
        ground_truths: List[str]
    ) -> Dict:
        """
        Calculate RAGAS metrics for given Q&A pairs
        
        Args:
            questions: List of input questions
            answers: List of generated answers from the RAG system
            contexts: List of retrieved context chunks for each question
            ground_truths: List of reference ground truth answers
            
        Returns:
            Dictionary with metric scores and detailed results
        """
        # Create dataset in RAGAS format
        data = {
            "question": questions,
            "answer": answers,
            "contexts": contexts,
            "ground_truth": ground_truths
        }
        
        dataset = Dataset.from_dict(data)
        
        # Run RAGAS evaluation with custom LLM and embeddings
        result = evaluate(
            dataset,
            metrics=self.metrics,
            llm=self.llm,
            embeddings=self.embeddings
        )
        
        # Convert to dict and add individual scores
        # Handle both single values and lists from RAGAS
        def get_score(value):
            if isinstance(value, list):
                return sum(value) / len(value) if value else 0
            return value if value is not None else 0
        
        scores = {
            "faithfulness": get_score(result["faithfulness"]),
            "answer_relevancy": get_score(result["answer_relevancy"]),
            "context_recall": get_score(result["context_recall"]),
            "context_precision": get_score(result["context_precision"]),
        }
        
        scores["overall_score"] = sum(scores.values()) / 4
        
        return {
            "metrics": scores,
            "detailed_results": result.to_pandas()
        }
    
    def format_report(self, results: Dict) -> str:
        """Format metrics into readable report"""
        metrics = results["metrics"]
        
        report = "=" * 60 + "\n"
        report += "RAG QUALITY METRICS (RAGAS)\n"
        report += "=" * 60 + "\n\n"
        
        report += f"Faithfulness:       {metrics['faithfulness']:.4f}\n"
        report += f"  (measures hallucination - higher is better)\n\n"
        
        report += f"Answer Relevancy:   {metrics['answer_relevancy']:.4f}\n"
        report += f"  (measures answer quality - higher is better)\n\n"
        
        report += f"Context Recall:     {metrics['context_recall']:.4f}\n"
        report += f"  (measures retrieval coverage - higher is better)\n\n"
        
        report += f"Context Precision:  {metrics['context_precision']:.4f}\n"
        report += f"  (measures retrieval relevance - higher is better)\n\n"
        
        report += "-" * 60 + "\n"
        report += f"Overall Score:      {metrics['overall_score']:.4f}\n"
        report += "=" * 60 + "\n"
        
        return report
