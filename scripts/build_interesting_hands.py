#!/usr/bin/env python3
"""Build an interesting-hand subset for later calibration/debugging work."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from essence_of_poker.calibration.interesting_hands import build_interesting_hand_subset


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", default=None, help="PHH/JSON/ZIP corpus path. Defaults to latest compact DB source.")
    parser.add_argument("--compact-db", default="data/calibration_compact.sqlite3")
    parser.add_argument("--output-db", default="data/interesting_hands.sqlite3")
    parser.add_argument("--output-jsonl", default="data/interesting_hands.jsonl")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--min-score", type=float, default=12.0)
    parser.add_argument("--scan-limit", type=int, default=None, help="Optional max hands to scan for fast bounded runs.")
    args = parser.parse_args()

    result = build_interesting_hand_subset(
        args.input,
        compact_db=args.compact_db,
        output_db=args.output_db,
        output_jsonl=args.output_jsonl,
        limit=args.limit,
        min_score=args.min_score,
        scan_limit=args.scan_limit,
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
