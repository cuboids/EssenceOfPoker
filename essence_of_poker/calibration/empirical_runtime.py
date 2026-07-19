"""Runtime empirical baseline lookup for the dashboard/backend API."""

from __future__ import annotations

import sqlite3
import hashlib
import json
from contextlib import closing
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from essence_of_poker.calibration.empirical_repository import (
    count_rows,
    default_source_key,
    default_source_key_for_path,
    empirical_spot_cache_requests as repository_empirical_spot_cache_requests,
    level_count_maps,
    source_summary,
)
from essence_of_poker.version_registry import VERSION_REGISTRY

ACTION_TYPES = ("fold", "check", "call", "bet", "raise", "all-in")
HAND_CLASSES = tuple(
    f"{first}-{second}-pair" if first == second else f"{first}-{second}-{suffix}"
    for first in range(1, 14)
    for second in range(first, 14)
    for suffix in (("pair",) if first == second else ("suited", "offsuit"))
)
DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "calibration_compact.sqlite3"
DEFAULT_SPOT_CACHE_PATH = Path(__file__).resolve().parents[1] / "data" / "empirical_spot_cache.json"
DEFAULT_ALPHA = 0.5
DEFAULT_MIN_EXACT_COUNT = 25
EXPECTED_EMPIRICAL_SPOT_CACHE_VERSION = VERSION_REGISTRY.generated_data["empiricalSpotCache"]
EXPECTED_RANGE_MODEL_VERSION = VERSION_REGISTRY.models["rangeEngine"]


def empirical_spot_payload_cached(
    *,
    cache_path: str | Path = DEFAULT_SPOT_CACHE_PATH,
    db_path: str | Path = DEFAULT_DB_PATH,
    street: str,
    position: str,
    player_count: int,
    stake_bucket: str = "micro",
    year_bucket: str = "2009-2010",
    facing_aggression: bool = False,
    amount_bucket: str = "none",
    source_key: str | None = None,
    alpha: float = DEFAULT_ALPHA,
    min_exact_count: int = DEFAULT_MIN_EXACT_COUNT,
) -> dict[str, Any]:
    request = normalize_request(
        street=street,
        position=position,
        player_count=player_count,
        stake_bucket=stake_bucket,
        year_bucket=year_bucket,
        facing_aggression=facing_aggression,
        amount_bucket=amount_bucket,
    )
    cache = load_empirical_spot_cache(str(Path(cache_path)))
    if cache and empirical_spot_cache_compatibility(cache)["ok"]:
        payload = cache.get("spots", {}).get(empirical_spot_cache_key(request))
        if payload:
            payload = dict(payload)
            payload["cache"] = {
                "hit": True,
                "path": str(cache_path),
                "version": cache.get("version"),
                "contractVersion": cache.get("contractVersion"),
                "modelVersion": cache.get("modelVersion"),
                "sourceDb": cache.get("sourceDb"),
            }
            return payload
    payload = empirical_spot_payload(
        db_path=db_path,
        street=request["street"],
        position=request["position"],
        player_count=request["playerCount"],
        stake_bucket=request["stakeBucket"],
        year_bucket=request["yearBucket"],
        facing_aggression=request["facingAggression"],
        amount_bucket=request["amountBucket"],
        source_key=source_key,
        alpha=alpha,
        min_exact_count=min_exact_count,
    )
    payload["cache"] = {"hit": False, "path": str(cache_path)}
    return payload


def empirical_spot_payload(
    *,
    db_path: str | Path = DEFAULT_DB_PATH,
    street: str,
    position: str,
    player_count: int,
    stake_bucket: str = "micro",
    year_bucket: str = "2009-2010",
    facing_aggression: bool = False,
    amount_bucket: str = "none",
    source_key: str | None = None,
    alpha: float = DEFAULT_ALPHA,
    min_exact_count: int = DEFAULT_MIN_EXACT_COUNT,
) -> dict[str, Any]:
    db = Path(db_path)
    if not db.exists():
        return {"ok": False, "error": "calibration database not found", "path": str(db)}
    request = normalize_request(
        street=street,
        position=position,
        player_count=player_count,
        stake_bucket=stake_bucket,
        year_bucket=year_bucket,
        facing_aggression=facing_aggression,
        amount_bucket=amount_bucket,
    )
    with closing(sqlite3.connect(db)) as connection:
        connection.row_factory = sqlite3.Row
        selected_source = source_key or default_source_key(connection)
        return empirical_spot_payload_from_connection(
            connection,
            selected_source,
            request,
            source=source_summary(connection, selected_source),
            global_counts=count_rows(connection, selected_source, {}),
            alpha=alpha,
            min_exact_count=min_exact_count,
        )


def empirical_spot_payload_from_connection(
    connection: sqlite3.Connection,
    selected_source: str,
    request: dict[str, Any],
    *,
    source: dict[str, Any],
    global_counts: dict[str, int],
    alpha: float,
    min_exact_count: int,
) -> dict[str, Any]:
    levels = level_count_maps(connection, selected_source, request)
    global_probabilities = smoothed_probabilities(global_counts, alpha)
    hand_classes: dict[str, Any] = {}
    fallback_usage: dict[str, int] = {name: 0 for name, _ in levels}
    fallback_usage["global"] = 0
    for hand_class in HAND_CLASSES:
        entry = best_hand_class_entry(
            hand_class,
            levels,
            global_counts,
            global_probabilities,
            alpha=alpha,
            min_exact_count=min_exact_count,
        )
        fallback_usage[entry["level"]] = fallback_usage.get(entry["level"], 0) + 1
        hand_classes[hand_class] = entry
    return {
        "ok": True,
        "kind": "empirical_spot_baseline",
        "version": 1,
        "source": source,
        "request": request,
        "smoothing": {
            "alpha": alpha,
            "minExactCount": min_exact_count,
            "trainingFolds": [1, 2, 3, 4],
        },
        "fallbackUsage": fallback_usage,
        "spotProbabilities": global_probabilities if not levels else spot_probabilities(levels, global_probabilities, alpha),
        "handClasses": hand_classes,
    }


def normalize_request(**kwargs: Any) -> dict[str, Any]:
    street = str(kwargs["street"]).lower()
    if street not in {"preflop", "flop", "turn", "river"}:
        raise ValueError("street must be preflop, flop, turn, or river")
    position = str(kwargs["position"]).upper()
    player_count = int(kwargs["player_count"])
    return {
        "street": street,
        "position": position,
        "playerCount": player_count,
        "stakeBucket": str(kwargs.get("stake_bucket") or "micro"),
        "yearBucket": str(kwargs.get("year_bucket") or "2009-2010"),
        "facingAggression": bool(kwargs.get("facing_aggression")),
        "amountBucket": str(kwargs.get("amount_bucket") or "none"),
    }


def empirical_spot_cache_key(request: dict[str, Any]) -> str:
    return "|".join((
        str(request["street"]),
        str(request["position"]),
        str(request["playerCount"]),
        str(request["stakeBucket"]),
        str(request["yearBucket"]),
        "1" if request["facingAggression"] else "0",
        str(request["amountBucket"]),
    ))


def load_empirical_spot_cache(cache_path: str) -> dict[str, Any] | None:
    path = Path(cache_path)
    if not path.exists():
        return None
    stat = path.stat()
    return _load_empirical_spot_cache_for_signature(str(path), stat.st_mtime_ns, stat.st_size)


@lru_cache(maxsize=8)
def _load_empirical_spot_cache_for_signature(cache_path: str, mtime_ns: int, size: int) -> dict[str, Any] | None:
    path = Path(cache_path)
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if payload.get("kind") != "empirical_spot_cache" or not isinstance(payload.get("spots"), dict):
        return None
    return payload


def empirical_spot_cache_status(cache_path: str | Path = DEFAULT_SPOT_CACHE_PATH) -> dict[str, Any]:
    path = Path(cache_path)
    if not path.exists():
        return {"ok": False, "path": str(path), "spotCount": 0}
    try:
        payload = load_empirical_spot_cache(str(path))
    except (OSError, json.JSONDecodeError):
        return {"ok": False, "path": str(path), "spotCount": 0}
    if not payload:
        return {"ok": False, "path": str(path), "spotCount": 0}
    compatibility = empirical_spot_cache_compatibility(payload)
    return {
        "ok": compatibility["ok"],
        "path": str(path),
        "version": payload.get("version"),
        "contractVersion": payload.get("contractVersion"),
        "modelVersion": payload.get("modelVersion"),
        "spotCount": len(payload.get("spots", {})),
        "generatedAt": payload.get("generatedAt"),
        "source": payload.get("source"),
        "sourceDb": payload.get("sourceDb"),
        "compatibility": compatibility,
    }


def empirical_spot_cache_compatibility(payload: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    if payload.get("contractVersion") != EXPECTED_EMPIRICAL_SPOT_CACHE_VERSION:
        errors.append("empirical spot cache contract version mismatch")
    if payload.get("modelVersion") != EXPECTED_RANGE_MODEL_VERSION:
        errors.append("range model version mismatch")
    if not payload.get("generatedAt"):
        errors.append("missing generation timestamp")
    source_db = payload.get("sourceDb") or {}
    if not source_db.get("sha256"):
        errors.append("missing source database hash")
    return {
        "ok": not errors,
        "errors": errors,
        "expected": {
            "contractVersion": EXPECTED_EMPIRICAL_SPOT_CACHE_VERSION,
            "modelVersion": EXPECTED_RANGE_MODEL_VERSION,
        },
        "actual": {
            "contractVersion": payload.get("contractVersion"),
            "modelVersion": payload.get("modelVersion"),
        },
    }


def build_empirical_spot_cache(
    db_path: str | Path = DEFAULT_DB_PATH,
    *,
    output_path: str | Path = DEFAULT_SPOT_CACHE_PATH,
    source_key: str | None = None,
    alpha: float = DEFAULT_ALPHA,
    min_exact_count: int = DEFAULT_MIN_EXACT_COUNT,
) -> dict[str, Any]:
    db = Path(db_path)
    if not db.exists():
        raise FileNotFoundError(db)
    with closing(sqlite3.connect(db)) as connection:
        connection.row_factory = sqlite3.Row
        selected_source = source_key or default_source_key(connection)
        requests = empirical_spot_cache_requests(connection, selected_source)
        source = source_summary(connection, selected_source)
        global_counts = count_rows(connection, selected_source, {})
        spots = {
            empirical_spot_cache_key(request): empirical_spot_payload_from_connection(
                connection,
                selected_source,
                request,
                source=source,
                global_counts=global_counts,
                alpha=alpha,
                min_exact_count=min_exact_count,
            )
            for request in requests
        }

    artifact = {
        "ok": True,
        "kind": "empirical_spot_cache",
        "version": 1,
        "contractVersion": EXPECTED_EMPIRICAL_SPOT_CACHE_VERSION,
        "modelVersion": EXPECTED_RANGE_MODEL_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "sourceDb": source_database_summary(db),
        "smoothing": {
            "alpha": alpha,
            "minExactCount": min_exact_count,
            "trainingFolds": [1, 2, 3, 4],
        },
        "spotCount": len(spots),
        "spots": spots,
    }
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    load_empirical_spot_cache.cache_clear()
    return artifact


def source_database_summary(db_path: Path) -> dict[str, Any]:
    payload = db_path.read_bytes()
    return {
        "path": str(db_path),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
    }


def empirical_spot_cache_requests(connection: sqlite3.Connection, source_key: str) -> list[dict[str, Any]]:
    return repository_empirical_spot_cache_requests(connection, source_key, normalize_request)


def best_hand_class_entry(
    hand_class: str,
    levels: list[tuple[str, dict[str, dict[str, int]]]],
    global_counts: dict[str, int],
    global_probabilities: dict[str, float],
    *,
    alpha: float,
    min_exact_count: int,
) -> dict[str, Any]:
    for name, level_counts in levels:
        counts = level_counts.get(hand_class) or level_counts.get("*")
        if not counts:
            continue
        total = sum(counts.values())
        if name == "exact" and total < min_exact_count:
            continue
        return {
            "level": name,
            "count": total,
            "actions": {action: counts.get(action, 0) for action in ACTION_TYPES if counts.get(action, 0)},
            "probabilities": smoothed_probabilities(counts, alpha),
        }
    return {
        "level": "global",
        "count": sum(global_counts.values()),
        "actions": {action: global_counts.get(action, 0) for action in ACTION_TYPES if global_counts.get(action, 0)},
        "probabilities": global_probabilities,
    }


def spot_probabilities(
    levels: list[tuple[str, dict[str, dict[str, int]]]],
    global_probabilities: dict[str, float],
    alpha: float,
) -> dict[str, float]:
    for name, counts_by_key in levels:
        if name in {"exact", "no_year", "no_stake_year"}:
            continue
        counts = counts_by_key.get("*")
        if counts:
            return smoothed_probabilities(counts, alpha)
    return global_probabilities


def smoothed_probabilities(counts: dict[str, int], alpha: float = DEFAULT_ALPHA) -> dict[str, float]:
    total = sum(counts.values())
    denominator = total + alpha * len(ACTION_TYPES)
    return {action: (counts.get(action, 0) + alpha) / denominator for action in ACTION_TYPES}


load_empirical_spot_cache.cache_clear = _load_empirical_spot_cache_for_signature.cache_clear  # type: ignore[attr-defined]
