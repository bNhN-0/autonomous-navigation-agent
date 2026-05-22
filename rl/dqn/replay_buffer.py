from __future__ import annotations

from collections import deque
from typing import Deque

import numpy as np
import torch


class ReplayBuffer:
    def __init__(self, capacity: int) -> None:
        self.buffer: Deque[tuple[np.ndarray, int, float, np.ndarray, bool, np.ndarray]] = deque(
            maxlen=capacity
        )

    def push(
        self,
        state: np.ndarray,
        action: int,
        reward: float,
        next_state: np.ndarray,
        done: bool,
        next_action_mask: np.ndarray,
    ) -> None:
        self.buffer.append(
            (
                np.asarray(state, dtype=np.float32),
                int(action),
                float(reward),
                np.asarray(next_state, dtype=np.float32),
                bool(done),
                np.asarray(next_action_mask, dtype=np.float32),
            )
        )

    def sample(
        self,
        batch_size: int,
        device: torch.device | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        indices = np.random.choice(len(self.buffer), size=batch_size, replace=False)
        states, actions, rewards, next_states, dones, next_action_masks = zip(
            *(self.buffer[index] for index in indices)
        )

        states_tensor = torch.as_tensor(np.stack(states), dtype=torch.float32, device=device)
        actions_tensor = torch.as_tensor(actions, dtype=torch.long, device=device)
        rewards_tensor = torch.as_tensor(rewards, dtype=torch.float32, device=device)
        next_states_tensor = torch.as_tensor(
            np.stack(next_states),
            dtype=torch.float32,
            device=device,
        )
        dones_tensor = torch.as_tensor(dones, dtype=torch.float32, device=device)
        next_action_masks_tensor = torch.as_tensor(
            np.stack(next_action_masks),
            dtype=torch.float32,
            device=device,
        )

        return (
            states_tensor,
            actions_tensor,
            rewards_tensor,
            next_states_tensor,
            dones_tensor,
            next_action_masks_tensor,
        )

    def __len__(self) -> int:
        return len(self.buffer)
