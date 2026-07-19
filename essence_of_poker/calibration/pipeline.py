"""End-to-end calibration pipeline orchestration."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from essence_of_poker.calibration.features import aggregate_player_stats, extract_training_examples
from essence_of_poker.calibration.model import archetype_table, train_calibrated_model
from essence_of_poker.calibration.phh_importer import iter_hand_histories
from essence_of_poker.calibration.repository import CalibrationStore


def import_hands(
    input_path: str | Path,
    db_path: str | Path,
    *,
    batch_size: int = 1000,
    progress: Callable[[dict[str, int]], None] | None = None,
    progress_every: int = 100_000,
) -> dict[str, int]:
    store = CalibrationStore(db_path)
    store.initialize()
    totals = {"hands": 0, "players": 0, "actions": 0, "training_examples": 0}
    batch = []
    try:
        for hand in iter_hand_histories(input_path):
            hand_key = f"{hand.source}:{hand.source_hand_id}"
            batch.append((hand, extract_training_examples(hand_key, hand)))
            if len(batch) >= batch_size:
                add_totals(totals, store.upsert_hands_with_examples(batch))
                batch.clear()
                if progress and totals["hands"] % progress_every < batch_size:
                    progress(dict(totals))
        if batch:
            add_totals(totals, store.upsert_hands_with_examples(batch))
            if progress:
                progress(dict(totals))
    finally:
        store.close()
    return totals


def rebuild_training_examples(db_path: str | Path) -> dict[str, int]:
    store = CalibrationStore(db_path)
    store.initialize()
    examples = 0
    try:
        for hand_key, hand in store.hands_for_feature_extraction():
            examples += store.insert_training_examples(extract_training_examples(hand_key, hand))
    finally:
        store.close()
    return {"training_examples": examples}


def train_from_store(db_path: str | Path, *, model_key: str = "range-action-v1", folds: int = 5) -> dict[str, object]:
    store = CalibrationStore(db_path)
    store.initialize()
    try:
        examples = store.training_examples()
        result = train_calibrated_model(examples, folds=folds)
        player_stats = aggregate_player_stats(examples)
        archetypes = archetype_table(player_stats)
        payload = {**result.payload, "player_archetypes": archetypes}
        metrics = {**result.metrics, "players_with_archetypes": len(archetypes)}
        store.save_model_artifact(model_key, "range_action_model", payload, metrics)
        return {"model_key": model_key, "payload": payload, "metrics": metrics}
    finally:
        store.close()


def add_totals(totals: dict[str, int], increment: dict[str, int]) -> None:
    for key, value in increment.items():
        totals[key] = totals.get(key, 0) + value
