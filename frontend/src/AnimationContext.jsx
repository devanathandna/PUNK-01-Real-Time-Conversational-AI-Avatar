import { createContext, useContext, useState, useRef } from "react";

export const AnimationContext = createContext({
  animations: [],       // [] = idle; non-empty = play emotion sequence
  setAnimations: () => {},
  triggerManualAnimation: () => {}, // function to trigger a single animation for a duration
});

export const useAnimationContext = () => useContext(AnimationContext);

export function AnimationProvider({ children }) {
  const [animations, setAnimations] = useState([]);
  const manualAnimationTimeoutRef = useRef(null);

  const triggerManualAnimation = (animationName, duration = 3000) => {
    // Clear any existing manual animation timeout
    if (manualAnimationTimeoutRef.current) {
      clearTimeout(manualAnimationTimeoutRef.current);
    }

    // Set the animation to play
    setAnimations([animationName]);

    // Schedule return to idle after duration
    manualAnimationTimeoutRef.current = setTimeout(() => {
      setAnimations([]);
      manualAnimationTimeoutRef.current = null;
    }, duration);
  };

  return (
    <AnimationContext.Provider value={{ animations, setAnimations, triggerManualAnimation }}>
      {children}
    </AnimationContext.Provider>
  );
}
