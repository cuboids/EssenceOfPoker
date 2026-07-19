#!/usr/bin/env python3
"""Import PHH/JSON hand histories into the calibration SQLite database."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from essence_of_poker.calibration.pipeline import import_hands


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="PHH/JSON/JSONL file or directory")
    parser.add_argument("--db", default="data/calibration.sqlite3", help="Calibration SQLite path")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--progress-every", type=int, default=100000)
    args = parser.parse_args()
    def progress(totals: dict[str, int]) -> None:
        print(f"imported {totals}", file=sys.stderr, flush=True)

    print(json.dumps(
        import_hands(
            args.input,
            args.db,
            batch_size=args.batch_size,
            progress=progress,
            progress_every=args.progress_every,
        ),
        sort_keys=True,
    ))


if __name__ == "__main__":
    main()
