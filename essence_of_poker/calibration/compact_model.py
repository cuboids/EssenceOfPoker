"""Train an advanced compact action model from aggregated feature counts."""

from __future__ import annotations

import json
import math
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from essence_of_poker.calibration.model import ACTION_ORDER, hashed_features


@dataclass(frozen=True)
class CompactTrainingRow:
    fold: int
    action_type: str
    count: int
    features: dict[str, float | str]


class WeightedSoftmaxModel:
    def __init__(self, *, dimensions: int = 512, epochs: int = 5, learning_rate: float = 1.2, l2: float = 0.0001) -> None:
        self.dimensions = dimensions
        self.epochs = epochs
        self.learning_rate = learning_rate
        self.l2 = l2
        self.labels = tuple(ACTION_ORDER)
        self.weights = [[0.0 for _ in range(dimensions)] for _ in self.labels]

    def fit(self, rows: list[CompactTrainingRow]) -> "WeightedSoftmaxModel":
        total_count = max(1, sum(row.count for row in rows))
        for _ in range(self.epochs):
            for row in rows:
                indices = hashed_features(row.features, self.dimensions)
                probabilities = self.predict_from_indices(indices)
                true_index = self.labels.index(row.action_type)
                row_weight = row.count / total_count
                for label_index, label_weights in enumerate(self.weights):
                    error = probabilities[label_index] - (1.0 if label_index == true_index else 0.0)
                    for index, value in indices:
                        label_weights[index] -= self.learning_rate * (
                            row_weight * error * value + self.l2 * label_weights[index] / max(1, len(rows))
                        )
        return self

    def predict_proba(self, features: dict[str, float | str]) -> dict[str, float]:
        return dict(zip(self.labels, self.predict_from_indices(hashed_features(features, self.dimensions)), strict=True))

    def predict_from_indices(self, indices: list[tuple[int, float]]) -> list[float]:
        logits = []
        for label_weights in self.weights:
            logits.append(sum(label_weights[index] * value for index, value in indices))
        return softmax(logits)

    def to_payload(self) -> dict[str, Any]:
        return {
            "model": "compact_weighted_softmax_action",
            "dimensions": self.dimensions,
            "epochs": self.epochs,
            "learningRate": self.learning_rate,
            "l2": self.l2,
            "labels": list(self.labels),
            "weights": self.weights,
        }


def train_compact_softmax_model(
    db_path: str | Path,
    *,
    output_path: str | Path | None = None,
    source_key: str | None = None,
    dimensions: int = 512,
    epochs: int = 5,
    folds: int = 5,
) -> dict[str, Any]:
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        selected_source = source_key or default_source_key(connection)
        rows = compact_rows(connection, selected_source)
        fold_metrics = []
        for fold in range(folds):
            train_rows = [row for row in rows if row.fold != fold]
            heldout_rows = [row for row in rows if row.fold == fold]
            if not train_rows or not heldout_rows:
                continue
            model = WeightedSoftmaxModel(dimensions=dimensions, epochs=epochs).fit(train_rows)
            fold_metrics.append(evaluate(model, heldout_rows))
        final_model = WeightedSoftmaxModel(dimensions=dimensions, epochs=epochs).fit(rows)
        artifact = {
            "kind": "compact_softmax_action_model",
            "version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source": source_summary(connection, selected_source),
            "featureSchema": compact_feature_schema(),
            "crossValidation": summarize_metrics(fold_metrics),
            "payload": final_model.to_payload(),
        }
        if output_path is not None:
            path = Path(output_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(artifact, sort_keys=True, separators=(",", ":")))
        return artifact


def compact_rows(connection: sqlite3.Connection, source_key: str) -> list[CompactTrainingRow]:
    rows = connection.execute(
        """
        SELECT fold, street, position, player_count, site, stake_bucket, year_bucket,
               skill_bucket, facing_aggression, prior_aggression_bucket, amount_bucket,
               hand_class, action_type, count
        FROM action_feature_counts
        WHERE source_key = ?
        ORDER BY fold, street, position, player_count, hand_class, action_type
        """,
        (source_key,),
    ).fetchall()
    return [
        CompactTrainingRow(
            fold=int(row["fold"]),
            action_type=str(row["action_type"]),
            count=int(row["count"]),
            features={
                "bias": 1.0,
                "street": row["street"],
                "position": row["position"],
                "player_count": float(row["player_count"]),
                "site": row["site"],
                "stake_bucket": row["stake_bucket"],
                "year_bucket": row["year_bucket"],
                "skill_bucket": row["skill_bucket"],
                "facing_aggression": float(row["facing_aggression"]),
                "prior_aggression_bucket": row["prior_aggression_bucket"],
                "amount_bucket": row["amount_bucket"],
                "hand_class": row["hand_class"],
            },
        )
        for row in rows
    ]


def evaluate(model: WeightedSoftmaxModel, rows: list[CompactTrainingRow]) -> dict[str, float]:
    total_count = max(1, sum(row.count for row in rows))
    log_loss = 0.0
    brier = 0.0
    correct = 0
    for row in rows:
        probabilities = model.predict_proba(row.features)
        observed_probability = max(1e-12, probabilities.get(row.action_type, 1e-12))
        log_loss += -math.log(observed_probability) * row.count
        brier += sum(
            ((probabilities[label] - (1.0 if label == row.action_type else 0.0)) ** 2) * row.count
            for label in model.labels
        )
        if max(probabilities, key=probabilities.get) == row.action_type:
            correct += row.count
    return {
        "log_loss": log_loss / total_count,
        "brier": brier / total_count,
        "accuracy": correct / total_count,
        "actions": total_count,
    }


def summarize_metrics(metrics: list[dict[str, float]]) -> dict[str, Any]:
    if not metrics:
        return {"folds": 0}
    keys = [key for key in metrics[0] if key != "actions"]
    return {
        "folds": len(metrics),
        "foldMetrics": metrics,
        **{key: sum(metric[key] for metric in metrics) / len(metrics) for key in keys},
        "actions": sum(metric["actions"] for metric in metrics),
    }


def compact_feature_schema() -> list[str]:
    return [
        "street",
        "position",
        "player_count",
        "site",
        "stake_bucket",
        "year_bucket",
        "skill_bucket",
        "facing_aggression",
        "prior_aggression_bucket",
        "amount_bucket",
        "hand_class",
    ]


def default_source_key(connection: sqlite3.Connection) -> str:
    row = connection.execute("SELECT source_key FROM corpus_sources ORDER BY imported_at DESC LIMIT 1").fetchone()
    if row is None:
        raise ValueError("no compact calibration source has been imported")
    return str(row[0])


def source_summary(connection: sqlite3.Connection, source_key: str) -> dict[str, Any]:
    source = connection.execute(
        "SELECT source_key, sha256, bytes FROM corpus_sources WHERE source_key = ?",
        (source_key,),
    ).fetchone()
    files = connection.execute(
        "SELECT COUNT(*), SUM(hand_count), SUM(action_count) FROM corpus_files WHERE source_key = ?",
        (source_key,),
    ).fetchone()
    return {
        "sourceKey": source["source_key"],
        "sha256": source["sha256"],
        "bytes": source["bytes"],
        "files": files[0],
        "hands": files[1],
        "actions": files[2],
    }


def softmax(logits: list[float]) -> list[float]:
    peak = max(logits)
    exps = [math.exp(logit - peak) for logit in logits]
    total = sum(exps)
    return [value / total for value in exps]
