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
        <RoundedBox args={[0.92, 0.16, 1.12]} radius={0.08} smoothness={6}>
          <meshStandardMaterial color="#d2d8df" roughness={0.96} metalness={0.02} />
        </RoundedBox>

        <RoundedBox
          args={[0.52, 0.18, 0.38]}
          radius={0.06}
          smoothness={6}
          position={[0, 0.16, -0.18]}
        >
          <meshStandardMaterial color="#8a93a0" roughness={0.94} metalness={0.03} />
        </RoundedBox>

        <RoundedBox
          args={[0.56, 0.03, 0.12]}
          radius={0.03}
          smoothness={4}
          position={[0, 0.09, 0.49]}
        >
          <meshStandardMaterial color="#252d37" roughness={0.92} />
        </RoundedBox>

        <mesh ref={statusStripRef} position={[0, 0.1, 0.52]}>
          <boxGeometry args={[0.36, 0.022, 0.02]} />
          <meshStandardMaterial color="#93c5fd" roughness={0.88} />
        </mesh>

        <RoundedBox
          args={[0.54, 0.05, 0.42]}
          radius={0.03}
          smoothness={4}
          position={[0, 0.16, 0.16]}
        >
          <meshStandardMaterial color="#98a2ae" roughness={0.95} />
        </RoundedBox>

        <RoundedBox
          args={[0.66, 0.12, 0.38]}
          radius={0.04}
          smoothness={4}
          position={[0, 0.12, 0.17]}
        >
          <meshStandardMaterial color="#6f7886" roughness={0.97} />
        </RoundedBox>

        <mesh position={[0, 0.16, -0.42]}>
          <boxGeometry args={[0.4, 0.02, 0.03]} />
          <meshStandardMaterial color="#e2e7ec" roughness={0.9} />
        </mesh>

        <mesh position={[0, 0.19, -0.28]}>
          <boxGeometry args={[0.26, 0.015, 0.02]} />
          <meshStandardMaterial color="#5b6574" roughness={0.92} />
        </mesh>

        <group ref={cargoRef} position={[0, 0.28, 0.18]} scale={[0.001, 0.001, 0.001]}>
          <RoundedBox args={[0.34, 0.18, 0.28]} radius={0.04} smoothness={4}>
            <meshStandardMaterial color="#f1d7a1" roughness={0.92} />
          </RoundedBox>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.26, 0.03, 0.3]} />
            <meshStandardMaterial color="#b78b57" roughness={0.94} />
          </mesh>
          <mesh position={[0, 0.06, 0.14]}>
            <boxGeometry args={[0.14, 0.04, 0.03]} />
            <meshStandardMaterial color="#9a744a" roughness={0.94} />
          </mesh>
        </group>

        {[ 
          [-0.34, -0.07, -0.32],
          [0.34, -0.07, -0.32],
          [-0.34, -0.07, 0.3],
          [0.34, -0.07, 0.3],
        ].map((wheel, index) => (
          <group key={index} position={wheel as [number, number, number]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.085, 0.085, 0.08, 16]} />
              <meshStandardMaterial color="#1d232b" roughness={0.95} />
            </mesh>
            <mesh position={[0, 0.025, 0]}>
              <boxGeometry args={[0.12, 0.05, 0.14]} />
              <meshStandardMaterial color="#444d59" roughness={0.95} />
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
