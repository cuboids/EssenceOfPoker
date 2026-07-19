"""Deterministic training and soft archetype modeling for range calibration."""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from essence_of_poker.calibration.features import ACTION_ORDER
from essence_of_poker.calibration.schema import TrainingExample

ARCHETYPE_CENTROIDS: dict[str, dict[str, float]] = {
    "complete_novice": {"vpip": 0.55, "pfr": 0.08, "call_rate": 0.45, "fold_rate": 0.22, "aggression": 0.35},
    "calling_station": {"vpip": 0.48, "pfr": 0.10, "call_rate": 0.50, "fold_rate": 0.18, "aggression": 0.20},
    "nit": {"vpip": 0.17, "pfr": 0.13, "call_rate": 0.12, "fold_rate": 0.62, "aggression": 0.78},
    "tag": {"vpip": 0.25, "pfr": 0.20, "call_rate": 0.16, "fold_rate": 0.45, "aggression": 0.95},
    "lag": {"vpip": 0.36, "pfr": 0.29, "call_rate": 0.19, "fold_rate": 0.34, "aggression": 1.25},
    "gto": {"vpip": 0.29, "pfr": 0.23, "call_rate": 0.20, "fold_rate": 0.39, "aggression": 0.92},
    "maniac": {"vpip": 0.62, "pfr": 0.46, "call_rate": 0.18, "fold_rate": 0.20, "aggression": 2.20},
}


@dataclass(frozen=True)
class TrainingResult:
    payload: dict[str, Any]
    metrics: dict[str, Any]


class SoftmaxRangeActionModel:
    """Small calibrated softmax model with hashed sparse features.

    This is not intended to be the final frontier model. It is the formal
    baseline: deterministic, inspectable, cross-validated, and good enough to
    replace hand-tuned frequencies once real examples exist.
    """

    def __init__(self, *, dimensions: int = 512, learning_rate: float = 0.16, l2: float = 0.0003, epochs: int = 8) -> None:
        self.dimensions = dimensions
        self.learning_rate = learning_rate
        self.l2 = l2
        self.epochs = epochs
        self.labels = tuple(ACTION_ORDER)
        self.weights = [[0.0 for _ in range(dimensions)] for _ in self.labels]
        self.temperature = 1.0

    def fit(self, examples: list[TrainingExample]) -> "SoftmaxRangeActionModel":
        for _ in range(self.epochs):
            for example in examples:
                indices = hashed_features(example.features, self.dimensions)
                probabilities = self.predict_from_indices(indices)
                true_index = self.labels.index(example.action_type)
                for label_index in range(len(self.labels)):
                    error = probabilities[label_index] - (1.0 if label_index == true_index else 0.0)
                    for index, value in indices:
                        self.weights[label_index][index] -= self.learning_rate * (
                            error * value + self.l2 * self.weights[label_index][index]
                        ) * example.weight
        self.temperature = fit_temperature(self, examples)
        return self

    def predict_proba(self, features: dict[str, float | str]) -> dict[str, float]:
        probabilities = self.predict_from_indices(hashed_features(features, self.dimensions), self.temperature)
        return dict(zip(self.labels, probabilities, strict=True))

    def predict_from_indices(self, indices: list[tuple[int, float]], temperature: float = 1.0) -> list[float]:
        logits = []
        for label_weights in self.weights:
            logits.append(sum(label_weights[index] * value for index, value in indices) / max(0.01, temperature))
        return softmax(logits)

    def to_payload(self) -> dict[str, Any]:
        return {
            "model": "hashed_softmax_range_action",
            "dimensions": self.dimensions,
            "labels": list(self.labels),
            "temperature": self.temperature,
            "weights": self.weights,
        }


def train_calibrated_model(examples: list[TrainingExample], *, folds: int = 5, dimensions: int = 512) -> TrainingResult:
    if not examples:
        raise ValueError("cannot train calibration model without examples")
    fold_metrics = []
    for fold in range(folds):
        train = [example for example in examples if deterministic_fold(example.split_key, folds) != fold]
        validation = [example for example in examples if deterministic_fold(example.split_key, folds) == fold]
        if not train or not validation:
            continue
        model = SoftmaxRangeActionModel(dimensions=dimensions).fit(train)
        fold_metrics.append(evaluate_model(model, validation))
    final_model = SoftmaxRangeActionModel(dimensions=dimensions).fit(examples)
    metrics = summarize_fold_metrics(fold_metrics)
    metrics["examples"] = len(examples)
    metrics["folds"] = len(fold_metrics)
    return TrainingResult(payload=final_model.to_payload(), metrics=metrics)


def evaluate_model(model: SoftmaxRangeActionModel, examples: list[TrainingExample]) -> dict[str, float]:
    losses = []
    correct = 0
    brier_total = 0.0
    for example in examples:
        probabilities = model.predict_proba(example.features)
        probability = max(1e-9, probabilities.get(example.action_type, 1e-9))
        losses.append(-math.log(probability))
        predicted = max(probabilities, key=probabilities.get)
        correct += int(predicted == example.action_type)
        brier_total += sum(
            (probabilities[label] - (1.0 if label == example.action_type else 0.0)) ** 2
            for label in model.labels
        )
    total = max(1, len(examples))
    return {
        "log_loss": sum(losses) / total,
        "accuracy": correct / total,
        "brier": brier_total / total,
    }


def summarize_fold_metrics(fold_metrics: list[dict[str, float]]) -> dict[str, float]:
    if not fold_metrics:
        return {"cv_log_loss": float("nan"), "cv_accuracy": float("nan"), "cv_brier": float("nan")}
    return {
        f"cv_{key}": sum(metric[key] for metric in fold_metrics) / len(fold_metrics)
        for key in fold_metrics[0]
    }


def fit_temperature(model: SoftmaxRangeActionModel, examples: list[TrainingExample]) -> float:
    candidates = [0.65, 0.8, 1.0, 1.2, 1.5, 1.9]
    if not examples:
        return 1.0
    losses = []
    for temperature in candidates:
        total = 0.0
        for example in examples:
            indices = hashed_features(example.features, model.dimensions)
            probabilities = dict(zip(model.labels, model.predict_from_indices(indices, temperature), strict=True))
            total += -math.log(max(1e-9, probabilities[example.action_type]))
        losses.append((total / len(examples), temperature))
    return min(losses)[1]


def archetype_probabilities(player_stats: dict[str, float]) -> dict[str, float]:
    distances = {}
    sample_size = player_stats.get("sample_size", 0.0)
    confidence = min(1.0, math.log1p(sample_size) / math.log(500.0))
    for name, centroid in ARCHETYPE_CENTROIDS.items():
        distance = 0.0
        for key, expected in centroid.items():
            distance += (player_stats.get(key, 0.0) - expected) ** 2
        distances[name] = math.sqrt(distance)
    scores = {name: -distance * (2.0 + 3.0 * confidence) for name, distance in distances.items()}
    return normalize_scores(scores)


def archetype_table(player_stats: dict[str, dict[str, float]]) -> dict[str, dict[str, float]]:
    return {player: archetype_probabilities(stats) for player, stats in player_stats.items()}


def hashed_features(features: dict[str, float | str], dimensions: int) -> list[tuple[int, float]]:
    encoded: list[tuple[int, float]] = []
    for key, value in sorted(features.items()):
        if isinstance(value, str):
            encoded.append((stable_hash(f"{key}={value}") % dimensions, 1.0))
        else:
            amount = float(value)
            if math.isfinite(amount):
                encoded.append((stable_hash(key) % dimensions, amount))
    return encoded


def deterministic_fold(key: str, folds: int) -> int:
    return stable_hash(key) % folds


def stable_hash(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:16], 16)


def softmax(logits: list[float]) -> list[float]:
    peak = max(logits)
    exps = [math.exp(logit - peak) for logit in logits]
    total = sum(exps)
    return [value / total for value in exps]


def normalize_scores(scores: dict[str, float]) -> dict[str, float]:
    probabilities = softmax(list(scores.values()))
    return dict(zip(scores.keys(), probabilities, strict=True))


def artifact_to_json(result: TrainingResult) -> str:
    return json.dumps({"payload": result.payload, "metrics": result.metrics}, sort_keys=True)
