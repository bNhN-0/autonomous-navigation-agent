import type { CustomMapConfig, DynamicObstacle, GridPosition } from "./types";

export function cellKey([row, col]: GridPosition) {
  return `${row}-${col}`;
}

export function sameCell(
  a: GridPosition | null | undefined,
  b: GridPosition | null | undefined,
) {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}

export function isAdjacentCell(a: GridPosition, b: GridPosition) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
}

export function isCellInBounds(mapConfig: CustomMapConfig, cell: GridPosition) {
  return (
    cell[0] >= 0
    && cell[0] < mapConfig.rows
    && cell[1] >= 0
    && cell[1] < mapConfig.cols
  );
}

export function isReservedCell(mapConfig: CustomMapConfig, cell: GridPosition) {
  return (
    sameCell(mapConfig.start, cell)
    || mapConfig.pickups.some((pickupCell) => sameCell(pickupCell, cell))
    || mapConfig.deliveries.some((deliveryCell) => sameCell(deliveryCell, cell))
  );
}

export function findDynamicObstacleAtCell(
  mapConfig: CustomMapConfig,
  cell: GridPosition,
  excludeObstacleId?: string,
) {
  return (
    mapConfig.dynamic_obstacles.find((obstacle) => (
      obstacle.id !== excludeObstacleId
      && obstacle.path.some((pathCell) => sameCell(pathCell, cell))
    )) ?? null
  );
}

export function validateDynamicObstaclePath(
  mapConfig: CustomMapConfig,
  obstacle: DynamicObstacle,
) {
  if (obstacle.path.length < 2) {
    return "Dynamic obstacle path must include at least 2 cells.";
  }

  const obstacleKeys = new Set(mapConfig.obstacles.map(cellKey));

  for (const cell of obstacle.path) {
    if (!isCellInBounds(mapConfig, cell)) {
      return "Dynamic obstacle path is outside map bounds.";
    }

    if (obstacleKeys.has(cellKey(cell))) {
      return "Dynamic obstacle path cannot cross static obstacles.";
    }

    if (isReservedCell(mapConfig, cell)) {
      return "Dynamic obstacle path cannot pass through start, pickup, or delivery zones.";
    }
  }

  for (let index = 1; index < obstacle.path.length; index += 1) {
    if (!isAdjacentCell(obstacle.path[index - 1], obstacle.path[index])) {
      return "Dynamic obstacle path must use connected cells.";
    }
  }

  return null;
}

export function bfsPath(
  mapConfig: CustomMapConfig,
  start: GridPosition,
  goal: GridPosition,
) {
  const queue: GridPosition[] = [start];
  const visited = new Set<string>([cellKey(start)]);
  const obstacleKeys = new Set(mapConfig.obstacles.map(cellKey));

  while (queue.length > 0) {
    const [row, col] = queue.shift()!;

    if (row === goal[0] && col === goal[1]) {
      return true;
    }

    for (const [deltaRow, deltaCol] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nextCell: GridPosition = [row + deltaRow, col + deltaCol];
      const nextKey = cellKey(nextCell);

      if (
        !isCellInBounds(mapConfig, nextCell)
        || obstacleKeys.has(nextKey)
        || visited.has(nextKey)
      ) {
        continue;
      }

      visited.add(nextKey);
      queue.push(nextCell);
    }
  }

  return false;
}

export function isMissionReachable(mapConfig: CustomMapConfig) {
  if (!mapConfig.start || mapConfig.pickups.length === 0 || mapConfig.deliveries.length === 0) {
    return false;
  }
  if (mapConfig.pickups.length !== 1 || mapConfig.deliveries.length !== 1) {
    return false;
  }

  const current = mapConfig.start;
  const pickup = mapConfig.pickups[0];
  const delivery = mapConfig.deliveries[0];
  return bfsPath(mapConfig, current, pickup) && bfsPath(mapConfig, pickup, delivery);
}

export function validateCustomMap(mapConfig: CustomMapConfig) {
  const errors = new Set<string>();
  const obstacleKeys = new Set(mapConfig.obstacles.map(cellKey));
  const dynamicLabelSet = new Set<string>();

  if (!mapConfig.start) {
    errors.add("Place a start cell before running Planner-Guided DQN.");
  }
  if (mapConfig.pickups.length === 0) {
    errors.add("Place at least one pickup cell before running Planner-Guided DQN.");
  } else if (mapConfig.pickups.length > 1) {
    errors.add("Use exactly one pickup cell.");
  }
  if (mapConfig.deliveries.length === 0) {
    errors.add("Place at least one delivery cell before running Planner-Guided DQN.");
  } else if (mapConfig.deliveries.length > 1) {
    errors.add("Use exactly one delivery cell.");
  }

  if (mapConfig.start && obstacleKeys.has(cellKey(mapConfig.start))) {
    errors.add("Start cannot overlap a static obstacle.");
  }
  if (mapConfig.pickups.some((pickup) => obstacleKeys.has(cellKey(pickup)))) {
    errors.add("Pickup cannot overlap a static obstacle.");
  }
  if (mapConfig.deliveries.some((delivery) => obstacleKeys.has(cellKey(delivery)))) {
    errors.add("Delivery cannot overlap a static obstacle.");
  }

  if (
    mapConfig.start
    && (
      mapConfig.pickups.some((pickup) => sameCell(mapConfig.start, pickup))
      || mapConfig.deliveries.some((delivery) => sameCell(mapConfig.start, delivery))
      || mapConfig.pickups.some((pickup) => mapConfig.deliveries.some((delivery) => sameCell(pickup, delivery)))
    )
  ) {
    errors.add("Start, pickups, and deliveries must occupy different cells.");
  }

  for (const obstacle of mapConfig.dynamic_obstacles) {
    const normalizedLabel = (obstacle.label ?? "").trim().replace(/\s+/g, " ");

    if (!normalizedLabel) {
      errors.add("Each dynamic obstacle must have a name.");
    } else {
      const labelKey = normalizedLabel.toLowerCase();
      if (dynamicLabelSet.has(labelKey)) {
        errors.add("Dynamic obstacle names must be unique.");
      }
      dynamicLabelSet.add(labelKey);
    }

    const pathError = validateDynamicObstaclePath(mapConfig, obstacle);
    if (pathError) {
      errors.add(pathError);
    }
  }

  if (
    mapConfig.start
    && isMissionReachable(mapConfig) === false
  ) {
    errors.add("The current custom layout does not have a valid start -> pickup -> delivery route.");
  }

  return [...errors];
}
