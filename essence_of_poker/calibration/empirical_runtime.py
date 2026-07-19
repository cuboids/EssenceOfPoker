"""Runtime empirical baseline lookup for the dashboard/backend API."""

from __future__ import annotations

import sqlite3
import hashlib
import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

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
TRAINING_FOLD_PREDICATE = "fold != 0"
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
    with sqlite3.connect(db) as connection:
        connection.row_factory = sqlite3.Row
        selected_source = source_key or default_source_key(connection)
        levels = level_count_maps(connection, selected_source, request)
        global_counts = count_rows(connection, selected_source, {})
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
            "source": source_summary(connection, selected_source),
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


@lru_cache(maxsize=4)
def load_empirical_spot_cache(cache_path: str) -> dict[str, Any] | None:
    path = Path(cache_path)
    if not path.exists():
        return None
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
    with sqlite3.connect(db) as connection:
        connection.row_factory = sqlite3.Row
        selected_source = source_key or default_source_key(connection)
        requests = empirical_spot_cache_requests(connection, selected_source)
        source = source_summary(connection, selected_source)

    spots = {}
    for request in requests:
        payload = empirical_spot_payload(
            db_path=db,
            street=request["street"],
            position=request["position"],
            player_count=request["playerCount"],
            stake_bucket=request["stakeBucket"],
            year_bucket=request["yearBucket"],
            facing_aggression=request["facingAggression"],
            amount_bucket=request["amountBucket"],
            source_key=selected_source,
            alpha=alpha,
            min_exact_count=min_exact_count,
        )
        spots[empirical_spot_cache_key(request)] = payload

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
    rows = connection.execute(
        f"""
        SELECT DISTINCT street, position, player_count, stake_bucket, year_bucket, facing_aggression, amount_bucket
        FROM action_feature_counts
        WHERE source_key = ? AND {TRAINING_FOLD_PREDICATE}
        ORDER BY street, position, player_count, stake_bucket, year_bucket, facing_aggression, amount_bucket
        """,
        (source_key,),
    ).fetchall()
    return [
        normalize_request(
            street=row["street"],
            position=row["position"],
            player_count=row["player_count"],
            stake_bucket=row["stake_bucket"],
            year_bucket=row["year_bucket"],
            facing_aggression=bool(row["facing_aggression"]),
            amount_bucket=row["amount_bucket"],
        )
        for row in rows
    ]


def level_count_maps(connection: sqlite3.Connection, source_key: str, request: dict[str, Any]) -> list[tuple[str, dict[str, dict[str, int]]]]:
    return [
        ("exact", hand_class_counts(connection, source_key, {
            "street": request["street"],
            "position": request["position"],
            "player_count": request["playerCount"],
            "stake_bucket": request["stakeBucket"],
            "year_bucket": request["yearBucket"],
            "facing_aggression": int(request["facingAggression"]),
            "amount_bucket": request["amountBucket"],
        })),
        ("no_year", hand_class_counts(connection, source_key, {
            "street": request["street"],
            "position": request["position"],
            "player_count": request["playerCount"],
            "stake_bucket": request["stakeBucket"],
            "facing_aggression": int(request["facingAggression"]),
            "amount_bucket": request["amountBucket"],
        })),
        ("no_stake_year", hand_class_counts(connection, source_key, {
            "street": request["street"],
            "position": request["position"],
            "player_count": request["playerCount"],
            "facing_aggression": int(request["facingAggression"]),
            "amount_bucket": request["amountBucket"],
        })),
        ("spot", {"*": count_rows(connection, source_key, {
            "street": request["street"],
            "position": request["position"],
            "player_count": request["playerCount"],
            "facing_aggression": int(request["facingAggression"]),
            "amount_bucket": request["amountBucket"],
        })}),
        ("street_position", {"*": count_rows(connection, source_key, {
            "street": request["street"],
            "position": request["position"],
        })}),
        ("street", {"*": count_rows(connection, source_key, {
            "street": request["street"],
        })}),
    ]


def hand_class_counts(connection: sqlite3.Connection, source_key: str, predicates: dict[str, Any]) -> dict[str, dict[str, int]]:
    rows = grouped_count_rows(connection, source_key, predicates, group_by=("hand_class", "action_type"))
    result: dict[str, dict[str, int]] = {}
    for row in rows:
        result.setdefault(str(row["hand_class"]), {})[str(row["action_type"])] = int(row["count"])
    return result


def count_rows(connection: sqlite3.Connection, source_key: str, predicates: dict[str, Any]) -> dict[str, int]:
    rows = grouped_count_rows(connection, source_key, predicates, group_by=("action_type",))
    return {str(row["action_type"]): int(row["count"]) for row in rows}


def grouped_count_rows(
    connection: sqlite3.Connection,
    source_key: str,
    predicates: dict[str, Any],
    *,
    group_by: tuple[str, ...],
) -> list[sqlite3.Row]:
    clauses = ["source_key = ?", TRAINING_FOLD_PREDICATE]
    params: list[Any] = [source_key]
    for key, value in predicates.items():
        clauses.append(f"{key} = ?")
        params.append(value)
    group_sql = ", ".join(group_by)
    return list(connection.execute(
        f"""
        SELECT {group_sql}, SUM(count) AS count
        FROM action_feature_counts
        WHERE {' AND '.join(clauses)}
        GROUP BY {group_sql}
        """,
        params,
    ))


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


@lru_cache(maxsize=8)
def default_source_key_for_path(db_path: str) -> str:
    with sqlite3.connect(db_path) as connection:
        return default_source_key(connection)


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
