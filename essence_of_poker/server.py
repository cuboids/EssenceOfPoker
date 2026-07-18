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
    }


def static_cache_control(request_path: str) -> str:
    if "?v=" in request_path:
        return "public, max-age=31536000, immutable"
    return "no-cache"


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
