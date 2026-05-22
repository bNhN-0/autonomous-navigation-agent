"use client";

import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { gridToWorld } from "./TrackGrid";
import type { GridPosition, MapLayout } from "./types";

type DeliveryAgentProps = {
  map: MapLayout;
  path: GridPosition[];
  visualProgress: number;
  pickupStep: number;
  deliveryStep: number;
  followTargetRef?: MutableRefObject<DeliveryAgentFollowTarget | null>;
};

export type DeliveryAgentFollowTarget = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

export default function DeliveryAgent({
  map,
  path,
  visualProgress,
  pickupStep,
  deliveryStep,
  followTargetRef,
}: DeliveryAgentProps) {
  const agentRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const cargoRef = useRef<THREE.Group>(null);
  const statusStripRef = useRef<THREE.Mesh>(null);
  const targetQuaternion = useRef(new THREE.Quaternion());
  const latestProgressRef = useRef(visualProgress);

  const worldPath = useMemo(
    () =>
      path.map((point) => {
        const [x, y, z] = gridToWorld(point, map.rows, map.cols);
        return new THREE.Vector3(x, y + 0.16, z);
      }),
    [map.cols, map.rows, path],
  );

  useEffect(() => {
    latestProgressRef.current = visualProgress;
  }, [visualProgress]);

  useEffect(() => {
    const agent = agentRef.current;
    if (!agent || worldPath.length === 0) {
      return;
    }

    agent.position.copy(worldPath[0]);
    const lookTarget = getLookTarget(worldPath, 0);
    updateHeading(agent, worldPath[0], lookTarget, true, 0, targetQuaternion.current);
    syncVisualState(0, 0, pickupStep, deliveryStep, cargoRef.current, statusStripRef.current);
    syncFollowTarget(agent, followTargetRef);
  }, [deliveryStep, followTargetRef, pickupStep, worldPath]);

  useFrame((state, delta) => {
    const agent = agentRef.current;
    const cargo = cargoRef.current;
    const body = bodyRef.current;

    if (!agent || !cargo || !body || worldPath.length === 0) {
      return;
    }

    const maxVisualProgress = Math.max(worldPath.length - 1, 0);
    const clampedProgress = THREE.MathUtils.clamp(latestProgressRef.current, 0, maxVisualProgress);
    const segmentIndex = Math.min(Math.floor(clampedProgress), Math.max(worldPath.length - 2, 0));
    const rawT = worldPath.length > 1 ? clampedProgress - segmentIndex : 0;
    const easedT = smoothstep(rawT);
    const currentPoint = worldPath[segmentIndex] ?? worldPath[0];
    const nextPoint = worldPath[Math.min(segmentIndex + 1, worldPath.length - 1)] ?? currentPoint;
    const isWaiting = currentPoint.distanceToSquared(nextPoint) < 0.0001;
    const idleOffset = isWaiting ? Math.sin(state.clock.elapsedTime * 2.4) * 0.01 : 0;

    agent.position.lerpVectors(currentPoint, nextPoint, easedT);
    agent.position.y += idleOffset;

    const currentVisualPoint = agent.position.clone();
    const lookTarget = getLookTarget(worldPath, segmentIndex);
    updateHeading(agent, currentVisualPoint, lookTarget, false, delta, targetQuaternion.current);

    body.position.y = isWaiting ? Math.sin(state.clock.elapsedTime * 2.4) * 0.005 : 0;

    const currentStep = Math.min(Math.floor(clampedProgress), Math.max(path.length - 1, 0));
    syncVisualState(currentStep, rawT, pickupStep, deliveryStep, cargo, statusStripRef.current);
    syncFollowTarget(agent, followTargetRef);
  });

  return (
    <group ref={agentRef}>
      <group ref={bodyRef} scale={0.94}>
        <RoundedBox args={[0.94, 0.18, 1.28]} radius={0.12} smoothness={6} position={[0, 0.02, 0]}>
          <meshStandardMaterial color="#c43c32" roughness={0.72} metalness={0.18} />
        </RoundedBox>

        <RoundedBox
          args={[0.58, 0.22, 0.54]}
          radius={0.06}
          smoothness={6}
          position={[0, 0.19, -0.08]}
        >
          <meshStandardMaterial color="#d6dde7" roughness={0.28} metalness={0.08} />
        </RoundedBox>

        <RoundedBox
          args={[0.54, 0.04, 0.12]}
          radius={0.03}
          smoothness={4}
          position={[0, 0.1, 0.59]}
        >
          <meshStandardMaterial color="#20262e" roughness={0.88} />
        </RoundedBox>

        <mesh ref={statusStripRef} position={[0, 0.11, 0.6]}>
          <boxGeometry args={[0.36, 0.022, 0.02]} />
          <meshStandardMaterial color="#93c5fd" roughness={0.88} />
        </mesh>

        <RoundedBox
          args={[0.72, 0.05, 0.76]}
          radius={0.03}
          smoothness={4}
          position={[0, 0.08, 0.04]}
        >
          <meshStandardMaterial color="#161b22" roughness={0.42} metalness={0.22} />
        </RoundedBox>

        <RoundedBox
          args={[0.74, 0.11, 0.36]}
          radius={0.04}
          smoothness={4}
          position={[0, 0.13, -0.32]}
        >
          <meshStandardMaterial color="#2b313a" roughness={0.5} metalness={0.14} />
        </RoundedBox>

        <mesh position={[0, 0.11, -0.62]}>
          <boxGeometry args={[0.56, 0.03, 0.04]} />
          <meshStandardMaterial color="#e8edf3" roughness={0.7} />
        </mesh>

        <mesh position={[0, 0.13, 0.66]}>
          <boxGeometry args={[0.52, 0.03, 0.04]} />
          <meshStandardMaterial color="#f4f7fb" roughness={0.68} />
        </mesh>

        <mesh position={[-0.21, 0.18, 0.66]}>
          <boxGeometry args={[0.11, 0.03, 0.03]} />
          <meshStandardMaterial color="#f4f7fb" roughness={0.68} />
        </mesh>

        <mesh position={[0.21, 0.18, 0.66]}>
          <boxGeometry args={[0.11, 0.03, 0.03]} />
          <meshStandardMaterial color="#f4f7fb" roughness={0.68} />
        </mesh>

        <group ref={cargoRef} position={[0, 0.26, -0.02]} scale={[0.001, 0.001, 0.001]}>
          <RoundedBox args={[0.3, 0.16, 0.24]} radius={0.04} smoothness={4}>
            <meshStandardMaterial color="#f2d29c" roughness={0.9} />
          </RoundedBox>
          <mesh position={[0, -0.01, 0]}>
            <boxGeometry args={[0.24, 0.03, 0.26]} />
            <meshStandardMaterial color="#b48651" roughness={0.92} />
          </mesh>
          <mesh position={[0, 0.05, 0.12]}>
            <boxGeometry args={[0.12, 0.03, 0.03]} />
            <meshStandardMaterial color="#93693f" roughness={0.94} />
          </mesh>
        </group>

        {[ 
          [-0.35, -0.07, -0.38],
          [0.35, -0.07, -0.38],
          [-0.35, -0.07, 0.4],
          [0.35, -0.07, 0.4],
        ].map((wheel, index) => (
          <group key={index} position={wheel as [number, number, number]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.1, 0.1, 0.1, 18]} />
              <meshStandardMaterial color="#161b21" roughness={0.94} />
            </mesh>
            <mesh position={[0, 0.025, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.11, 16]} />
              <meshStandardMaterial color="#aab4c1" roughness={0.45} metalness={0.3} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function getLookTarget(
  worldPath: THREE.Vector3[],
  segmentIndex: number,
) {
  const currentPoint = worldPath[segmentIndex] ?? worldPath[0];
  for (let index = segmentIndex + 1; index < worldPath.length; index += 1) {
    if (currentPoint.distanceToSquared(worldPath[index]) > 0.0001) {
      return worldPath[index];
    }
  }
  return currentPoint;
}

function updateHeading(
  agent: THREE.Group,
  currentPoint: THREE.Vector3,
  nextPoint: THREE.Vector3,
  snap: boolean,
  delta = 0,
  quaternion = new THREE.Quaternion(),
) {
  const direction = new THREE.Vector3().subVectors(nextPoint, currentPoint);

  if (direction.lengthSq() < 0.0001) {
    return;
  }

  const yaw = Math.atan2(direction.x, direction.z);
  quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));

  if (snap) {
    agent.quaternion.copy(quaternion);
    return;
  }

  agent.quaternion.slerp(quaternion, 1 - Math.exp(-delta * 10));
}

function syncVisualState(
  currentStep: number,
  segmentT: number,
  pickupStep: number,
  deliveryStep: number,
  cargo: THREE.Group | null,
  statusStrip: THREE.Mesh | null,
) {
  const pickupBlend = pickupStep < 0
    ? 0
    : currentStep < pickupStep
      ? 0
      : currentStep > pickupStep
        ? 1
        : smoothstep(segmentT);
  const cargoLoaded = pickupStep >= 0 && currentStep >= pickupStep;
  const deliveryComplete = deliveryStep >= 0 && currentStep >= deliveryStep;

  if (cargo) {
    const cargoScale = Math.max(pickupBlend, 0.001);
    cargo.scale.setScalar(cargoScale);
  }

  if (!statusStrip) {
    return;
  }

  const material = statusStrip.material as THREE.MeshStandardMaterial;

  if (deliveryComplete) {
    material.color.set("#86efac");
    return;
  }

  if (cargoLoaded) {
    material.color.set("#7dd3a8");
    return;
  }

  material.color.set("#93c5fd");
}

function smoothstep(t: number) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function syncFollowTarget(
  agent: THREE.Group,
  followTargetRef?: MutableRefObject<DeliveryAgentFollowTarget | null>,
) {
  if (!followTargetRef?.current) {
    return;
  }

  followTargetRef.current.position.copy(agent.position);
  followTargetRef.current.quaternion.copy(agent.quaternion);
}
