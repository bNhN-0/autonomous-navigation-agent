from __future__ import annotations

import heapq
from typing import Any, Iterable

from rl.dqn.environment import normalize_map_config

GridPosition = tuple[int, int]
MapConfig = dict[str, Any]


def is_adjacent(a: GridPosition, b: GridPosition) -> bool:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1


def penalty_cost(map_config: MapConfig, cell: GridPosition) -> float:
    for zone in map_config.get("penalty_zones", []):
        if tuple(zone["cell"]) == cell:
            return max(1.0, abs(float(zone.get("penalty", -3))) / 2.0)
    return 0.0


def in_bounds(map_config: MapConfig, cell: GridPosition) -> bool:
    return 0 <= cell[0] < int(map_config["rows"]) and 0 <= cell[1] < int(map_config["cols"])


def astar_path(
    map_config: MapConfig,
    start: GridPosition,
    goal: GridPosition,
    blocked_cells: Iterable[GridPosition] | None = None,
) -> list[list[int]] | None:
    normalized_map = normalize_map_config(map_config)
    obstacles = {tuple(cell) for cell in normalized_map.get("obstacles", [])}
    blocked = set(blocked_cells or [])
    blocked.discard(start)
    blocked.discard(goal)
    if not in_bounds(normalized_map, start) or not in_bounds(normalized_map, goal):
        return None
    if start in obstacles or goal in obstacles or start in blocked or goal in blocked:
        return None

    def heuristic(position: GridPosition) -> int:
        return abs(position[0] - goal[0]) + abs(position[1] - goal[1])

    open_heap: list[tuple[float, float, GridPosition]] = [(heuristic(start), 0.0, start)]
    parents: dict[GridPosition, GridPosition | None] = {start: None}
    g_scores: dict[GridPosition, float] = {start: 0.0}

    while open_heap:
        _, current_cost, current = heapq.heappop(open_heap)
        if current == goal:
            path: list[list[int]] = [[goal[0], goal[1]]]
            cursor = goal
            while parents[cursor] is not None:
                cursor = parents[cursor]
                path.append([cursor[0], cursor[1]])
            path.reverse()
            return path

        if current_cost > g_scores.get(current, float("inf")):
            continue

        for delta_row, delta_col in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            neighbor = (current[0] + delta_row, current[1] + delta_col)
            if not in_bounds(normalized_map, neighbor) or neighbor in obstacles or neighbor in blocked:
                continue

            step_cost = 1.0 + penalty_cost(normalized_map, neighbor)
            next_cost = current_cost + step_cost
            if next_cost >= g_scores.get(neighbor, float("inf")):
                continue

            g_scores[neighbor] = next_cost
            parents[neighbor] = current
            heapq.heappush(
                open_heap,
                (next_cost + heuristic(neighbor), next_cost, neighbor),
            )

    return None


def validate_path(map_config: MapConfig, path: list[list[int]]) -> None:
    normalized_map = normalize_map_config(map_config)
    obstacles = {tuple(cell) for cell in normalized_map.get("obstacles", [])}

    if not path:
        raise ValueError("Planner path is empty.")

    previous: GridPosition | None = None
    for row, col in path:
        cell = (int(row), int(col))
        if not in_bounds(normalized_map, cell):
            raise ValueError("Planner path contains an out-of-bounds cell.")
        if cell in obstacles:
            raise ValueError("Planner path crosses a static obstacle.")
        if previous is not None and not is_adjacent(previous, cell):
            raise ValueError("Planner path must use adjacent transitions.")
        previous = cell


def append_path_segment(
    mission_path: list[list[int]],
    segment: list[list[int]],
) -> None:
    if not segment:
        return
    if not mission_path:
        mission_path.extend(segment)
        return
    mission_path.extend(segment[1:])


def choose_nearest_target(
    map_config: MapConfig,
    current: GridPosition,
    candidates: list[GridPosition],
    blocked_cells: Iterable[GridPosition] | None = None,
) -> tuple[GridPosition, list[list[int]]] | None:
    best_target: GridPosition | None = None
    best_path: list[list[int]] | None = None

    for candidate in candidates:
        path = astar_path(map_config, current, candidate, blocked_cells=blocked_cells)
        if not path:
            continue
        if best_path is None or len(path) < len(best_path):
            best_target = candidate
            best_path = path

    if best_target is None or best_path is None:
        return None
    return best_target, best_path


def build_mission_path(map_config: MapConfig) -> dict[str, list[list[int]]] | None:
    normalized_map = normalize_map_config(map_config)
    start = tuple(normalized_map["start"])
    remaining_pickups = [tuple(cell) for cell in normalized_map["pickups"]]
    remaining_deliveries = [tuple(cell) for cell in normalized_map["deliveries"]]
    ordered_pickups: list[list[int]] = []
    ordered_deliveries: list[list[int]] = []
    target_sequence: list[list[int]] = []
    target_visit_indices: dict[GridPosition, int] = {}
    current = start
    mission_path: list[list[int]] = []
    pickup_phase_path: list[list[int]] = []

    while remaining_pickups:
        blocked_deliveries = {delivery for delivery in remaining_deliveries}
        selected = choose_nearest_target(
            normalized_map,
            current,
            remaining_pickups,
            blocked_cells=blocked_deliveries,
        )
        if selected is None:
            return None
        target, segment = selected
        append_path_segment(mission_path, segment)
        append_path_segment(pickup_phase_path, segment)
        ordered_pickups.append([target[0], target[1]])
        target_sequence.append([target[0], target[1]])
        target_visit_indices[target] = len(mission_path) - 1
        remaining_pickups = [pickup for pickup in remaining_pickups if pickup != target]
        current = target

    delivery_phase_path: list[list[int]] = [[current[0], current[1]]] if mission_path else []
    while remaining_deliveries:
        selected = choose_nearest_target(normalized_map, current, remaining_deliveries)
        if selected is None:
            return None
        target, segment = selected
        append_path_segment(mission_path, segment)
        append_path_segment(delivery_phase_path, segment)
        ordered_deliveries.append([target[0], target[1]])
        target_sequence.append([target[0], target[1]])
        target_visit_indices[target] = len(mission_path) - 1
        remaining_deliveries = [delivery for delivery in remaining_deliveries if delivery != target]
        current = target

    if not mission_path:
        return None
    validate_path(normalized_map, mission_path)

    return {
        "path_to_pickup": pickup_phase_path,
        "path_to_delivery": delivery_phase_path,
        "mission_path": mission_path,
        "ordered_pickups": ordered_pickups,
        "ordered_deliveries": ordered_deliveries,
        "target_sequence": target_sequence,
        "target_visit_indices": {f"{row},{col}": index for (row, col), index in target_visit_indices.items()},
    }
