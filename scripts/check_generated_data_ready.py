#!/usr/bin/env python3
"""Check that generated dashboard data artifacts needed for verification exist."""

from __future__ import annotations

import json
import gzip
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = (
    ROOT / "dashboard" / "data" / "prior_portfolio.json",
    ROOT / "dashboard" / "data" / "prior_win_shares.json",
    ROOT / "dashboard" / "data" / "preflop_hand_equity_cache.json",
    ROOT / "dashboard" / "data" / "range_model_defaults.json",
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
    for manifest_path, class_dir_name, payload_key in (
        (ROOT / "essence_of_poker" / "data" / "preflop_aggregate_manifest.json", "preflop_aggregate_classes", "aggregates"),
        (ROOT / "essence_of_poker" / "data" / "preflop_hidden_villain_manifest.json", "preflop_hidden_villain_classes", "curves"),
        (ROOT / "essence_of_poker" / "data" / "preflop_primary_manifest.json", "preflop_primary_classes", "assets"),
    ):
        if not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        class_dir = manifest_path.parent / class_dir_name
        expected_classes = sorted(str(class_key) for class_key in manifest.get("classes", []))
        actual_classes = sorted(path.name.removesuffix(".json.gz") for path in class_dir.glob("*.json.gz")) if class_dir.exists() else []
        if len(expected_classes) != 169 or actual_classes != expected_classes:
            errors.append(
                f"generated class split is stale: {class_dir.relative_to(ROOT)} has {len(actual_classes)}/{len(expected_classes) or 169} classes"
            )
            missing = sorted(set(expected_classes) - set(actual_classes))
            extra = sorted(set(actual_classes) - set(expected_classes))
            if missing:
                errors.append(f"missing class files: {', '.join(missing[:5])}")
            if extra:
                errors.append(f"unexpected class files: {', '.join(extra[:5])}")
            continue
        errors.extend(class_payload_errors(class_dir, expected_classes, payload_key))
    errors.extend(range_model_default_errors(ROOT / "dashboard" / "data" / "range_model_defaults.json"))
    return errors


def range_model_default_errors(path: Path) -> list[str]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    errors: list[str] = []
    if payload.get("kind") != "range_model_parameters":
        errors.append("range model defaults have an invalid kind")
    if payload.get("version") != payload.get("model", {}).get("name"):
        errors.append("range model defaults version must match model name")
    if not isinstance(payload.get("model", {}).get("openRaiseFrequency"), dict):
        errors.append("range model defaults are missing openRaiseFrequency")
    return errors


def class_payload_errors(class_dir: Path, expected_classes: list[str], payload_key: str) -> list[str]:
    errors: list[str] = []
    for class_key in expected_classes:
        path = class_dir / f"{class_key}.json.gz"
        try:
            with gzip.open(path, "rt", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"invalid generated class payload: {_display_path(path)} ({exc.__class__.__name__})")
            continue
        if payload.get("classKey") != class_key:
            errors.append(f"class payload key mismatch: {_display_path(path)} has {payload.get('classKey')!r}")
        if payload.get("exact") is not True:
            errors.append(f"class payload is not exact: {_display_path(path)}")
        if not isinstance(payload.get(payload_key), dict):
            errors.append(f"class payload missing {payload_key}: {_display_path(path)}")
    return errors


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    main()
