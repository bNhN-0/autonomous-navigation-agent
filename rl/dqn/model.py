from __future__ import annotations

import torch
from torch import nn


class DeliveryDQN(nn.Module):
    def __init__(self, input_channels: int = 8, action_count: int = 5) -> None:
        super().__init__()
        self.network = nn.Sequential(
            nn.Conv2d(input_channels, 32, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(32, 64, kernel_size=3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, 64, kernel_size=3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.Flatten(),
            nn.Linear(64 * 5 * 5, 256),
            nn.ReLU(inplace=True),
            nn.Linear(256, action_count),
        )

    def forward(self, state: torch.Tensor) -> torch.Tensor:
        return self.network(state)
