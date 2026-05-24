import { createContext, useContext, useState } from "react";

export const AnimationContext = createContext({
  animations: [],       // [] = idle; non-empty = play emotion sequence
  setAnimations: () => {},
});

export const useAnimationContext = () => useContext(AnimationContext);

export function AnimationProvider({ children }) {
  const [animations, setAnimations] = useState([]);
  return (
    <AnimationContext.Provider value={{ animations, setAnimations }}>
      {children}
    </AnimationContext.Provider>
  );
}
