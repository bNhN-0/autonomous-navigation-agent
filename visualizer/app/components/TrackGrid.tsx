"use client";

import { RoundedBox } from "@react-three/drei";
import { useMemo, useState } from "react";

import { sameCell } from "./customMapValidation";
import { StartPad, StaticObstacleBlock, StationMarker } from "./SceneModels";
import type { CellTool, GridPosition, MapLayout, PenaltyZone } from "./types";

type TrackGridProps = {
  map: MapLayout;
  showPenaltyZones: boolean;
  editorMode?: boolean;
  selectedTool?: CellTool;
  activeDynamicObstacleId?: string | null;
  onCellSelect?: (cell: GridPosition) => void;
};

function gridToWorld(
  [row, col]: GridPosition,
  rows: number,
  cols: number,
): [number, number, number] {
  return [col - cols / 2 + 0.5, 0, row - rows / 2 + 0.5];
}

function isSameCell(a: GridPosition, b: GridPosition) {
  return a[0] === b[0] && a[1] === b[1];
}

function toCellKey([row, col]: GridPosition) {
  return `${row}-${col}`;
}

function penaltyLookupMap(zones: PenaltyZone[]) {
  return new Map(zones.map((zone) => [toCellKey(zone.cell), zone]));
}

function obstacleVariantForCell(cell: GridPosition) {
  const seed = (cell[0] * 31 + cell[1] * 17) % 2;
  return seed === 0 ? "crate" as const : "cabinet" as const;
}

function editorAccent(tool?: CellTool) {
  if (tool === "start" || tool === "pickup") {
    return "#93c5fd";
  }
  if (tool === "delivery") {
    return "#86efac";
  }
  if (tool === "rough") {
    return "#d4a163";
  }
  if (tool === "danger" || tool === "dynamic_path") {
    return "#d9755d";
  }
  if (tool === "clear_dynamic_path") {
    return "#f59e0b";
  }
  if (tool === "obstacle") {
    return "#a1a1aa";
  }
  return "#a1a1aa";
}

export default function TrackGrid({
  map,
  showPenaltyZones,
  editorMode = false,
  selectedTool,
  activeDynamicObstacleId = null,
  onCellSelect,
}: TrackGridProps) {
  const [hoveredCellKey, setHoveredCellKey] = useState<string | null>(null);
  const obstacles = useMemo(
    () => (Array.isArray(map.obstacles) ? map.obstacles : []),
    [map.obstacles],
  );
  const pickups = useMemo(
    () => (Array.isArray(map.pickups) ? map.pickups : (map.pickup ? [map.pickup] : [])),
    [map.pickup, map.pickups],
  );
  const deliveries = useMemo(
    () => (Array.isArray(map.deliveries) ? map.deliveries : (map.delivery ? [map.delivery] : [])),
    [map.deliveries, map.delivery],
  );
  const dynamicObstacles = useMemo(
    () => (Array.isArray(map.dynamic_obstacles) ? map.dynamic_obstacles : []),
    [map.dynamic_obstacles],
  );
  const obstacleKeys = useMemo(() => new Set(obstacles.map(toCellKey)), [obstacles]);
  const penaltyLookup = useMemo(() => penaltyLookupMap(map.penalty_zones ?? []), [map.penalty_zones]);
  const cells = useMemo(() => {
    const nextCells: GridPosition[] = [];
    for (let row = 0; row < map.rows; row += 1) {
      for (let col = 0; col < map.cols; col += 1) {
        nextCells.push([row, col]);
      }
    }
    return nextCells;
  }, [map.cols, map.rows]);
  const hoverColor = editorAccent(selectedTool);

  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.09, 0]}>
        <planeGeometry args={[map.cols + 4, map.rows + 4]} />
        <meshStandardMaterial color="#2a3038" roughness={1} />
      </mesh>

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <planeGeometry args={[map.cols + 1.4, map.rows + 1.4]} />
        <meshStandardMaterial color="#252b33" roughness={1} />
      </mesh>

      {cells.map((cell) => {
        const cellKey = toCellKey(cell);
        const isObstacle = obstacleKeys.has(cellKey);
        const isStart = isSameCell(map.start, cell);
        const isPickup = pickups.some((pickupCell) => isSameCell(pickupCell, cell));
        const isDelivery = deliveries.some((deliveryCell) => isSameCell(deliveryCell, cell));
        const penaltyZone = penaltyLookup.get(cellKey);
        const isPenalty =
          showPenaltyZones && Boolean(penaltyZone) && !isStart && !isPickup && !isDelivery;
        const activeDynamicIndex = dynamicObstacles
          ?.find((obstacle) => obstacle.id === activeDynamicObstacleId)
          ?.path.findIndex((pathCell) => sameCell(pathCell, cell)) ?? -1;
        const hasOtherDynamicPath = dynamicObstacles.some(
          (obstacle) => (
            obstacle.id !== activeDynamicObstacleId
            && obstacle.path.some((pathCell) => sameCell(pathCell, cell))
          ),
        );
        const hasDynamicPath = activeDynamicIndex >= 0 || hasOtherDynamicPath;
        const isHovered = editorMode && hoveredCellKey === cellKey;
        const [x, y, z] = gridToWorld(cell, map.rows, map.cols);

        const tileColor = isStart
          ? "#313947"
          : isPickup
            ? "#344556"
            : isDelivery
              ? "#334536"
              : isPenalty && penaltyZone?.severity === "danger"
                ? "#5a3b3f"
                : isPenalty
                  ? "#5f4c35"
                  : "#343c48";

        const laneColor = isPenalty
          ? penaltyZone?.severity === "danger"
            ? "#8f5f65"
            : "#92704a"
          : "#687487";

        return (
          <group
            key={cellKey}
            position={[x, y, z]}
            onPointerOver={(event) => {
              if (!editorMode) {
                return;
              }
              event.stopPropagation();
              setHoveredCellKey(cellKey);
              document.body.style.cursor = "crosshair";
            }}
            onPointerOut={(event) => {
              if (!editorMode) {
                return;
              }
              event.stopPropagation();
              setHoveredCellKey((current) => (current === cellKey ? null : current));
              document.body.style.cursor = "";
            }}
            onClick={(event) => {
              if (!editorMode || !onCellSelect) {
                return;
              }
              event.stopPropagation();
              onCellSelect(cell);
            }}
          >
            <RoundedBox args={[0.95, 0.05, 0.95]} radius={0.03} smoothness={4} position={[0, 0.025, 0]}>
              <meshStandardMaterial color={tileColor} roughness={0.96} />
            </RoundedBox>

            {!isObstacle && !isStart && !isPickup && !isDelivery && (
              <>
                <mesh position={[0, 0.053, 0]}>
                  <boxGeometry args={[0.54, 0.006, 0.08]} />
                  <meshStandardMaterial color={laneColor} roughness={0.92} />
                </mesh>
                <mesh position={[0, 0.053, 0.22]}>
                  <boxGeometry args={[0.18, 0.006, 0.05]} />
                  <meshStandardMaterial color={laneColor} roughness={0.92} />
                </mesh>
                <mesh position={[0, 0.053, -0.22]}>
                  <boxGeometry args={[0.18, 0.006, 0.05]} />
                  <meshStandardMaterial color={laneColor} roughness={0.92} />
                </mesh>
              </>
            )}

            {hasDynamicPath && (
              <>
                <mesh position={[0, 0.072, 0]}>
                  <cylinderGeometry args={[0.1, 0.1, 0.02, 18]} />
                  <meshStandardMaterial
                    color={activeDynamicIndex >= 0 ? "#d9755d" : "#a9733f"}
                    roughness={0.95}
                  />
                </mesh>
                {activeDynamicIndex >= 0 && (
                  <mesh position={[0, 0.074, 0]}>
                    <ringGeometry args={[0.12, 0.16, 20]} />
                    <meshStandardMaterial color="#f1c89d" roughness={0.9} side={2} />
                  </mesh>
                )}
              </>
            )}

            {isHovered && (
              <mesh position={[0, 0.062, 0]}>
                <boxGeometry args={[0.98, 0.008, 0.98]} />
                <meshStandardMaterial color={hoverColor} transparent opacity={0.35} roughness={1} />
              </mesh>
            )}

            {isObstacle && <StaticObstacleBlock variant={obstacleVariantForCell(cell)} />}
            {isStart && <StartPad />}
            {isPickup && <StationMarker kind="pickup" />}
            {isDelivery && <StationMarker kind="delivery" />}
          </group>
        );
      })}
    </group>
  );
}

export { gridToWorld };
