from __future__ import annotations

import argparse
import json
import random
from collections import deque
from pathlib import Path
import sys
from typing import Any

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from torch import nn

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from rl.dqn.environment import ACTION_COUNT, WAIT_ACTION, DeliveryDQNEnvironment
from rl.dqn.map_generator import (
    bfs_path,
    build_validation_maps,
    curriculum_stage_for_episode,
    generate_curriculum_map,
)
from rl.dqn.model import DeliveryDQN
from rl.dqn.replay_buffer import ReplayBuffer

# Conservative default for local runs. Increase to 5000+ for stronger training.
EPISODES = 200
MAX_STEPS = 220
BATCH_SIZE = 32
GAMMA = 0.99
LEARNING_RATE = 1e-4
REPLAY_BUFFER_SIZE = 50_000
MIN_REPLAY_SIZE = 500
TARGET_UPDATE_INTERVAL = 250
TRAIN_INTERVAL = 4
DEMO_PREFILL_EPISODES = 1000
TEACHER_ASSIST_EPISODES = 10
TEACHER_ASSIST_PROB = 0.2
BEHAVIOR_CLONE_UPDATES = 15000
EVAL_INTERVAL = 250
EPSILON_START = 1.0
EPSILON_END = 0.05
EPSILON_DECAY_RATIO = 0.8
ROLLING_WINDOW = 100
SEED = 12345

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = PROJECT_ROOT / "rl" / "models" / "dqn_delivery_agent.pt"
BEST_MODEL_PATH = PROJECT_ROOT / "rl" / "models" / "dqn_delivery_agent_best.pt"
OUTPUT_DIR = PROJECT_ROOT / "rl" / "dqn" / "outputs"
METRICS_PATH = OUTPUT_DIR / "dqn_training_metrics.csv"
SUMMARY_PATH = OUTPUT_DIR / "dqn_eval_summary.json"


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def epsilon_for_episode(episode: int, epsilon_decay_steps: int) -> float:
    progress = min(episode / max(1, epsilon_decay_steps), 1.0)
    epsilon = EPSILON_START - progress * (EPSILON_START - EPSILON_END)
    return max(EPSILON_END, epsilon)


def select_action(
    model: DeliveryDQN,
    state: np.ndarray,
    env: DeliveryDQNEnvironment,
    epsilon: float,
    rng: random.Random,
    device: torch.device,
) -> int:
    valid_actions = env.get_valid_actions()
    if not valid_actions:
        return WAIT_ACTION

    if rng.random() < epsilon:
        return rng.choice(valid_actions)

    state_tensor = torch.as_tensor(state, dtype=torch.float32, device=device).unsqueeze(0)
    with torch.no_grad():
        q_values = model(state_tensor).squeeze(0).detach().cpu().numpy()

    masked_q_values = np.full(ACTION_COUNT, -np.inf, dtype=np.float32)
    masked_q_values[valid_actions] = q_values[valid_actions]
    return int(np.argmax(masked_q_values))


def action_from_transition(current: tuple[int, int], nxt: tuple[int, int]) -> int:
    delta = (nxt[0] - current[0], nxt[1] - current[1])
    for action, direction in {
        0: (-1, 0),
        1: (1, 0),
        2: (0, -1),
        3: (0, 1),
    }.items():
        if direction == delta:
            return action
    return 4


def teacher_action(env: DeliveryDQNEnvironment) -> int:
    grid = [[0 for _ in range(env.cols)] for _ in range(env.rows)]
    for row, col in env.obstacles:
        grid[row][col] = 1

    target = env.delivery if env.has_pickup else env.pickup
    valid_actions = env.get_valid_actions()
    static_path = bfs_path(grid, env.position, target)

    if static_path and len(static_path) > 1:
        desired_action = action_from_transition(static_path[0], static_path[1])
        if desired_action in valid_actions:
            return desired_action
        if 4 in valid_actions:
            return 4

    if 4 in valid_actions:
        return 4

    return valid_actions[0]


def optimize_model(
    policy_net: DeliveryDQN,
    target_net: DeliveryDQN,
    optimizer: torch.optim.Optimizer,
    replay_buffer: ReplayBuffer,
    batch_size: int,
    device: torch.device,
) -> float | None:
    if len(replay_buffer) < batch_size:
        return None

    states, actions, rewards, next_states, dones, next_action_masks = replay_buffer.sample(
        batch_size,
        device=device,
    )
    q_values = policy_net(states).gather(1, actions.unsqueeze(1)).squeeze(1)

    with torch.no_grad():
        next_q_logits = target_net(next_states)
        masked_next_q_values = next_q_logits.masked_fill(next_action_masks <= 0, float("-inf"))
        next_q_values = masked_next_q_values.max(dim=1).values
        next_q_values = torch.where(
            next_action_masks.sum(dim=1) > 0,
            next_q_values,
            torch.zeros_like(next_q_values),
        )
        target_values = rewards + GAMMA * next_q_values * (1.0 - dones)

    loss = F.smooth_l1_loss(q_values, target_values)
    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    nn.utils.clip_grad_norm_(policy_net.parameters(), max_norm=5.0)
    optimizer.step()

    return float(loss.item())


def behavior_clone_pretrain(
    policy_net: DeliveryDQN,
    optimizer: torch.optim.Optimizer,
    demo_samples: list[tuple[np.ndarray, int]],
    device: torch.device,
    updates: int,
) -> None:
    if not demo_samples:
        return

    for _ in range(updates):
        indices = np.random.choice(
            len(demo_samples),
            size=min(BATCH_SIZE, len(demo_samples)),
            replace=False,
        )
        sampled_states = np.stack([demo_samples[index][0] for index in indices])
        sampled_actions = np.array([demo_samples[index][1] for index in indices], dtype=np.int64)

        state_tensor = torch.as_tensor(sampled_states, dtype=torch.float32, device=device)
        action_tensor = torch.as_tensor(sampled_actions, dtype=torch.long, device=device)
        logits = policy_net(state_tensor)
        loss = F.cross_entropy(logits, action_tensor)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        nn.utils.clip_grad_norm_(policy_net.parameters(), max_norm=5.0)
        optimizer.step()


def rollout_episode(
    policy_net: DeliveryDQN,
    env: DeliveryDQNEnvironment,
    rng: random.Random,
    device: torch.device,
    epsilon: float,
    replay_buffer: ReplayBuffer | None = None,
) -> dict[str, Any]:
    state = env.reset()
    total_reward = 0.0
    collisions = 0
    dynamic_collisions = 0
    penalty_zone_visits = 0
    wait_count = 0
    reached_pickup = False
    completed_delivery = False

    for step_index in range(1, env.max_steps + 1):
        action = select_action(policy_net, state, env, epsilon, rng, device)
        next_state, reward, done, info = env.step(action)

        if replay_buffer is not None:
            replay_buffer.push(
                state,
                action,
                reward,
                next_state,
                done,
                env.get_action_mask(),
            )

        total_reward += reward
        collisions += int(info["collision"])
        dynamic_collisions += int(info["dynamic_collision"])
        penalty_zone_visits += int(info["penalty_zone_visit"])
        wait_count += int(info["wait"])
        reached_pickup = reached_pickup or bool(info["reached_pickup"])
        completed_delivery = completed_delivery or bool(info["completed_delivery"])
        state = next_state

        if done:
            return {
                "reward": round(total_reward, 3),
                "steps": step_index,
                "success": int(completed_delivery),
                "reached_pickup": int(reached_pickup),
                "completed_delivery": int(completed_delivery),
                "collisions": collisions,
                "dynamic_collisions": dynamic_collisions,
                "penalty_zone_visits": penalty_zone_visits,
                "wait_count": wait_count,
            }

    return {
        "reward": round(total_reward, 3),
        "steps": env.max_steps,
        "success": int(completed_delivery),
        "reached_pickup": int(reached_pickup),
        "completed_delivery": int(completed_delivery),
        "collisions": collisions,
        "dynamic_collisions": dynamic_collisions,
        "penalty_zone_visits": penalty_zone_visits,
        "wait_count": wait_count,
    }


def evaluate_policy(
    policy_net: DeliveryDQN,
    device: torch.device,
    map_configs: list[dict[str, Any]],
    max_steps: int,
) -> dict[str, float]:
    rng = random.Random(SEED + 900)
    metrics: list[dict[str, Any]] = []

    for map_config in map_configs:
        env = DeliveryDQNEnvironment(map_config, max_steps=max_steps)
        metrics.append(
            rollout_episode(
                policy_net=policy_net,
                env=env,
                rng=rng,
                device=device,
                epsilon=0.0,
            )
        )

    frame = pd.DataFrame(metrics)
    return {
        "episodes": len(map_configs),
        "eval_avg_reward": round(float(frame["reward"].mean()), 3),
        "eval_avg_steps": round(float(frame["steps"].mean()), 3),
        "eval_success_rate": round(float(frame["success"].mean()), 3),
        "collision_rate": round(float(frame["collisions"].mean()), 3),
        "pickup_success_rate": round(float(frame["reached_pickup"].mean()), 3),
        "delivery_success_rate": round(float(frame["completed_delivery"].mean()), 3),
    }


def train_dqn(
    episodes: int,
    max_steps: int,
    epsilon_decay_steps: int | None = None,
) -> dict[str, Any]:
    set_seed(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    rng = random.Random(SEED)
    resolved_epsilon_decay_steps = (
        max(1, int(episodes * EPSILON_DECAY_RATIO))
        if epsilon_decay_steps is None
        else max(1, epsilon_decay_steps)
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    validation_maps = build_validation_maps()

    policy_net = DeliveryDQN().to(device)
    target_net = DeliveryDQN().to(device)
    target_net.load_state_dict(policy_net.state_dict())
    target_net.eval()

    optimizer = torch.optim.Adam(policy_net.parameters(), lr=LEARNING_RATE)
    replay_buffer = ReplayBuffer(REPLAY_BUFFER_SIZE)
    demo_samples: list[tuple[np.ndarray, int]] = []
    demo_prefill_episodes = min(DEMO_PREFILL_EPISODES, max(60, episodes))
    behavior_clone_updates = min(BEHAVIOR_CLONE_UPDATES, max(750, episodes * 12))

    metrics: list[dict[str, Any]] = []
    rolling_successes: deque[int] = deque(maxlen=ROLLING_WINDOW)
    best_rolling_success = -1.0
    global_step = 0
    last_loss = None

    print(
        f"Training DQN delivery agent for {episodes} episodes on {device.type.upper()} "
        f"(increase to 5000+ episodes for a stronger policy). "
        f"epsilon_decay_steps={resolved_epsilon_decay_steps} | "
        f"demo_prefill={demo_prefill_episodes} | bc_updates={behavior_clone_updates}"
    )

    for demo_index in range(demo_prefill_episodes):
        demo_stage = curriculum_stage_for_episode(demo_index + 1, demo_prefill_episodes)
        map_config = generate_curriculum_map(demo_stage, random.Random(SEED + 50_000 + demo_index))
        env = DeliveryDQNEnvironment(map_config, max_steps=max_steps)
        state = env.reset()

        for _ in range(max_steps):
            action = teacher_action(env)
            next_state, reward, done, _ = env.step(action)
            replay_buffer.push(
                state,
                action,
                reward,
                next_state,
                done,
                env.get_action_mask(),
            )
            demo_samples.append((state, action))
            state = next_state
            if done:
                break

    behavior_clone_pretrain(
        policy_net,
        optimizer,
        demo_samples,
        device,
        updates=behavior_clone_updates,
    )
    target_net.load_state_dict(policy_net.state_dict())
    initial_validation = evaluate_policy(
        policy_net,
        device=device,
        map_configs=validation_maps,
        max_steps=max_steps,
    )
    best_eval_score = (
        float(initial_validation["eval_success_rate"]),
        float(initial_validation["eval_avg_reward"]),
    )
    best_rolling_success = initial_validation["eval_success_rate"]
    torch.save(
        {
            "model_state_dict": policy_net.state_dict(),
            "episodes": 0,
            "state_channels": 8,
            "action_count": ACTION_COUNT,
        },
        BEST_MODEL_PATH,
    )

    for episode in range(1, episodes + 1):
        stage_config = curriculum_stage_for_episode(episode, episodes)
        map_config = generate_curriculum_map(stage_config, random.Random(SEED + episode))
        env = DeliveryDQNEnvironment(map_config, max_steps=max_steps)
        state = env.reset()
        epsilon = epsilon_for_episode(episode, resolved_epsilon_decay_steps)
        episode_reward = 0.0
        collisions = 0
        dynamic_collisions = 0
        penalty_zone_visits = 0
        wait_count = 0
        reached_pickup = False
        completed_delivery = False

        for step_index in range(1, max_steps + 1):
            use_teacher = (
                episode <= TEACHER_ASSIST_EPISODES
                and rng.random() < TEACHER_ASSIST_PROB
            )
            action = (
                teacher_action(env)
                if use_teacher
                else select_action(policy_net, state, env, epsilon, rng, device)
            )
            next_state, reward, done, info = env.step(action)
            replay_buffer.push(
                state,
                action,
                reward,
                next_state,
                done,
                env.get_action_mask(),
            )

            if len(replay_buffer) >= MIN_REPLAY_SIZE and global_step % TRAIN_INTERVAL == 0:
                loss = optimize_model(
                    policy_net=policy_net,
                    target_net=target_net,
                    optimizer=optimizer,
                    replay_buffer=replay_buffer,
                    batch_size=BATCH_SIZE,
                    device=device,
                )
                if loss is not None:
                    last_loss = loss

            episode_reward += reward
            collisions += int(info["collision"])
            dynamic_collisions += int(info["dynamic_collision"])
            penalty_zone_visits += int(info["penalty_zone_visit"])
            wait_count += int(info["wait"])
            reached_pickup = reached_pickup or bool(info["reached_pickup"])
            completed_delivery = completed_delivery or bool(info["completed_delivery"])
            state = next_state
            global_step += 1

            if global_step % TARGET_UPDATE_INTERVAL == 0:
                target_net.load_state_dict(policy_net.state_dict())

            if done:
                break

        episode_metrics = {
            "episode": episode,
            "reward": round(episode_reward, 3),
            "steps": step_index,
            "success": int(completed_delivery),
            "reached_pickup": int(reached_pickup),
            "completed_delivery": int(completed_delivery),
            "collisions": collisions,
            "dynamic_collisions": dynamic_collisions,
            "penalty_zone_visits": penalty_zone_visits,
            "wait_count": wait_count,
            "epsilon": round(epsilon, 4),
            "map_type": map_config.get("map_type", "custom"),
            "curriculum_stage": int(map_config.get("curriculum_stage", 0)),
            "curriculum_label": map_config.get("curriculum_label", "custom"),
        }
        metrics.append(episode_metrics)
        rolling_successes.append(int(completed_delivery))
        rolling_success_rate = sum(rolling_successes) / len(rolling_successes)

        if episode % EVAL_INTERVAL == 0:
            validation = evaluate_policy(
                policy_net,
                device=device,
                map_configs=validation_maps,
                max_steps=max_steps,
            )
            eval_score = (
                float(validation["eval_success_rate"]),
                float(validation["eval_avg_reward"]),
            )
            if eval_score > best_eval_score:
                best_eval_score = eval_score
                best_rolling_success = validation["eval_success_rate"]
                torch.save(
                    {
                        "model_state_dict": policy_net.state_dict(),
                        "episodes": episode,
                        "state_channels": 8,
                        "action_count": ACTION_COUNT,
                    },
                    BEST_MODEL_PATH,
                )
            print(
                f"eval@episode={episode:4d} | eval_success_rate={validation['eval_success_rate']:.3f} | "
                f"eval_avg_reward={validation['eval_avg_reward']:8.3f} | "
                f"eval_avg_steps={validation['eval_avg_steps']:7.3f}"
            )

        if episode % 50 == 0 or episode == episodes:
            recent = metrics[-min(ROLLING_WINDOW, len(metrics)) :]
            average_reward = np.mean([item["reward"] for item in recent])
            print(
                f"episode={episode:4d} | stage={stage_config['stage']} | rolling_success={rolling_success_rate:.3f} | "
                f"avg_reward={average_reward:7.3f} | epsilon={episode_metrics['epsilon']:.3f} | "
                f"loss={last_loss if last_loss is not None else 'n/a'}"
            )

    torch.save(
        {
            "model_state_dict": policy_net.state_dict(),
            "episodes": episodes,
            "state_channels": 8,
            "action_count": ACTION_COUNT,
        },
        MODEL_PATH,
    )

    final_validation = evaluate_policy(
        policy_net,
        device=device,
        map_configs=validation_maps,
        max_steps=max_steps,
    )
    final_eval_score = (
        float(final_validation["eval_success_rate"]),
        float(final_validation["eval_avg_reward"]),
    )
    if final_eval_score > best_eval_score:
        best_eval_score = final_eval_score
        best_rolling_success = final_validation["eval_success_rate"]
        torch.save(
            {
                "model_state_dict": policy_net.state_dict(),
                "episodes": episodes,
                "state_channels": 8,
                "action_count": ACTION_COUNT,
            },
            BEST_MODEL_PATH,
        )

    metrics_df = pd.DataFrame(metrics)
    metrics_df.to_csv(METRICS_PATH, index=False)

    checkpoint = torch.load(BEST_MODEL_PATH if BEST_MODEL_PATH.exists() else MODEL_PATH, map_location=device)
    policy_net.load_state_dict(checkpoint["model_state_dict"])
    evaluation = evaluate_policy(policy_net, device=device, map_configs=validation_maps, max_steps=max_steps)
    evaluation["episodes_trained"] = episodes
    evaluation["final_model_path"] = str(MODEL_PATH)
    evaluation["best_model_path"] = str(BEST_MODEL_PATH)
    evaluation["model_path"] = str(BEST_MODEL_PATH if BEST_MODEL_PATH.exists() else MODEL_PATH)
    evaluation["best_validation_success_rate"] = round(best_rolling_success, 3)
    evaluation["best_validation_average_reward"] = round(best_eval_score[1], 3)
    evaluation["final_rolling_success_rate"] = round(rolling_success_rate, 3)
    evaluation["average_training_reward"] = round(float(metrics_df["reward"].mean()), 3)
    evaluation["average_training_steps"] = round(float(metrics_df["steps"].mean()), 3)

    with SUMMARY_PATH.open("w", encoding="utf-8") as summary_file:
        json.dump(evaluation, summary_file, indent=2)

    return evaluation


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a reusable DQN delivery agent.")
    parser.add_argument("--episodes", type=int, default=EPISODES)
    parser.add_argument("--max-steps", type=int, default=MAX_STEPS)
    parser.add_argument("--epsilon-decay-steps", type=int, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    summary = train_dqn(
        episodes=args.episodes,
        max_steps=args.max_steps,
        epsilon_decay_steps=args.epsilon_decay_steps,
    )

    print("\nDQN Training Summary")
    print(f"Episodes trained: {summary['episodes_trained']}")
    print(f"Final rolling success rate: {summary['final_rolling_success_rate']}")
    print(f"Best validation success rate: {summary['best_validation_success_rate']}")
    print(f"Best validation avg reward: {summary['best_validation_average_reward']}")
    print(f"Average reward: {summary['average_training_reward']}")
    print(f"Average steps: {summary['average_training_steps']}")
    print(f"Collision rate: {summary['collision_rate']}")
    print(f"Pickup success rate: {summary['pickup_success_rate']}")
    print(f"Delivery success rate: {summary['delivery_success_rate']}")
    print(f"Eval success rate: {summary['eval_success_rate']}")
    print(f"Eval avg reward: {summary['eval_avg_reward']}")
    print(f"Eval avg steps: {summary['eval_avg_steps']}")
    print(f"Model save path: {summary['model_path']}")


if __name__ == "__main__":
    main()
