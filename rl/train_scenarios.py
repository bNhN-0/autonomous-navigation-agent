from __future__ import annotations

"""Legacy Q-learning baseline exporter kept for development reference only.

The final user-facing simulator now uses Planner-Guided DQN for preset and
custom-map replay. This module remains in the repository only as an earlier
baseline experiment and export utility.
"""

import json
import math
from collections import Counter, deque
from dataclasses import dataclass
from pathlib import Path
import sys
from typing import Any, Callable

import numpy as np
import pandas as pd

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from rl.dqn.environment import (
    normalize_map_config,
    validate_dynamic_obstacles as validate_map_dynamic_obstacles,
)

SEED = 12345
WAIT_ACTION = 4
WAIT_PENALTY = -2.0
ACTIONS: dict[int, tuple[int, int]] = {
    0: (-1, 0),  # up
    1: (1, 0),   # down
    2: (0, -1),  # left
    3: (0, 1),   # right
    WAIT_ACTION: (0, 0),  # wait
}
MOVE_ACTIONS = tuple(action for action in ACTIONS if action != WAIT_ACTION)
ACTION_COUNT = len(ACTIONS)
OUTPUT_ROOT = Path(__file__).resolve().parent / "outputs" / "scenarios"
ROLLING_WINDOW = 100
EVALUATION_EPISODES = 48

GridPosition = tuple[int, int]
StateTuple = tuple[int, int, int, int]
ActionSelector = Callable[["DeliveryEnvironment", StateTuple, np.random.Generator], int]


def empty_grid(rows: int, cols: int) -> list[list[int]]:
    return [[0 for _ in range(cols)] for _ in range(rows)]


def fill_rect(
    grid: list[list[int]],
    top: int,
    left: int,
    bottom: int,
    right: int,
    value: int = 1,
) -> None:
    for row in range(top, bottom + 1):
        for col in range(left, right + 1):
            grid[row][col] = value


def polyline_path(*points: GridPosition) -> list[list[int]]:
    if len(points) < 2:
        return [list(points[0])] if points else []

    path: list[GridPosition] = [points[0]]

    for start, end in zip(points, points[1:]):
        if start[0] == end[0]:
            step = 1 if end[1] > start[1] else -1
            segment = [(start[0], col) for col in range(start[1] + step, end[1] + step, step)]
        elif start[1] == end[1]:
            step = 1 if end[0] > start[0] else -1
            segment = [(row, start[1]) for row in range(start[0] + step, end[0] + step, step)]
        else:
            raise ValueError(f"Polyline segment must be axis-aligned: {start} -> {end}")

        path.extend(segment)

    return [list(cell) for cell in path]


def penalty_zone(
    row: int,
    col: int,
    penalty: int,
    label: str,
    severity: str,
) -> dict[str, Any]:
    return {
        "cell": [row, col],
        "penalty": penalty,
        "label": label,
        "severity": severity,
    }


def dynamic_obstacle(
    obstacle_id: str,
    label: str,
    kind: str,
    path: list[list[int]],
    speed: int,
    color: str,
) -> dict[str, Any]:
    return {
        "id": obstacle_id,
        "label": label,
        "kind": kind,
        "path": path,
        "speed": speed,
        "color": color,
    }


def scenario_to_map_config(scenario: dict[str, Any]) -> dict[str, Any]:
    grid = np.array(scenario["grid"], dtype=np.int8)
    return {
        "rows": int(grid.shape[0]),
        "cols": int(grid.shape[1]),
        "start": list(scenario["start"]),
        "pickup": list(scenario["pickup"]),
        "delivery": list(scenario["delivery"]),
        "obstacles": [[int(row), int(col)] for row, col in np.argwhere(grid == 1)],
        "penalty_zones": scenario.get("penalty_zones", []),
        "dynamic_obstacles": scenario.get("dynamic_obstacles", []),
    }
 

def validate_scenario_dynamic_obstacles(
    scenario_id: str,
    scenario: dict[str, Any],
) -> None:
    try:
        validate_map_dynamic_obstacles(scenario_to_map_config(scenario))
    except ValueError as error:
        raise ValueError(f"{scenario_id}: {error}") from error


def validate_scenario_map_config(
    scenario_id: str,
    scenario: dict[str, Any],
) -> None:
    try:
        normalize_map_config(scenario_to_map_config(scenario))
    except ValueError as error:
        raise ValueError(f"{scenario_id}: {error}") from error


def build_food_court_grid() -> list[list[int]]:
    grid = empty_grid(12, 15)

    for top, left, bottom, right in [
        (2, 2, 3, 3),
        (2, 6, 3, 7),
        (2, 10, 3, 11),
        (6, 2, 7, 3),
        (6, 6, 7, 7),
        (6, 10, 7, 11),
        (9, 4, 9, 5),
        (9, 8, 9, 10),
    ]:
        fill_rect(grid, top, left, bottom, right)

    return grid


def build_warehouse_cargo_grid() -> list[list[int]]:
    rows, cols = 17, 20
    grid = empty_grid(rows, cols)
    shelf_rows = [(1, 4), (6, 9), (11, 14)]
    shelf_cols = [(2, 3), (6, 7), (10, 11), (14, 15)]

    for top, bottom in shelf_rows:
        for left, right in shelf_cols:
            fill_rect(grid, top, left, bottom, right)

    for top, left, bottom, right in [
        (2, 18, 4, 18),
        (12, 18, 14, 18),
    ]:
        fill_rect(grid, top, left, bottom, right)

    return grid


def build_mall_delivery_grid() -> list[list[int]]:
    grid = empty_grid(15, 19)

    for top, left, bottom, right in [
        (1, 1, 3, 3),
        (1, 6, 3, 8),
        (1, 11, 3, 13),
        (5, 2, 7, 4),
        (5, 7, 7, 10),
        (5, 13, 7, 16),
        (9, 1, 11, 3),
        (9, 6, 11, 8),
        (9, 11, 11, 13),
    ]:
        fill_rect(grid, top, left, bottom, right)

    return grid


def build_crowded_corridor_grid() -> list[list[int]]:
    rows, cols = 12, 16
    grid = empty_grid(rows, cols)

    wall_specs = {
        3: {1, 10},
        7: {4},
        11: {1, 8, 10},
    }

    for col, gaps in wall_specs.items():
        for row in range(rows):
            if row not in gaps:
                grid[row][col] = 1

    for row, left, right, gaps in [
        (2, 4, 10, {8}),
        (6, 4, 13, {6, 12}),
        (9, 8, 14, {11}),
    ]:
        for col in range(left, right + 1):
            if col not in gaps:
                grid[row][col] = 1

    return grid


SCENARIOS: dict[str, dict[str, Any]] = {
    "food_court": {
        "name": "Food Court Delivery",
        "grid": build_food_court_grid(),
        "start": (10, 1),
        "pickup": (1, 12),
        "delivery": (10, 13),
        "penalty_zones": [
            penalty_zone(4, 4, -3, "Lunch queue", "crowded"),
            penalty_zone(4, 5, -3, "Lunch queue", "crowded"),
            penalty_zone(4, 6, -3, "Lunch queue", "crowded"),
            penalty_zone(4, 7, -3, "Tray traffic", "crowded"),
            penalty_zone(5, 7, -3, "Tray traffic", "crowded"),
            penalty_zone(8, 6, -10, "Spill hazard", "danger"),
        ],
        "dynamic_obstacles": [
            dynamic_obstacle(
                "server-cart",
                "Service Cart",
                "cart",
                polyline_path((4, 1), (4, 13)),
                1,
                "#f97316",
            ),
            dynamic_obstacle(
                "customer-flow",
                "Customer Flow",
                "person",
                polyline_path((1, 14), (10, 14)),
                1,
                "#fb7185",
            ),
        ],
        "training": {
            "min_episodes": 3400,
            "max_episodes": 6800,
            "max_steps": 220,
            "alpha": 0.24,
            "gamma": 0.987,
            "epsilon_min": 0.04,
            "target_success_rate": 0.88,
        },
    },
    "warehouse_cargo": {
        "name": "Warehouse Cargo",
        "grid": build_warehouse_cargo_grid(),
        "start": (15, 1),
        "pickup": (2, 17),
        "delivery": (15, 18),
        "penalty_zones": [
            penalty_zone(5, 4, -3, "Forklift crossing", "crowded"),
            penalty_zone(5, 8, -3, "Forklift crossing", "crowded"),
            penalty_zone(5, 12, -3, "Forklift crossing", "crowded"),
            penalty_zone(10, 8, -3, "Inventory merge", "crowded"),
            penalty_zone(10, 12, -3, "Inventory merge", "crowded"),
            penalty_zone(10, 16, -10, "Loading hazard", "danger"),
        ],
        "dynamic_obstacles": [
            dynamic_obstacle(
                "forklift-east",
                "Forklift",
                "cart",
                polyline_path((5, 1), (5, 18)),
                1,
                "#f97316",
            ),
            dynamic_obstacle(
                "forklift-south",
                "Forklift",
                "cart",
                polyline_path((10, 1), (10, 18)),
                1,
                "#fb923c",
            ),
        ],
        "training": {
            "min_episodes": 5200,
            "max_episodes": 9600,
            "max_steps": 320,
            "alpha": 0.22,
            "gamma": 0.989,
            "epsilon_min": 0.05,
            "target_success_rate": 0.84,
        },
    },
    "mall_delivery": {
        "name": "Mall Delivery",
        "grid": build_mall_delivery_grid(),
        "start": (13, 1),
        "pickup": (2, 15),
        "delivery": (12, 17),
        "penalty_zones": [
            penalty_zone(4, 9, -3, "Escalator queue", "crowded"),
            penalty_zone(8, 5, -3, "Atrium traffic", "crowded"),
            penalty_zone(8, 6, -3, "Atrium traffic", "crowded"),
            penalty_zone(8, 7, -3, "Atrium traffic", "crowded"),
            penalty_zone(8, 11, -3, "Atrium traffic", "crowded"),
            penalty_zone(12, 9, -10, "Wet floor", "danger"),
        ],
        "dynamic_obstacles": [
            dynamic_obstacle(
                "mall-crowd",
                "Pedestrian Group",
                "person",
                polyline_path((4, 10), (4, 16)),
                1,
                "#f472b6",
            ),
            dynamic_obstacle(
                "cleaning-cart",
                "Cleaning Cart",
                "cart",
                polyline_path((9, 14), (13, 14)),
                1,
                "#fb923c",
            ),
        ],
        "training": {
            "min_episodes": 5200,
            "max_episodes": 9800,
            "max_steps": 300,
            "alpha": 0.22,
            "gamma": 0.989,
            "epsilon_min": 0.05,
            "target_success_rate": 0.86,
        },
    },
    "crowded_corridor": {
        "name": "Crowded Corridor",
        "grid": build_crowded_corridor_grid(),
        "start": (10, 1),
        "pickup": (1, 13),
        "delivery": (10, 14),
        "penalty_zones": [
            penalty_zone(0, 4, -3, "Foot traffic", "crowded"),
            penalty_zone(0, 5, -3, "Foot traffic", "crowded"),
            penalty_zone(0, 6, -3, "Foot traffic", "crowded"),
            penalty_zone(1, 8, -10, "Blocked shortcut", "danger"),
            penalty_zone(0, 8, -10, "Blocked shortcut", "danger"),
            penalty_zone(4, 8, -3, "Narrow merge", "crowded"),
            penalty_zone(7, 12, -10, "Maintenance zone", "danger"),
            penalty_zone(8, 12, -3, "Foot traffic", "crowded"),
            penalty_zone(10, 8, -3, "Queue spillover", "crowded"),
        ],
        "dynamic_obstacles": [
            dynamic_obstacle(
                "hallway-runner",
                "Moving Blocker",
                "blocker",
                polyline_path((8, 8), (8, 15)),
                2,
                "#f97316",
            ),
            dynamic_obstacle(
                "pedestrian-surge",
                "Pedestrian Surge",
                "person",
                polyline_path((1, 15), (10, 15)),
                1,
                "#fb7185",
            ),
        ],
        "training": {
            "min_episodes": 5800,
            "max_episodes": 10400,
            "max_steps": 340,
            "alpha": 0.23,
            "gamma": 0.99,
            "epsilon_min": 0.06,
            "target_success_rate": 0.82,
        },
    },
}


@dataclass
class RolloutResult:
    path: list[GridPosition]
    actions: list[int]
    time_phases: list[int]
    dynamic_obstacle_timeline: list[dict[str, Any]]
    path_length: int
    reached_pickup: bool
    reached_delivery: bool
    completed_delivery: bool
    total_reward: float
    pickup_step: int
    delivery_step: int
    penalty_zone_visits: int
    collisions: int
    wait_count: int
    dynamic_collision_count: int


def build_dynamic_cycle(path: list[list[int]], speed: int) -> list[GridPosition]:
    positions = [tuple(cell) for cell in path]
    dwell = max(1, int(speed))

    if not positions:
        return []

    if len(positions) == 1:
        motion = positions
    elif len(positions) == 2:
        motion = [positions[0], positions[1], positions[0]]
    else:
        motion = positions + list(reversed(positions[1:-1]))

    cycle: list[GridPosition] = []
    for position in motion:
        cycle.extend([position] * dwell)

    return cycle


def lcm_all(values: list[int]) -> int:
    result = 1
    for value in values:
        result = math.lcm(result, value)
    return max(result, 1)


class DeliveryEnvironment:
    def __init__(self, scenario: dict[str, Any]) -> None:
        self.grid = np.array(scenario["grid"], dtype=np.int8)
        self.start = tuple(scenario["start"])
        self.pickup = tuple(scenario["pickup"])
        self.delivery = tuple(scenario["delivery"])
        self.penalty_zones = list(scenario["penalty_zones"])
        self.penalty_lookup = {
            tuple(zone["cell"]): zone for zone in self.penalty_zones
        }
        self.dynamic_obstacles = list(scenario.get("dynamic_obstacles", []))
        self.dynamic_cycles = {
            obstacle["id"]: build_dynamic_cycle(
                obstacle["path"],
                int(obstacle.get("speed", 1)),
            )
            for obstacle in self.dynamic_obstacles
        }
        self.cycle_length = lcm_all(
            [len(cycle) for cycle in self.dynamic_cycles.values() if cycle]
        )
        self.training = scenario["training"]
        self.rows, self.cols = self.grid.shape
        self.position = self.start
        self.has_pickup = False
        self.time_phase = 0

    def reset(self) -> StateTuple:
        self.position = self.start
        self.has_pickup = False
        self.time_phase = 0
        return self.state_tuple()

    def state_tuple(self) -> StateTuple:
        return self.position[0], self.position[1], int(self.has_pickup), self.time_phase

    def is_valid_position(self, row: int, col: int) -> bool:
        if row < 0 or row >= self.rows or col < 0 or col >= self.cols:
            return False
        return self.grid[row, col] == 0

    def state_to_index(self, state: StateTuple) -> int:
        row, col, has_pickup, time_phase = state
        return ((((row * self.cols) + col) * 2 + has_pickup) * self.cycle_length) + time_phase

    def target_for_state(self, has_pickup: int) -> GridPosition:
        return self.delivery if has_pickup else self.pickup

    def penalty_for_position(self, position: GridPosition) -> int:
        zone = self.penalty_lookup.get(position)
        if zone:
            return int(zone["penalty"])
        return -1

    def wait_penalty_for_position(self, position: GridPosition) -> float:
        return float(min(int(WAIT_PENALTY), self.penalty_for_position(position)))

    def next_time_phase(self, time_phase: int | None = None) -> int:
        phase = self.time_phase if time_phase is None else time_phase
        return (phase + 1) % self.cycle_length

    def dynamic_positions_at(self, time_phase: int) -> dict[str, GridPosition]:
        positions: dict[str, GridPosition] = {}
        for obstacle in self.dynamic_obstacles:
            cycle = self.dynamic_cycles.get(obstacle["id"], [])
            if not cycle:
                continue
            positions[obstacle["id"]] = cycle[time_phase % len(cycle)]
        return positions

    def dynamic_collision_for_move(
        self,
        current_position: GridPosition,
        next_position: GridPosition,
        current_time_phase: int,
        next_time_phase: int,
    ) -> bool:
        current_positions = self.dynamic_positions_at(current_time_phase)
        next_positions = self.dynamic_positions_at(next_time_phase)

        for obstacle_id, obstacle_next in next_positions.items():
            if obstacle_next == next_position:
                return True

            obstacle_current = current_positions.get(obstacle_id)
            if (
                obstacle_current is not None
                and obstacle_current == next_position
                and obstacle_next == current_position
            ):
                return True

        return False

    def current_timeline_frame(self, step: int) -> dict[str, Any]:
        positions = self.dynamic_positions_at(self.time_phase)
        obstacles = [
            {
                "id": obstacle["id"],
                "position": [int(positions[obstacle["id"]][0]), int(positions[obstacle["id"]][1])],
            }
            for obstacle in self.dynamic_obstacles
            if obstacle["id"] in positions
        ]
        return {
            "step": step,
            "obstacles": obstacles,
        }

    def step(self, action: int) -> tuple[StateTuple, float, bool, dict[str, int]]:
        row, col = self.position
        current_phase = self.time_phase
        next_phase = self.next_time_phase()
        move_row, move_col = ACTIONS[action]
        next_row = row + move_row
        next_col = col + move_col
        wait_action = int(action == WAIT_ACTION)

        event = {
            "collision": 0,
            "dynamic_collision": 0,
            "penalty_zone_visit": 0,
            "reached_pickup": int(self.has_pickup),
            "reached_delivery": 0,
            "completed_delivery": 0,
            "wait": wait_action,
        }

        if action != WAIT_ACTION and not self.is_valid_position(next_row, next_col):
            self.time_phase = next_phase
            event["collision"] = 1
            return self.state_tuple(), -100.0, False, event

        next_position = self.position if action == WAIT_ACTION else (next_row, next_col)

        if self.dynamic_collision_for_move(self.position, next_position, current_phase, next_phase):
            self.time_phase = next_phase
            event["collision"] = 1
            event["dynamic_collision"] = 1
            return self.state_tuple(), -100.0, False, event

        self.position = next_position
        self.time_phase = next_phase
        reward = (
            self.wait_penalty_for_position(self.position)
            if action == WAIT_ACTION
            else float(self.penalty_for_position(self.position))
        )
        event["penalty_zone_visit"] = int(self.position in self.penalty_lookup)
        event["reached_delivery"] = int(self.position == self.delivery)

        if not self.has_pickup and self.position == self.pickup:
            self.has_pickup = True
            reward += 30.0

        event["reached_pickup"] = int(self.has_pickup)

        if self.position == self.delivery:
            if self.has_pickup:
                reward += 100.0
                event["completed_delivery"] = 1
            else:
                reward = -5.0

        return self.state_tuple(), reward, bool(event["completed_delivery"]), event


def validate_delivery_path(
    scenario_id: str,
    grid: list[list[int]],
    start: GridPosition,
    pickup: GridPosition,
    delivery: GridPosition,
) -> tuple[int, int]:
    path_to_pickup = bfs_path(grid, start, pickup)
    path_to_delivery = bfs_path(grid, pickup, delivery)

    if not path_to_pickup or not path_to_delivery:
        raise ValueError(
            f"{scenario_id} does not have a valid delivery route from start to pickup to delivery."
        )

    return len(path_to_pickup) - 1, len(path_to_delivery) - 1


def bfs_path(
    grid: list[list[int]],
    start: GridPosition,
    goal: GridPosition,
) -> list[GridPosition] | None:
    rows = len(grid)
    cols = len(grid[0])
    queue = deque([start])
    parents: dict[GridPosition, GridPosition | None] = {start: None}

    while queue:
        state = queue.popleft()
        if state == goal:
            path = [goal]
            cursor = goal
            while parents[cursor] is not None:
                cursor = parents[cursor]
                path.append(cursor)
            return list(reversed(path))

        row, col = state
        for delta_row, delta_col in (ACTIONS[action] for action in MOVE_ACTIONS):
            next_row = row + delta_row
            next_col = col + delta_col
            next_state = (next_row, next_col)

            if not (0 <= next_row < rows and 0 <= next_col < cols):
                continue
            if grid[next_row][next_col] == 1:
                continue
            if next_state in parents:
                continue

            parents[next_state] = state
            queue.append(next_state)

    return None


def combine_paths(*paths: list[GridPosition]) -> list[GridPosition]:
    combined: list[GridPosition] = []
    for path in paths:
        if not path:
            continue
        if not combined:
            combined.extend(path)
        else:
            combined.extend(path[1:])
    return combined


def epsilon_for_episode(episode: int, max_episodes: int, epsilon_min: float) -> float:
    exploration_span = max(1, int(max_episodes * 0.82))
    progress = min(episode / exploration_span, 1.0)
    return max(epsilon_min, 1.0 - progress * (1.0 - epsilon_min))


def projected_priority(
    env: DeliveryEnvironment,
    state: StateTuple,
    action: int,
) -> tuple[int, int, int, int, int]:
    row, col, has_pickup, time_phase = state
    next_phase = env.next_time_phase(time_phase)
    wait_rank = int(action == WAIT_ACTION)
    delta_row, delta_col = ACTIONS[action]
    next_row = row + delta_row
    next_col = col + delta_col

    if action != WAIT_ACTION and not env.is_valid_position(next_row, next_col):
        return 3, 3, wait_rank, 999, action

    next_position = (row, col) if action == WAIT_ACTION else (next_row, next_col)
    if env.dynamic_collision_for_move((row, col), next_position, time_phase, next_phase):
        return 2, 3, wait_rank, 999, action

    zone = env.penalty_lookup.get(next_position)
    penalty_rank = 0
    if zone:
        penalty_rank = 2 if int(zone["penalty"]) <= -10 else 1

    target = env.target_for_state(has_pickup)
    distance = abs(next_position[0] - target[0]) + abs(next_position[1] - target[1])
    return 0, penalty_rank, wait_rank, distance, action


def greedy_action(
    env: DeliveryEnvironment,
    state: StateTuple,
    q_values: np.ndarray,
) -> int:
    best_value = float(np.max(q_values))
    best_actions = np.flatnonzero(np.isclose(q_values, best_value))

    if len(best_actions) == 1:
        return int(best_actions[0])

    ranked_actions = sorted(
        (int(action) for action in best_actions),
        key=lambda action: projected_priority(env, state, action),
    )
    return ranked_actions[0]


def select_action(
    env: DeliveryEnvironment,
    state: StateTuple,
    q_table: np.ndarray,
    epsilon: float,
    rng: np.random.Generator,
) -> int:
    if rng.random() < epsilon:
        return int(rng.integers(ACTION_COUNT))

    return greedy_action(env, state, q_table[env.state_to_index(state)])


def action_from_transition(current: GridPosition, nxt: GridPosition) -> int:
    delta = (nxt[0] - current[0], nxt[1] - current[1])
    for action in MOVE_ACTIONS:
        if ACTIONS[action] == delta:
            return action
    raise ValueError(f"Invalid transition from {current} to {nxt}")


def rollout_with_policy(
    scenario: dict[str, Any],
    max_steps: int,
    action_selector: ActionSelector,
    rng: np.random.Generator,
) -> RolloutResult:
    env = DeliveryEnvironment(scenario)
    state = env.reset()
    path = [env.position]
    actions: list[int] = []
    time_phases = [env.time_phase]
    timeline = [env.current_timeline_frame(0)]
    total_reward = 0.0
    reached_pickup = False
    reached_delivery = False
    completed_delivery = False
    pickup_step = -1
    delivery_step = -1
    penalty_zone_visits = 0
    collisions = 0
    wait_count = 0
    dynamic_collision_count = 0

    for step_index in range(1, max_steps + 1):
        action = action_selector(env, state, rng)
        state, reward, done, event = env.step(action)

        actions.append(action)
        path.append(env.position)
        time_phases.append(env.time_phase)
        timeline.append(env.current_timeline_frame(step_index))
        total_reward += reward
        penalty_zone_visits += event["penalty_zone_visit"]
        collisions += event["collision"]
        wait_count += event["wait"]
        dynamic_collision_count += event["dynamic_collision"]
        reached_pickup = reached_pickup or bool(event["reached_pickup"])
        reached_delivery = reached_delivery or bool(event["reached_delivery"])
        completed_delivery = completed_delivery or bool(event["completed_delivery"])

        if event["reached_pickup"] and pickup_step < 0:
            pickup_step = step_index
        if event["reached_delivery"] and delivery_step < 0:
            delivery_step = step_index

        if done:
            break

    return RolloutResult(
        path=path,
        actions=actions,
        time_phases=time_phases,
        dynamic_obstacle_timeline=timeline,
        path_length=len(actions),
        reached_pickup=reached_pickup,
        reached_delivery=reached_delivery,
        completed_delivery=completed_delivery,
        total_reward=round(total_reward, 3),
        pickup_step=pickup_step,
        delivery_step=delivery_step,
        penalty_zone_visits=penalty_zone_visits,
        collisions=collisions,
        wait_count=wait_count,
        dynamic_collision_count=dynamic_collision_count,
    )


def rollout_with_action_sequence(
    scenario: dict[str, Any],
    action_sequence: list[int],
    max_steps: int,
) -> RolloutResult:
    env = DeliveryEnvironment(scenario)
    env.reset()
    path = [env.position]
    actions: list[int] = []
    time_phases = [env.time_phase]
    timeline = [env.current_timeline_frame(0)]
    total_reward = 0.0
    reached_pickup = False
    reached_delivery = False
    completed_delivery = False
    pickup_step = -1
    delivery_step = -1
    penalty_zone_visits = 0
    collisions = 0
    wait_count = 0
    dynamic_collision_count = 0

    for step_index, action in enumerate(action_sequence[:max_steps], start=1):
        _, reward, done, event = env.step(action)

        actions.append(action)
        path.append(env.position)
        time_phases.append(env.time_phase)
        timeline.append(env.current_timeline_frame(step_index))
        total_reward += reward
        penalty_zone_visits += event["penalty_zone_visit"]
        collisions += event["collision"]
        wait_count += event["wait"]
        dynamic_collision_count += event["dynamic_collision"]
        reached_pickup = reached_pickup or bool(event["reached_pickup"])
        reached_delivery = reached_delivery or bool(event["reached_delivery"])
        completed_delivery = completed_delivery or bool(event["completed_delivery"])

        if event["reached_pickup"] and pickup_step < 0:
            pickup_step = step_index
        if event["reached_delivery"] and delivery_step < 0:
            delivery_step = step_index

        if done:
            break

    return RolloutResult(
        path=path,
        actions=actions,
        time_phases=time_phases,
        dynamic_obstacle_timeline=timeline,
        path_length=len(actions),
        reached_pickup=reached_pickup,
        reached_delivery=reached_delivery,
        completed_delivery=completed_delivery,
        total_reward=round(total_reward, 3),
        pickup_step=pickup_step,
        delivery_step=delivery_step,
        penalty_zone_visits=penalty_zone_visits,
        collisions=collisions,
        wait_count=wait_count,
        dynamic_collision_count=dynamic_collision_count,
    )


def build_shortest_delivery_actions(scenario: dict[str, Any]) -> list[int]:
    path_to_pickup = bfs_path(
        scenario["grid"],
        tuple(scenario["start"]),
        tuple(scenario["pickup"]),
    )
    path_to_delivery = bfs_path(
        scenario["grid"],
        tuple(scenario["pickup"]),
        tuple(scenario["delivery"]),
    )

    if not path_to_pickup or not path_to_delivery:
        return []

    full_path = combine_paths(path_to_pickup, path_to_delivery)
    return [
        action_from_transition(full_path[index], full_path[index + 1])
        for index in range(len(full_path) - 1)
    ]


def aggregate_comparison_metrics(results: list[RolloutResult]) -> dict[str, float]:
    episode_count = max(1, len(results))
    return {
        "success_rate": round(
            sum(1 for result in results if result.completed_delivery) / episode_count,
            3,
        ),
        "average_reward": round(
            sum(result.total_reward for result in results) / episode_count,
            3,
        ),
        "average_steps": round(
            sum(result.path_length for result in results) / episode_count,
            3,
        ),
        "collision_count": int(sum(result.collisions for result in results)),
        "penalty_zone_visits": int(sum(result.penalty_zone_visits for result in results)),
        "pickup_success_rate": round(
            sum(1 for result in results if result.reached_pickup) / episode_count,
            3,
        ),
        "delivery_success_rate": round(
            sum(1 for result in results if result.reached_delivery) / episode_count,
            3,
        ),
    }


def pick_representative_rollout(results: list[RolloutResult]) -> RolloutResult:
    successful = [result for result in results if result.completed_delivery]
    candidates = successful if successful else results
    return max(
        candidates,
        key=lambda result: (
            result.total_reward,
            -result.collisions,
            -result.wait_count,
            -result.path_length,
        ),
    )


def evaluate_q_learning_policy(
    scenario: dict[str, Any],
    q_table: np.ndarray,
) -> tuple[dict[str, float], RolloutResult]:
    def policy(
        env: DeliveryEnvironment,
        state: StateTuple,
        _: np.random.Generator,
    ) -> int:
        return greedy_action(env, state, q_table[env.state_to_index(state)])

    rng = np.random.default_rng(SEED + 700)
    results = [
        rollout_with_policy(
            scenario=scenario,
            max_steps=int(scenario["training"]["max_steps"]),
            action_selector=policy,
            rng=rng,
        )
        for _ in range(EVALUATION_EPISODES)
    ]

    return aggregate_comparison_metrics(results), pick_representative_rollout(results)


def evaluate_random_policy(
    scenario: dict[str, Any],
) -> tuple[dict[str, float], RolloutResult]:
    def policy(
        _: DeliveryEnvironment,
        __: StateTuple,
        rng: np.random.Generator,
    ) -> int:
        return int(rng.integers(ACTION_COUNT))

    rng = np.random.default_rng(SEED + 900)
    results = [
        rollout_with_policy(
            scenario=scenario,
            max_steps=int(scenario["training"]["max_steps"]),
            action_selector=policy,
            rng=rng,
        )
        for _ in range(EVALUATION_EPISODES)
    ]

    return aggregate_comparison_metrics(results), pick_representative_rollout(results)


def evaluate_shortest_path_policy(
    scenario: dict[str, Any],
) -> tuple[dict[str, float] | None, RolloutResult | None]:
    action_sequence = build_shortest_delivery_actions(scenario)
    if not action_sequence:
        return None, None

    results = [
        rollout_with_action_sequence(
            scenario=scenario,
            action_sequence=action_sequence,
            max_steps=int(scenario["training"]["max_steps"]),
        )
        for _ in range(EVALUATION_EPISODES)
    ]

    return aggregate_comparison_metrics(results), pick_representative_rollout(results)


def train_scenario(
    scenario_id: str,
    scenario: dict[str, Any],
) -> tuple[pd.DataFrame, np.ndarray, RolloutResult, float]:
    env = DeliveryEnvironment(scenario)
    training = scenario["training"]
    q_table = np.zeros(
        (env.rows * env.cols * 2 * env.cycle_length, ACTION_COUNT),
        dtype=np.float32,
    )
    metrics: list[dict[str, float | int]] = []
    rolling_success_rate = 0.0
    rng = np.random.default_rng(SEED + sum(ord(char) for char in scenario_id))

    for episode in range(1, int(training["max_episodes"]) + 1):
        state = env.reset()
        epsilon = epsilon_for_episode(
            episode=episode,
            max_episodes=int(training["max_episodes"]),
            epsilon_min=float(training["epsilon_min"]),
        )
        total_reward = 0.0
        collisions = 0
        penalty_zone_visits = 0
        reached_pickup = 0
        completed_delivery = 0

        for step_index in range(1, int(training["max_steps"]) + 1):
            action = select_action(env, state, q_table, epsilon, rng)
            next_state, reward, done, event = env.step(action)

            state_index = env.state_to_index(state)
            next_state_index = env.state_to_index(next_state)
            best_future = float(np.max(q_table[next_state_index]))
            td_target = reward if done else reward + float(training["gamma"]) * best_future

            q_table[state_index, action] = q_table[state_index, action] + float(training["alpha"]) * (
                td_target - q_table[state_index, action]
            )

            total_reward += reward
            collisions += event["collision"]
            penalty_zone_visits += event["penalty_zone_visit"]
            reached_pickup = max(reached_pickup, event["reached_pickup"])
            completed_delivery = max(completed_delivery, event["completed_delivery"])
            state = next_state

            if done:
                metrics.append(
                    {
                        "episode": episode,
                        "reward": round(total_reward, 3),
                        "steps": step_index,
                        "success": completed_delivery,
                        "reached_pickup": reached_pickup,
                        "completed_delivery": completed_delivery,
                        "collisions": collisions,
                        "penalty_zone_visits": penalty_zone_visits,
                    }
                )
                break
        else:
            metrics.append(
                {
                    "episode": episode,
                    "reward": round(total_reward, 3),
                    "steps": int(training["max_steps"]),
                    "success": completed_delivery,
                    "reached_pickup": reached_pickup,
                    "completed_delivery": completed_delivery,
                    "collisions": collisions,
                    "penalty_zone_visits": penalty_zone_visits,
                }
            )

        if episode >= ROLLING_WINDOW:
            recent = metrics[-ROLLING_WINDOW:]
            rolling_success_rate = (
                sum(int(item["success"]) for item in recent) / ROLLING_WINDOW
            )
        else:
            rolling_success_rate = (
                sum(int(item["success"]) for item in metrics) / len(metrics)
            )

        if episode % 125 == 0 and episode >= int(training["min_episodes"]):
            greedy_metrics, greedy_rollout = evaluate_q_learning_policy(scenario, q_table)
            if (
                greedy_rollout.completed_delivery
                and rolling_success_rate >= float(training["target_success_rate"])
                and greedy_metrics["pickup_success_rate"] >= float(training["target_success_rate"])
            ):
                break

    metrics_df = pd.DataFrame(metrics)
    _, greedy_rollout = evaluate_q_learning_policy(scenario, q_table)

    if not greedy_rollout.completed_delivery:
        print(
            f"WARNING: {scenario_id} did not complete the delivery task with the greedy policy."
        )

    return metrics_df, q_table, greedy_rollout, rolling_success_rate


def serialize_rollout(rollout: RolloutResult, scenario: dict[str, Any]) -> dict[str, Any]:
    return {
        "start": list(scenario["start"]),
        "pickup": list(scenario["pickup"]),
        "delivery": list(scenario["delivery"]),
        "path": [[int(row), int(col)] for row, col in rollout.path],
        "actions": rollout.actions,
        "time_phases": rollout.time_phases,
        "path_length": rollout.path_length,
        "reached_pickup": rollout.reached_pickup,
        "reached_delivery": rollout.reached_delivery,
        "completed_delivery": rollout.completed_delivery,
        "total_reward": rollout.total_reward,
        "pickup_step": rollout.pickup_step,
        "delivery_step": rollout.delivery_step,
        "penalty_zone_visits": rollout.penalty_zone_visits,
        "collisions": rollout.collisions,
        "wait_count": rollout.wait_count,
        "dynamic_collision_count": rollout.dynamic_collision_count,
    }


def summarize_policy_action(
    env: DeliveryEnvironment,
    q_table: np.ndarray,
    row: int,
    col: int,
    has_pickup: int,
) -> int | None:
    action_counts: Counter[int] = Counter()
    action_scores: dict[int, list[float]] = {}

    for time_phase in range(env.cycle_length):
        state = (row, col, has_pickup, time_phase)
        q_values = q_table[env.state_to_index(state)]
        action = greedy_action(env, state, q_values)
        action_counts[action] += 1
        action_scores.setdefault(action, []).append(float(q_values[action]))

    if not action_counts:
        return None

    max_count = max(action_counts.values())
    candidates = [action for action, count in action_counts.items() if count == max_count]
    if len(candidates) == 1:
        return candidates[0]

    candidates.sort(
        key=lambda action: (
            -sum(action_scores[action]) / len(action_scores[action]),
            projected_priority(env, (row, col, has_pickup, 0), action),
        ),
    )
    return candidates[0]


def export_rollout_timeline(path: Path, rollout: RolloutResult) -> None:
    with path.open("w", encoding="utf-8") as timeline_file:
        json.dump(rollout.dynamic_obstacle_timeline, timeline_file, indent=2)


def export_scenario(
    scenario_id: str,
    scenario: dict[str, Any],
    metrics_df: pd.DataFrame,
    q_table: np.ndarray,
    learned_rollout: RolloutResult,
) -> dict[str, Any]:
    scenario_dir = OUTPUT_ROOT / scenario_id
    scenario_dir.mkdir(parents=True, exist_ok=True)

    grid = np.array(scenario["grid"], dtype=np.int8)
    rows, cols = grid.shape
    obstacles = [[int(row), int(col)] for row, col in np.argwhere(grid == 1)]

    q_metrics, q_rollout = evaluate_q_learning_policy(scenario, q_table)
    random_metrics, random_rollout = evaluate_random_policy(scenario)
    shortest_metrics, shortest_rollout = evaluate_shortest_path_policy(scenario)

    env = DeliveryEnvironment(scenario)
    map_layout = {
        "rows": rows,
        "cols": cols,
        "start": list(scenario["start"]),
        "pickup": list(scenario["pickup"]),
        "delivery": list(scenario["delivery"]),
        "obstacles": obstacles,
        "penalty_zones": scenario["penalty_zones"],
        "dynamic_obstacles": scenario["dynamic_obstacles"],
        "dynamic_cycle_length": env.cycle_length,
    }

    policy_grid: list[dict[str, int | str | None]] = []

    for row in range(rows):
        for col in range(cols):
            position = (row, col)

            if grid[row, col] == 1:
                cell_type = "obstacle"
                before_action = None
                after_action = None
            elif position == tuple(scenario["start"]):
                cell_type = "start"
                before_action = summarize_policy_action(env, q_table, row, col, 0)
                after_action = summarize_policy_action(env, q_table, row, col, 1)
            elif position == tuple(scenario["pickup"]):
                cell_type = "pickup"
                before_action = summarize_policy_action(env, q_table, row, col, 0)
                after_action = summarize_policy_action(env, q_table, row, col, 1)
            elif position == tuple(scenario["delivery"]):
                cell_type = "delivery"
                before_action = summarize_policy_action(env, q_table, row, col, 0)
                after_action = None
            elif position in env.penalty_lookup:
                cell_type = "penalty"
                before_action = summarize_policy_action(env, q_table, row, col, 0)
                after_action = summarize_policy_action(env, q_table, row, col, 1)
            else:
                cell_type = "road"
                before_action = summarize_policy_action(env, q_table, row, col, 0)
                after_action = summarize_policy_action(env, q_table, row, col, 1)

            zone = env.penalty_lookup.get(position)
            policy_grid.append(
                {
                    "row": row,
                    "col": col,
                    "type": cell_type,
                    "best_action_before_pickup": before_action,
                    "best_action_after_pickup": after_action,
                    "penalty": int(zone["penalty"]) if zone else None,
                }
            )

    comparison_results = {
        "random_policy": random_metrics,
        "shortest_path_policy": shortest_metrics,
        "q_learning_policy": q_metrics,
    }

    metrics_df.to_csv(scenario_dir / "training_metrics.csv", index=False)
    np.save(
        scenario_dir / "q_table.npy",
        q_table.reshape(rows, cols, 2, env.cycle_length, ACTION_COUNT),
    )

    with (scenario_dir / "map_layout.json").open("w", encoding="utf-8") as map_file:
        json.dump(map_layout, map_file, indent=2)

    with (scenario_dir / "learned_path.json").open("w", encoding="utf-8") as path_file:
        json.dump(serialize_rollout(learned_rollout, scenario), path_file, indent=2)

    with (scenario_dir / "random_path.json").open("w", encoding="utf-8") as random_file:
        json.dump(serialize_rollout(random_rollout, scenario), random_file, indent=2)

    export_rollout_timeline(scenario_dir / "dynamic_obstacle_timeline.json", learned_rollout)
    export_rollout_timeline(
        scenario_dir / "random_dynamic_obstacle_timeline.json",
        random_rollout,
    )

    if shortest_rollout:
        with (scenario_dir / "shortest_path.json").open("w", encoding="utf-8") as shortest_file:
            json.dump(serialize_rollout(shortest_rollout, scenario), shortest_file, indent=2)

    with (scenario_dir / "policy_grid.json").open("w", encoding="utf-8") as policy_file:
        json.dump(policy_grid, policy_file, indent=2)

    with (scenario_dir / "comparison_results.json").open("w", encoding="utf-8") as comparison_file:
        json.dump(comparison_results, comparison_file, indent=2)

    final_rolling_success = float(
        metrics_df["success"]
        .rolling(window=min(ROLLING_WINDOW, len(metrics_df)), min_periods=1)
        .mean()
        .iloc[-1]
    )

    return {
        "scenario": scenario_id,
        "rows": rows,
        "cols": cols,
        "completed_delivery": learned_rollout.completed_delivery,
        "path_length": learned_rollout.path_length,
        "total_reward": learned_rollout.total_reward,
        "pickup_step": learned_rollout.pickup_step,
        "delivery_step": learned_rollout.delivery_step,
        "wait_count": learned_rollout.wait_count,
        "dynamic_collision_count": learned_rollout.dynamic_collision_count,
        "final_rolling_success_rate": round(final_rolling_success, 3),
    }


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    summary_rows: list[dict[str, Any]] = []

    print(f"Training {len(SCENARIOS)} delivery scenarios with seed {SEED}...")

    for scenario_id, scenario in SCENARIOS.items():
        rows = len(scenario["grid"])
        cols = len(scenario["grid"][0])
        validate_scenario_map_config(scenario_id, scenario)
        validate_scenario_dynamic_obstacles(scenario_id, scenario)
        pickup_distance, delivery_distance = validate_delivery_path(
            scenario_id=scenario_id,
            grid=scenario["grid"],
            start=tuple(scenario["start"]),
            pickup=tuple(scenario["pickup"]),
            delivery=tuple(scenario["delivery"]),
        )
        cycle_length = DeliveryEnvironment(scenario).cycle_length

        print(
            f"[{scenario_id}] {scenario['name']} | map={rows}x{cols} | cycle={cycle_length} | "
            f"shortest=start->pickup {pickup_distance}, pickup->delivery {delivery_distance}"
        )

        metrics_df, q_table, learned_rollout, rolling_success_rate = train_scenario(
            scenario_id,
            scenario,
        )
        summary_row = export_scenario(
            scenario_id=scenario_id,
            scenario=scenario,
            metrics_df=metrics_df,
            q_table=q_table,
            learned_rollout=learned_rollout,
        )
        summary_row["final_rolling_success_rate"] = round(rolling_success_rate, 3)
        summary_rows.append(summary_row)

        status = "completed delivery" if learned_rollout.completed_delivery else "failed"
        print(
            f"  episodes={len(metrics_df):4d} | {status:18s} | "
            f"path_length={learned_rollout.path_length:3d} | reward={learned_rollout.total_reward:8.3f} | "
            f"pickup_step={learned_rollout.pickup_step:3d} | delivery_step={learned_rollout.delivery_step:3d} | "
            f"waits={learned_rollout.wait_count:2d} | dynamic_hits={learned_rollout.dynamic_collision_count:2d} | "
            f"rolling_success={rolling_success_rate:.3f}"
        )

    summary_df = pd.DataFrame(summary_rows)
    summary_df.to_csv(OUTPUT_ROOT / "scenario_summary.csv", index=False)

    print("\nDelivery Scenario Summary")
    print(summary_df.to_string(index=False))


if __name__ == "__main__":
    main()
