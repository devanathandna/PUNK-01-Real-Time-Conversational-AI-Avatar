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
  const [enableTTS, setEnableTTS] = useState(false);
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
            {m.emotion && m.emotion !== "none" && (
              <span style={styles.emotion}>{m.emotion === "happy" ? " 😊" : " 😔"}</span>
            )}
            {m.audioData && (
              <button 
                style={styles.audioPlayButton} 
                onClick={() => playAudioFromBase64(m.audioData)}
                title="Play audio response"
              >
                🔊
              </button>
            )}
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

      <div style={styles.controls}>
        <label style={styles.ttsToggle}>
          <input 
            type="checkbox" 
            checked={enableTTS}
            onChange={(e) => setEnableTTS(e.target.checked)}
            style={styles.checkbox}
          />
          <span style={styles.ttsLabel}>🔊 TTS</span>
        </label>
        <div style={styles.langButtons}>
          {[{ code: "en", label: "English" }, { code: "ta", label: "Tamil" }, { code: "hi", label: "Hindi" }].map(({ code, label }) => (
            <button
              key={code}
              style={{ ...styles.langButton, ...(language === code ? styles.langButtonActive : {}) }}
              onClick={() => setLanguage(code)}
            >
              {label}
            </button>
          ))}
        </div>
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
          placeholder="Ask about Deavanathan…"
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
    bottom: 20,
    right: 20,
    width: 370,
    maxHeight: "60vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#1e1e2e",
    borderRadius: 12,
    boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
    overflow: "hidden",
    fontFamily: "'Segoe UI', sans-serif",
    zIndex: 1000,
  },
  header: {
    padding: "12px 16px",
    fontWeight: 600,
    fontSize: 16,
    color: "#fff",
    backgroundColor: "#2a2a3d",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: "40vh",
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#3b82f6",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: "12px 12px 0 12px",
    maxWidth: "80%",
    fontSize: 14,
    wordBreak: "break-word",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#2a2a3d",
    color: "#e0e0e0",
    padding: "8px 12px",
    borderRadius: "12px 12px 12px 0",
    maxWidth: "80%",
    fontSize: 14,
    wordBreak: "break-word",
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
    padding: "8px 16px",
    borderTop: "1px solid #333",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
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
    borderTop: "1px solid #333",
  },
  recordButton: {
    border: "none",
    padding: "10px 12px",
    cursor: "pointer",
    fontSize: 16,
    color: "#fff",
    transition: "background-color 0.2s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 44,
  },
  input: {
    flex: 1,
    padding: "10px 12px",
    border: "none",
    outline: "none",
    fontSize: 14,
    backgroundColor: "#16161e",
    color: "#fff",
  },
  button: {
    padding: "10px 18px",
    border: "none",
    backgroundColor: "#3b82f6",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
  },
  loadingIndicator: {
    alignSelf: "flex-start",
    backgroundColor: "#2a2a3d",
    color: "#9ca3af",
    padding: "8px 12px",
    borderRadius: "12px 12px 12px 0",
    fontSize: 12,
    fontStyle: "italic",
    opacity: 0.8,
  },
  langButtons: {
    display: "flex",
    gap: 4,
  },
  langButton: {
    padding: "3px 8px",
    border: "1px solid #444",
    borderRadius: 4,
    backgroundColor: "transparent",
    color: "#9ca3af",
    fontSize: 11,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  langButtonActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
    color: "#fff",
  },
};
