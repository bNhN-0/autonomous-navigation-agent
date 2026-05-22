# Autonomous Delivery Navigation Agent

Autonomous Delivery Navigation Agent is a planner-guided deep reinforcement learning simulator for indoor pickup-and-delivery navigation. A planner builds the mission route, a DQN policy handles local action choices, and a safety layer prevents invalid moves.

The final user-facing app is centered on one method:
- Planner-Guided DQN
- preset scenario replay
- custom-map inference
- 3D mission playback
- indoor pickup and delivery missions

The project does not claim:
- real self-driving capability
- production robotics deployment
- autonomous vehicle deployment

## System Overview

Planner-Guided DQN combines three parts:
- Global planner: builds a mission route from `Start -> Pickup -> Delivery`.
- DQN local policy: influences safe local moves, penalty avoidance, and useful waiting around moving obstacles.
- Safety layer: blocks invalid actions such as wall collisions, obstacle collisions, and delivery before pickup completion.

Preset scenarios and custom maps both use the same backend inference pipeline at `POST /api/infer-custom-map`.

## Final Flow

1. The user selects a preset scenario or creates a custom map.
2. The frontend sends the map layout to the FastAPI backend.
3. The backend validates bounds, obstacles, penalty zones, and dynamic obstacle paths.
4. The planner builds the mission route: `Start -> Pickup -> Delivery`.
5. The DQN policy contributes local action choices near that route.
6. The safety layer blocks invalid movement into walls, obstacles, or premature delivery.
7. The backend returns the executed route, timeline data, and replay metrics.
8. The frontend replays the mission in 3D.

## Repository Layout

```text
backend/                  FastAPI inference service
rl/
  train_scenarios.py      Legacy Q-learning development baseline exporter
  dqn/
    environment.py
    map_generator.py
    model.py
    replay_buffer.py
    train_dqn.py
    infer_dqn.py
    planner.py
visualizer/               Next.js + React Three Fiber frontend
```

## Train The DQN Policy

```powershell
python rl\dqn\train_dqn.py
```

The default run writes:
- `rl/models/dqn_delivery_agent.pt`
- `rl/dqn/outputs/dqn_training_metrics.csv`
- `rl/dqn/outputs/dqn_eval_summary.json`

For a longer local run:

```powershell
python rl\dqn\train_dqn.py --episodes 5000
```

## Run Planner-Guided DQN Inference

```powershell
python rl\dqn\infer_dqn.py
```

That runs Planner-Guided DQN on the bundled sample map and writes:
- `rl/dqn/outputs/sample_custom_map.json`
- `rl/dqn/outputs/custom_dqn_rollout.json`

You can also pass a custom map file:

```powershell
python rl\dqn\infer_dqn.py --map path\to\custom_map.json
```

## Start The Backend

```powershell
uvicorn backend.main:app --reload
```

Available endpoints:
- `GET /api/health`
- `POST /api/infer-custom-map`

The backend validates the map, builds a mission route, runs Planner-Guided DQN rollout, and returns replay-ready path data for the frontend.

## Start The Visualizer

```powershell
cd visualizer
npm install
npm run dev
```

Recommended local stack:
- frontend: `http://localhost:3000`
- backend: `http://localhost:8000`

If needed:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL='http://localhost:8000'
```

## Frontend Features

- preset scenario replay with Planner-Guided DQN
- custom 2D and direct 3D map editing
- single pickup and single delivery missions
- dynamic obstacle timeline replay
- smooth continuous robot playback
- planner route and executed route visualization

## Mission Elements

- Dynamic obstacles move on backend-defined timelines and stay synchronized during replay.
- Penalty zones represent costly or risky tiles that the local policy tries to avoid when possible.
- Pickup must be reached before delivery can complete.
- The custom map editor supports start, pickup, delivery, obstacles, penalty zones, and dynamic obstacle paths.


