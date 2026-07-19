#!/usr/bin/env python3
"""Precompute dashboard empirical spot payloads from compact calibration counts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from essence_of_poker.calibration.empirical_runtime import build_empirical_spot_cache


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="data/calibration_compact.sqlite3")
    parser.add_argument("--output", default="essence_of_poker/data/empirical_spot_cache.json")
    parser.add_argument("--source-key")
    parser.add_argument("--alpha", type=float, default=0.5)
    parser.add_argument("--min-exact-count", type=int, default=25)
    args = parser.parse_args()

    artifact = build_empirical_spot_cache(
        args.db,
        output_path=args.output,
        source_key=args.source_key,
        alpha=args.alpha,
        min_exact_count=args.min_exact_count,
    )
    print(json.dumps({
        "spotCount": artifact["spotCount"],
        "sourceKey": artifact["source"]["sourceKey"],
        "hands": artifact["source"]["hands"],
        "actions": artifact["source"]["actions"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
