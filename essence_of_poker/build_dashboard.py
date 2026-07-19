"""Build a versioned dashboard artifact for production serving."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE_ROOT = PROJECT_ROOT / "dashboard"
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "dist" / "dashboard"


def build_dashboard(
    source_root: Path = DEFAULT_SOURCE_ROOT,
    output_root: Path = DEFAULT_OUTPUT_ROOT,
) -> dict:
    """Copy dashboard source files and write content-hash build metadata."""

    source_root = source_root.resolve()
    output_root = output_root.resolve()
    if not (source_root / "index.html").exists():
        raise FileNotFoundError(f"dashboard source is missing index.html: {source_root}")

    if output_root.exists():
        shutil.rmtree(output_root)
    shutil.copytree(source_root, output_root, ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"))

    version = _manifest_version(_asset_hashes(output_root, include_index=False))
    assets = _asset_hashes(output_root, include_index=False)
    _rewrite_index(output_root / "index.html", version, assets)
    assets = _asset_hashes(output_root)

    build_info = {
        "version": version,
        "builtAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "sourceRoot": str(source_root),
        "assets": assets,
    }
    (output_root / "asset-manifest.json").write_text(
        json.dumps({"version": version, "assets": assets}, indent=2),
        encoding="utf-8",
    )
    (output_root / "build_info.json").write_text(json.dumps(build_info, indent=2), encoding="utf-8")
    return build_info


def _asset_hashes(root: Path, *, include_index: bool = True) -> dict[str, str]:
    assets = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name in {"asset-manifest.json", "build_info.json"}:
            continue
        if not include_index and path.name == "index.html":
            continue
        relative_path = path.relative_to(root).as_posix()
        assets[relative_path] = _content_hash(path)
    return assets


def _content_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:12]


def _manifest_version(assets: dict[str, str]) -> str:
    digest = hashlib.sha256()
    for relative_path, content_hash in sorted(assets.items()):
        digest.update(relative_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(content_hash.encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()[:16]


def _rewrite_index(index_path: Path, version: str, assets: dict[str, str]) -> None:
    html = index_path.read_text(encoding="utf-8")
    html = html.replace(
        'href="styles.css?v=frontend-modules-2"',
        f'href="styles.css?v={assets["styles.css"]}-{version}"',
    )
    html = html.replace(
        'src="app.js?v=frontend-modules-2"',
        f'src="app.js?v={assets["app.js"]}-{version}"',
    )
    html = html.replace(
        '    <script type="module" src="app.js',
        f'    <script>window.ESSENCE_ASSET_VERSION = "{version}";</script>\n    <script type="module" src="app.js',
    )
    index_path.write_text(html, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_ROOT)
    args = parser.parse_args()
    build_info = build_dashboard(args.source, args.output)
    print(f"Built dashboard {build_info['version']} at {args.output}")


if __name__ == "__main__":
    main()
