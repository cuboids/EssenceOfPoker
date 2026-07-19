"""SQLite repository helpers for empirical calibration runtime lookups."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from functools import lru_cache
from typing import Any

TRAINING_FOLD_PREDICATE = "fold != 0"


def empirical_spot_cache_requests(connection: sqlite3.Connection, source_key: str, normalize_request) -> list[dict[str, Any]]:
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


@lru_cache(maxsize=8)
def default_source_key_for_path(db_path: str) -> str:
    with closing(sqlite3.connect(db_path)) as connection:
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
