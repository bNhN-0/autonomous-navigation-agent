from __future__ import annotations

from functools import lru_cache
from typing import Any

import torch

from rl.dqn.environment import normalize_map_config
from rl.dqn.infer_dqn import (
    load_model,
    recommended_max_steps,
    resolve_model_path,
    run_planner_guided_inference,
)
from rl.dqn.planner import build_mission_path


def validate_custom_map(map_config: dict[str, Any]) -> dict[str, Any]:
    normalized_map = normalize_map_config(map_config)
    # Safety validation prevents invalid movement into obstacles or walls.
    obstacle_set = {tuple(cell) for cell in normalized_map["obstacles"]}

    if tuple(normalized_map["start"]) in obstacle_set:
        raise ValueError("start cannot be placed on a static obstacle.")
    for label, positions in {
        "pickup": normalized_map["pickups"],
        "delivery": normalized_map["deliveries"],
    }.items():
        for position in positions:
            if tuple(position) in obstacle_set:
                raise ValueError(f"{label} cannot be placed on a static obstacle.")

    if build_mission_path(normalized_map) is None:
        raise ValueError("no_valid_route")

    return normalized_map


@lru_cache(maxsize=1)
def get_loaded_model() -> tuple[Any, torch.device]:
    model_path = resolve_model_path()
    if not model_path.exists():
        raise FileNotFoundError(
            f"DQN model file is missing at {model_path}. Run python rl/dqn/train_dqn.py first."
        )
    return load_model(model_path)


def infer_custom_map(map_config: dict[str, Any], max_steps: int | None = None) -> dict[str, Any]:
    normalized_map = validate_custom_map(map_config)
    checkpoint_path = resolve_model_path()
    model, device = get_loaded_model()
    # The best validation checkpoint is used for inference by default.
    resolved_max_steps = max_steps or recommended_max_steps(normalized_map)
    rollout = run_planner_guided_inference(
        map_config=normalized_map,
        model=model,
        device=device,
        max_steps=resolved_max_steps,
    )
    inference_meta = {
        "checkpoint_used": checkpoint_path.name,
        "method": "planner_guided_dqn",
        "used_fallback": False,
        "planner_used": True,
        "dqn_used": True,
        "completed_delivery": bool(rollout["completed_delivery"]),
        "reached_pickup": bool(rollout["reached_pickup"]),
        "reached_pickups": int(rollout["reached_pickups"]),
        "completed_deliveries": int(rollout["completed_deliveries"]),
        "pickup_step": int(rollout["pickup_step"]),
        "delivery_step": int(rollout["delivery_step"]),
        "path_length": int(rollout["path_length"]),
        "total_reward": float(rollout["total_reward"]),
        "failure_reason": rollout["failure_reason"],
        "planner_path": rollout["planner_path"],
        "dqn_actions": rollout["dqn_actions"],
        "planner_override_count": int(rollout["planner_override_count"]),
        "dqn_action_count": int(rollout["dqn_action_count"]),
        "safety_override_count": int(rollout["safety_override_count"]),
        "wait_count": int(rollout["wait_count"]),
        "max_consecutive_wait": int(rollout["max_consecutive_wait"]),
        "excessive_wait_count": int(rollout["excessive_wait_count"]),
        "collisions": int(rollout["collisions"]),
        "dynamic_collision_count": int(rollout["dynamic_collision_count"]),
        "penalty_zone_visits": int(rollout["penalty_zone_visits"]),
        "first_20_path_cells": rollout["path"][:20],
    }

    return {
        "method": "planner_guided_dqn",
        "map": normalized_map,
        "rollout": rollout,
        "inference_meta": inference_meta,
    }
