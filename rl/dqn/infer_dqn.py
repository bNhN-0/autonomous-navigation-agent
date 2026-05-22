from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

import torch

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from rl.dqn.environment import (
    ACTIONS,
    ACTION_COUNT,
    WAIT_ACTION,
    DeliveryDQNEnvironment,
    normalize_map_config,
)
from rl.dqn.model import DeliveryDQN
from rl.dqn.planner import build_mission_path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FINAL_MODEL_PATH = PROJECT_ROOT / "rl" / "models" / "dqn_delivery_agent.pt"
BEST_MODEL_PATH = PROJECT_ROOT / "rl" / "models" / "dqn_delivery_agent_best.pt"
MODEL_PATH = FINAL_MODEL_PATH
OUTPUT_DIR = PROJECT_ROOT / "rl" / "dqn" / "outputs"
ROLL_OUT_PATH = OUTPUT_DIR / "custom_dqn_rollout.json"
SAMPLE_MAP_PATH = OUTPUT_DIR / "sample_custom_map.json"
MAX_ROUTE_DEVIATION = 2
MAX_BAD_DQN_STREAK = 3
MAX_STUCK_STEPS = 18
MAX_PLANNER_STALL_STEPS = 4
DEFAULT_MAX_STEPS = 220


def resolve_model_path(model_path: Path | None = None) -> Path:
    if model_path is not None:
        return model_path
    if BEST_MODEL_PATH.exists():
        return BEST_MODEL_PATH
    return FINAL_MODEL_PATH


def sample_custom_map() -> dict[str, Any]:
    return {
        "rows": 10,
        "cols": 17,
        "start": [0, 16],
        "pickups": [[9, 0]],
        "deliveries": [[1, 16]],
        "obstacles": [
            [4, 13],
            [5, 13],
            [6, 7],
            [6, 8],
            [6, 9],
            [6, 10],
            [7, 7],
            [7, 8],
            [7, 9],
            [7, 10],
            [8, 1],
        ],
        "penalty_zones": [
            {"cell": [2, 14], "penalty": -3, "type": "crowded"},
            {"cell": [4, 8], "penalty": -3, "type": "crowded"},
        ],
        "dynamic_obstacles": [
            {
                "id": "person-1",
                "path": [[6, 13], [7, 13], [8, 13], [9, 13], [8, 13], [7, 13]],
                "speed": 1,
            },
            {
                "id": "person-2",
                "path": [
                    [5, 0],
                    [5, 1],
                    [5, 2],
                    [5, 3],
                    [5, 4],
                    [5, 5],
                    [5, 6],
                    [5, 5],
                    [5, 4],
                    [5, 3],
                    [5, 2],
                    [5, 1],
                ],
                "speed": 1,
            },
        ],
    }


def recommended_max_steps(
    map_config: dict[str, Any],
    plan: dict[str, list[list[int]]] | None = None,
) -> int:
    normalized_map = normalize_map_config(map_config)
    resolved_plan = plan or build_mission_path(normalized_map)
    planner_path_length = len(resolved_plan["mission_path"]) if resolved_plan else 0
    pickup_count = len(normalized_map["pickups"])
    dynamic_count = len(normalized_map.get("dynamic_obstacles", []))
    area_budget = normalized_map["rows"] * normalized_map["cols"]
    mission_budget = planner_path_length * 5 + pickup_count * 24 + dynamic_count * 20
    return max(DEFAULT_MAX_STEPS, area_budget, mission_budget)


def load_model(
    model_path: Path | None = None,
    device: torch.device | None = None,
) -> tuple[DeliveryDQN, torch.device]:
    resolved_model_path = resolve_model_path(model_path)
    if not resolved_model_path.exists():
        raise FileNotFoundError(
            f"Trained DQN model not found at {resolved_model_path}. Run python rl/dqn/train_dqn.py first."
        )

    resolved_device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
    checkpoint = torch.load(resolved_model_path, map_location=resolved_device)
    model = DeliveryDQN(
        input_channels=int(checkpoint.get("state_channels", 8)),
        action_count=int(checkpoint.get("action_count", ACTION_COUNT)),
    ).to(resolved_device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return model, resolved_device


def build_timeline_frame(env: DeliveryDQNEnvironment, step: int) -> dict[str, Any]:
    dynamic_positions = env.get_dynamic_positions()
    return {
        "step": step,
        "obstacles": [
            {"id": obstacle["id"], "position": list(dynamic_positions[obstacle["id"]])}
            for obstacle in env.dynamic_obstacles
            if obstacle["id"] in dynamic_positions
        ],
    }


def manhattan_distance(a: tuple[int, int], b: tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def action_from_transition(current: tuple[int, int], nxt: tuple[int, int]) -> int:
    delta = (nxt[0] - current[0], nxt[1] - current[1])
    for action, direction in ACTIONS.items():
        if direction == delta:
            return action
    return WAIT_ACTION


def next_position_for_action(position: tuple[int, int], action: int) -> tuple[int, int]:
    delta_row, delta_col = ACTIONS[action]
    return (position[0] + delta_row, position[1] + delta_col)


def route_distance(position: tuple[int, int], future_route: list[tuple[int, int]]) -> int:
    if not future_route:
        return 0
    return min(manhattan_distance(position, route_cell) for route_cell in future_route)


def penalty_cost_for_cell(env: DeliveryDQNEnvironment, cell: tuple[int, int]) -> float:
    zone = env.penalty_lookup.get(cell)
    if zone is None:
        return 0.0
    return min(8.0, abs(float(zone.get("penalty", -3))) / 2.0)


def distance_to_path_index(
    mission_path: list[tuple[int, int]],
    position: tuple[int, int],
    start_index: int,
    end_index: int,
) -> tuple[int, int]:
    best_index = start_index
    best_distance = float("inf")
    upper_bound = min(end_index, len(mission_path) - 1)
    for index in range(start_index, upper_bound + 1):
        distance = manhattan_distance(position, mission_path[index])
        if distance < best_distance:
            best_distance = distance
            best_index = index
    return int(best_distance), best_index


def planner_action_toward_cell(
    current_position: tuple[int, int],
    target_cell: tuple[int, int],
) -> int | None:
    if current_position == target_cell:
        return None

    best_action: int | None = None
    best_distance: int | None = None
    for action, (delta_row, delta_col) in ACTIONS.items():
        if action == WAIT_ACTION:
            continue
        candidate = (current_position[0] + delta_row, current_position[1] + delta_col)
        distance = manhattan_distance(candidate, target_cell)
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_action = action

    return best_action


def advance_planner_index(
    mission_path: list[tuple[int, int]],
    current_index: int,
    position: tuple[int, int],
    segment_end_index: int,
) -> int:
    upper_bound = min(segment_end_index, len(mission_path) - 1)
    for index in range(current_index, upper_bound + 1):
        if mission_path[index] == position:
            return index
    return current_index


def target_index_from_plan(
    plan: dict[str, Any],
    target: tuple[int, int],
) -> int:
    return int(plan["target_visit_indices"][f"{target[0]},{target[1]}"])


def planner_action_for_index(
    current_position: tuple[int, int],
    mission_path: list[tuple[int, int]],
    planner_index: int,
    segment_end_index: int,
) -> tuple[int | None, tuple[int, int] | None]:
    next_index = min(planner_index + 1, segment_end_index)
    if next_index <= planner_index:
        return None, None
    next_waypoint = mission_path[next_index]
    if manhattan_distance(current_position, next_waypoint) == 1:
        return action_from_transition(current_position, next_waypoint), next_waypoint
    return planner_action_toward_cell(current_position, next_waypoint), next_waypoint


def dynamic_block_requires_wait(
    env: DeliveryDQNEnvironment,
    planner_action: int | None,
    target_improving_actions: list[int],
) -> bool:
    safe_moves = set(env.get_safe_movement_actions())
    if not safe_moves:
        return True
    if planner_action is not None and planner_action not in safe_moves:
        return True
    return any(action not in safe_moves for action in target_improving_actions)


def is_safe_action(env: DeliveryDQNEnvironment, action: int) -> bool:
    if action == WAIT_ACTION:
        return env.get_wait_allowed()
    return action in env.get_safe_movement_actions()


def choose_safe_action(
    *,
    env: DeliveryDQNEnvironment,
    preferred_action: int | None,
    planner_action: int | None,
    wait_useful: bool,
) -> tuple[int, bool]:
    if preferred_action is not None and is_safe_action(env, preferred_action):
        return preferred_action, False
    if planner_action is not None and is_safe_action(env, planner_action):
        return planner_action, True
    if wait_useful and is_safe_action(env, WAIT_ACTION):
        return WAIT_ACTION, True
    if is_safe_action(env, WAIT_ACTION):
        return WAIT_ACTION, True

    safe_moves = env.get_safe_movement_actions()
    if safe_moves:
        return safe_moves[0], True

    return WAIT_ACTION, True


def choose_guided_action(
    model: DeliveryDQN,
    state: torch.Tensor,
    env: DeliveryDQNEnvironment,
    device: torch.device,
    mission_path: list[tuple[int, int]],
    planner_index: int,
    segment_end_index: int,
    bad_dqn_streak: int,
    planner_stall_steps: int,
) -> dict[str, Any]:
    with torch.no_grad():
        q_values = model(state.unsqueeze(0).to(device)).squeeze(0).detach().cpu()

    current_position = env.position
    mission_target = env.target_position()
    planner_action, next_waypoint = planner_action_for_index(
        current_position,
        mission_path,
        planner_index,
        segment_end_index,
    )
    future_route = mission_path[planner_index: segment_end_index + 1]
    valid_actions = env.get_valid_actions()
    if not valid_actions:
        return {
            "raw_dqn_action": WAIT_ACTION,
            "selected_action": WAIT_ACTION,
            "planner_action": planner_action,
            "planner_override": False,
            "safety_override": True,
            "wait_useful": True,
        }

    local_target = next_waypoint or mission_target
    current_target_distance = manhattan_distance(current_position, local_target)
    current_route_distance, nearest_route_index = distance_to_path_index(
        mission_path,
        current_position,
        planner_index,
        segment_end_index,
    )
    target_improving_actions: list[int] = []
    action_scores: dict[int, float] = {}
    action_progress: dict[int, tuple[int, int]] = {}

    for action in valid_actions:
        next_position = current_position if action == WAIT_ACTION else next_position_for_action(current_position, action)
        next_target_distance = manhattan_distance(next_position, local_target)
        distance_improvement = float(current_target_distance - next_target_distance)
        if distance_improvement > 0:
            target_improving_actions.append(action)

        route_penalty, next_route_index = distance_to_path_index(
            mission_path,
            next_position,
            planner_index,
            segment_end_index,
        )
        penalty_cost = penalty_cost_for_cell(env, next_position)
        wait_penalty = 0.0
        if action == WAIT_ACTION:
            wait_penalty = 3.0
        if env.remaining_pickups and env.is_delivery_position(next_position):
            action_scores[action] = float("-inf")
            action_progress[action] = (route_penalty, next_route_index)
            continue

        action_scores[action] = (
            float(q_values[action].item())
            + 2.0 * distance_improvement
            - 1.5 * route_penalty
            - penalty_cost
            - wait_penalty
        )
        action_progress[action] = (route_penalty, next_route_index)

    wait_useful = dynamic_block_requires_wait(env, planner_action, target_improving_actions)
    if WAIT_ACTION in action_scores and not wait_useful:
        action_scores[WAIT_ACTION] -= 4.0

    raw_dqn_action = max(valid_actions, key=lambda action: float(q_values[action].item()))
    scored_actions = [action for action in valid_actions if action_scores[action] != float("-inf")]
    if not scored_actions:
        scored_actions = [action for action in valid_actions if action == WAIT_ACTION] or valid_actions
    selected_action = max(scored_actions, key=lambda action: action_scores[action])
    planner_override = False

    raw_next_position = current_position if raw_dqn_action == WAIT_ACTION else next_position_for_action(current_position, raw_dqn_action)
    raw_route_distance = route_distance(raw_next_position, future_route)
    raw_target_delta = manhattan_distance(raw_next_position, local_target) - current_target_distance
    raw_is_bad = (
        raw_target_delta > 0
        or raw_route_distance > MAX_ROUTE_DEVIATION
        or (env.remaining_pickups and env.is_delivery_position(raw_next_position))
    )

    if planner_action is not None and planner_action in valid_actions:
        selected_next_position = current_position if selected_action == WAIT_ACTION else next_position_for_action(current_position, selected_action)
        selected_route_distance, selected_route_index = action_progress.get(
            selected_action,
            distance_to_path_index(
                mission_path,
                selected_next_position,
                planner_index,
                segment_end_index,
            ),
        )
        if current_route_distance > 0 and selected_route_index <= nearest_route_index:
            selected_action = planner_action
            planner_override = True
        elif current_route_distance == 0 and selected_route_distance > 0:
            selected_action = planner_action
            planner_override = True
        elif selected_route_distance > MAX_ROUTE_DEVIATION:
            selected_action = planner_action
            planner_override = True
        elif raw_is_bad and bad_dqn_streak >= MAX_BAD_DQN_STREAK:
            selected_action = planner_action
            planner_override = True
        elif selected_route_distance > current_route_distance + 1:
            selected_action = planner_action
            planner_override = True
        elif planner_stall_steps >= MAX_PLANNER_STALL_STEPS:
            selected_action = planner_action
            planner_override = True

    if selected_action == WAIT_ACTION and not wait_useful and planner_action is not None and planner_action in valid_actions:
        selected_action = planner_action
        planner_override = True

    selected_action, safety_override = choose_safe_action(
        env=env,
        preferred_action=selected_action,
        planner_action=planner_action,
        wait_useful=wait_useful,
    )
    if planner_action is not None and selected_action == planner_action and selected_action != raw_dqn_action:
        planner_override = True

    return {
        "raw_dqn_action": raw_dqn_action,
        "selected_action": selected_action,
        "planner_action": planner_action,
        "planner_override": planner_override,
        "safety_override": safety_override,
        "wait_useful": wait_useful,
        "raw_is_bad": raw_is_bad,
        "next_waypoint": next_waypoint,
        "local_target": list(local_target),
    }


def run_planner_guided_inference(
    map_config: dict[str, Any],
    model: DeliveryDQN,
    device: torch.device,
    max_steps: int | None = None,
) -> dict[str, Any]:
    normalized_map = normalize_map_config(map_config)
    plan = build_mission_path(normalized_map)
    if plan is None:
        raise ValueError("no_valid_route")
    resolved_max_steps = max_steps or recommended_max_steps(normalized_map, plan)

    # Planner builds the mission route; DQN only influences local action choice.
    normalized_map["ordered_pickups"] = plan["ordered_pickups"]
    normalized_map["ordered_deliveries"] = plan["ordered_deliveries"]

    planner_path_to_pickup = [list(cell) for cell in plan["path_to_pickup"]]
    planner_path_to_delivery = [list(cell) for cell in plan["path_to_delivery"]]
    planner_path = [list(cell) for cell in plan["mission_path"]]
    mission_path = [tuple(cell) for cell in plan["mission_path"]]
    ordered_pickups = [tuple(cell) for cell in plan["ordered_pickups"]]
    ordered_deliveries = [tuple(cell) for cell in plan["ordered_deliveries"]]

    # Dynamic obstacle timelines keep backend rollout and frontend replay synchronized.
    env = DeliveryDQNEnvironment(normalized_map, max_steps=resolved_max_steps)
    state = torch.as_tensor(env.reset(), dtype=torch.float32, device=device)
    path = [list(env.position)]
    actions: list[int] = []
    dqn_actions: list[int] = []
    time_phases = [env.time_phase]
    timeline = [build_timeline_frame(env, 0)]
    total_reward = 0.0
    reached_pickup = False
    reached_delivery = False
    completed_delivery = False
    pickup_step = -1
    delivery_step = -1
    pickup_steps: list[int] = []
    delivery_steps: list[int] = []
    collisions = 0
    dynamic_collisions = 0
    penalty_zone_visits = 0
    wait_count = 0
    max_consecutive_wait = 0
    excessive_wait_count = 0
    timed_out = False
    failure_reason: str | None = None
    planner_override_count = 0
    dqn_action_count = 0
    safety_override_count = 0
    bad_dqn_streak = 0
    stuck_steps = 0
    planner_index = 0
    planner_stall_steps = 0

    for step_index in range(1, resolved_max_steps + 1):
        current_target = env.target_position()
        segment_end_index = target_index_from_plan(plan, current_target)
        planner_index = advance_planner_index(
            mission_path,
            planner_index,
            env.position,
            segment_end_index,
        )
        action_plan = choose_guided_action(
            model=model,
            state=state,
            env=env,
            device=device,
            mission_path=mission_path,
            planner_index=planner_index,
            segment_end_index=segment_end_index,
            bad_dqn_streak=bad_dqn_streak,
            planner_stall_steps=planner_stall_steps,
        )
        selected_action = int(action_plan["selected_action"])
        raw_dqn_action = int(action_plan["raw_dqn_action"])
        planner_action = action_plan["planner_action"]

        if action_plan["planner_override"]:
            planner_override_count += 1
        elif selected_action == raw_dqn_action:
            dqn_action_count += 1

        if action_plan["safety_override"]:
            safety_override_count += 1

        if action_plan.get("raw_is_bad", False):
            bad_dqn_streak += 1
        else:
            bad_dqn_streak = 0

        if selected_action == WAIT_ACTION:
            wait_count += 1

        planner_index_before_step = planner_index
        next_state, reward, done, info = env.step(selected_action)

        actions.append(selected_action)
        dqn_actions.append(raw_dqn_action)
        path.append(list(env.position))
        time_phases.append(int(info["time_phase"]))
        timeline.append(build_timeline_frame(env, step_index))
        total_reward += reward
        collisions += int(info["collision"])
        dynamic_collisions += int(info["dynamic_collision"])
        penalty_zone_visits += int(info["penalty_zone_visit"])
        max_consecutive_wait = max(max_consecutive_wait, int(info["max_consecutive_wait"]))
        excessive_wait_count = int(info["excessive_wait_count"])
        timed_out = timed_out or bool(info["timed_out"])
        reached_pickup = reached_pickup or bool(info["reached_pickup"])
        reached_delivery = reached_delivery or bool(info["reached_delivery"])
        completed_delivery = completed_delivery or bool(info["completed_delivery"])

        if info["reached_pickups"] > len(pickup_steps):
            pickup_steps.append(step_index)
        if info["completed_deliveries"] > len(delivery_steps):
            delivery_steps.append(step_index)

        if pickup_steps and pickup_step < 0:
            pickup_step = step_index
        if delivery_steps:
            delivery_step = delivery_steps[-1]

        if path[-1] == path[-2]:
            stuck_steps += 1
        else:
            stuck_steps = 0

        # Delivery is only valid after pickup has been reached.
        if env.remaining_pickups and env.is_delivery_position(env.position):
            failure_reason = "mission_order_violation"
            done = True
        elif not completed_delivery and info["dynamic_collision"]:
            failure_reason = "dynamic_collision"
            done = True
        elif not completed_delivery and info["collision"]:
            failure_reason = "collision"
            done = True
        elif not completed_delivery and stuck_steps >= MAX_STUCK_STEPS:
            failure_reason = "stuck"
            done = True
        elif not completed_delivery and info["timed_out"]:
            failure_reason = "timeout"

        state = torch.as_tensor(next_state, dtype=torch.float32, device=device)
        current_target = env.target_position()
        segment_end_index = target_index_from_plan(plan, current_target)
        planner_index = advance_planner_index(
            mission_path,
            planner_index,
            env.position,
            segment_end_index,
        )
        if planner_index > planner_index_before_step:
            planner_stall_steps = 0
        else:
            planner_stall_steps += 1

        if done:
            break

    if not completed_delivery and failure_reason is None:
        if timed_out:
            failure_reason = "timeout"
        elif dynamic_collisions > 0:
            failure_reason = "dynamic_collision"
        elif collisions > 0:
            failure_reason = "collision"
        elif stuck_steps >= MAX_STUCK_STEPS:
            failure_reason = "stuck"
        elif excessive_wait_count > 0 and max_consecutive_wait >= 10:
            failure_reason = "excessive_waiting"
        else:
            failure_reason = "incomplete_delivery"

    return {
        "method": "planner_guided_dqn",
        "planner_used": True,
        "dqn_used": True,
        "used_fallback": False,
        "start": list(normalized_map["start"]),
        "pickups": [list(cell) for cell in ordered_pickups],
        "deliveries": [list(cell) for cell in ordered_deliveries],
        "pickup": list(normalized_map["pickup"]),
        "delivery": list(normalized_map["delivery"]),
        "planner_path": planner_path,
        "planner_path_to_pickup": planner_path_to_pickup,
        "planner_path_to_delivery": planner_path_to_delivery,
        "path": path,
        "actions": actions,
        "dqn_actions": dqn_actions,
        "time_phases": time_phases,
        "path_length": len(actions),
        "mission_complete": completed_delivery,
        "reached_pickup": reached_pickup,
        "reached_pickups": len(pickup_steps),
        "reached_delivery": reached_delivery,
        "completed_deliveries": len(delivery_steps),
        "completed_delivery": completed_delivery,
        "total_reward": round(total_reward, 3),
        "pickup_step": pickup_step,
        "delivery_step": delivery_step,
        "pickup_steps": pickup_steps,
        "delivery_steps": delivery_steps,
        "current_target": list(env.target_position()) if (env.remaining_pickups or env.remaining_deliveries) else None,
        "wait_count": wait_count,
        "max_consecutive_wait": max_consecutive_wait,
        "excessive_wait_count": excessive_wait_count,
        "collisions": collisions,
        "dynamic_collision_count": dynamic_collisions,
        "penalty_zone_visits": penalty_zone_visits,
        "timed_out": timed_out,
        "failure_reason": failure_reason,
        "planner_override_count": planner_override_count,
        "dqn_action_count": dqn_action_count,
        "safety_override_count": safety_override_count,
        "dynamic_obstacle_timeline": timeline,
    }


def run_dqn_inference(
    map_config: dict[str, Any],
    model: DeliveryDQN,
    device: torch.device,
    max_steps: int | None = None,
) -> dict[str, Any]:
    return run_planner_guided_inference(
        map_config=map_config,
        model=model,
        device=device,
        max_steps=max_steps,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run planner-guided DQN inference on a custom delivery map.")
    parser.add_argument("--map", dest="map_path", type=str, default=None)
    parser.add_argument("--max-steps", type=int, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.map_path:
        with Path(args.map_path).open("r", encoding="utf-8") as map_file:
            map_config = json.load(map_file)
    else:
        map_config = sample_custom_map()
        with SAMPLE_MAP_PATH.open("w", encoding="utf-8") as sample_file:
            json.dump(map_config, sample_file, indent=2)

    model, device = load_model()
    rollout = run_planner_guided_inference(
        map_config,
        model=model,
        device=device,
        max_steps=args.max_steps,
    )

    with ROLL_OUT_PATH.open("w", encoding="utf-8") as rollout_file:
        json.dump(rollout, rollout_file, indent=2)

    print(f"Saved planner-guided rollout to {ROLL_OUT_PATH}")
    print(
        f"method={rollout['method']} | completed_delivery={rollout['completed_delivery']} | "
        f"path_length={rollout['path_length']} | reward={rollout['total_reward']} | "
        f"failure_reason={rollout['failure_reason']}"
    )


if __name__ == "__main__":
    main()
