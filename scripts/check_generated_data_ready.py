#!/usr/bin/env python3
"""Check that generated dashboard data artifacts needed for verification exist."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = (
    ROOT / "dashboard" / "data" / "prior_portfolio.json",
    ROOT / "dashboard" / "data" / "prior_win_shares.json",
    ROOT / "dashboard" / "data" / "preflop_hand_equity_cache.json",
    ROOT / "essence_of_poker" / "data" / "preflop_aggregate_manifest.json",
    ROOT / "essence_of_poker" / "data" / "preflop_hidden_villain_manifest.json",
    ROOT / "essence_of_poker" / "data" / "preflop_primary_manifest.json",
)


def main() -> None:
    errors = generated_data_errors()
    if errors:
        print("\n".join(errors), file=sys.stderr)
        print("Run `bash scripts/verify.sh --regenerate-data` to rebuild generated artifacts.", file=sys.stderr)
        raise SystemExit(1)
    print("ok generated data artifacts are present")


def generated_data_errors() -> list[str]:
    errors = [f"missing generated artifact: {_display_path(path)}" for path in REQUIRED_FILES if not path.exists()]
    for manifest_path, class_dir_name in (
        (ROOT / "essence_of_poker" / "data" / "preflop_aggregate_manifest.json", "preflop_aggregate_classes"),
        (ROOT / "essence_of_poker" / "data" / "preflop_hidden_villain_manifest.json", "preflop_hidden_villain_classes"),
        (ROOT / "essence_of_poker" / "data" / "preflop_primary_manifest.json", "preflop_primary_classes"),
    ):
        if not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        class_dir = manifest_path.parent / class_dir_name
        expected = len(manifest.get("classes", []))
        actual = len(list(class_dir.glob("*.json.gz"))) if class_dir.exists() else 0
        if expected != 169 or actual != expected:
            errors.append(
                f"generated class split is stale: {class_dir.relative_to(ROOT)} has {actual}/{expected or 169} classes"
            )
    return errors


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    main()
