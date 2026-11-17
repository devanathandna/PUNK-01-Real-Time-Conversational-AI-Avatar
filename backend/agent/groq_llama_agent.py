"""
Groq OpenGPT-OSS 120B AI Agent - English-only, clean JSON responses
"""

import os
import json
import logging
from typing import Dict, Any, AsyncGenerator
from groq import Groq
from pydantic import BaseModel, Field, ValidationError
from rag_faiss.retriever import retrieve as query_knowledge_base

logger = logging.getLogger(__name__)


class AgentResponse(BaseModel):
    """Validated agent response schema"""
    response: str = Field(..., description="The assistant response text")
    emotion: str = Field(default="Talking", description="Avatar emotion")
    
    class Config:
        use_enum_values = True


def _get_groq_client() -> Groq:
    """Get Groq client using rotating keys."""
    from config.settings import get_rotating_key
    
    api_key = get_rotating_key("GROQ_STT_API_KEY")
    if not api_key:
        api_key = os.getenv("GROQ_API_KEY")
        
    if not api_key:
        raise Exception("GROQ_STT_API_KEY or GROQ_API_KEY not found")
        
    return Groq(api_key=api_key)


def _normalize_emotion(emotion: str) -> str:
    """Normalize emotion to supported avatar animations."""
    if not isinstance(emotion, str):
        return "Talking"
    
    cleaned = emotion.strip().lower()
    
    mapping = {
        "acknowledging": "Acknowledging",
        "talking": "Talking",
        "talking2": "Talking2",
        "headnodyes": "HeadNodYes",
        "head_nod_yes": "HeadNodYes",
    }
    
    return mapping.get(cleaned, "Talking")


async def sanitize_query(user_query: str) -> str:
    """Transform irrelevant queries into Sri Eshwar College related queries."""
    try:
        import asyncio
        client = _get_groq_client()
        
        def _run_transformer():
            prompt = f"""Transform this query to be about Sri Eshwar College if needed:
{user_query}

Output ONLY the transformed query text:"""
            
            return client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=100
            )
            
        loop = asyncio.get_event_loop()
        response = await asyncio.wait_for(loop.run_in_executor(None, _run_transformer), timeout=3.0)
        
        text = response.choices[0].message.content.strip()
        logger.info(f"🔄 Transformer: '{user_query}' -> '{text}'")
        return text
    except Exception as e:
        logger.warning(f"Transformer failed: {e}")
        return user_query


async def get_agent_response(
    user_query: str,
    *args,
    **kwargs
) -> Dict[str, Any]:
    """
    Get agent response using OpenGPT-OSS 120B with Pydantic validation
    """
    try:
        # Only transform query for audio/speech input (is_audio flag)
        is_audio_input = kwargs.get("is_audio_input", False)
        if is_audio_input:
            user_query = await sanitize_query(user_query)
        
        # Get RAG context
        try:
            import asyncio
            rag_results = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(None, query_knowledge_base, user_query),
                timeout=6.0
            )
            context = rag_results.get("context", "") if isinstance(rag_results, dict) else ""
            context = context.strip() if context.strip() else "No specific context available."
        except Exception as e:
            logger.warning(f"RAG error: {e}")
            context = "Using general knowledge."
        
        # Build prompt - explicit JSON format instruction
        prompt = f"""You are AIVA, AI assistant for Sri Eshwar College.

CONTEXT: {context}

USER QUERY: {user_query}

Respond ONLY in this JSON format, nothing else:
{{"response":"your detailed answer (100+ characters)","emotion":"Talking"}}"""
        
        # Call Groq
        client = _get_groq_client()
        logger.info(f"[en] Calling OpenGPT-OSS 120B")
        
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.65,
            max_tokens=1000,
            top_p=0.95
        )
        
        text = response.choices[0].message.content.strip()
        
        # Extract JSON - handle if model adds extra text
        if not text.startswith("{"):
            start = text.find("{")
            if start != -1:
                text = text[start:]
        if not text.endswith("}"):
            end = text.rfind("}")
            if end != -1:
                text = text[:end+1]
        
        # Parse JSON
        parsed_json = json.loads(text)
        validated = AgentResponse(**parsed_json)
        
        # Normalize emotion
        emotion = _normalize_emotion(validated.emotion)
        
        logger.info(f"[en] {len(validated.response)} chars, emotion: {emotion}")
        
        return {
            "response": validated.response,
            "emotion": emotion,
            "language": "en",
            "success": True
        }
        
    except ValidationError as ve:
        logger.error(f"Validation error: {ve}")
        return {
            "response": "Response validation failed.",
            "emotion": "Talking",
            "language": "en",
            "success": False,
            "error": str(ve)
        }
        
    except json.JSONDecodeError as je:
        logger.error(f"JSON decode error: {je}")
        return {
            "response": "Response was not valid JSON.",
            "emotion": "Talking",
            "language": "en",
            "success": False,
            "error": str(je)
        }
        
    except Exception as error:
        logger.error(f"Agent error: {error}")
        return {
            "response": "Technical difficulty. Try again.",
            "emotion": "Talking",
            "language": "en",
            "success": False,
            "error": str(error)
        }


async def get_agent_response_streaming(
    user_query: str,
    *args,
    **kwargs
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Streaming LLM response using OpenGPT-OSS 120B with Pydantic validation
    """
    try:
        # Only transform query for audio/speech input (is_audio flag)
        is_audio_input = kwargs.get("is_audio_input", False)
        if is_audio_input:
            user_query = await sanitize_query(user_query)
        
        # Get RAG context
        try:
            import asyncio
            rag_results = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(None, query_knowledge_base, user_query),
                timeout=6.0
            )
            context = rag_results.get("context", "") if isinstance(rag_results, dict) else ""
            context = context.strip() if context.strip() else "No specific context available."
        except Exception as e:
            logger.warning(f"RAG error: {e}")
            context = "Using general knowledge."
        
        # Build prompt - EXPLICIT JSON format instruction
        prompt = f"""You are AIVA, AI assistant for Sri Eshwar College.

CONTEXT: {context}

USER QUERY: {user_query}

Respond ONLY in this JSON format, nothing else:
{{"response":"your detailed answer (500+ characters)","emotion":"Talking"}}"""
        
        # Stream from Groq
        client = _get_groq_client()
        logger.info(f"[en] Streaming OpenGPT-OSS 120B")
        
        stream = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.65,
            max_tokens=1000,
            top_p=0.95,
            stream=True
        )
        
        full_text = ""
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                token = chunk.choices[0].delta.content
                full_text += token
                yield {
                    "type": "token",
                    "token": token,
                    "language": "en"
                }
        
        # Extract and parse JSON
        text = full_text.strip()
        if not text.startswith("{"):
            start = text.find("{")
            if start != -1:
                text = text[start:]
        if not text.endswith("}"):
            end = text.rfind("}")
            if end != -1:
                text = text[:end+1]
        
        parsed_json = json.loads(text)
        validated = AgentResponse(**parsed_json)
        emotion = _normalize_emotion(validated.emotion)
        
        logger.info(f"[en] Streaming complete: {len(validated.response)} chars, emotion: {emotion}")
        
        yield {
            "type": "complete",
            "response": validated.response,
            "emotion": emotion,
            "language": "en",
            "full_text": full_text
        }
        
    except ValidationError as ve:
        logger.error(f"Streaming validation error: {ve}")
        yield {
            "type": "error",
            "error": str(ve),
            "response": "Response validation failed.",
            "emotion": "Talking",
            "language": "en"
        }
        
    except Exception as error:
        logger.error(f"Streaming error: {error}")
        yield {
            "type": "error",
            "error": str(error),
            "response": "Technical difficulty.",
            "emotion": "Talking",
            "language": "en"
        }
