"""Serve the dashboard with a Redis-backed cache API."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from essence_of_poker.api_handlers import (
    DEFAULT_DASHBOARD_ROOT,
    cache_get_api_response,
    cache_put_api_response,
    cache_write_is_authorized,
    cached_data_health_payload,
    class_data_status,
    dashboard_compatible_interesting_hand,
    dashboard_root_from_environment,
    empirical_calibration_status,
    empirical_spot_api_response,
    health_api_response,
    health_payload,
    not_found_api_response,
    options_api_response,
    preflop_class_api_response,
    random_interesting_hand_payload,
    random_interesting_hand_api_response,
    static_cache_control,
    valid_preflop_class_key,
)
from essence_of_poker.api_routes import (
    API_CACHE,
    API_EMPIRICAL_SPOT,
    API_HEALTH,
    API_INTERESTING_HAND,
    API_NOT_FOUND,
    API_PREFLOP_CLASS_DATA,
    match_api_route,
)
from essence_of_poker.cache import CacheBackend, cache_from_environment


class DashboardRequestHandler(SimpleHTTPRequestHandler):
    cache: CacheBackend
    dashboard_root: Path = DEFAULT_DASHBOARD_ROOT

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(self.dashboard_root), **kwargs)

    def do_GET(self) -> None:
        route = match_api_route("GET", urlparse(self.path).path)
        if route is None:
            super().do_GET()
            return
        if route.name == API_HEALTH:
            self._api_response(health_api_response(self.cache, self.dashboard_root))
            return
        if route.name == API_EMPIRICAL_SPOT:
            self._api_response(empirical_spot_api_response(parse_qs(urlparse(self.path).query)))
            return
        if route.name == API_INTERESTING_HAND:
            self._api_response(random_interesting_hand_api_response())
            return
        if route.name == API_PREFLOP_CLASS_DATA:
            self._api_response(preflop_class_api_response(route.data_family, route.class_key))
            return
        if route.name == API_CACHE:
            self._api_response(cache_get_api_response(self.cache, self.path))
            return
        if route.name == API_NOT_FOUND:
            self._api_response(not_found_api_response())
            return
        super().do_GET()

    def do_PUT(self) -> None:
        route = match_api_route("PUT", urlparse(self.path).path)
        if route and route.name == API_CACHE:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length > 0 else b""
            self._api_response(cache_put_api_response(self.cache, self.path, body, self.headers, self.client_address))
            return
        self._api_response(not_found_api_response())

    def do_OPTIONS(self) -> None:
        self._api_response(options_api_response())

    def end_headers(self) -> None:
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", static_cache_control(self.path))
        super().end_headers()

    def _api_response(self, response) -> None:
        self.send_response(response.status)
        for name, value in response.headers:
            self.send_header(name, value)
        if not any(name.lower() == "content-length" for name, _ in response.headers):
            self.send_header("Content-Length", str(len(response.body)))
        self.end_headers()
        self.wfile.write(response.body)


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
