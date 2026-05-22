from __future__ import annotations

import random
from collections import deque
from typing import Any, Callable

from .environment import normalize_map_config, validate_dynamic_obstacle_path

GridPosition = tuple[int, int]
MapConfig = dict[str, Any]
CurriculumStage = dict[str, Any]

CURRICULUM_STAGES: tuple[CurriculumStage, ...] = (
    {
        "stage": 1,
        "label": "open_navigation",
        "rows": (8, 10),
        "cols": (8, 10),
        "layouts": ("empty",),
        "allow_penalty_zones": False,
        "allow_dynamic_obstacles": False,
        "allow_wait_action": False,
    },
    {
        "stage": 2,
        "label": "static_obstacles",
        "rows": (10, 12),
        "cols": (10, 12),
        "layouts": ("open_layout", "warehouse_corridors"),
        "allow_penalty_zones": False,
        "allow_dynamic_obstacles": False,
        "allow_wait_action": False,
    },
    {
        "stage": 3,
        "label": "penalty_zones",
        "rows": (12, 14),
        "cols": (12, 14),
        "layouts": ("open_layout", "warehouse_corridors", "mall_blocks"),
        "allow_penalty_zones": True,
        "allow_dynamic_obstacles": False,
        "allow_wait_action": False,
    },
    {
        "stage": 4,
        "label": "large_maps",
        "rows": (14, 20),
        "cols": (14, 20),
        "layouts": ("open_layout", "warehouse_corridors", "mall_blocks", "crowded_corridor"),
        "allow_penalty_zones": True,
        "allow_dynamic_obstacles": False,
        "allow_wait_action": False,
    },
    {
        "stage": 5,
        "label": "dynamic_delivery",
        "rows": (14, 20),
        "cols": (14, 20),
        "layouts": (
            "open_layout",
            "warehouse_corridors",
            "mall_blocks",
            "crowded_corridor",
            "obstacle_dense",
        ),
        "allow_penalty_zones": True,
        "allow_dynamic_obstacles": True,
        "allow_wait_action": True,
    },
)


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
            if 0 <= row < len(grid) and 0 <= col < len(grid[0]):
                grid[row][col] = value


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
        row, col = queue.popleft()
        if (row, col) == goal:
            path = [goal]
            cursor = goal
            while parents[cursor] is not None:
                cursor = parents[cursor]
                path.append(cursor)
            return list(reversed(path))

        for delta_row, delta_col in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            next_row = row + delta_row
            next_col = col + delta_col
            next_state = (next_row, next_col)
            if not (0 <= next_row < rows and 0 <= next_col < cols):
                continue
            if grid[next_row][next_col] == 1 or next_state in parents:
                continue
            parents[next_state] = (row, col)
            queue.append(next_state)

    return None


def is_solvable(map_config: MapConfig) -> bool:
    normalized = normalize_map_config(map_config)
    grid = empty_grid(normalized["rows"], normalized["cols"])
    for row, col in normalized["obstacles"]:
        grid[row][col] = 1

    start = tuple(normalized["start"])
    pickup = tuple(normalized["pickup"])
    delivery = tuple(normalized["delivery"])

    return bool(bfs_path(grid, start, pickup) and bfs_path(grid, pickup, delivery))


def generate_open_layout(rng: random.Random, rows: int, cols: int) -> list[list[int]]:
    grid = empty_grid(rows, cols)
    block_count = max(2, (rows * cols) // 55)

    for _ in range(block_count):
        height = rng.randint(1, max(1, rows // 4))
        width = rng.randint(1, max(1, cols // 4))
        top = rng.randint(1, max(1, rows - height - 1))
        left = rng.randint(1, max(1, cols - width - 1))
        fill_rect(grid, top, left, top + height - 1, left + width - 1)

    return grid


def generate_warehouse_layout(rng: random.Random, rows: int, cols: int) -> list[list[int]]:
    grid = empty_grid(rows, cols)
    shelf_width = 2 if cols >= 12 else 1
    aisle_gap = 2 if cols >= 14 else 1

    for left in range(2, cols - shelf_width, shelf_width + aisle_gap + 1):
        for top in range(1, rows - 2, 4):
            height = min(3, rows - top - 2)
            fill_rect(grid, top, left, top + height, left + shelf_width - 1)

    return grid


def generate_mall_layout(rng: random.Random, rows: int, cols: int) -> list[list[int]]:
    grid = empty_grid(rows, cols)
    for top in range(1, rows - 3, 4):
        left = 1
        while left < cols - 3:
            width = rng.randint(2, min(4, cols - left - 1))
            height = rng.randint(2, min(3, rows - top - 1))
            fill_rect(grid, top, left, min(rows - 2, top + height - 1), min(cols - 2, left + width - 1))
            left += width + rng.randint(2, 3)
    return grid


def generate_corridor_layout(rng: random.Random, rows: int, cols: int) -> list[list[int]]:
    grid = empty_grid(rows, cols)

    for col in range(3, cols - 2, 4):
        openings = {rng.randint(0, rows - 1), rng.randint(0, rows - 1)}
        for row in range(rows):
            if row not in openings:
                grid[row][col] = 1

    for row in range(3, rows - 2, 4):
        openings = {rng.randint(0, cols - 1), rng.randint(0, cols - 1)}
        for col in range(cols):
            if col not in openings:
                grid[row][col] = 1

    return grid


def generate_obstacle_dense_layout(rng: random.Random, rows: int, cols: int) -> list[list[int]]:
    grid = empty_grid(rows, cols)
    attempts = max(12, (rows * cols) // 8)

    for _ in range(attempts):
        height = rng.randint(1, max(1, rows // 5))
        width = rng.randint(1, max(1, cols // 5))
        top = rng.randint(0, rows - height)
        left = rng.randint(0, cols - width)
        fill_rect(grid, top, left, top + height - 1, left + width - 1)

    return grid


def generate_empty_layout(_: random.Random, rows: int, cols: int) -> list[list[int]]:
    return empty_grid(rows, cols)


def collect_free_cells(grid: list[list[int]]) -> list[GridPosition]:
    free_cells: list[GridPosition] = []
    for row, row_values in enumerate(grid):
        for col, cell in enumerate(row_values):
            if cell == 0:
                free_cells.append((row, col))
    return free_cells


def sample_special_cells(
    rng: random.Random,
    free_cells: list[GridPosition],
) -> tuple[GridPosition, GridPosition, GridPosition]:
    candidates = free_cells[:]
    rng.shuffle(candidates)

    best = (candidates[0], candidates[1], candidates[2])
    best_score = -1

    for start in candidates[: min(60, len(candidates))]:
        for pickup in candidates[: min(60, len(candidates))]:
            if pickup == start:
                continue
            for delivery in candidates[: min(60, len(candidates))]:
                if delivery in {start, pickup}:
                    continue
                score = (
                    abs(start[0] - pickup[0]) + abs(start[1] - pickup[1])
                    + abs(pickup[0] - delivery[0]) + abs(pickup[1] - delivery[1])
                )
                if score > best_score:
                    best = (start, pickup, delivery)
                    best_score = score

    return best


def generate_penalty_zones(
    rng: random.Random,
    free_cells: list[GridPosition],
    blocked_cells: set[GridPosition],
) -> list[dict[str, Any]]:
    count = rng.randint(0, max(2, len(free_cells) // 18))
    candidates = [cell for cell in free_cells if cell not in blocked_cells]
    rng.shuffle(candidates)
    zones: list[dict[str, Any]] = []

    for cell in candidates[:count]:
        severity = "danger" if rng.random() < 0.28 else "crowded"
        penalty = -10 if severity == "danger" else -3
        zones.append(
            {
                "cell": [cell[0], cell[1]],
                "penalty": penalty,
                "label": "Danger Zone" if severity == "danger" else "Rough Zone",
                "severity": severity,
                "type": severity,
            }
        )

    return zones


def resolve_curriculum_stage(stage: int) -> CurriculumStage:
    for stage_config in CURRICULUM_STAGES:
        if int(stage_config["stage"]) == int(stage):
            return stage_config
    raise ValueError(f"Unsupported curriculum stage: {stage}")


def curriculum_stage_for_episode(episode: int, total_episodes: int) -> CurriculumStage:
    if total_episodes <= 0:
        return CURRICULUM_STAGES[-1]

    episodes_per_stage = max(1, total_episodes // len(CURRICULUM_STAGES))
    stage_index = min((max(episode, 1) - 1) // episodes_per_stage, len(CURRICULUM_STAGES) - 1)
    return CURRICULUM_STAGES[stage_index]


def find_free_segments(
    grid: list[list[int]],
    min_length: int = 4,
) -> list[list[GridPosition]]:
    rows = len(grid)
    cols = len(grid[0])
    segments: list[list[GridPosition]] = []

    for row in range(rows):
        current: list[GridPosition] = []
        for col in range(cols):
            if grid[row][col] == 0:
                current.append((row, col))
            else:
                if len(current) >= min_length:
                    segments.append(current[:])
                current.clear()
        if len(current) >= min_length:
            segments.append(current[:])

    for col in range(cols):
        current = []
        for row in range(rows):
            if grid[row][col] == 0:
                current.append((row, col))
            else:
                if len(current) >= min_length:
                    segments.append(current[:])
                current.clear()
        if len(current) >= min_length:
            segments.append(current[:])

    return segments


def build_cycle_path(segment: list[GridPosition]) -> list[list[int]]:
    if len(segment) < 2:
        return [[segment[0][0], segment[0][1]]]

    cycle = segment + list(reversed(segment[1:-1]))
    return [[row, col] for row, col in cycle]


def generate_dynamic_obstacles(
    rng: random.Random,
    grid: list[list[int]],
    start: GridPosition,
    pickup: GridPosition,
    delivery: GridPosition,
    required: bool = False,
) -> list[dict[str, Any]]:
    protected_cells = {start, pickup, delivery}
    segments = [
        segment
        for segment in find_free_segments(grid)
        if all(cell not in protected_cells for cell in segment)
    ]
    rng.shuffle(segments)
    count = 1 if segments and (required or rng.random() < 0.55) else 0
    if len(segments) > 3 and rng.random() < 0.25:
        count = 2

    obstacles: list[dict[str, Any]] = []
    base_map_config: MapConfig = {
        "rows": len(grid),
        "cols": len(grid[0]),
        "start": list(start),
        "pickup": list(pickup),
        "delivery": list(delivery),
        "obstacles": [[row, col] for row, col in collect_obstacles(grid)],
    }

    for index, segment in enumerate(segments[:count]):
        kind = rng.choice(["person", "cart", "blocker"])
        label = {
            "person": "Moving Person",
            "cart": "Service Cart",
            "blocker": "Moving Blocker",
        }[kind]
        candidate = {
            "id": f"{kind}-{index}",
            "label": label,
            "kind": kind,
            "path": build_cycle_path(segment[: rng.randint(4, min(len(segment), 7))]),
            "speed": 1,
        }

        try:
            validate_dynamic_obstacle_path(base_map_config, candidate)
        except ValueError:
            continue

        obstacles.append(candidate)

    return obstacles


def generate_random_map(seed: int | None = None) -> MapConfig:
    rng = random.Random(seed)
    return generate_curriculum_map(resolve_curriculum_stage(5), rng)


def generate_curriculum_map(
    stage_config: CurriculumStage,
    rng: random.Random | None = None,
) -> MapConfig:
    resolved_rng = rng or random.Random()
    layout_generators: dict[str, Callable[[random.Random, int, int], list[list[int]]]] = {
        "empty": generate_empty_layout,
        "open_layout": generate_open_layout,
        "warehouse_corridors": generate_warehouse_layout,
        "mall_blocks": generate_mall_layout,
        "crowded_corridor": generate_corridor_layout,
        "obstacle_dense": generate_obstacle_dense_layout,
    }

    for _ in range(120):
        rows = resolved_rng.randint(*stage_config["rows"])
        cols = resolved_rng.randint(*stage_config["cols"])
        map_type = resolved_rng.choice(list(stage_config["layouts"]))
        layout_generator = layout_generators[map_type]
        grid = layout_generator(resolved_rng, rows, cols)
        free_cells = collect_free_cells(grid)
        if len(free_cells) < 3:
            continue

        start, pickup, delivery = sample_special_cells(resolved_rng, free_cells)
        protected = {start, pickup, delivery}
        penalty_zones = (
            generate_penalty_zones(resolved_rng, free_cells, protected)
            if stage_config["allow_penalty_zones"]
            else []
        )
        dynamic_obstacles = (
            generate_dynamic_obstacles(
                resolved_rng,
                grid,
                start,
                pickup,
                delivery,
                required=bool(stage_config["allow_dynamic_obstacles"]),
            )
            if stage_config["allow_dynamic_obstacles"]
            else []
        )

        map_config: MapConfig = {
            "rows": rows,
            "cols": cols,
            "start": list(start),
            "pickup": list(pickup),
            "delivery": list(delivery),
            "obstacles": [[row, col] for row, col in collect_obstacles(grid)],
            "penalty_zones": penalty_zones,
            "dynamic_obstacles": dynamic_obstacles,
            "map_type": f"stage_{stage_config['stage']}_{map_type}",
            "curriculum_stage": int(stage_config["stage"]),
            "curriculum_label": str(stage_config["label"]),
            "allow_wait_action": bool(stage_config["allow_wait_action"]),
        }

        if is_solvable(map_config):
            return normalize_map_config(map_config)

    raise RuntimeError("Unable to generate a solvable random delivery map.")


def build_validation_maps(maps_per_stage: int = 2) -> list[MapConfig]:
    validation_maps: list[MapConfig] = []

    for stage_config in CURRICULUM_STAGES:
        for index in range(maps_per_stage):
            seed = 90_000 + int(stage_config["stage"]) * 100 + index
            validation_maps.append(
                generate_curriculum_map(stage_config, random.Random(seed))
            )

    return validation_maps


def collect_obstacles(grid: list[list[int]]) -> list[GridPosition]:
    obstacles: list[GridPosition] = []
    for row, row_values in enumerate(grid):
        for col, value in enumerate(row_values):
            if value == 1:
                obstacles.append((row, col))
    return obstacles
