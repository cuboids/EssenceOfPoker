"""Compact SQLite store for very large hand-history corpora."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class CompactCalibrationStore:
    """Stores source manifests and aggregated calibration counts.

    The normalized `CalibrationStore` remains useful for small corpora and
    debugging. This store is the production shape for tens of millions of
    hands: the archive stays as the source of truth, and SQLite holds a compact
    manifest plus feature-count tensors for training.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.execute("PRAGMA synchronous = NORMAL")

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "CompactCalibrationStore":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()

    def initialize(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS corpus_sources (
              source_key TEXT PRIMARY KEY,
              source_type TEXT NOT NULL,
              path TEXT NOT NULL,
              sha256 TEXT,
              bytes INTEGER,
              imported_at TEXT NOT NULL,
              metadata_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS corpus_files (
              source_key TEXT NOT NULL,
              file_path TEXT NOT NULL,
              bytes INTEGER NOT NULL,
              dataset TEXT NOT NULL,
              site TEXT,
              stake_bucket TEXT,
              year INTEGER,
              hand_count INTEGER NOT NULL DEFAULT 0,
              action_count INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(source_key, file_path)
            );

            CREATE TABLE IF NOT EXISTS action_feature_counts (
              source_key TEXT NOT NULL,
              fold INTEGER NOT NULL,
              street TEXT NOT NULL,
              position TEXT NOT NULL,
              player_count INTEGER NOT NULL,
              site TEXT NOT NULL,
              stake_bucket TEXT NOT NULL,
              year_bucket TEXT NOT NULL,
              skill_bucket TEXT NOT NULL,
              facing_aggression INTEGER NOT NULL,
              prior_aggression_bucket TEXT NOT NULL,
              amount_bucket TEXT NOT NULL,
              hand_class TEXT NOT NULL,
              action_type TEXT NOT NULL,
              count INTEGER NOT NULL,
              PRIMARY KEY (
                source_key, fold, street, position, player_count, site,
                stake_bucket, year_bucket, skill_bucket, facing_aggression,
                prior_aggression_bucket, amount_bucket, hand_class, action_type
              )
            );

            CREATE TABLE IF NOT EXISTS compact_import_runs (
              run_key TEXT PRIMARY KEY,
              source_key TEXT NOT NULL,
              started_at TEXT NOT NULL,
              finished_at TEXT,
              files_seen INTEGER NOT NULL DEFAULT 0,
              hands_seen INTEGER NOT NULL DEFAULT 0,
              actions_seen INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL,
              error TEXT
            );
            """
        )
        self.connection.commit()

    def upsert_source(self, source_key: str, *, source_type: str, path: str, sha256: str | None, bytes_: int | None, metadata: dict[str, Any]) -> None:
        with self.connection:
            self.connection.execute(
                """
                INSERT OR REPLACE INTO corpus_sources (
                  source_key, source_type, path, sha256, bytes, imported_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source_key,
                    source_type,
                    path,
                    sha256,
                    bytes_,
                    datetime.now(timezone.utc).isoformat(),
                    json.dumps(metadata, sort_keys=True),
                ),
            )

    def start_run(self, run_key: str, source_key: str) -> None:
        with self.connection:
            self.connection.execute(
                """
                INSERT OR REPLACE INTO compact_import_runs (
                  run_key, source_key, started_at, finished_at, status
                ) VALUES (?, ?, ?, NULL, 'running')
                """,
                (run_key, source_key, datetime.now(timezone.utc).isoformat()),
            )

    def finish_run(self, run_key: str, totals: dict[str, int], *, status: str = "complete", error: str | None = None) -> None:
        with self.connection:
            self.connection.execute(
                """
                UPDATE compact_import_runs
                SET finished_at = ?, files_seen = ?, hands_seen = ?, actions_seen = ?, status = ?, error = ?
                WHERE run_key = ?
                """,
                (
                    datetime.now(timezone.utc).isoformat(),
                    totals.get("files", 0),
                    totals.get("hands", 0),
                    totals.get("actions", 0),
                    status,
                    error,
                    run_key,
                ),
            )

    def flush(self, source_key: str, file_rows: list[dict[str, Any]], count_rows: dict[tuple[Any, ...], int]) -> None:
        with self.connection:
            self.connection.executemany(
                """
                INSERT OR REPLACE INTO corpus_files (
                  source_key, file_path, bytes, dataset, site, stake_bucket, year, hand_count, action_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        source_key,
                        row["file_path"],
                        row["bytes"],
                        row["dataset"],
                        row.get("site"),
                        row.get("stake_bucket"),
                        row.get("year"),
                        row["hand_count"],
                        row["action_count"],
                    )
                    for row in file_rows
                ],
            )
            self.connection.executemany(
                """
                INSERT INTO action_feature_counts (
                  source_key, fold, street, position, player_count, site,
                  stake_bucket, year_bucket, skill_bucket, facing_aggression,
                  prior_aggression_bucket, amount_bucket, hand_class, action_type, count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT DO UPDATE SET count = count + excluded.count
                """,
                [(source_key, *key, count) for key, count in count_rows.items()],
            )
