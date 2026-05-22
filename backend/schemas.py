from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class PenaltyZoneInput(BaseModel):
    cell: tuple[int, int]
    penalty: int = -3
    type: Literal["crowded", "danger"] = "crowded"
    label: str | None = None

    @field_validator("cell")
    @classmethod
    def validate_cell(cls, value: tuple[int, int]) -> tuple[int, int]:
        if len(value) != 2:
            raise ValueError("Penalty zone cells must contain row and col.")
        return value


class DynamicObstacleInput(BaseModel):
    id: str
    path: list[tuple[int, int]] = Field(default_factory=list)
    speed: int = Field(default=1, ge=1)
    label: str | None = None
    kind: Literal["cart", "person", "blocker"] | None = None
    color: str | None = None

    @field_validator("path")
    @classmethod
    def validate_path_cells(cls, value: list[tuple[int, int]]) -> list[tuple[int, int]]:
        for cell in value:
            if len(cell) != 2:
                raise ValueError("Dynamic obstacle path cells must contain row and col.")
        return value


class CustomMapRequest(BaseModel):
    rows: int = Field(ge=1, le=20)
    cols: int = Field(ge=1, le=20)
    start: tuple[int, int]
    pickup: tuple[int, int] | None = None
    delivery: tuple[int, int] | None = None
    pickups: list[tuple[int, int]] = Field(default_factory=list)
    deliveries: list[tuple[int, int]] = Field(default_factory=list)
    obstacles: list[tuple[int, int]] = Field(default_factory=list)
    penalty_zones: list[PenaltyZoneInput] = Field(default_factory=list)
    dynamic_obstacles: list[DynamicObstacleInput] = Field(default_factory=list)

    @field_validator("start", "pickup", "delivery")
    @classmethod
    def validate_position_shape(cls, value: tuple[int, int] | None) -> tuple[int, int] | None:
        if value is None:
            return value
        if len(value) != 2:
            raise ValueError("Positions must contain row and col.")
        return value

    @field_validator("pickups", "deliveries")
    @classmethod
    def validate_target_list_shapes(
        cls,
        value: list[tuple[int, int]],
    ) -> list[tuple[int, int]]:
        for cell in value:
            if len(cell) != 2:
                raise ValueError("Mission target cells must contain row and col.")
        return value

    @model_validator(mode="after")
    def validate_distinct_targets(self) -> "CustomMapRequest":
        pickups = list(self.pickups)
        deliveries = list(self.deliveries)
        if self.pickup is not None and not pickups:
            pickups = [self.pickup]
        if self.delivery is not None and not deliveries:
            deliveries = [self.delivery]
        if not pickups:
            raise ValueError("at least one pickup is required.")
        if not deliveries:
            raise ValueError("at least one delivery is required.")
        if len(pickups) != 1:
            raise ValueError("exactly one pickup is required for single-agent missions.")
        if len(deliveries) != 1:
            raise ValueError("exactly one delivery is required for single-agent missions.")

        occupied = [self.start, *pickups, *deliveries]
        if len({tuple(cell) for cell in occupied}) != len(occupied):
            raise ValueError("start, pickups, and deliveries must occupy distinct cells.")
        return self


class DqnInferenceResponseModel(BaseModel):
    method: Literal["planner_guided_dqn"]
    map: dict
    rollout: dict
    inference_meta: dict
