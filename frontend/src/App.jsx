import React from "react";
import { Canvas } from "@react-three/fiber";
import { Experience } from "./components/Experience";
import { ChatInterface } from "./components/ChatInterface";
import { AnimationProvider } from "./AnimationContext";

// Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Canvas Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh',
          flexDirection: 'column',
          fontFamily: 'Arial, sans-serif' 
        }}>
          <h2>Something went wrong with the 3D scene.</h2>
          <p>Please check the console for more details.</p>
          <button 
            onClick={() => window.location.reload()} 
            style={{ 
              padding: '10px 20px', 
              backgroundColor: '#007bff', 
              color: 'white', 
              border: 'none', 
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <AnimationProvider>
    <ErrorBoundary>
      <Canvas shadows camera={{ position: [0, 0, 8], fov: 30 }}>
        <color attach="background" args={["#ececec"]} />
        <ambientLight intensity={0.35} />
        <hemisphereLight intensity={0.8} groundColor="#c7d2d9" />
        <directionalLight position={[0, 3, 6]} intensity={1.35} castShadow />
        <directionalLight position={[-3, 2, 4]} intensity={0.45} />
        <Experience />
      </Canvas>
      <ChatInterface />
    </ErrorBoundary>
    </AnimationProvider>
  );
}

export default App;
