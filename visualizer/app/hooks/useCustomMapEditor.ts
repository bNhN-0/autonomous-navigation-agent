"use client";

import { useMemo, useState } from "react";

import {
  findDynamicObstacleAtCell,
  isAdjacentCell,
  sameCell,
} from "../components/customMapValidation";
import type {
  CellTool,
  CustomMapConfig,
  DynamicObstacle,
  GridPosition,
  PenaltyZone,
} from "../components/types";

const DYNAMIC_DEFAULTS = {
  person: { label: "Moving Person", color: "#ef4444" },
  cart: { label: "Service Cart", color: "#f59e0b" },
  blocker: { label: "Moving Blocker", color: "#a1a1aa" },
} satisfies Record<NonNullable<DynamicObstacle["kind"]>, { label: string; color: string }>;

function samePenalty(a: PenaltyZone, cell: GridPosition) {
  return a.cell[0] === cell[0] && a.cell[1] === cell[1];
}

function cloneMapConfig(mapConfig: CustomMapConfig): CustomMapConfig {
  return {
    ...mapConfig,
    start: mapConfig.start ? [...mapConfig.start] as GridPosition : null,
    pickups: mapConfig.pickups.map((cell) => [...cell] as GridPosition),
    deliveries: mapConfig.deliveries.map((cell) => [...cell] as GridPosition),
    pickup: mapConfig.pickup ? [...mapConfig.pickup] as GridPosition : null,
    delivery: mapConfig.delivery ? [...mapConfig.delivery] as GridPosition : null,
    obstacles: mapConfig.obstacles.map((cell) => [...cell] as GridPosition),
    penalty_zones: mapConfig.penalty_zones.map((zone) => ({
      ...zone,
      cell: [...zone.cell] as GridPosition,
    })),
    dynamic_obstacles: mapConfig.dynamic_obstacles.map((obstacle) => ({
      ...obstacle,
      path: obstacle.path.map((cell) => [...cell] as GridPosition),
    })),
  };
}

function createDynamicObstacleId(obstacles: DynamicObstacle[]) {
  let index = obstacles.length + 1;
  while (obstacles.some((obstacle) => obstacle.id === `custom-dynamic-${index}`)) {
    index += 1;
  }
  return `custom-dynamic-${index}`;
}

function toolDisplayLabel(tool: "start" | "pickup" | "delivery") {
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

export function resizeCustomMap(
  mapConfig: CustomMapConfig,
  rows: number,
  cols: number,
): CustomMapConfig {
  const inBounds = (cell: GridPosition | null) =>
    Boolean(cell && cell[0] < rows && cell[1] < cols);

  return {
    ...mapConfig,
    rows,
    cols,
    start: inBounds(mapConfig.start) ? mapConfig.start : null,
    pickups: mapConfig.pickups.filter((cell) => cell[0] < rows && cell[1] < cols),
    deliveries: mapConfig.deliveries.filter((cell) => cell[0] < rows && cell[1] < cols),
    pickup: inBounds(mapConfig.pickup) ? mapConfig.pickup : null,
    delivery: inBounds(mapConfig.delivery) ? mapConfig.delivery : null,
    obstacles: mapConfig.obstacles.filter((cell) => cell[0] < rows && cell[1] < cols),
    penalty_zones: mapConfig.penalty_zones.filter(
      (zone) => zone.cell[0] < rows && zone.cell[1] < cols,
    ),
    dynamic_obstacles: mapConfig.dynamic_obstacles.filter((obstacle) =>
      obstacle.path.every((cell) => cell[0] < rows && cell[1] < cols),
    ),
  };
}

export type CustomMapEditorController = {
  selectedTool: CellTool;
  setSelectedTool: (tool: CellTool) => void;
  activeDynamicObstacleId: string | null;
  setSelectedDynamicObstacleId: (id: string | null) => void;
  activeDynamicObstacle: DynamicObstacle | null;
  editorMessage: string | null;
  setEditorMessage: (message: string | null) => void;
  applyCellTool: (cell: GridPosition) => void;
  handleRowsChange: (rows: number) => void;
  handleColsChange: (cols: number) => void;
  handleAddDynamicObstacle: () => void;
  handleDynamicKindChange: (kind: NonNullable<DynamicObstacle["kind"]>) => void;
  handleClearSelectedPath: () => void;
  handleRemoveSelectedObstacle: () => void;
  updateSelectedDynamicObstacle: (updater: (obstacle: DynamicObstacle) => DynamicObstacle) => void;
};

export function useCustomMapEditor(
  mapConfig: CustomMapConfig,
  onMapChange: (mapConfig: CustomMapConfig) => void,
): CustomMapEditorController {
  const [selectedTool, setSelectedToolState] = useState<CellTool>("obstacle");
  const [selectedDynamicObstacleId, setSelectedDynamicObstacleId] = useState<string | null>(
    mapConfig.dynamic_obstacles[0]?.id ?? null,
  );
  const [editorMessage, setEditorMessage] = useState<string | null>(null);

  const activeDynamicObstacleId = useMemo(() => {
    if (
      selectedDynamicObstacleId
      && mapConfig.dynamic_obstacles.some((obstacle) => obstacle.id === selectedDynamicObstacleId)
    ) {
      return selectedDynamicObstacleId;
    }

    return mapConfig.dynamic_obstacles[0]?.id ?? null;
  }, [mapConfig.dynamic_obstacles, selectedDynamicObstacleId]);

  const activeDynamicObstacle = useMemo(
    () => mapConfig.dynamic_obstacles.find((obstacle) => obstacle.id === activeDynamicObstacleId) ?? null,
    [activeDynamicObstacleId, mapConfig.dynamic_obstacles],
  );

  const setSelectedTool = (tool: CellTool) => {
    setSelectedToolState(tool);
    setEditorMessage(null);

    if (
      (tool === "dynamic_path" || tool === "clear_dynamic_path")
      && !activeDynamicObstacleId
      && mapConfig.dynamic_obstacles[0]
    ) {
      setSelectedDynamicObstacleId(mapConfig.dynamic_obstacles[0].id);
    }
  };

  const updateSelectedDynamicObstacle = (
    updater: (obstacle: DynamicObstacle) => DynamicObstacle,
  ) => {
    if (!activeDynamicObstacleId) {
      return;
    }

    const nextMap = cloneMapConfig(mapConfig);
    const obstacleIndex = nextMap.dynamic_obstacles.findIndex(
      (obstacle) => obstacle.id === activeDynamicObstacleId,
    );

    if (obstacleIndex < 0) {
      return;
    }

    nextMap.dynamic_obstacles[obstacleIndex] = updater(nextMap.dynamic_obstacles[obstacleIndex]);
    onMapChange(nextMap);
  };

  const applyCellTool = (cell: GridPosition) => {
    const nextMap = cloneMapConfig(mapConfig);
    const isStart = sameCell(mapConfig.start, cell);
    const isPickup = mapConfig.pickups.some((pickupCell) => sameCell(pickupCell, cell));
    const isDelivery = mapConfig.deliveries.some((deliveryCell) => sameCell(deliveryCell, cell));
    const obstacleIndex = nextMap.obstacles.findIndex(
      (obstacle) => obstacle[0] === cell[0] && obstacle[1] === cell[1],
    );
    const penaltyIndex = nextMap.penalty_zones.findIndex((zone) => samePenalty(zone, cell));
    const dynamicObstacleAtCell = findDynamicObstacleAtCell(mapConfig, cell);
    const fail = (message: string) => {
      setEditorMessage(message);
    };

    const removeObstacle = () => {
      if (obstacleIndex >= 0) {
        nextMap.obstacles.splice(obstacleIndex, 1);
      }
    };

    const removePenalty = () => {
      if (penaltyIndex >= 0) {
        nextMap.penalty_zones.splice(penaltyIndex, 1);
      }
    };

    setEditorMessage(null);

    if (selectedTool === "road") {
      if (!isStart && !isPickup && !isDelivery) {
        removeObstacle();
        removePenalty();
      }
      onMapChange(nextMap);
      return;
    }

    if (selectedTool === "clear") {
      if (dynamicObstacleAtCell) {
        fail("This cell is used by a dynamic obstacle path.");
        return;
      }
      removeObstacle();
      removePenalty();
      if (isStart) {
        nextMap.start = null;
      }
      if (isPickup) {
        nextMap.pickups = nextMap.pickups.filter((pickupCell) => !sameCell(pickupCell, cell));
        nextMap.pickup = nextMap.pickups[0] ?? null;
      }
      if (isDelivery) {
        nextMap.deliveries = nextMap.deliveries.filter((deliveryCell) => !sameCell(deliveryCell, cell));
        nextMap.delivery = nextMap.deliveries[0] ?? null;
      }
      onMapChange(nextMap);
      return;
    }

    if (selectedTool === "obstacle") {
      if (dynamicObstacleAtCell) {
        fail("This cell is used by a dynamic obstacle path.");
        return;
      }
      if (isStart || isPickup || isDelivery) {
        fail("Static obstacles cannot replace start, pickup, or delivery cells.");
        return;
      }
      removePenalty();
      if (obstacleIndex >= 0) {
        nextMap.obstacles.splice(obstacleIndex, 1);
      } else {
        nextMap.obstacles.push(cell);
      }
      onMapChange(nextMap);
      return;
    }

    if (selectedTool === "rough" || selectedTool === "danger") {
      if (isStart || isPickup || isDelivery) {
        fail("Penalty zones cannot replace start, pickup, or delivery cells.");
        return;
      }
      if (obstacleIndex >= 0) {
        fail("Penalty zones cannot be placed on static obstacles.");
        return;
      }
      removePenalty();
      nextMap.penalty_zones.push({
        cell,
        penalty: selectedTool === "danger" ? -10 : -3,
        label: selectedTool === "danger" ? "Danger Zone" : "Rough Zone",
        severity: selectedTool === "danger" ? "danger" : "crowded",
        type: selectedTool === "danger" ? "danger" : "crowded",
      });
      onMapChange(nextMap);
      return;
    }

    if (selectedTool === "dynamic_path") {
      if (!activeDynamicObstacleId) {
        fail("Add or select a dynamic obstacle before drawing its path.");
        return;
      }
      if (obstacleIndex >= 0) {
        fail("Dynamic obstacle path cannot cross static obstacles.");
        return;
      }
      if (isStart || isPickup || isDelivery) {
        fail("Dynamic obstacle path cannot pass through start, pickup, or delivery zones.");
        return;
      }

      const dynamicObstacleIndex = nextMap.dynamic_obstacles.findIndex(
        (obstacle) => obstacle.id === activeDynamicObstacleId,
      );
      if (dynamicObstacleIndex < 0) {
        fail("Select an active dynamic obstacle before drawing its path.");
        return;
      }

      const currentPath = nextMap.dynamic_obstacles[dynamicObstacleIndex].path;
      const lastCell = currentPath[currentPath.length - 1];
      if (lastCell && !isAdjacentCell(lastCell, cell)) {
        fail("Dynamic obstacle path must use connected cells.");
        return;
      }

      currentPath.push(cell);
      onMapChange(nextMap);
      return;
    }

    if (selectedTool === "clear_dynamic_path") {
      if (!activeDynamicObstacleId) {
        fail("Select a dynamic obstacle before trimming its path.");
        return;
      }

      const dynamicObstacleIndex = nextMap.dynamic_obstacles.findIndex(
        (obstacle) => obstacle.id === activeDynamicObstacleId,
      );
      if (dynamicObstacleIndex < 0) {
        fail("Select a dynamic obstacle before trimming its path.");
        return;
      }

      const currentPath = nextMap.dynamic_obstacles[dynamicObstacleIndex].path;
      const pathIndex = currentPath.findIndex((pathCell) => sameCell(pathCell, cell));
      if (pathIndex < 0) {
        fail("Select a cell from the active dynamic obstacle path to trim it.");
        return;
      }

      nextMap.dynamic_obstacles[dynamicObstacleIndex].path = currentPath.slice(0, pathIndex);
      onMapChange(nextMap);
      return;
    }

    if (selectedTool === "start" || selectedTool === "pickup" || selectedTool === "delivery") {
      const label = toolDisplayLabel(selectedTool);

      if (dynamicObstacleAtCell) {
        fail(`${label} cannot be placed on a dynamic obstacle path.`);
        return;
      }
      if (obstacleIndex >= 0) {
        fail(`${label} cannot be placed on a static obstacle.`);
        return;
      }

      removePenalty();

      if (selectedTool === "start") {
        nextMap.start = cell;
      } else if (selectedTool === "pickup") {
        nextMap.pickups = [cell];
        nextMap.pickup = cell;
      } else {
        nextMap.deliveries = [cell];
        nextMap.delivery = cell;
      }

      onMapChange(nextMap);
    }
  };

  const handleRowsChange = (rows: number) => {
    onMapChange(resizeCustomMap(mapConfig, rows, mapConfig.cols));
  };

  const handleColsChange = (cols: number) => {
    onMapChange(resizeCustomMap(mapConfig, mapConfig.rows, cols));
  };

  const handleAddDynamicObstacle = () => {
    const nextId = createDynamicObstacleId(mapConfig.dynamic_obstacles);
    const nextMap = cloneMapConfig(mapConfig);

    nextMap.dynamic_obstacles.push({
      id: nextId,
      label: DYNAMIC_DEFAULTS.person.label,
      kind: "person",
      path: [],
      speed: 1,
      color: DYNAMIC_DEFAULTS.person.color,
    });

    setSelectedDynamicObstacleId(nextId);
    setSelectedToolState("dynamic_path");
    setEditorMessage("Draw at least two connected cells for the new dynamic obstacle path.");
    onMapChange(nextMap);
  };

  const handleDynamicKindChange = (kind: NonNullable<DynamicObstacle["kind"]>) => {
    updateSelectedDynamicObstacle((obstacle) => {
      const previousKind = obstacle.kind ?? "person";
      const currentDefaults = DYNAMIC_DEFAULTS[previousKind];
      const nextDefaults = DYNAMIC_DEFAULTS[kind];

      return {
        ...obstacle,
        kind,
        label: !obstacle.label || obstacle.label === currentDefaults.label
          ? nextDefaults.label
          : obstacle.label,
        color: !obstacle.color || obstacle.color === currentDefaults.color
          ? nextDefaults.color
          : obstacle.color,
      };
    });
  };

  const handleClearSelectedPath = () => {
    updateSelectedDynamicObstacle((obstacle) => ({
      ...obstacle,
      path: [],
    }));
    setEditorMessage("The active dynamic obstacle path has been cleared.");
  };

  const handleRemoveSelectedObstacle = () => {
    if (!activeDynamicObstacleId) {
      return;
    }

    const nextMap = cloneMapConfig(mapConfig);
    nextMap.dynamic_obstacles = nextMap.dynamic_obstacles.filter(
      (obstacle) => obstacle.id !== activeDynamicObstacleId,
    );
    onMapChange(nextMap);
    setEditorMessage(null);
  };

  return {
    selectedTool,
    setSelectedTool,
    activeDynamicObstacleId,
    setSelectedDynamicObstacleId,
    activeDynamicObstacle,
    editorMessage,
    setEditorMessage,
    applyCellTool,
    handleRowsChange,
    handleColsChange,
    handleAddDynamicObstacle,
    handleDynamicKindChange,
    handleClearSelectedPath,
    handleRemoveSelectedObstacle,
    updateSelectedDynamicObstacle,
  };
}
