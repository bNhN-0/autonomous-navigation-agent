"use client";

import { RoundedBox, Text } from "@react-three/drei";

type Variant = "crate" | "cabinet";
type StationKind = "start" | "pickup" | "delivery";
type DynamicKind = "person" | "cart" | "service_robot" | "forklift";

const COLORS = {
  floorMark: "#555f6d",
  bodyLight: "#d7d9dc",
  bodyMid: "#aeb6c2",
  bodyDark: "#454d59",
  wheelDark: "#1d232b",
  sensorDark: "#252d37",
  pickup: "#93c5fd",
  delivery: "#86efac",
  start: "#cbd5e1",
  rough: "#a37a4c",
  danger: "#a85b61",
  crate: "#6c5a4a",
  cabinet: "#58616f",
  barrier: "#4d5865",
  steel: "#8d99a8",
  charcoal: "#39424d",
  softPanel: "#7f8997",
  softPanelDark: "#687281",
} as const;

export function StartPad() {
  return (
    <group position={[0, 0.09, 0]}>
      <RoundedBox args={[0.54, 0.06, 0.54]} radius={0.04} smoothness={4}>
        <meshStandardMaterial color="#4d5a68" roughness={0.96} />
      </RoundedBox>
      <RoundedBox args={[0.28, 0.02, 0.28]} radius={0.02} smoothness={4} position={[0, 0.045, 0]}>
        <meshStandardMaterial color={COLORS.start} roughness={0.9} />
      </RoundedBox>
      <Text
        position={[0, 0.14, 0]}
        fontSize={0.08}
        color="#f4f4f5"
        anchorX="center"
        anchorY="middle"
      >
        Start
      </Text>
    </group>
  );
}

export function StationMarker({ kind }: { kind: StationKind }) {
  const accent = kind === "pickup" ? COLORS.pickup : kind === "delivery" ? COLORS.delivery : COLORS.start;
  const label = kind === "pickup" ? "Pickup" : kind === "delivery" ? "Delivery" : "Start";

  if (kind === "pickup") {
    return (
      <group position={[0, 0.08, 0]}>
        <RoundedBox args={[0.62, 0.06, 0.62]} radius={0.04} smoothness={4}>
          <meshStandardMaterial color="#344556" roughness={0.96} />
        </RoundedBox>
        <RoundedBox args={[0.26, 0.14, 0.26]} radius={0.03} smoothness={4} position={[0, 0.11, 0.06]}>
          <meshStandardMaterial color={COLORS.softPanel} roughness={0.9} />
        </RoundedBox>
        <RoundedBox args={[0.22, 0.12, 0.18]} radius={0.02} smoothness={4} position={[0, 0.2, 0.06]}>
          <meshStandardMaterial color={accent} roughness={0.9} />
        </RoundedBox>
        <mesh position={[0, 0.12, -0.14]}>
          <boxGeometry args={[0.08, 0.18, 0.08]} />
          <meshStandardMaterial color="#5f6c7a" roughness={0.92} />
        </mesh>
        <mesh position={[0, 0.23, -0.14]}>
          <boxGeometry args={[0.22, 0.06, 0.04]} />
          <meshStandardMaterial color={accent} roughness={0.9} />
        </mesh>
        <Text position={[0, 0.34, 0]} fontSize={0.08} color="#f4f4f5" anchorX="center" anchorY="middle">
          {label}
        </Text>
      </group>
    );
  }

  if (kind === "delivery") {
    return (
      <group position={[0, 0.08, 0]}>
        <RoundedBox args={[0.72, 0.06, 0.6]} radius={0.04} smoothness={4}>
          <meshStandardMaterial color="#334536" roughness={0.96} />
        </RoundedBox>
        <RoundedBox args={[0.52, 0.04, 0.4]} radius={0.03} smoothness={4} position={[0, 0.05, 0]}>
          <meshStandardMaterial color={accent} roughness={0.9} />
        </RoundedBox>
        <mesh position={[0, 0.16, -0.2]}>
          <boxGeometry args={[0.56, 0.22, 0.05]} />
          <meshStandardMaterial color="#5d6a60" roughness={0.92} />
        </mesh>
        <mesh position={[0, 0.16, 0]}>
          <boxGeometry args={[0.3, 0.08, 0.26]} />
          <meshStandardMaterial color={COLORS.softPanelDark} roughness={0.92} />
        </mesh>
        <Text position={[0, 0.33, 0]} fontSize={0.08} color="#f4f4f5" anchorX="center" anchorY="middle">
          {label}
        </Text>
      </group>
    );
  }

  return <StartPad />;
}

export function StaticObstacleBlock({ variant }: { variant: Variant }) {
  if (variant === "crate") {
    return (
      <group position={[0, 0.39, 0]}>
        <RoundedBox args={[0.74, 0.34, 0.74]} radius={0.03} smoothness={4}>
          <meshStandardMaterial color={COLORS.crate} roughness={0.97} />
        </RoundedBox>
        <RoundedBox args={[0.66, 0.28, 0.66]} radius={0.03} smoothness={4} position={[0, 0.28, 0]}>
          <meshStandardMaterial color="#7b6857" roughness={0.97} />
        </RoundedBox>
        <mesh position={[0, 0.09, 0]}>
          <boxGeometry args={[0.76, 0.03, 0.76]} />
          <meshStandardMaterial color="#9b846f" roughness={0.96} />
        </mesh>
        <mesh position={[0, 0.39, 0]}>
          <boxGeometry args={[0.68, 0.03, 0.68]} />
          <meshStandardMaterial color="#9b846f" roughness={0.96} />
        </mesh>
      </group>
    );
  }

  if (variant === "cabinet") {
    return (
      <group position={[0, 0.42, 0]}>
        <RoundedBox args={[0.78, 0.8, 0.46]} radius={0.04} smoothness={4}>
          <meshStandardMaterial color={COLORS.cabinet} roughness={0.96} />
        </RoundedBox>
        <mesh position={[0, 0.1, 0.24]}>
          <boxGeometry args={[0.7, 0.54, 0.03]} />
          <meshStandardMaterial color={COLORS.softPanelDark} roughness={0.96} />
        </mesh>
        <mesh position={[0, 0.28, 0.255]}>
          <boxGeometry args={[0.7, 0.025, 0.02]} />
          <meshStandardMaterial color="#818b99" roughness={0.94} />
        </mesh>
        <mesh position={[0, -0.02, 0.255]}>
          <boxGeometry args={[0.7, 0.025, 0.02]} />
          <meshStandardMaterial color="#818b99" roughness={0.94} />
        </mesh>
      </group>
    );
  }

  return null;
}

export function DynamicObstacleModel({
  kind,
  color,
}: {
  kind: DynamicKind;
  color?: string;
}) {
  if (kind === "person") {
    return (
      <group>
        <mesh position={[0, 0.42, 0]}>
          <sphereGeometry args={[0.085, 16, 16]} />
          <meshStandardMaterial color="#d7d9dc" roughness={0.88} />
        </mesh>
        <RoundedBox args={[0.22, 0.26, 0.14]} radius={0.03} smoothness={4} position={[0, 0.22, 0]}>
          <meshStandardMaterial color={color ?? "#7b8794"} roughness={0.9} />
        </RoundedBox>
        <mesh position={[-0.05, 0.06, 0]}>
          <boxGeometry args={[0.06, 0.18, 0.06]} />
          <meshStandardMaterial color={COLORS.charcoal} roughness={0.94} />
        </mesh>
        <mesh position={[0.05, 0.06, 0]}>
          <boxGeometry args={[0.06, 0.18, 0.06]} />
          <meshStandardMaterial color={COLORS.charcoal} roughness={0.94} />
        </mesh>
        <mesh position={[0, 0.27, 0.08]}>
          <boxGeometry args={[0.16, 0.03, 0.03]} />
          <meshStandardMaterial color="#b3bac5" roughness={0.9} />
        </mesh>
      </group>
    );
  }

  if (kind === "cart") {
    return (
      <group>
        <RoundedBox args={[0.48, 0.16, 0.7]} radius={0.04} smoothness={4} position={[0, 0.11, 0]}>
          <meshStandardMaterial color={color ?? "#738091"} roughness={0.94} />
        </RoundedBox>
        <RoundedBox args={[0.38, 0.1, 0.34]} radius={0.03} smoothness={4} position={[0, 0.23, 0.03]}>
          <meshStandardMaterial color="#959fac" roughness={0.93} />
        </RoundedBox>
        <mesh position={[0, 0.18, -0.22]}>
          <boxGeometry args={[0.32, 0.03, 0.04]} />
          <meshStandardMaterial color="#5f6875" roughness={0.93} />
        </mesh>
        {[
          [-0.17, -0.02, -0.22],
          [0.17, -0.02, -0.22],
          [-0.17, -0.02, 0.22],
          [0.17, -0.02, 0.22],
        ].map((wheel, index) => (
          <mesh key={index} position={wheel as [number, number, number]}>
            <cylinderGeometry args={[0.05, 0.05, 0.03, 14]} />
            <meshStandardMaterial color={COLORS.wheelDark} roughness={0.95} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === "forklift") {
    return (
      <group>
        <RoundedBox args={[0.42, 0.18, 0.58]} radius={0.04} smoothness={4} position={[0, 0.11, 0]}>
          <meshStandardMaterial color={color ?? "#6f7b88"} roughness={0.94} />
        </RoundedBox>
        <RoundedBox args={[0.22, 0.18, 0.2]} radius={0.03} smoothness={4} position={[0, 0.27, -0.1]}>
          <meshStandardMaterial color="#8f98a5" roughness={0.92} />
        </RoundedBox>
        <mesh position={[0, 0.28, 0.21]}>
          <boxGeometry args={[0.18, 0.32, 0.03]} />
          <meshStandardMaterial color={COLORS.steel} roughness={0.92} />
        </mesh>
        <mesh position={[0, 0.08, 0.31]}>
          <boxGeometry args={[0.22, 0.02, 0.16]} />
          <meshStandardMaterial color={COLORS.steel} roughness={0.92} />
        </mesh>
        <mesh position={[0, 0.18, -0.18]}>
          <boxGeometry args={[0.26, 0.02, 0.03]} />
          <meshStandardMaterial color="#d6dce3" roughness={0.9} />
        </mesh>
      </group>
    );
  }

  return (
      <group>
      <RoundedBox args={[0.42, 0.16, 0.48]} radius={0.05} smoothness={4} position={[0, 0.1, 0]}>
        <meshStandardMaterial color={color ?? "#6e7f90"} roughness={0.94} />
      </RoundedBox>
      <RoundedBox args={[0.18, 0.12, 0.16]} radius={0.03} smoothness={4} position={[0, 0.22, -0.08]}>
        <meshStandardMaterial color="#97a1ad" roughness={0.92} />
      </RoundedBox>
      <mesh position={[0, 0.11, 0.24]}>
        <boxGeometry args={[0.28, 0.03, 0.04]} />
        <meshStandardMaterial color={COLORS.sensorDark} roughness={0.9} />
      </mesh>
      {[
        [-0.15, -0.01, -0.14],
        [0.15, -0.01, -0.14],
        [-0.15, -0.01, 0.14],
        [0.15, -0.01, 0.14],
      ].map((wheel, index) => (
        <mesh key={index} position={wheel as [number, number, number]}>
          <cylinderGeometry args={[0.045, 0.045, 0.03, 14]} />
          <meshStandardMaterial color={COLORS.wheelDark} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}
