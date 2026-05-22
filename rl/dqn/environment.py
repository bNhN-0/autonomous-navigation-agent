from __future__ import annotations

import math
from collections import deque
from typing import Any

import numpy as np

MAX_MAP_SIZE = 20
WAIT_ACTION = 4
WAIT_PENALTY = -4.0
WAIT_SOFT_THRESHOLD = 3
WAIT_HARD_THRESHOLD = 10
WAIT_SOFT_EXTRA_PENALTY = -5.0
WAIT_HARD_EXTRA_PENALTY = -15.0

ACTIONS: dict[int, tuple[int, int]] = {
    0: (-1, 0),  # up
    1: (1, 0),   # down
    2: (0, -1),  # left
    3: (0, 1),   # right
    WAIT_ACTION: (0, 0),  # wait
}
ACTION_COUNT = len(ACTIONS)
STATE_CHANNELS = 8

GridPosition = tuple[int, int]
MapConfig = dict[str, Any]


def is_adjacent_cell(a: GridPosition, b: GridPosition) -> bool:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1


def is_reserved_cell(map_config: MapConfig, cell: GridPosition) -> bool:
    reserved_cells = {tuple(int(value) for value in map_config["start"])}
    reserved_cells.update(
        tuple(int(value) for value in target)
        for target in map_config.get("pickups", [map_config["pickup"]])
    )
    reserved_cells.update(
        tuple(int(value) for value in target)
        for target in map_config.get("deliveries", [map_config["delivery"]])
    )
    return cell in reserved_cells


def clamp_penalty_value(penalty: int) -> float:
    return min(abs(float(penalty)) / 10.0, 1.0)


def normalize_penalty_zone(zone: dict[str, Any]) -> dict[str, Any]:
    penalty = int(zone.get("penalty", -3))
    severity = zone.get("severity") or zone.get("type")
    if severity not in {"crowded", "danger"}:
        severity = "danger" if penalty <= -10 else "crowded"

    label = zone.get("label")
    if not label:
        label = "Danger Zone" if severity == "danger" else "Rough Zone"

    return {
        "cell": [int(zone["cell"][0]), int(zone["cell"][1])],
        "penalty": penalty,
        "label": label,
        "severity": severity,
        "type": severity,
    }


def normalize_dynamic_obstacle(obstacle: dict[str, Any], index: int) -> dict[str, Any]:
    path: list[list[int]] = []
    for cell in obstacle.get("path", []):
        if len(cell) != 2:
            raise ValueError("Dynamic obstacle path cells must contain row and col.")
        path.append([int(cell[0]), int(cell[1])])

    if len(path) < 2:
        raise ValueError("Dynamic obstacle path must include at least 2 cells.")

    obstacle_id = obstacle.get("id") or f"dynamic-{index}"
    kind = obstacle.get("kind") or "person"
    label = obstacle.get("label") or obstacle_id
    speed = max(1, int(obstacle.get("speed", 1)))

    return {
        "id": str(obstacle_id),
        "label": str(label),
        "kind": kind,
        "path": path,
        "speed": speed,
        "color": obstacle.get("color"),
    }


def build_dynamic_cycle(path: list[list[int]], speed: int) -> list[GridPosition]:
    dwell = max(1, int(speed))
    positions = [(int(cell[0]), int(cell[1])) for cell in path]

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


def validate_dynamic_cycle(
    map_config: MapConfig,
    cycle: list[GridPosition],
) -> None:
    rows = int(map_config["rows"])
    cols = int(map_config["cols"])
    obstacles = {
        tuple(int(value) for value in cell)
        for cell in map_config.get("obstacles", [])
    }

    def in_bounds(position: GridPosition) -> bool:
        return 0 <= position[0] < rows and 0 <= position[1] < cols

    for position in cycle:
        if not in_bounds(position):
            raise ValueError("Dynamic obstacle cycle is outside map bounds.")
        if position in obstacles:
            raise ValueError("Dynamic obstacle cycle cannot cross static obstacles.")
        if is_reserved_cell(map_config, position):
            raise ValueError(
                "Dynamic obstacle cycle cannot pass through start, pickup, or delivery zones."
            )

    for current_position, next_position in zip(cycle, cycle[1:]):
        if current_position == next_position:
            continue
        if not is_adjacent_cell(current_position, next_position):
            raise ValueError("Dynamic obstacle cycle must use connected cells.")


def validate_dynamic_obstacle_path(
    map_config: MapConfig,
    obstacle: dict[str, Any],
) -> None:
    rows = int(map_config["rows"])
    cols = int(map_config["cols"])
    path = [tuple(int(value) for value in cell) for cell in obstacle.get("path", [])]
    obstacles = {
        tuple(int(value) for value in cell)
        for cell in map_config.get("obstacles", [])
    }

    def in_bounds(position: GridPosition) -> bool:
        return 0 <= position[0] < rows and 0 <= position[1] < cols

    if len(path) < 2:
        raise ValueError("Dynamic obstacle path must include at least 2 cells.")

    for position in path:
        if not in_bounds(position):
            raise ValueError("Dynamic obstacle path is outside map bounds.")
        if position in obstacles:
            raise ValueError("Dynamic obstacle path cannot cross static obstacles.")
        if is_reserved_cell(map_config, position):
            raise ValueError(
                "Dynamic obstacle path cannot pass through start, pickup, or delivery zones."
            )

    for current_position, next_position in zip(path, path[1:]):
        if not is_adjacent_cell(current_position, next_position):
            raise ValueError("Dynamic obstacle path must use connected cells.")

    validate_dynamic_cycle(
        map_config,
        build_dynamic_cycle([[row, col] for row, col in path], int(obstacle.get("speed", 1))),
    )


def validate_dynamic_obstacles(map_config: MapConfig) -> None:
    for obstacle in map_config.get("dynamic_obstacles", []):
        validate_dynamic_obstacle_path(map_config, obstacle)


def normalize_map_config(map_config: MapConfig) -> MapConfig:
    rows = int(map_config["rows"])
    cols = int(map_config["cols"])

    if rows <= 0 or cols <= 0:
        raise ValueError("rows and cols must be positive integers.")
    if rows > MAX_MAP_SIZE or cols > MAX_MAP_SIZE:
        raise ValueError(f"rows and cols must be <= {MAX_MAP_SIZE}.")

    start = tuple(int(value) for value in map_config["start"])
    pickup_cells = map_config.get("pickups") or (
        [map_config["pickup"]] if map_config.get("pickup") is not None else []
    )
    delivery_cells = map_config.get("deliveries") or (
        [map_config["delivery"]] if map_config.get("delivery") is not None else []
    )
    if not pickup_cells:
        raise ValueError("at least one pickup is required.")
    if not delivery_cells:
        raise ValueError("at least one delivery is required.")

    pickups = sorted({
        (int(cell[0]), int(cell[1]))
        for cell in pickup_cells
        if len(cell) == 2
    })
    if len(pickups) != 1:
        raise ValueError("exactly one pickup is required for single-agent missions.")
    deliveries = sorted({
        (int(cell[0]), int(cell[1]))
        for cell in delivery_cells
        if len(cell) == 2
    })
    if len(deliveries) != 1:
        raise ValueError("exactly one delivery is required for single-agent missions.")
    pickup = pickups[0]
    delivery = deliveries[0]

    def in_bounds(position: GridPosition) -> bool:
        return 0 <= position[0] < rows and 0 <= position[1] < cols

    for label, position in {
        "start": start,
        **{f"pickup[{index}]": cell for index, cell in enumerate(pickups)},
        **{f"delivery[{index}]": cell for index, cell in enumerate(deliveries)},
    }.items():
        if not in_bounds(position):
            raise ValueError(f"{label} must be inside the map bounds.")

    obstacles = sorted({
        (int(cell[0]), int(cell[1]))
        for cell in map_config.get("obstacles", [])
        if len(cell) == 2
    })

    for obstacle in obstacles:
        if not in_bounds(obstacle):
            raise ValueError("Obstacle cells must be inside the map bounds.")
        if obstacle in {start, *pickups, *deliveries}:
            raise ValueError("start, pickups, and deliveries cannot be placed on obstacles.")

    penalty_zones = [
        normalize_penalty_zone(zone)
        for zone in map_config.get("penalty_zones", [])
    ]
    for zone in penalty_zones:
        cell = tuple(zone["cell"])
        if not in_bounds(cell):
            raise ValueError("Penalty zones must be inside the map bounds.")
        if cell in obstacles:
            raise ValueError("Penalty zones cannot overlap static obstacles.")

    dynamic_obstacles = [
        normalize_dynamic_obstacle(obstacle, index)
        for index, obstacle in enumerate(map_config.get("dynamic_obstacles", []))
    ]

    normalized_map = {
        "rows": rows,
        "cols": cols,
        "start": list(start),
        "pickups": [list(position) for position in pickups],
        "deliveries": [list(position) for position in deliveries],
        "pickup": list(pickup),
        "delivery": list(delivery),
        "obstacles": [list(position) for position in obstacles],
        "penalty_zones": penalty_zones,
        "dynamic_obstacles": dynamic_obstacles,
        "map_type": map_config.get("map_type", "custom"),
        "curriculum_stage": int(map_config.get("curriculum_stage", 0)),
        "curriculum_label": map_config.get("curriculum_label", "custom"),
        "allow_wait_action": bool(
            map_config.get("allow_wait_action", bool(dynamic_obstacles))
        ),
    }
    validate_dynamic_obstacles(normalized_map)
    return normalized_map


def lcm_all(values: list[int]) -> int:
    result = 1
    for value in values:
        result = math.lcm(result, value)
    return max(result, 1)


class DeliveryDQNEnvironment:
    def __init__(
        self,
        map_config: MapConfig,
        max_steps: int = 220,
    ) -> None:
        self.map_config = normalize_map_config(map_config)
        self.rows = int(self.map_config["rows"])
        self.cols = int(self.map_config["cols"])
        self.start = tuple(self.map_config["start"])
        self.pickups = [tuple(cell) for cell in self.map_config.get("ordered_pickups", self.map_config["pickups"])]
        self.deliveries = [tuple(cell) for cell in self.map_config.get("ordered_deliveries", self.map_config["deliveries"])]
        self.pickup = self.pickups[0]
        self.delivery = self.deliveries[0]
        self.obstacles = {tuple(cell) for cell in self.map_config["obstacles"]}
        self.penalty_zones = list(self.map_config.get("penalty_zones", []))
        self.penalty_lookup = {
            tuple(zone["cell"]): zone for zone in self.penalty_zones
        }
        self.dynamic_obstacles = list(self.map_config.get("dynamic_obstacles", []))
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
        self.max_steps = max_steps
        self.allow_wait_action = bool(self.map_config.get("allow_wait_action", bool(self.dynamic_obstacles)))
        self.position: GridPosition = self.start
        self.remaining_pickups: list[GridPosition] = list(self.pickups)
        self.remaining_deliveries: list[GridPosition] = list(self.deliveries)
        self.completed_pickups: list[GridPosition] = []
        self.completed_deliveries: list[GridPosition] = []
        self.has_pickup = False
        self.time_phase = 0
        self.step_count = 0
        self.consecutive_wait_count = 0
        self.max_consecutive_wait = 0
        self.excessive_wait_count = 0

    def reset(self) -> np.ndarray:
        self.position = self.start
        self.remaining_pickups = list(self.pickups)
        self.remaining_deliveries = list(self.deliveries)
        self.completed_pickups = []
        self.completed_deliveries = []
        self.has_pickup = False
        self.time_phase = 0
        self.step_count = 0
        self.consecutive_wait_count = 0
        self.max_consecutive_wait = 0
        self.excessive_wait_count = 0
        return self.get_state()

    def target_position(self) -> GridPosition:
        if self.remaining_pickups:
            return self.remaining_pickups[0]
        if self.remaining_deliveries:
            return self.remaining_deliveries[0]
        return self.deliveries[-1]

    def current_phase(self) -> str:
        if not self.remaining_pickups and not self.remaining_deliveries:
            return "complete"
        if not self.remaining_pickups:
            return "delivering"
        return "to_pickup"

    def is_delivery_position(self, position: GridPosition) -> bool:
        return position in self.deliveries

    def next_time_phase(self, time_phase: int | None = None) -> int:
        phase = self.time_phase if time_phase is None else time_phase
        return (phase + 1) % self.cycle_length

    def is_valid_position(self, row: int, col: int) -> bool:
        if row < 0 or row >= self.rows or col < 0 or col >= self.cols:
            return False
        return (row, col) not in self.obstacles

    def get_dynamic_positions(self, time_phase: int | None = None) -> dict[str, GridPosition]:
        phase = self.time_phase if time_phase is None else time_phase
        positions: dict[str, GridPosition] = {}

        for obstacle in self.dynamic_obstacles:
            cycle = self.dynamic_cycles.get(obstacle["id"], [])
            if not cycle:
                continue
            positions[obstacle["id"]] = cycle[phase % len(cycle)]

        return positions

    def get_safe_movement_actions(self) -> list[int]:
        valid_actions: list[int] = []
        row, col = self.position
        next_phase = self.next_time_phase()

        for action, (delta_row, delta_col) in ACTIONS.items():
            if action == WAIT_ACTION:
                continue

            next_row = row + delta_row
            next_col = col + delta_col
            if not self.is_valid_position(next_row, next_col):
                continue
            if self._dynamic_collision(
                current_position=self.position,
                next_position=(next_row, next_col),
                current_phase=self.time_phase,
                next_phase=next_phase,
            ):
                continue
            valid_actions.append(action)

        return valid_actions

    def get_wait_allowed(self) -> bool:
        if not self.allow_wait_action:
            return False

        safe_movement_actions = self.get_safe_movement_actions()
        if not safe_movement_actions:
            return True

        return self.is_preferred_route_blocked() or self.has_nearby_dynamic_obstacle()

    def get_valid_actions(self) -> list[int]:
        safe_movement_actions = self.get_safe_movement_actions()
        if self.get_wait_allowed():
            return [*safe_movement_actions, WAIT_ACTION]
        return safe_movement_actions

    def get_action_mask(self) -> np.ndarray:
        mask = np.zeros((ACTION_COUNT,), dtype=np.float32)
        for action in self.get_valid_actions():
            mask[action] = 1.0

        if not mask.any():
            mask[WAIT_ACTION] = 1.0

        return mask

    def get_preferred_route_action(self) -> int | None:
        path = self._static_shortest_path(self.position, self.target_position())
        if not path or len(path) < 2:
            return None

        delta = (path[1][0] - path[0][0], path[1][1] - path[0][1])
        for action, direction in ACTIONS.items():
            if action != WAIT_ACTION and direction == delta:
                return action

        return None

    def is_preferred_route_blocked(self) -> bool:
        preferred_action = self.get_preferred_route_action()
        if preferred_action is None:
            return False

        delta_row, delta_col = ACTIONS[preferred_action]
        next_position = (self.position[0] + delta_row, self.position[1] + delta_col)
        next_phase = self.next_time_phase()

        current_dynamic_positions = self.get_dynamic_positions(self.time_phase).values()
        next_dynamic_positions = self.get_dynamic_positions(next_phase).values()
        if next_position in current_dynamic_positions or next_position in next_dynamic_positions:
            return True

        return self._dynamic_collision(
            current_position=self.position,
            next_position=next_position,
            current_phase=self.time_phase,
            next_phase=next_phase,
        )

    def has_nearby_dynamic_obstacle(self, radius: int = 1) -> bool:
        preferred_action = self.get_preferred_route_action()
        preferred_position: GridPosition | None = None
        if preferred_action is not None:
            delta_row, delta_col = ACTIONS[preferred_action]
            preferred_position = (self.position[0] + delta_row, self.position[1] + delta_col)

        for phase in {self.time_phase, self.next_time_phase()}:
            for position in self.get_dynamic_positions(phase).values():
                if self._manhattan_distance(self.position, position) <= radius:
                    return True
                if (
                    preferred_position is not None
                    and self._manhattan_distance(preferred_position, position) <= radius
                ):
                    return True

        return False

    def get_state(self) -> np.ndarray:
        state = np.zeros((STATE_CHANNELS, MAX_MAP_SIZE, MAX_MAP_SIZE), dtype=np.float32)

        for row, col in self.obstacles:
            state[0, row, col] = 1.0

        for zone in self.penalty_zones:
            row, col = zone["cell"]
            state[1, row, col] = clamp_penalty_value(int(zone["penalty"]))

        agent_row, agent_col = self.position
        state[2, agent_row, agent_col] = 1.0
        if self.remaining_pickups:
            pickup_target = self.remaining_pickups[0]
            state[3, pickup_target[0], pickup_target[1]] = 1.0
        if self.remaining_deliveries:
            delivery_target = self.remaining_deliveries[0]
            state[4, delivery_target[0], delivery_target[1]] = 1.0
        state[5, : self.rows, : self.cols] = float(not self.remaining_pickups)

        for row in range(self.rows):
            for col in range(self.cols):
                if (row, col) not in self.obstacles:
                    state[7, row, col] = 1.0

        for position in self.get_dynamic_positions().values():
            state[6, position[0], position[1]] = 1.0

        return state

    def step(self, action: int) -> tuple[np.ndarray, float, bool, dict[str, Any]]:
        if action not in ACTIONS:
            raise ValueError(f"Unsupported action: {action}")

        self.step_count += 1
        previous_target = self.target_position()
        previous_distance = self._manhattan_distance(self.position, previous_target)
        row, col = self.position
        current_phase = self.time_phase
        next_phase = self.next_time_phase()
        delta_row, delta_col = ACTIONS[action]
        next_row = row + delta_row
        next_col = col + delta_col
        reward = 0.0
        done = False
        wait_action = action == WAIT_ACTION
        collision = False
        dynamic_collision = False
        penalty_zone_visit = False
        completed_delivery = False
        timed_out = False
        excessive_wait = False

        if wait_action and not self.allow_wait_action:
            reward = -100.0
            collision = True
            self.time_phase = next_phase
            self.consecutive_wait_count = 0
        elif not wait_action and not self.is_valid_position(next_row, next_col):
            reward = -100.0
            collision = True
            self.time_phase = next_phase
            self.consecutive_wait_count = 0
        else:
            next_position = self.position if wait_action else (next_row, next_col)
            if self._dynamic_collision(
                current_position=self.position,
                next_position=next_position,
                current_phase=current_phase,
                next_phase=next_phase,
            ):
                reward = -100.0
                collision = True
                dynamic_collision = True
                self.time_phase = next_phase
                self.consecutive_wait_count = 0
            else:
                self.position = next_position
                self.time_phase = next_phase

                if wait_action:
                    self.consecutive_wait_count += 1
                    self.max_consecutive_wait = max(
                        self.max_consecutive_wait,
                        self.consecutive_wait_count,
                    )
                    reward = WAIT_PENALTY
                    if self.consecutive_wait_count > WAIT_HARD_THRESHOLD:
                        reward += WAIT_HARD_EXTRA_PENALTY
                        excessive_wait = True
                    elif self.consecutive_wait_count > WAIT_SOFT_THRESHOLD:
                        reward += WAIT_SOFT_EXTRA_PENALTY
                        excessive_wait = True

                    if excessive_wait:
                        self.excessive_wait_count += 1
                else:
                    self.consecutive_wait_count = 0
                    reward = float(self._penalty_for_position(self.position))
                    penalty_zone_visit = self.position in self.penalty_lookup

                if self.position in self.remaining_pickups:
                    self.remaining_pickups = [
                        pickup for pickup in self.remaining_pickups
                        if pickup != self.position
                    ]
                    self.completed_pickups.append(self.position)
                    self.has_pickup = not self.remaining_pickups
                    reward += 30.0

                if self.position in self.deliveries:
                    if not self.remaining_pickups and self.position in self.remaining_deliveries:
                        self.remaining_deliveries = [
                            delivery for delivery in self.remaining_deliveries
                            if delivery != self.position
                        ]
                        self.completed_deliveries.append(self.position)
                        reward += 100.0
                        completed_delivery = len(self.remaining_deliveries) == 0
                        done = completed_delivery
                    else:
                        reward = -5.0

                new_distance = self._manhattan_distance(self.position, previous_target)
                if new_distance < previous_distance:
                    reward += 1.0
                elif new_distance > previous_distance:
                    reward += -1.0

        if not done and self.step_count >= self.max_steps:
            reward += -50.0
            done = True
            timed_out = True

        if completed_delivery:
            current_phase_label = "complete"
        elif wait_action:
            current_phase_label = "waiting"
        elif not self.remaining_pickups:
            current_phase_label = "delivering"
        else:
            current_phase_label = "to_pickup"

        info = {
            "reached_pickup": bool(self.completed_pickups),
            "reached_pickups": len(self.completed_pickups),
            "reached_delivery": bool(self.completed_deliveries),
            "completed_deliveries": len(self.completed_deliveries),
            "completed_delivery": completed_delivery,
            "mission_complete": completed_delivery,
            "collision": collision,
            "dynamic_collision": dynamic_collision,
            "penalty_zone_visit": penalty_zone_visit,
            "wait": wait_action,
            "current_phase": current_phase_label,
            "current_target": list(self.target_position()) if (self.remaining_pickups or self.remaining_deliveries) else None,
            "time_phase": self.time_phase,
            "timed_out": timed_out,
            "consecutive_wait_count": self.consecutive_wait_count,
            "max_consecutive_wait": self.max_consecutive_wait,
            "excessive_wait": excessive_wait,
            "excessive_wait_count": self.excessive_wait_count,
        }

        return self.get_state(), reward, done, info

    def render_debug_optional(self) -> str:
        dynamic_positions = {
            position for position in self.get_dynamic_positions().values()
        }
        rows: list[str] = []

        for row in range(self.rows):
            tokens: list[str] = []
            for col in range(self.cols):
                position = (row, col)
                token = "."
                if position in self.obstacles:
                    token = "#"
                elif position in dynamic_positions:
                    token = "D"
                elif position == self.position:
                    token = "A"
                elif position == self.pickup:
                    token = "P"
                elif position == self.delivery:
                    token = "G"
                elif position in self.penalty_lookup:
                    token = "!"
                tokens.append(token)
            rows.append(" ".join(tokens))

        return "\n".join(rows)

    def _penalty_for_position(self, position: GridPosition) -> int:
        zone = self.penalty_lookup.get(position)
        if zone:
            return int(zone["penalty"])
        return -1

    def _static_shortest_path(
        self,
        start: GridPosition,
        goal: GridPosition,
    ) -> list[GridPosition] | None:
        queue = deque([start])
        parents: dict[GridPosition, GridPosition | None] = {start: None}

        while queue:
            row, col = queue.popleft()
            if (row, col) == goal:
                path = [goal]
                cursor = goal
                while parents[cursor] is not None:
                    cursor = parents[cursor]
                    path.append(cursor)
                return list(reversed(path))

            for delta_row, delta_col in (ACTIONS[action] for action in ACTIONS if action != WAIT_ACTION):
                next_row = row + delta_row
                next_col = col + delta_col
                next_state = (next_row, next_col)
                if not self.is_valid_position(next_row, next_col):
                    continue
                if next_state in parents:
                    continue
                parents[next_state] = (row, col)
                queue.append(next_state)

        return None

    def _dynamic_collision(
        self,
        current_position: GridPosition,
        next_position: GridPosition,
        current_phase: int,
        next_phase: int,
    ) -> bool:
        current_positions = self.get_dynamic_positions(current_phase)
        next_positions = self.get_dynamic_positions(next_phase)

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

    @staticmethod
    def _manhattan_distance(a: GridPosition, b: GridPosition) -> int:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])
