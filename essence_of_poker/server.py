"""Serve the dashboard with a Redis-backed cache API."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from essence_of_poker.cache import CacheBackend, cache_from_environment


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DASHBOARD_ROOT = PROJECT_ROOT / "dashboard"
MAX_CACHE_PAYLOAD_BYTES = 24 * 1024 * 1024


class DashboardRequestHandler(SimpleHTTPRequestHandler):
    cache: CacheBackend
    dashboard_root: Path = DEFAULT_DASHBOARD_ROOT

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(self.dashboard_root), **kwargs)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self._json_response(health_payload(self.cache, self.dashboard_root))
            return
        if self.path.startswith("/api/data/preflop-hidden-villain/"):
            self._handle_preflop_hidden_villain_data()
            return
        if self.path.startswith("/api/data/preflop-aggregate/"):
            self._handle_preflop_aggregate_data()
            return
        if self.path.startswith("/api/data/preflop-primary/"):
            self._handle_preflop_primary_data()
            return
        if self.path.startswith("/api/cache/"):
            self._handle_cache_get()
            return
        super().do_GET()

    def do_PUT(self) -> None:
        if self.path.startswith("/api/cache/"):
            self._handle_cache_put()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors_headers()
        self.end_headers()

    def end_headers(self) -> None:
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", static_cache_control(self.path))
        super().end_headers()

    def _handle_cache_get(self) -> None:
        key = self._cache_key()
        value = self.cache.get(key)
        if value is None:
            self._json_response({"hit": False}, status=HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.OK)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Cache", self.cache.name)
        self.end_headers()
        self.wfile.write(value)

    def _handle_cache_put(self) -> None:
        key = self._cache_key()
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_CACHE_PAYLOAD_BYTES:
            self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return

        payload = self.rfile.read(length)
        try:
            json.loads(payload)
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, "cache payload must be JSON")
            return

        self.cache.set(key, payload)
        digest = hashlib.sha256(payload).hexdigest()[:16]
        self._json_response({"ok": True, "cache": self.cache.name, "sha256": digest})

    def _handle_preflop_hidden_villain_data(self) -> None:
        class_key = unquote(self.path.removeprefix("/api/data/preflop-hidden-villain/"))
        data_path = PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_hidden_villain_classes" / f"{class_key}.json.gz"
        self._serve_gzipped_class_payload(class_key, data_path)

    def _handle_preflop_aggregate_data(self) -> None:
        class_key = unquote(self.path.removeprefix("/api/data/preflop-aggregate/"))
        data_path = PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_aggregate_classes" / f"{class_key}.json.gz"
        self._serve_gzipped_class_payload(class_key, data_path)

    def _handle_preflop_primary_data(self) -> None:
        class_key = unquote(self.path.removeprefix("/api/data/preflop-primary/"))
        data_path = PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_primary_classes" / f"{class_key}.json.gz"
        self._serve_gzipped_class_payload(class_key, data_path)

    def _serve_gzipped_class_payload(self, class_key: str, data_path: Path) -> None:
        if not valid_preflop_class_key(class_key):
            self.send_error(HTTPStatus.BAD_REQUEST, "invalid preflop class key")
            return

        if not data_path.exists():
            self._json_response({"hit": False}, status=HTTPStatus.NOT_FOUND)
            return

        payload = data_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _cache_key(self) -> str:
        suffix = self.path.removeprefix("/api/cache/")
        return f"eop:{unquote(suffix)}"

    def _json_response(self, payload: dict, *, status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def dashboard_root_from_environment(path: str | None = None) -> Path:
    configured = path or os.environ.get("ESSENCE_DASHBOARD_ROOT")
    return Path(configured).resolve() if configured else DEFAULT_DASHBOARD_ROOT


def load_build_info(dashboard_root: Path) -> dict:
    build_info_path = dashboard_root / "build_info.json"
    if not build_info_path.exists():
        return {"version": "development", "builtAt": None}
    return json.loads(build_info_path.read_text(encoding="utf-8"))


def health_payload(cache: CacheBackend, dashboard_root: Path) -> dict:
    return {
        "ok": True,
        "cache": cache.status(),
        "dashboardRoot": str(dashboard_root),
        "build": load_build_info(dashboard_root),
        "data": data_health_payload(),
    }


def data_health_payload() -> dict:
    return {
        "preflopAggregateClasses": class_data_status(
            PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_aggregate_manifest.json",
            PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_aggregate_classes",
        ),
        "preflopHiddenVillainClasses": class_data_status(
            PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_hidden_villain_manifest.json",
            PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_hidden_villain_classes",
        ),
        "preflopPrimaryClasses": class_data_status(
            PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_primary_manifest.json",
            PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_primary_classes",
        ),
    }


def class_data_status(manifest_path: Path, classes_dir: Path) -> dict:
    class_count = len(list(classes_dir.glob("*.json.gz"))) if classes_dir.exists() else 0
    return {
        "ok": manifest_path.exists() and class_count == 169,
        "manifest": str(manifest_path),
        "classesDir": str(classes_dir),
        "classCount": class_count,
    }


def static_cache_control(request_path: str) -> str:
    if "?v=" in request_path:
        return "public, max-age=31536000, immutable"
    return "no-cache"


def valid_preflop_class_key(class_key: str) -> bool:
    parts = class_key.split("-")
    if len(parts) != 3 or parts[2] not in {"pair", "suited", "offsuit"}:
        return False
    try:
        first = int(parts[0])
        second = int(parts[1])
    except ValueError:
        return False
    if not (1 <= first <= 13 and 1 <= second <= 13 and first <= second):
        return False
    if parts[2] == "pair":
        return first == second
    return first < second


def run(host: str, port: int, dashboard_root: Path | None = None) -> None:
    DashboardRequestHandler.cache = cache_from_environment()
    DashboardRequestHandler.dashboard_root = (dashboard_root or dashboard_root_from_environment()).resolve()
    server = ThreadingHTTPServer((host, port), DashboardRequestHandler)
    print(
        f"Serving dashboard on http://{host}:{port}/ "
        f"from {DashboardRequestHandler.dashboard_root} "
        f"with {DashboardRequestHandler.cache.name} cache"
    )
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--dashboard-root", type=Path, default=None)
    args = parser.parse_args()
    run(args.host, args.port, args.dashboard_root)


if __name__ == "__main__":
    main()
