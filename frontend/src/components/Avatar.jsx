import React, { useEffect, useMemo, useRef } from 'react';
import { useAnimations, useFBX, useGLTF } from '@react-three/drei';
import { Box3, Vector3, Quaternion, LoopOnce } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { useAnimationContext } from '../AnimationContext';

const REF_CLIP = 'BreathingIdle';

const isHips = (trackName) => /hips\.(position|quaternion)$/i.test(trackName);

function findHipsTracks(clip) {
  return {
    pos:  clip.tracks.find((t) => /hips\.position$/i.test(t.name)),
    quat: clip.tracks.find((t) => /hips\.quaternion$/i.test(t.name)),
  };
}

/**
 * Clones every clip and:
 *  - drops scale tracks and non-hips position tracks (Mixamo cm units can stretch the mesh)
 *  - aligns hips rotation/position to the reference (idle) clip's first frame,
 *    so every clip shares the same root orientation.
 */
function prepareClips(rawClips) {
  const ref = rawClips.find((c) => c.name === REF_CLIP);
  const refHips = ref ? findHipsTracks(ref) : {};
  const refQ0 = refHips.quat ? new Quaternion().fromArray(refHips.quat.values, 0) : null;
  const refP0 = refHips.pos  ? new Vector3().fromArray(refHips.pos.values, 0)     : null;

  return rawClips.map((src) => {
    const clip = src.clone(); // clones tracks + values, original FBX stays untouched

    clip.tracks = clip.tracks.filter((t) => {
      if (t.name.endsWith('.scale')) return false;
      if (t.name.endsWith('.position') && !isHips(t.name)) return false;
      return true;
    });

    if (clip.name === REF_CLIP || !refQ0) return clip;

    const { pos, quat } = findHipsTracks(clip);
    if (!quat) return clip;

    const q0    = new Quaternion().fromArray(quat.values, 0);
    const delta = refQ0.clone().multiply(q0.clone().invert()); // delta * q0 = refQ0

    // Debug: how far off was this clip from idle? (remove later)
    const deg = (2 * Math.acos(Math.min(1, Math.abs(delta.w))) * 180) / Math.PI;
    console.log(`[Avatar] ${clip.name}: hips orientation offset vs idle = ${deg.toFixed(1)}°`);

    const q = new Quaternion();
    for (let i = 0; i < quat.values.length; i += 4) {
      q.fromArray(quat.values, i).premultiply(delta).toArray(quat.values, i);
    }

    if (pos && refP0) {
      const p0 = new Vector3().fromArray(pos.values, 0);
      const p  = new Vector3();
      for (let i = 0; i < pos.values.length; i += 3) {
        p.fromArray(pos.values, i).sub(p0).applyQuaternion(delta).add(refP0).toArray(pos.values, i);
      }
    }
    return clip;
  });
}

function rename(clip, name) {
  const c = clip.clone();
  c.name = name;
  return c;
}

export function Avatar(props) {
  const targetHeight = 3.4;

  const breathingIdleFbx = useFBX('/animations/BreathingIdle.fbx');
  const acknowledgingFbx = useFBX('/animations/Acknowledging.fbx');
  const talkingFbx       = useFBX('/animations/Talking.fbx');
  const talkingTwoFbx    = useFBX('/animations/Talking2.fbx');
  const headNodYesFbx    = useFBX('/animations/HeadNodYes.fbx');
  const { scene } = useGLTF('/models/shalaka.glb');

  const { animations } = useAnimationContext();
  // Stable key: a new array identity with the same content must NOT restart the sequence
  const animationKey = (animations ?? []).join('|');

  const currentRef = useRef(null); // action currently driving the skeleton

  // ── Clone + scale model ────────────────────────────────────────────────────
  const { avatar, offset, modelScale } = useMemo(() => {
    const clonedAvatar = SkeletonUtils.clone(scene);
    const bounds = new Box3();
    const center = new Vector3();
    const size   = new Vector3();

    clonedAvatar.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
      }
    });

    clonedAvatar.updateMatrixWorld(true);
    bounds.setFromObject(clonedAvatar);
    bounds.getCenter(center);
    bounds.getSize(size);

    const s = size.y > 0 ? targetHeight / size.y : 1;
    return {
      avatar: clonedAvatar,
      offset: [-center.x * s, -bounds.min.y * s, -center.z * s],
      modelScale: s,
    };
  }, [scene]);

  // ── Build + normalize clips ────────────────────────────────────────────────
  const allAnimations = useMemo(() => {
    const fbxMap = [
      [breathingIdleFbx, 'BreathingIdle'],
      [acknowledgingFbx, 'Acknowledging'],
      [talkingFbx,       'Talking'],
      [talkingTwoFbx,    'Talking2'],
      [headNodYesFbx,    'HeadNodYes'],
    ];
    const renamed = fbxMap
      .filter(([fbx]) => fbx.animations?.[0])
      .map(([fbx, name]) => rename(fbx.animations[0], name));
    return prepareClips(renamed);
  }, [breathingIdleFbx, acknowledgingFbx, talkingFbx, talkingTwoFbx, headNodYesFbx]);

  const { actions, mixer } = useAnimations(allAnimations, avatar);

  // ── Single sequencer: idle <-> emotion clips, always cross-faded ───────────
  useEffect(() => {
    if (!actions || !mixer) return;

    const idle = actions.BreathingIdle;
    const sequence = animationKey
      ? animationKey.split('|').filter((n) => actions[n])
      : [];

    // Cross-fade keeps total weight == 1, so the bind pose never leaks through
    const switchTo = (next, fade = 0.35) => {
      const prev = currentRef.current;
      if (prev === next) {
        next.reset().play();
        return;
      }
      next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
      if (prev) prev.crossFadeTo(next, fade, false);
      else next.fadeIn(fade);
      currentRef.current = next;
    };

    // No emotions → back to idle
    if (sequence.length === 0) {
      if (idle) switchTo(idle, 0.5);
      return;
    }

    let active = true;
    let step = 0;

    const playNext = () => {
      if (!active) return;
      const action = actions[sequence[step % sequence.length]];
      step++;
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      switchTo(action);
    };

    const onFinished = (e) => {
      if (e.action !== currentRef.current) return; // ignore clips that are fading out
      playNext();
    };

    mixer.addEventListener('finished', onFinished);
    playNext();

    return () => {
      active = false;
      mixer.removeEventListener('finished', onFinished);
    };
  }, [animationKey, actions, mixer]);

  return (
    <group {...props} dispose={null}>
      <group rotation={[0, -Math.PI / 2, 0]}>
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