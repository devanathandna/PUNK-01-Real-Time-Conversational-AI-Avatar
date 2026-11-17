import React, { useState, useRef, useEffect } from "react";
import { useAnimationContext } from "../AnimationContext";

const WS_URL = "ws://localhost:8000/ws";

const LANG_STYLE_MAP = {
  en: "english",
  ta: "tanglish",
  hi: "hindi-english",
};

const VALID_ANIMATIONS = new Set(["Acknowledging", "Talking", "Talking2", "HeadNodYes"]);

const normalizeEmotionSequence = (emotion) => {
  if (!emotion) return [];

  if (Array.isArray(emotion)) {
    return emotion.filter((name) => VALID_ANIMATIONS.has(name));
  }

  if (typeof emotion === "string") {
    // Support a single value ("Talking") and comma-separated values.
    return emotion
      .split(",")
      .map((name) => name.trim())
      .filter((name) => VALID_ANIMATIONS.has(name));
  }

  return [];
};

export function ChatInterface({ onResponse }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [enableTTS, setEnableTTS] = useState(true);
  const [language, setLanguage] = useState("en");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [isAudioGenerating, setIsAudioGenerating] = useState(false);
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const currentAudioRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const lastPlayedAudioRef = useRef("");
  const pendingEmotionRef = useRef([]);    // emotion array from latest backend response
  const ttsAnimTriggeredRef = useRef(false); // guard: trigger animations only once per TTS session

  const { setAnimations } = useAnimationContext();

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("WS message type:", data.type);
      
      switch(data.type) {
        // === Standard Streaming ===
        case "streaming_text_response":
          // Display complete text immediately
          setMessages((prev) => [...prev, { 
            role: "assistant", 
            text: data.response_text,
            emotion: data.emotion
          }]);
          // Store emotion so the upcoming audio chunks can trigger animations
          pendingEmotionRef.current = normalizeEmotionSequence(data.emotion);
          ttsAnimTriggeredRef.current = false;
          setIsAudioGenerating(true);
          break;
        
        // === Token Streaming (typing effect) ===
        case "streaming_token":
          setIsStreaming(true);
          setStreamingText((prev) => prev + data.token);
          break;
        
        case "streaming_text_complete":
          // Finalize text and add to messages
          setMessages((prev) => [...prev, { 
            role: "assistant", 
            text: data.response_text,
            emotion: data.emotion
          }]);
          // Store emotion so the upcoming audio chunks can trigger animations
          pendingEmotionRef.current = normalizeEmotionSequence(data.emotion);
          ttsAnimTriggeredRef.current = false;
          setStreamingText("");
          setIsStreaming(false);
          break;
        
        // === Streaming Audio Chunks ===
        case "streaming_audio_chunk":
          playAudioChunk(data.audio_data, data.chunk_id);
          setIsAudioGenerating(false);
          break;

        // === Full TTS Audio (new backend contract) ===
        case "streaming_audio_response":
        case "streaming_tts_complete":
          // Some backends send emotion with audio events instead of text events.
          if (data.emotion) {
            pendingEmotionRef.current = normalizeEmotionSequence(data.emotion);
          }
          if (data.audio_data && data.audio_data !== lastPlayedAudioRef.current) {
            lastPlayedAudioRef.current = data.audio_data;
            playAudioFromBase64(data.audio_data);
            setIsAudioGenerating(false);
          }
          break;
        
        case "streaming_stt_complete":
          // Update the audio message placeholder with the transcribed text
          if (data.text) {
            setMessages((prev) => {
              const updated = [...prev];
              const lastAudioIdx = updated.map((m) => m.isAudio).lastIndexOf(true);
              if (lastAudioIdx !== -1) {
                updated[lastAudioIdx] = { ...updated[lastAudioIdx], text: data.text, isAudio: false };
              }
              return updated;
            });
          }
          // data.is_hindi indicates the backend detected Hindi speech
          if (data.is_hindi) {
            console.log("Backend detected Hindi speech");
          }
          break;

        case "streaming_complete":
          setIsAudioGenerating(false);
          setIsStreaming(false);
          setStreamingText("");
          break;
        
        case "streaming_error":
          console.error("Streaming error:", data.error);
          setMessages((prev) => [...prev, { 
            role: "assistant", 
            text: `Error: ${data.error}`,
            isError: true
          }]);
          setIsAudioGenerating(false);
          setIsStreaming(false);
          setStreamingText("");
          break;

        case "streaming_audio_error":
          console.error("Streaming audio error:", data.error);
          setMessages((prev) => [...prev, {
            role: "assistant",
            text: `Audio error: ${data.error}`,
            isError: true,
          }]);
          setIsAudioGenerating(false);
          break;
        
        // === Legacy Response Types ===
        case "audio_conversation_response":
          setMessages((prev) => [
            ...prev,
            { role: "user", text: data.input_text || "Audio message" },
            { role: "assistant", text: data.response_text, emotion: data.emotion, audioData: data.audio_data }
          ]);
          pendingEmotionRef.current = normalizeEmotionSequence(data.emotion);
          if (data.success && data.audio_data) {
            playAudioFromBase64(data.audio_data);
          }
          break;
        
        case "text_with_audio_response":
          setMessages((prev) => [...prev, { 
            role: "assistant", 
            text: data.response, 
            emotion: data.emotion,
            audioData: data.audio_data 
          }]);
          pendingEmotionRef.current = normalizeEmotionSequence(data.emotion);
          if (data.audio_data) {
            playAudioFromBase64(data.audio_data);
          }
          break;
        
        default:
          // Handle legacy text responses
          if (data.response) {
            setMessages((prev) => [...prev, { 
              role: "assistant", 
              text: data.response, 
              emotion: data.emotion 
            }]);
          }
          break;
      }
      
      if (onResponse) onResponse(data);
    };

    return () => ws.close();
  }, [onResponse]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Audio playback function
  const playAudioFromBase64 = async (base64Audio) => {
    try {
      // Stop any currently playing audio
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }

      // Trigger emotion animations at the start of TTS
      if (pendingEmotionRef.current.length > 0) {
        setAnimations(pendingEmotionRef.current);
        pendingEmotionRef.current = [];
      }

      // Convert base64 to blob
      const audioBlob = base64ToBlob(base64Audio);
      const audioUrl = URL.createObjectURL(audioBlob);
      
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl); // Clean up
        currentAudioRef.current = null;
        setAnimations([]); // TTS ended → return to BreathingIdle
      };
      
      await audio.play();
    } catch (error) {
      console.error('Error playing audio:', error);
      setAnimations([]); // ensure idle on error
    }
  };

  // Base64 to Blob converter
  const base64ToBlob = (base64) => {
    const bytes = atob(base64);
    const array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      array[i] = bytes.charCodeAt(i);
    }
    return new Blob([array], { type: 'audio/wav' });
  };

  // Audio chunk queue management
  const playAudioChunk = (base64Audio, chunkId) => {
    const audioBlob = base64ToBlob(base64Audio);
    const audioUrl = URL.createObjectURL(audioBlob);
    
    // Add to queue
    audioQueueRef.current.push(audioUrl);
    
    // Start playing if not already
    if (!isPlayingRef.current) {
      playNextAudio();
    }
  };

  const playNextAudio = () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      ttsAnimTriggeredRef.current = false;
      setAnimations([]); // TTS chunk stream ended → return to BreathingIdle
      return;
    }
    
    isPlayingRef.current = true;

    // Trigger emotion animations on the very first chunk that plays
    if (!ttsAnimTriggeredRef.current && pendingEmotionRef.current.length > 0) {
      ttsAnimTriggeredRef.current = true;
      setAnimations(pendingEmotionRef.current);
      pendingEmotionRef.current = [];
    }

    const audioUrl = audioQueueRef.current.shift();
    
    const audio = new Audio(audioUrl);
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      playNextAudio(); // Play next chunk
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      playNextAudio(); // Skip to next on error
    };
    audio.play().catch(err => {
      console.error('Error playing audio chunk:', err);
      URL.revokeObjectURL(audioUrl);
      playNextAudio();
    });
  };

  // Audio recording functions
  const startRecording = async () => {
    try {
      // Frontend handles noise reduction before sending to server
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,        // Remove echo
          noiseSuppression: true,        // Built-in browser noise reduction
          autoGainControl: true,         // Auto-adjust volume
          sampleRate: 16000,             // Optimal for Whisper
          channelCount: 1                // Mono audio (smaller, cleaner)
        }
      });
      
      const mediaRecorder = new MediaRecorder(stream, { 
        mimeType: 'audio/webm' 
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        convertBlobToBase64AndSend(audioBlob);
        stream.getTracks().forEach(track => track.stop()); // Stop microphone
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const convertBlobToBase64AndSend = (blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = reader.result.split(',')[1]; // Remove data:audio/webm;base64, prefix
      sendAudioMessage(base64Data);
    };
    reader.readAsDataURL(blob);
  };

  const sendAudioMessage = (base64Audio) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    setMessages((prev) => [...prev, { role: "user", text: "🎤 Audio message", isAudio: true }]);
    
    wsRef.current.send(JSON.stringify({
      type: "audio_base64_streaming_tokens",
      audio_data: base64Audio,
      input_language: language,
      output_language: language,
      response_style: LANG_STYLE_MAP[language],
    }));
  };

  const send = () => {
    const query = input.trim();
    if (!query || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    setMessages((prev) => [...prev, { role: "user", text: query }]);
    
    // Send with TTS option
    wsRef.current.send(JSON.stringify({ 
      type: "text",
      query: query,
      enable_tts: enableTTS,
      input_language: language,
      response_style: LANG_STYLE_MAP[language],
    }));
    
    setInput("");
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        Chopper AI
        <span style={{ ...styles.dot, backgroundColor: connected ? "#4caf50" : "#f44336" }} />
      </div>

      <div style={styles.messages}>
        {messages.map((m, i) => (
          <div key={i} style={{
            ...(m.role === "user" ? styles.userBubble : styles.assistantBubble),
            ...(m.isError ? { backgroundColor: "#ef4444" } : {})
          }}>
            <div>{m.text}</div>
          </div>
        ))}
        
        {/* Streaming text with typing effect */}
        {isStreaming && streamingText && (
          <div style={styles.assistantBubble} className="streaming">
            <div>{streamingText}<span className="streaming-cursor">▊</span></div>
          </div>
        )}
        
        {/* Audio generation indicator */}
        {isAudioGenerating && (
          <div style={styles.loadingIndicator}>
            <span>🔊 Generating audio...</span>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputRow}>
        <button 
          style={{
            ...styles.recordButton, 
            backgroundColor: isRecording ? "#ef4444" : "#10b981"
          }}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!connected}
          title={isRecording ? "Stop recording" : "Start recording"}
        >
          {isRecording ? "⏹️" : "🎤"}
        </button>
        
        <input
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask Anything related to SECE…"
        />
        <button style={styles.button} onClick={send} disabled={!connected}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    position: "fixed",
    bottom: 30,
    right: 30,
    width: 420,
    maxHeight: "70vh",
    display: "flex",
    flexDirection: "column",
    background: "rgba(15, 15, 25, 0.95)",
    backdropFilter: "blur(20px)",
    borderRadius: 20,
    border: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.2)",
    overflow: "hidden",
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    zIndex: 1000,
  },
  header: {
    padding: "16px 20px",
    fontWeight: 600,
    fontSize: 18,
    color: "#fff",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    display: "flex",
    alignItems: "center",
    gap: 10,
    letterSpacing: "0.3px",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    display: "inline-block",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxHeight: "45vh",
    background: "rgba(20, 20, 30, 0.3)",
  },
  userBubble: {
    alignSelf: "flex-end",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#fff",
    padding: "12px 16px",
    borderRadius: "18px 18px 4px 18px",
    maxWidth: "75%",
    fontSize: 15,
    wordBreak: "break-word",
    boxShadow: "0 4px 12px rgba(102, 126, 234, 0.3)",
    lineHeight: "1.5",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    background: "rgba(45, 45, 65, 0.9)",
    color: "#e8e8e8",
    padding: "12px 16px",
    borderRadius: "18px 18px 18px 4px",
    maxWidth: "75%",
    fontSize: 15,
    wordBreak: "break-word",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    lineHeight: "1.5",
  },
  emotion: { marginLeft: 4 },
  audioPlayButton: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    marginLeft: 8,
    opacity: 0.7,
    padding: 2,
    borderRadius: 4,
    transition: "opacity 0.2s",
  },
  controls: {
    padding: "12px 20px",
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "rgba(20, 20, 30, 0.5)",
  },
  ttsToggle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    fontSize: 12,
    color: "#e0e0e0",
  },
  checkbox: {
    margin: 0,
  },
  ttsLabel: {
    userSelect: "none",
  },
  inputRow: {
    display: "flex",
    padding: "12px",
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(20, 20, 30, 0.5)",
    gap: 8,
  },
  recordButton: {
    border: "none",
    padding: "12px 14px",
    borderRadius: 12,
    cursor: "pointer",
    fontSize: 20,
    color: "#fff",
    transition: "all 0.3s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 48,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
  },
  input: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255, 255, 255, 0.1)",
    background: "rgba(30, 30, 45, 0.8)",
    color: "#fff",
    fontSize: 15,
    outline: "none",
    transition: "all 0.3s",
  },
  button: {
    padding: "12px 20px",
    border: "none",
    borderRadius: 12,
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.3s",
    boxShadow: "0 4px 12px rgba(102, 126, 234, 0.4)",
  },
  loadingIndicator: {
    alignSelf: "flex-start",
    background: "rgba(45, 45, 65, 0.7)",
    color: "#b0b0b0",
    padding: "10px 14px",
    borderRadius: "18px 18px 18px 4px",
    fontSize: 13,
    fontStyle: "italic",
    opacity: 0.9,
  },
  langButtons: {
    display: "flex",
    gap: 8,
    background: "rgba(30, 30, 45, 0.6)",
    padding: "6px",
    borderRadius: 12,
  },
  langButton: {
    padding: "6px 14px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 8,
    background: "transparent",
    color: "#b0b0b0",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.3s",
  },
  langButtonActive: {
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    borderColor: "transparent",
    color: "#fff",
    boxShadow: "0 2px 8px rgba(102, 126, 234, 0.4)",
  },
};
