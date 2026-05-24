import React, { useEffect, useMemo, useRef } from 'react';
import { useAnimations, useFBX, useGLTF } from '@react-three/drei';
import { Box3, Vector3, LoopOnce } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { useAnimationContext } from '../AnimationContext';

function renameClip(clip, name) {
  const nextClip = clip.clone();
  nextClip.name = name;
  return nextClip;
}

export function Avatar(props) {
  const targetHeight = 3.4;

  // ── Load all FBXs ──────────────────────────────────────────────────────────
  const breathingIdleFbx = useFBX('/animations/BreathingIdle.fbx');
  const acknowledgingFbx = useFBX('/animations/Acknowledging.fbx');
  const talkingFbx       = useFBX('/animations/Talking.fbx');
  const talkingTwoFbx    = useFBX('/animations/Talking2.fbx');
  const headNodYesFbx    = useFBX('/animations/HeadNodYes.fbx');
  const { scene } = useGLTF('/models/shalaka.glb');

  const { animations } = useAnimationContext();
  const isPlayingEmotionsRef = useRef(false);

  // ── Clone + scale model ────────────────────────────────────────────────────
  const { avatar, offset, modelScale } = useMemo(() => {
    const clonedAvatar = SkeletonUtils.clone(scene);
    const bounds = new Box3();
    const center = new Vector3();
    const size   = new Vector3();

    clonedAvatar.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow    = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
      }
    });

    clonedAvatar.updateMatrixWorld(true);
    bounds.setFromObject(clonedAvatar);
    bounds.getCenter(center);
    bounds.getSize(size);

    const scaleFactor = size.y > 0 ? targetHeight / size.y : 1;
    return {
      avatar:     clonedAvatar,
      offset:     [-center.x * scaleFactor, -bounds.min.y * scaleFactor, -center.z * scaleFactor],
      modelScale: scaleFactor,
    };
  }, [scene]);

  // ── Build animation clip list ──────────────────────────────────────────────
  const allAnimations = useMemo(() => {
    const fbxMap = [
      [breathingIdleFbx, 'BreathingIdle'],
      [acknowledgingFbx, 'Acknowledging'],
      [talkingFbx,       'Talking'],
      [talkingTwoFbx,    'Talking2'],
      [headNodYesFbx,    'HeadNodYes'],
    ];
    return fbxMap
      .filter(([fbx]) => fbx.animations?.[0])
      .map(([fbx, name]) => renameClip(fbx.animations[0], name));
  }, [breathingIdleFbx, acknowledgingFbx, talkingFbx, talkingTwoFbx, headNodYesFbx]);

  const { actions, mixer } = useAnimations(allAnimations, avatar);

  // ── Start BreathingIdle once actions are ready ─────────────────────────────
  useEffect(() => {
    if (!actions?.BreathingIdle) return;
    actions.BreathingIdle.reset().fadeIn(0.5).play();
  }, [actions]);

  // ── Emotion animation sequencer ────────────────────────────────────────────
  useEffect(() => {
    if (!actions || !mixer) return;

    if (animations.length === 0) {
      // ── Return to BreathingIdle ─────────────────────────────────────────
      isPlayingEmotionsRef.current = false;
      Object.values(actions).forEach((a) => {
        if (a !== actions.BreathingIdle && a.isRunning()) a.fadeOut(0.3);
      });
      actions.BreathingIdle?.reset().fadeIn(0.5).play();
      return;
    }

    // ── Play emotion sequence, cycling until TTS ends ──────────────────────
    isPlayingEmotionsRef.current = true;
    let stepIndex = 0;

    const playStep = () => {
      if (!isPlayingEmotionsRef.current) return;
      const name   = animations[stepIndex % animations.length];
      stepIndex++;
      const action = actions[name];
      if (!action) { playStep(); return; } // skip unknown

      action.reset();
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.fadeIn(0.3).play();
    };

    const onFinished = (e) => {
      if (!isPlayingEmotionsRef.current) return;
      e.action.fadeOut(0.3);
      playStep();
    };

    mixer.addEventListener('finished', onFinished);
    actions.BreathingIdle?.fadeOut(0.5);
    playStep();

    return () => {
      isPlayingEmotionsRef.current = false;
      mixer.removeEventListener('finished', onFinished);
    };
  }, [animations, actions, mixer]);

  return (
    <group {...props} dispose={null}>
      {/* Wrapper group to handle coordinate system corrections */}
      <group rotation={[0, -Math.PI / 2, 0]}>
        {/* Additional rotation to fix FBX/GLB coordinate mismatch */}
        <group rotation={[-Math.PI / 2, 0, 96]}>
          <group position={offset} scale={modelScale}>
            <primitive object={avatar} />
          </group>
        </group>
      </group>
    </group>
  );
}

useGLTF.preload('/models/shalaka.glb');
useFBX.preload('/animations/BreathingIdle.fbx');
useFBX.preload('/animations/Acknowledging.fbx');
useFBX.preload('/animations/Talking.fbx');
useFBX.preload('/animations/Talking2.fbx');
useFBX.preload('/animations/HeadNodYes.fbx');