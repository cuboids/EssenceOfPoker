#!/usr/bin/env python3
"""Import a large PHH zip as compact feature-count tables."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from essence_of_poker.calibration.compact_importer import import_compact_zip


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("zip", help="PHH zip archive")
    parser.add_argument("--db", default="data/calibration_compact.sqlite3")
    parser.add_argument("--flush-every-files", type=int, default=100)
    args = parser.parse_args()

    def progress(totals: dict[str, int]) -> None:
        print(f"compact import {totals}", file=sys.stderr, flush=True)

    result = import_compact_zip(
        args.zip,
        args.db,
        flush_every_files=args.flush_every_files,
        progress=progress,
    )
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
