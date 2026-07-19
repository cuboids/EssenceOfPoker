"""SQLite repository for imported hands, training rows, and model artifacts."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from essence_of_poker.calibration.schema import (
    ActionRecord,
    CardRecord,
    HandHistoryRecord,
    PlayerRecord,
    TrainingExample,
)

SCHEMA_VERSION = 1


class CalibrationStore:
    """Durable store for range-calibration data.

    SQLite is intentionally the first boundary: it is portable, fast enough for
    local corpora, and keeps a clear upgrade path to DuckDB/Postgres later.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")

    def close(self) -> None:
        self.connection.close()

    def initialize(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS hands (
              hand_key TEXT PRIMARY KEY,
              source TEXT NOT NULL,
              source_hand_id TEXT NOT NULL,
              game TEXT NOT NULL,
              played_at TEXT,
              site TEXT,
              stake_bb REAL,
              max_players INTEGER,
              button_seat INTEGER,
              board_json TEXT NOT NULL,
              metadata_json TEXT NOT NULL,
              UNIQUE(source, source_hand_id)
            );

            CREATE TABLE IF NOT EXISTS players (
              hand_key TEXT NOT NULL,
              player_id TEXT NOT NULL,
              seat INTEGER,
              position TEXT,
              stack_bb REAL,
              is_hero INTEGER NOT NULL,
              hole_cards_json TEXT NOT NULL,
              PRIMARY KEY(hand_key, player_id),
              FOREIGN KEY(hand_key) REFERENCES hands(hand_key) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS actions (
              hand_key TEXT NOT NULL,
              action_index INTEGER NOT NULL,
              player_id TEXT NOT NULL,
              street TEXT NOT NULL,
              action_type TEXT NOT NULL,
              amount_bb REAL,
              pot_fraction REAL,
              all_in INTEGER NOT NULL,
              PRIMARY KEY(hand_key, action_index),
              FOREIGN KEY(hand_key) REFERENCES hands(hand_key) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS training_examples (
              example_key TEXT PRIMARY KEY,
              hand_key TEXT NOT NULL,
              player_id TEXT NOT NULL,
              action_index INTEGER NOT NULL,
              street TEXT NOT NULL,
              position TEXT NOT NULL,
              action_type TEXT NOT NULL,
              features_json TEXT NOT NULL,
              weight REAL NOT NULL,
              FOREIGN KEY(hand_key) REFERENCES hands(hand_key) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS player_archetypes (
              model_key TEXT NOT NULL,
              player_id TEXT NOT NULL,
              archetype_json TEXT NOT NULL,
              PRIMARY KEY(model_key, player_id)
            );

            CREATE TABLE IF NOT EXISTS model_artifacts (
              model_key TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              kind TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              metrics_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_actions_player ON actions(player_id, street, action_type);
            CREATE INDEX IF NOT EXISTS idx_examples_action ON training_examples(action_type, street, position);
            """
        )
        self.connection.execute(
            "INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)",
            ("schema_version", str(SCHEMA_VERSION)),
        )
        self.connection.commit()

    def upsert_hand(self, hand: HandHistoryRecord) -> str:
        hand_key = make_hand_key(hand.source, hand.source_hand_id)
        with self.connection:
            self.connection.execute(
                """
                INSERT OR REPLACE INTO hands (
                  hand_key, source, source_hand_id, game, played_at, site, stake_bb,
                  max_players, button_seat, board_json, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    hand_key,
                    hand.source,
                    hand.source_hand_id,
                    hand.game,
                    encode_datetime(hand.played_at),
                    hand.site,
                    hand.stake_bb,
                    hand.max_players,
                    hand.button_seat,
                    encode_cards(hand.board),
                    json.dumps(hand.metadata, sort_keys=True),
                ),
            )
            self.connection.execute("DELETE FROM players WHERE hand_key = ?", (hand_key,))
            self.connection.execute("DELETE FROM actions WHERE hand_key = ?", (hand_key,))
            self.connection.executemany(
                """
                INSERT INTO players (
                  hand_key, player_id, seat, position, stack_bb, is_hero, hole_cards_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        hand_key,
                        player.source_player_id,
                        player.seat,
                        player.position,
                        player.stack_bb,
                        int(player.is_hero),
                        encode_cards(player.hole_cards),
                    )
                    for player in hand.players
                ],
            )
            self.connection.executemany(
                """
                INSERT INTO actions (
                  hand_key, action_index, player_id, street, action_type,
                  amount_bb, pot_fraction, all_in
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        hand_key,
                        action.index,
                        action.player_id,
                        action.street,
                        action.action_type,
                        action.amount_bb,
                        action.pot_fraction,
                        int(action.all_in),
                    )
                    for action in hand.actions
                ],
            )
        return hand_key

    def upsert_hands_with_examples(self, items: Iterable[tuple[HandHistoryRecord, list[TrainingExample]]]) -> dict[str, int]:
        rows = list(items)
        hand_rows = []
        player_rows = []
        action_rows = []
        example_rows = []
        for hand, examples in rows:
            hand_key = make_hand_key(hand.source, hand.source_hand_id)
            hand_rows.append(
                (
                    hand_key,
                    hand.source,
                    hand.source_hand_id,
                    hand.game,
                    encode_datetime(hand.played_at),
                    hand.site,
                    hand.stake_bb,
                    hand.max_players,
                    hand.button_seat,
                    encode_cards(hand.board),
                    json.dumps(hand.metadata, sort_keys=True),
                )
            )
            player_rows.extend(
                (
                    hand_key,
                    player.source_player_id,
                    player.seat,
                    player.position,
                    player.stack_bb,
                    int(player.is_hero),
                    encode_cards(player.hole_cards),
                )
                for player in hand.players
            )
            action_rows.extend(
                (
                    hand_key,
                    action.index,
                    action.player_id,
                    action.street,
                    action.action_type,
                    action.amount_bb,
                    action.pot_fraction,
                    int(action.all_in),
                )
                for action in hand.actions
            )
            example_rows.extend(
                (
                    f"{example.hand_key}:{example.action_index}:{example.player_id}",
                    example.hand_key,
                    example.player_id,
                    example.action_index,
                    example.street,
                    example.position,
                    example.action_type,
                    json.dumps(example.features, sort_keys=True),
                    example.weight,
                )
                for example in examples
            )
        with self.connection:
            self.connection.executemany(
                """
                INSERT OR REPLACE INTO hands (
                  hand_key, source, source_hand_id, game, played_at, site, stake_bb,
                  max_players, button_seat, board_json, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                hand_rows,
            )
            self.connection.executemany(
                """
                INSERT OR REPLACE INTO players (
                  hand_key, player_id, seat, position, stack_bb, is_hero, hole_cards_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                player_rows,
            )
            self.connection.executemany(
                """
                INSERT OR REPLACE INTO actions (
                  hand_key, action_index, player_id, street, action_type,
                  amount_bb, pot_fraction, all_in
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                action_rows,
            )
            self.connection.executemany(
                """
                INSERT OR REPLACE INTO training_examples (
                  example_key, hand_key, player_id, action_index, street, position,
                  action_type, features_json, weight
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                example_rows,
            )
        return {
            "hands": len(hand_rows),
            "players": len(player_rows),
            "actions": len(action_rows),
            "training_examples": len(example_rows),
        }

    def insert_training_examples(self, examples: Iterable[TrainingExample]) -> int:
        rows = list(examples)
        with self.connection:
            self.connection.executemany(
                """
                INSERT OR REPLACE INTO training_examples (
                  example_key, hand_key, player_id, action_index, street, position,
                  action_type, features_json, weight
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        f"{example.hand_key}:{example.action_index}:{example.player_id}",
                        example.hand_key,
                        example.player_id,
                        example.action_index,
                        example.street,
                        example.position,
                        example.action_type,
                        json.dumps(example.features, sort_keys=True),
                        example.weight,
                    )
                    for example in rows
                ],
            )
        return len(rows)

    def training_examples(self) -> list[TrainingExample]:
        rows = self.connection.execute(
            """
            SELECT hand_key, player_id, action_index, street, position, action_type,
                   features_json, weight
            FROM training_examples
            ORDER BY hand_key, action_index
            """
        ).fetchall()
        return [
            TrainingExample(
                hand_key=row["hand_key"],
                player_id=row["player_id"],
                action_index=row["action_index"],
                street=row["street"],
                position=row["position"],
                action_type=row["action_type"],
                features=json.loads(row["features_json"]),
                weight=row["weight"],
            )
            for row in rows
        ]

    def hands_for_feature_extraction(self) -> list[tuple[str, HandHistoryRecord]]:
        hands = self.connection.execute("SELECT * FROM hands ORDER BY hand_key").fetchall()
        result = []
        for hand_row in hands:
            hand_key = hand_row["hand_key"]
            player_rows = self.connection.execute(
                "SELECT * FROM players WHERE hand_key = ? ORDER BY seat, player_id",
                (hand_key,),
            ).fetchall()
            action_rows = self.connection.execute(
                "SELECT * FROM actions WHERE hand_key = ? ORDER BY action_index",
                (hand_key,),
            ).fetchall()
            result.append((hand_key, decode_hand(hand_row, player_rows, action_rows)))
        return result

    def save_model_artifact(self, model_key: str, kind: str, payload: dict[str, Any], metrics: dict[str, Any]) -> None:
        with self.connection:
            self.connection.execute(
                """
                INSERT OR REPLACE INTO model_artifacts (
                  model_key, created_at, kind, payload_json, metrics_json
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    model_key,
                    datetime.now(timezone.utc).isoformat(),
                    kind,
                    json.dumps(payload, sort_keys=True),
                    json.dumps(metrics, sort_keys=True),
                ),
            )


def make_hand_key(source: str, source_hand_id: str) -> str:
    return f"{source}:{source_hand_id}"


def encode_cards(cards: tuple[CardRecord, ...]) -> str:
    return json.dumps([{"rank": card.rank, "suit": card.suit} for card in cards], sort_keys=True)


def decode_cards(payload: str) -> tuple[CardRecord, ...]:
    return tuple(CardRecord(card["rank"], card["suit"]) for card in json.loads(payload))


def encode_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def decode_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def decode_hand(hand_row: sqlite3.Row, player_rows: list[sqlite3.Row], action_rows: list[sqlite3.Row]) -> HandHistoryRecord:
    return HandHistoryRecord(
        source=hand_row["source"],
        source_hand_id=hand_row["source_hand_id"],
        game=hand_row["game"],
        played_at=decode_datetime(hand_row["played_at"]),
        site=hand_row["site"],
        stake_bb=hand_row["stake_bb"],
        max_players=hand_row["max_players"],
        button_seat=hand_row["button_seat"],
        board=decode_cards(hand_row["board_json"]),
        metadata=json.loads(hand_row["metadata_json"]),
        players=tuple(
            PlayerRecord(
                source_player_id=row["player_id"],
                seat=row["seat"],
                position=row["position"],
                stack_bb=row["stack_bb"],
                is_hero=bool(row["is_hero"]),
                hole_cards=decode_cards(row["hole_cards_json"]),
            )
            for row in player_rows
        ),
        actions=tuple(
            ActionRecord(
                index=row["action_index"],
                player_id=row["player_id"],
                street=row["street"],
                action_type=row["action_type"],
                amount_bb=row["amount_bb"],
                pot_fraction=row["pot_fraction"],
                all_in=bool(row["all_in"]),
            )
            for row in action_rows
        ),
    )
