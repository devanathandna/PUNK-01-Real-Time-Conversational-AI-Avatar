import React, { Suspense, useMemo } from "react";
import { OrbitControls, useTexture } from "@react-three/drei";
import { Avatar } from "./Avatar";
import { useThree } from "@react-three/fiber";

// Loading fallback component
function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="lightblue" />
    </mesh>
  );
}

export const Experience = () => {
  const texture = useTexture("/textures/lab.png");
  const { camera, viewport } = useThree();
  const backgroundViewport = viewport.getCurrentViewport(camera, [0, 0, -5]);

  const backgroundSize = useMemo(() => {
    const image = texture.image;

    if (!image?.width || !image?.height) {
      return [backgroundViewport.width, backgroundViewport.height];
    }

    const viewportRatio = backgroundViewport.width / backgroundViewport.height;
    const imageRatio = image.width / image.height;

    if (imageRatio > viewportRatio) {
      return [backgroundViewport.height * imageRatio, backgroundViewport.height];
    }

    return [backgroundViewport.width, backgroundViewport.width / imageRatio];
  }, [backgroundViewport.height, backgroundViewport.width, texture.image]);

  return (
    <>
      <OrbitControls />
      
      <Suspense fallback={<LoadingFallback />}>
        <Avatar position={[0, -2, 0.5]} rotation={[0, 0, 0]} />
      </Suspense>
      
      <mesh position={[0, 0, -5]}>
        <planeGeometry args={backgroundSize} />
        <meshBasicMaterial map={texture} />
      </mesh>
    </>
  );
};
