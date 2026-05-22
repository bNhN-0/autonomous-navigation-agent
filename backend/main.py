from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.schemas import CustomMapRequest, DqnInferenceResponseModel
from backend.services.dqn_service import infer_custom_map
from rl.dqn.infer_dqn import BEST_MODEL_PATH, FINAL_MODEL_PATH, resolve_model_path

app = FastAPI(
    title="Autonomous Delivery Navigation Agent API",
    description="FastAPI backend for planner-guided DQN custom-map inference.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, object]:
    model_path = resolve_model_path()
    return {
        "status": "ok",
        "model_available": BEST_MODEL_PATH.exists() or FINAL_MODEL_PATH.exists(),
        "model_name": model_path.name,
    }


@app.post("/api/infer-custom-map", response_model=DqnInferenceResponseModel)
def infer_custom_map_endpoint(payload: CustomMapRequest) -> dict[str, object]:
    try:
        result = infer_custom_map(payload.model_dump())
        meta = result.get("inference_meta", {})
        to_flag = lambda value: str(bool(value)).lower()
        print("CUSTOM MAP INFERENCE")
        print(f"checkpoint_used: {meta.get('checkpoint_used')}")
        print(f"method: {meta.get('method')}")
        print(f"planner_used: {to_flag(meta.get('planner_used'))}")
        print(f"dqn_used: {to_flag(meta.get('dqn_used'))}")
        print(f"used_fallback: {to_flag(meta.get('used_fallback'))}")
        print(f"completed_delivery: {to_flag(meta.get('completed_delivery'))}")
        print(f"reached_pickup: {to_flag(meta.get('reached_pickup'))}")
        print(f"pickup_step: {meta.get('pickup_step')}")
        print(f"delivery_step: {meta.get('delivery_step')}")
        print(f"path_length: {meta.get('path_length')}")
        print(f"planner_override_count: {meta.get('planner_override_count')}")
        print(f"dqn_action_count: {meta.get('dqn_action_count')}")
        print(f"failure_reason: {meta.get('failure_reason')}")
        print(f"first_20_path_cells: {meta.get('first_20_path_cells')}")
        return result
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
