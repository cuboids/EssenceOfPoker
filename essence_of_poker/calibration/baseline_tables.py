"""Empirical baseline action-probability tables from compact calibration counts."""

from __future__ import annotations

import json
import math
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ACTION_TYPES = ("fold", "check", "call", "bet", "raise", "all-in")
EXACT_DIMENSIONS = (
    "street",
    "position",
    "player_count",
    "stake_bucket",
    "year_bucket",
    "facing_aggression",
    "amount_bucket",
    "hand_class",
)
MODEL_DIMENSIONS = (
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
)
SMOOTHING_LEVELS = (
    ("exact", EXACT_DIMENSIONS),
    ("no_year", tuple(dimension for dimension in EXACT_DIMENSIONS if dimension != "year_bucket")),
    ("no_stake_year", tuple(dimension for dimension in EXACT_DIMENSIONS if dimension not in {"stake_bucket", "year_bucket"})),
    ("spot", ("street", "position", "player_count", "facing_aggression", "amount_bucket")),
    ("street_position", ("street", "position")),
    ("street", ("street",)),
    ("global", ()),
)
HELDOUT_FOLDS = frozenset({0})


@dataclass(frozen=True)
class BaselineBuildResult:
    artifact: dict[str, Any]
    metrics: dict[str, Any]


def build_empirical_baseline_tables(
    db_path: str | Path,
    *,
    output_path: str | Path | None = None,
    source_key: str | None = None,
    heldout_folds: frozenset[int] = HELDOUT_FOLDS,
    alpha: float = 0.5,
    min_exact_count: int = 25,
) -> BaselineBuildResult:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        selected_source = source_key or default_source_key(connection)
        train_rows = list(iter_count_rows(connection, selected_source, exclude_folds=heldout_folds))
        heldout_rows = list(iter_count_rows(connection, selected_source, include_folds=heldout_folds))
        hierarchy_counts = build_hierarchy_counts(train_rows)
        tables = {
            level_name: serialize_table(counts, alpha)
            for level_name, counts in hierarchy_counts.items()
        }
        artifact = {
            "kind": "empirical_action_baseline",
            "version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source": source_metadata(connection, selected_source),
            "dimensions": {
                "model": list(MODEL_DIMENSIONS),
                "exact": list(EXACT_DIMENSIONS),
                "smoothing_levels": [
                    {"name": name, "dimensions": list(dimensions)}
                    for name, dimensions in SMOOTHING_LEVELS
                ],
            },
            "smoothing": {
                "alpha": alpha,
                "min_exact_count": min_exact_count,
                "heldout_folds": sorted(heldout_folds),
            },
            "tables": tables,
        }
        metrics = evaluate_baseline(artifact, heldout_rows)
        artifact["metrics"] = metrics
        if output_path is not None:
            path = Path(output_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(artifact, sort_keys=True, separators=(",", ":")))
        return BaselineBuildResult(artifact=artifact, metrics=metrics)
    finally:
        connection.close()


def iter_count_rows(
    connection: sqlite3.Connection,
    source_key: str,
    *,
    include_folds: frozenset[int] | None = None,
    exclude_folds: frozenset[int] | None = None,
) -> list[dict[str, Any]]:
    predicates = ["source_key = ?"]
    params: list[Any] = [source_key]
    if include_folds is not None:
        predicates.append(f"fold IN ({','.join('?' for _ in include_folds)})")
        params.extend(sorted(include_folds))
    if exclude_folds is not None:
        predicates.append(f"fold NOT IN ({','.join('?' for _ in exclude_folds)})")
        params.extend(sorted(exclude_folds))
    sql = f"""
        SELECT {', '.join(MODEL_DIMENSIONS)}, action_type, SUM(count) AS count
        FROM action_feature_counts
        WHERE {' AND '.join(predicates)}
        GROUP BY {', '.join(MODEL_DIMENSIONS)}, action_type
    """
    return [dict(row) for row in connection.execute(sql, params)]


def build_hierarchy_counts(rows: list[dict[str, Any]]) -> dict[str, dict[str, Counter[str]]]:
    hierarchy: dict[str, dict[str, Counter[str]]] = {
        name: defaultdict(Counter) for name, _ in SMOOTHING_LEVELS
    }
    for row in rows:
        action_type = str(row["action_type"])
        count = int(row["count"])
        for level_name, dimensions in SMOOTHING_LEVELS:
            key = key_for_dimensions(row, dimensions)
            hierarchy[level_name][key][action_type] += count
    return hierarchy


def serialize_table(table: dict[str, Counter[str]], alpha: float) -> dict[str, Any]:
    entries = {}
    for key, counts in sorted(table.items()):
        total = sum(counts.values())
        probabilities = smoothed_probabilities(counts, alpha)
        entries[key] = {
            "count": total,
            "actions": {action: counts.get(action, 0) for action in ACTION_TYPES if counts.get(action, 0)},
            "probabilities": probabilities,
        }
    return entries


def smoothed_probabilities(counts: Counter[str], alpha: float) -> dict[str, float]:
    total = sum(counts.values())
    denominator = total + alpha * len(ACTION_TYPES)
    return {
        action: (counts.get(action, 0) + alpha) / denominator
        for action in ACTION_TYPES
    }


def evaluate_baseline(artifact: dict[str, Any], heldout_rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = 0
    log_loss = 0.0
    brier = 0.0
    correct = 0
    fallback_usage: Counter[str] = Counter()
    action_totals: Counter[str] = Counter()
    for row in heldout_rows:
        count = int(row["count"])
        probabilities, level = lookup_probabilities(artifact, row)
        observed = str(row["action_type"])
        probability = max(1e-12, probabilities.get(observed, 1e-12))
        log_loss += -math.log(probability) * count
        brier += sum(
            ((probabilities[action] - (1.0 if action == observed else 0.0)) ** 2) * count
            for action in ACTION_TYPES
        )
        predicted = max(probabilities, key=probabilities.get)
        correct += count if predicted == observed else 0
        total += count
        fallback_usage[level] += count
        action_totals[observed] += count
    return {
        "heldout_actions": total,
        "heldout_log_loss": log_loss / total if total else None,
        "heldout_brier": brier / total if total else None,
        "heldout_accuracy": correct / total if total else None,
        "fallback_usage": dict(fallback_usage),
        "heldout_action_totals": dict(action_totals),
    }


def lookup_probabilities(artifact: dict[str, Any], row: dict[str, Any]) -> tuple[dict[str, float], str]:
    min_exact_count = artifact["smoothing"]["min_exact_count"]
    for level in artifact["dimensions"]["smoothing_levels"]:
        name = level["name"]
        key = key_for_dimensions(row, tuple(level["dimensions"]))
        entry = artifact["tables"][name].get(key)
        if entry is None:
            continue
        if name == "exact" and entry["count"] < min_exact_count:
            continue
        return entry["probabilities"], name
    global_entry = artifact["tables"]["global"]["*"]
    return global_entry["probabilities"], "global"


def key_for_dimensions(row: dict[str, Any], dimensions: tuple[str, ...]) -> str:
    if not dimensions:
        return "*"
    return "|".join(f"{dimension}={normalize_key_value(row[dimension])}" for dimension in dimensions)


def normalize_key_value(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    return str(value)


def default_source_key(connection: sqlite3.Connection) -> str:
    row = connection.execute("SELECT source_key FROM corpus_sources ORDER BY imported_at DESC LIMIT 1").fetchone()
    if row is None:
        raise ValueError("no compact corpus source found")
    return str(row[0])


def source_metadata(connection: sqlite3.Connection, source_key: str) -> dict[str, Any]:
    source = connection.execute(
        "SELECT source_key, source_type, path, sha256, bytes, imported_at, metadata_json FROM corpus_sources WHERE source_key = ?",
        (source_key,),
    ).fetchone()
    if source is None:
        raise ValueError(f"unknown compact corpus source: {source_key}")
    files = connection.execute(
        "SELECT COUNT(*), SUM(hand_count), SUM(action_count) FROM corpus_files WHERE source_key = ?",
        (source_key,),
    ).fetchone()
    return {
        "source_key": source["source_key"],
        "source_type": source["source_type"],
        "path": source["path"],
        "sha256": source["sha256"],
        "bytes": source["bytes"],
        "imported_at": source["imported_at"],
        "metadata": json.loads(source["metadata_json"]),
        "files": files[0],
        "hands": files[1],
        "actions": files[2],
    }
