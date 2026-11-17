"""
Groq TTS Module - Using Canopy Labs Orpheus v1 (English only)
Fast, reliable text-to-speech via Groq API
"""
import os
import logging
from typing import Dict, Any
from groq import Groq
from io import BytesIO

logger = logging.getLogger(__name__)


class GroqTTSProcessor:
    def __init__(self):
        """Initialize Groq TTS processor"""
        self.model = "canopylabs/orpheus-v1-english"
        self.voice = "daniel"  # Male voice options: ember, alloy, echo, fable, onyx, sage
        self.api_key = os.getenv("GROQ_TTS_API_KEY") or os.getenv("GROQ_API_KEY")
        
        if not self.api_key:
            raise Exception("GROQ_TTS_API_KEY or GROQ_API_KEY not found in environment")
        
        self.client = Groq(api_key=self.api_key)
        logger.info(f"✅ Groq TTS Initialized - Model: {self.model}, Voice: {self.voice}")
    
    async def synthesize_speech(
        self,
        text: str,
        language: str = "en",
        voice: str = None,
        emotion: str = "none",
        track_ttfb: bool = False
    ) -> Dict[str, Any]:
        """
        Synthesize speech using Groq's Orpheus TTS
        
        Args:
            text: Text to synthesize
            language: Language (only 'en' supported)
            voice: Voice name (uses 'autumn' by default)
            emotion: Emotion/style (ignored, Orpheus handles naturally)
            track_ttfb: Track Time to First Byte for streaming analysis
        
        Returns:
            Dict with 'audio_data' (bytes), 'ttfb_ms' (optional), and metadata
        """
        import time
        
        try:
            if not text or not text.strip():
                logger.warning("Empty text provided to TTS")
                return {
                    "success": False,
                    "error": "Empty text",
                    "audio_data": None
                }
            
            logger.info(f"🎤 Groq TTS: Synthesizing '{text[:50]}...' (voice: {self.voice}, len: {len(text)} chars)")
            
            # Start timing for TTFB
            start_time = time.time() if track_ttfb else None
            ttfb = None
            
            # Call Groq TTS API - ensure full audio generation
            try:
                response = self.client.audio.speech.create(
                    model=self.model,
                    voice=self.voice,
                    response_format="wav",
                    input=text
                )
                
                # Record TTFB when first byte arrives
                if track_ttfb and start_time:
                    ttfb = (time.time() - start_time) * 1000  # Convert to ms
                
                # Get audio bytes from response
                audio_data = response.read() if hasattr(response, 'read') else response
            except Exception as e:
                if "terms_acceptance" in str(e).lower() or "model_terms_required" in str(e):
                    logger.warning(f"Orpheus model requires terms acceptance. Using Google TTS fallback.")
                    return await self._synthesize_with_google_tts(text)
                raise
            
            if not audio_data:
                logger.error("No audio data in TTS response")
                return {
                    "success": False,
                    "error": "No audio in response",
                    "audio_data": None
                }
            
            logger.info(f"✅ TTS Success: {len(audio_data)} bytes" + (f" (TTFB: {ttfb:.2f}ms)" if ttfb else ""))
            
            result = {
                "success": True,
                "audio_data": audio_data,
                "duration_ms": len(audio_data) // 32,
                "format": "wav",
                "sample_rate": 16000,
                "text": text[:50]
            }
            
            if ttfb is not None:
                result["ttfb_ms"] = ttfb
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Groq TTS Error: {e}")
            return {
                "success": False,
                "error": str(e),
                "audio_data": None
            }
    
    def get_supported_languages(self) -> Dict[str, Any]:
        """Get supported languages"""
        return {
            "languages": ["en"],
            "provider": "groq",
            "model": self.model,
            "voices": ["autumn"]
        }
    
    def split_into_sentences(self, text: str) -> list:
        """Split text into sentences for chunked streaming"""
        sentences = []
        current = ""
        for char in text:
            current += char
            if char in ".!?":
                sentences.append(current.strip())
                current = ""
        if current.strip():
            sentences.append(current.strip())
        return sentences if sentences else [text]
    
    async def _synthesize_with_google_tts(self, text: str) -> Dict[str, Any]:
        """Fallback to Google TTS if Orpheus model is not available"""
        try:
            import google.generativeai as genai
            api_key = os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise Exception("GOOGLE_API_KEY not set")
            
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-2.5-flash")
            
            # Use Gemini to generate audio (if available)
            logger.info(f"Fallback: Using Google Generative AI for TTS")
            
            # For now, return a dummy audio or error
            logger.warning("Google TTS fallback not fully implemented. Please accept Orpheus terms.")
            return {
                "success": False,
                "error": "TTS model requires terms acceptance at https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english",
                "audio_data": None
            }
        except Exception as e:
            logger.error(f"Google TTS fallback also failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "audio_data": None
            }

