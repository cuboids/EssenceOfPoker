#!/usr/bin/env python3
"""Train the empirical range-action model from the calibration database."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from essence_of_poker.calibration.pipeline import train_from_store


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="data/calibration.sqlite3", help="Calibration SQLite path")
    parser.add_argument("--model-key", default="range-action-v1")
    parser.add_argument("--folds", type=int, default=5)
    args = parser.parse_args()
    result = train_from_store(args.db, model_key=args.model_key, folds=args.folds)
    print(json.dumps({"model_key": result["model_key"], "metrics": result["metrics"]}, sort_keys=True))


if __name__ == "__main__":
    main()
