"""Build a release manifest tying static assets, data, and cache versions together."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from essence_of_poker.version_registry import VERSION_REGISTRY


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DASHBOARD_ROOT = PROJECT_ROOT / "dist" / "dashboard"
DEFAULT_OUTPUT = DEFAULT_DASHBOARD_ROOT / "release_manifest.json"

DATA_ARTIFACTS = {
    "priorPortfolio": PROJECT_ROOT / "dashboard" / "data" / "prior_portfolio.json",
    "priorWinShares": PROJECT_ROOT / "dashboard" / "data" / "prior_win_shares.json",
    "preflopHandEquity": PROJECT_ROOT / "dashboard" / "data" / "preflop_hand_equity_cache.json",
    "preflopAggregateClasses": PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_aggregate_manifest.json",
    "preflopHiddenVillainClasses": PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_hidden_villain_manifest.json",
    "preflopPrimaryClasses": PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_primary_manifest.json",
}
CLASS_DIRS = {
    "preflopAggregateClasses": PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_aggregate_classes",
    "preflopHiddenVillainClasses": PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_hidden_villain_classes",
    "preflopPrimaryClasses": PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_primary_classes",
}


def build_release_manifest(dashboard_root: Path = DEFAULT_DASHBOARD_ROOT) -> dict[str, Any]:
    build = read_json(dashboard_root / "build_info.json")
    build_version = str(build.get("version") or "development")
    return {
        "ok": True,
        "kind": "essence_release_manifest",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dashboard": {
            "root": str(dashboard_root),
            "build": build,
            "assets": read_json(dashboard_root / "asset_manifest.json"),
        },
        "versions": VERSION_REGISTRY.payload(),
        "cache": {
            "namespace": f"{VERSION_REGISTRY.cache_schema}:{build_version}",
            "schema": VERSION_REGISTRY.cache_schema,
            "families": dict(VERSION_REGISTRY.cache_families),
        },
        "generatedData": generated_data_manifest(),
    }


def generated_data_manifest() -> dict[str, Any]:
    artifacts = {}
    for name, path in DATA_ARTIFACTS.items():
        artifacts[name] = file_manifest(path)
        if name in CLASS_DIRS:
            artifacts[name]["classDirectory"] = class_directory_manifest(CLASS_DIRS[name])
            manifest = read_json(path) if path.exists() else {}
            artifacts[name]["manifestClasses"] = len(manifest.get("classes", []))
    return artifacts


def write_release_manifest(output: Path = DEFAULT_OUTPUT, dashboard_root: Path = DEFAULT_DASHBOARD_ROOT) -> dict[str, Any]:
    manifest = build_release_manifest(dashboard_root)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest


def file_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"ok": False, "path": str(path), "error": "missing"}
    payload = path.read_bytes()
    return {
        "ok": True,
        "path": str(path),
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def class_directory_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"ok": False, "path": str(path), "error": "missing"}
    files = sorted(path.glob("*.json.gz"))
    digest = hashlib.sha256()
    total_bytes = 0
    for file_path in files:
        payload = file_path.read_bytes()
        digest.update(file_path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(payload).digest())
        total_bytes += len(payload)
    return {
        "ok": True,
        "path": str(path),
        "files": len(files),
        "bytes": total_bytes,
        "sha256": digest.hexdigest(),
    }


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dashboard-root", type=Path, default=DEFAULT_DASHBOARD_ROOT)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    output = args.output or args.dashboard_root / "release_manifest.json"
    manifest = write_release_manifest(output, args.dashboard_root)
    print(f"Wrote release manifest for {manifest['cache']['namespace']} to {output}")


if __name__ == "__main__":
    main()
