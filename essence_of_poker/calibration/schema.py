"""Canonical records used by the range-calibration data pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

ActionType = Literal["fold", "check", "call", "bet", "raise", "all-in"]
Street = Literal["preflop", "flop", "turn", "river"]

VALID_ACTION_TYPES: frozenset[str] = frozenset(("fold", "check", "call", "bet", "raise", "all-in"))
VALID_STREETS: frozenset[str] = frozenset(("preflop", "flop", "turn", "river"))


@dataclass(frozen=True)
class CardRecord:
    """A physical card in project rank/suit encoding."""

    rank: int
    suit: int

    def __post_init__(self) -> None:
        if not 1 <= int(self.rank) <= 13:
            raise ValueError(f"rank must be in 1..13: {self.rank!r}")
        if not 1 <= int(self.suit) <= 4:
            raise ValueError(f"suit must be in 1..4: {self.suit!r}")

    @property
    def token(self) -> str:
        rank = "AKQJT98765432"[self.rank - 1]
        suit = "shdc"[self.suit - 1]
        return f"{rank}{suit}"


@dataclass(frozen=True)
class PlayerRecord:
    source_player_id: str
    seat: int | None
    position: str | None
    stack_bb: float | None = None
    is_hero: bool = False
    hole_cards: tuple[CardRecord, ...] = ()


@dataclass(frozen=True)
class ActionRecord:
    index: int
    player_id: str
    street: Street
    action_type: ActionType
    amount_bb: float | None = None
    pot_fraction: float | None = None
    all_in: bool = False

    def __post_init__(self) -> None:
        if self.street not in VALID_STREETS:
            raise ValueError(f"unknown street: {self.street!r}")
        if self.action_type not in VALID_ACTION_TYPES:
            raise ValueError(f"unknown action type: {self.action_type!r}")


@dataclass(frozen=True)
class HandHistoryRecord:
    source: str
    source_hand_id: str
    game: str = "NLHE"
    played_at: datetime | None = None
    site: str | None = None
    stake_bb: float | None = None
    max_players: int | None = None
    button_seat: int | None = None
    players: tuple[PlayerRecord, ...] = ()
    actions: tuple[ActionRecord, ...] = ()
    board: tuple[CardRecord, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.source_hand_id:
            raise ValueError("source_hand_id is required")
        if self.max_players is not None and not 2 <= int(self.max_players) <= 10:
            raise ValueError(f"max_players must be in 2..10: {self.max_players!r}")
        if self.played_at is not None and self.played_at.tzinfo is None:
            object.__setattr__(self, "played_at", self.played_at.replace(tzinfo=timezone.utc))


@dataclass(frozen=True)
class TrainingExample:
    hand_key: str
    player_id: str
    action_index: int
    street: Street
    position: str
    action_type: ActionType
    features: dict[str, float | str]
    weight: float = 1.0

    @property
    def split_key(self) -> str:
        return self.hand_key
