"use client";

import { useMemo } from "react";
import * as THREE from "three";

import { DynamicObstacleModel } from "./SceneModels";
import { gridToWorld } from "./TrackGrid";
import type {
  DynamicObstacle,
  DynamicObstacleTimelineFrame,
  GridPosition,
  MapLayout,
} from "./types";

type DynamicObstaclesProps = {
  map: MapLayout;
  timeline?: DynamicObstacleTimelineFrame[] | null;
  visualProgress?: number;
};

const EMPTY_OBSTACLES: DynamicObstacle[] = [];

export default function DynamicObstacles({
  map,
  timeline = null,
  visualProgress = 0,
}: DynamicObstaclesProps) {
  const obstacles = map.dynamic_obstacles ?? EMPTY_OBSTACLES;
  const obstacleLookup = useMemo(
    () => new Map(obstacles.map((obstacle) => [obstacle.id, obstacle])),
    [obstacles],
  );
  const interpolatedSnapshots = useMemo(() => {
    if (!timeline?.length) {
      return null;
    }

    const maxIndex = Math.max(timeline.length - 1, 0);
    const clampedProgress = THREE.MathUtils.clamp(visualProgress, 0, maxIndex);
    const currentIndex = Math.floor(clampedProgress);
    const nextIndex = Math.min(currentIndex + 1, maxIndex);
    const segmentT = smoothstep(clampedProgress - currentIndex);
    const currentFrame = timeline[currentIndex] ?? timeline[0];
    const nextFrame = timeline[nextIndex] ?? currentFrame;
    const snapshotIds = new Set([
      ...currentFrame.obstacles.map((obstacle) => obstacle.id),
      ...nextFrame.obstacles.map((obstacle) => obstacle.id),
    ]);

    return [...snapshotIds].map((id) => {
      const startSnapshot = currentFrame.obstacles.find((obstacle) => obstacle.id === id);
      const endSnapshot = nextFrame.obstacles.find((obstacle) => obstacle.id === id) ?? startSnapshot;
      if (!startSnapshot || !endSnapshot) {
        return null;
      }

      const position: GridPosition = [
        lerp(startSnapshot.position[0], endSnapshot.position[0], segmentT),
        lerp(startSnapshot.position[1], endSnapshot.position[1], segmentT),
      ];

      return {
        id,
        position,
        direction: [
          endSnapshot.position[0] - startSnapshot.position[0],
          endSnapshot.position[1] - startSnapshot.position[1],
        ] as [number, number],
      };
    }).filter(Boolean) as Array<{
      id: string;
      position: GridPosition;
      direction: [number, number];
    }>;
  }, [timeline, visualProgress]);

  if (obstacles.length === 0) {
    return null;
  }

  if (interpolatedSnapshots) {
    return (
      <group>
        {interpolatedSnapshots.map((snapshot) => {
          const obstacle = obstacleLookup.get(snapshot.id);

          if (!obstacle) {
            return null;
          }

          return (
            <ObstacleInstance
              key={snapshot.id}
              map={map}
              obstacle={obstacle}
              cell={snapshot.position}
              direction={snapshot.direction}
            />
          );
        })}
      </group>
    );
  }

  return (
    <group>
      {obstacles.map((obstacle) => (
        <MovingObstacle
          key={obstacle.id}
          map={map}
          obstacle={obstacle}
          visualProgress={visualProgress}
        />
      ))}
    </group>
  );
}

function ObstacleInstance({
  map,
  obstacle,
  cell,
  direction,
}: {
  map: MapLayout;
  obstacle: DynamicObstacle;
  cell: [number, number];
  direction: [number, number];
}) {
  const [x, y, z] = gridToWorld(cell, map.rows, map.cols);
  const yaw = direction[0] === 0 && direction[1] === 0
    ? 0
    : Math.atan2(direction[1], direction[0]) - Math.PI / 2;

  return (
    <group position={[x, y + 0.15, z]} rotation={[0, yaw, 0]}>
      <ObstacleModel obstacle={obstacle} />
    </group>
  );
}

function MovingObstacle({
  map,
  obstacle,
  visualProgress,
}: {
  map: MapLayout;
  obstacle: DynamicObstacle;
  visualProgress: number;
}) {
  const worldPath = useMemo(() => {
    const points = obstacle.path.map((cell) => {
      const [x, y, z] = gridToWorld(cell, map.rows, map.cols);
      return new THREE.Vector3(x, y + 0.15, z);
    });

    if (points.length <= 1) {
      return points;
    }

    if (points.length === 2) {
      return [points[0], points[1], points[0]];
    }

    return [...points, ...points.slice(1, -1).reverse()];
  }, [map.cols, map.rows, obstacle.path]);

  const playback = useMemo(() => {
    if (worldPath.length === 0) {
      return null;
    }

    if (worldPath.length === 1) {
      return {
        position: worldPath[0],
        rotationY: 0,
      };
    }

    const cycleLength = worldPath.length;
    const loopProgress = visualProgress % cycleLength;
    const currentIndex = Math.floor(loopProgress);
    const nextIndex = (currentIndex + 1) % cycleLength;
    const segmentT = smoothstep(loopProgress - currentIndex);
    const currentPoint = worldPath[currentIndex];
    const nextPoint = worldPath[nextIndex];
    const position = new THREE.Vector3().lerpVectors(currentPoint, nextPoint, segmentT);
    const direction = new THREE.Vector3().subVectors(nextPoint, currentPoint);
    const rotationY = direction.lengthSq() > 0.0001
      ? Math.atan2(direction.x, direction.z)
      : 0;

    return {
      position,
      rotationY,
    };
  }, [visualProgress, worldPath]);

  if (!playback) {
    return null;
  }

  return (
    <group position={playback.position} rotation={[0, playback.rotationY, 0]}>
      <ObstacleModel obstacle={obstacle} />
    </group>
  );
}

function ObstacleModel({ obstacle }: { obstacle: DynamicObstacle }) {
  const modelKind = obstacle.kind === "person"
    ? "person"
    : obstacle.kind === "cart"
      ? "cart"
      : obstacle.kind === "blocker"
        ? "forklift"
        : "service_robot";

  return <DynamicObstacleModel kind={modelKind} color={obstacle.color} />;
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function smoothstep(t: number) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
