#!/usr/bin/env python3
"""Train a compact weighted softmax range-action model."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from essence_of_poker.calibration.compact_model import train_compact_softmax_model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="data/calibration_compact.sqlite3")
    parser.add_argument("--output", default="essence_of_poker/data/compact_softmax_range_model.json")
    parser.add_argument("--dimensions", type=int, default=512)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--folds", type=int, default=5)
    args = parser.parse_args()
    artifact = train_compact_softmax_model(
        args.db,
        output_path=args.output,
        dimensions=args.dimensions,
        epochs=args.epochs,
        folds=args.folds,
    )
    print(json.dumps(artifact["crossValidation"], sort_keys=True))


if __name__ == "__main__":
    main()
