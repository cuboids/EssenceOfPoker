"""WSGI application boundary for production-style dashboard serving."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import sqlite3
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, unquote

from essence_of_poker.api_routes import (
    API_CACHE,
    API_EMPIRICAL_SPOT,
    API_HEALTH,
    API_INTERESTING_HAND,
    API_NOT_FOUND,
    API_OPTIONS,
    API_PREFLOP_CLASS_DATA,
    match_api_route,
    preflop_class_data_path,
)
from essence_of_poker.cache import CacheBackend, cache_from_environment
from essence_of_poker.calibration.empirical_runtime import empirical_spot_payload_cached
from essence_of_poker.server import (
    MAX_CACHE_PAYLOAD_BYTES,
    PROJECT_ROOT,
    cache_write_is_authorized,
    dashboard_root_from_environment,
    health_payload,
    random_interesting_hand_payload,
    required_query,
    static_cache_control,
    valid_preflop_class_key,
)


class EssencePokerWsgiApp:
    def __init__(self, *, cache: CacheBackend | None = None, dashboard_root: Path | None = None) -> None:
        self.cache = cache or cache_from_environment()
        self.dashboard_root = (dashboard_root or dashboard_root_from_environment()).resolve()

    def __call__(self, environ, start_response):
        request = WsgiRequest(environ)
        try:
            response = self.route(request)
        except Exception as exc:  # pragma: no cover - defensive production boundary
            response = json_response({"ok": False, "error": exc.__class__.__name__}, HTTPStatus.INTERNAL_SERVER_ERROR)
        start_response(response.status_line, response.headers)
        return [response.body]

    def route(self, request: "WsgiRequest") -> "WsgiResponse":
        route = match_api_route(request.method, request.path)
        if route is None:
            return self.static_file(request)
        if route.name == API_OPTIONS:
            return WsgiResponse(HTTPStatus.NO_CONTENT, b"", cors_headers())
        if route.name == API_HEALTH:
            return json_response(health_payload(self.cache, self.dashboard_root))
        if route.name == API_EMPIRICAL_SPOT:
            return self.empirical_spot(request)
        if route.name == API_INTERESTING_HAND:
            return self.random_interesting_hand()
        if route.name == API_PREFLOP_CLASS_DATA:
            return self.gzipped_class_payload(
                route.class_key,
                preflop_class_data_path(PROJECT_ROOT, route.data_family, route.class_key),
            )
        if route.name == API_CACHE:
            return self.cache_get(request) if route.method == "GET" else self.cache_put(request)
        if route.name == API_NOT_FOUND:
            return json_response({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
        return json_response({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)

    def cache_get(self, request: "WsgiRequest") -> "WsgiResponse":
        value = self.cache.get(cache_key_from_path(request.path))
        if value is None:
            return json_response({"hit": False}, HTTPStatus.NOT_FOUND)
        return WsgiResponse(
            HTTPStatus.OK,
            value,
            [
                *cors_headers(),
                ("Content-Type", "application/json"),
                ("Cache-Control", "no-store"),
                ("X-Cache", self.cache.name),
            ],
        )

    def cache_put(self, request: "WsgiRequest") -> "WsgiResponse":
        if not cache_write_is_authorized(request.headers, (request.remote_addr, 0)):
            return json_response({"ok": False, "error": "cache writes are not authorized"}, HTTPStatus.FORBIDDEN)
        if request.content_length <= 0 or request.content_length > MAX_CACHE_PAYLOAD_BYTES:
            return json_response({"ok": False, "error": "invalid cache payload size"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        payload = request.body
        try:
            json.loads(payload)
        except json.JSONDecodeError:
            return json_response({"ok": False, "error": "cache payload must be JSON"}, HTTPStatus.BAD_REQUEST)
        self.cache.set(cache_key_from_path(request.path), payload)
        digest = hashlib.sha256(payload).hexdigest()[:16]
        return json_response({"ok": True, "cache": self.cache.name, "sha256": digest})

    def empirical_spot(self, request: "WsgiRequest") -> "WsgiResponse":
        try:
            payload = empirical_spot_payload_cached(
                cache_path=PROJECT_ROOT / "essence_of_poker" / "data" / "empirical_spot_cache.json",
                db_path=PROJECT_ROOT / "data" / "calibration_compact.sqlite3",
                street=required_query(request.query, "street"),
                position=required_query(request.query, "position"),
                player_count=int(required_query(request.query, "playerCount")),
                stake_bucket=first_query(request.query, "stakeBucket", "micro"),
                year_bucket=first_query(request.query, "yearBucket", "2009-2010"),
                facing_aggression=first_query(request.query, "facingAggression", "0") in {"1", "true", "True"},
                amount_bucket=first_query(request.query, "amountBucket", "none"),
            )
        except (KeyError, ValueError) as exc:
            return json_response({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return json_response(payload, HTTPStatus.OK if payload.get("ok") else HTTPStatus.NOT_FOUND)

    def random_interesting_hand(self) -> "WsgiResponse":
        db_path = PROJECT_ROOT / "data" / "interesting_hands.sqlite3"
        if not db_path.exists():
            return json_response({"ok": False, "error": "interesting hand subset has not been generated"}, HTTPStatus.NOT_FOUND)
        try:
            payload = random_interesting_hand_payload(db_path)
        except sqlite3.Error as exc:
            return json_response({"ok": False, "error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
        if not payload:
            return json_response({"ok": False, "error": "interesting hand subset is empty"}, HTTPStatus.NOT_FOUND)
        return json_response(payload)

    def gzipped_class_payload(self, class_key: str, data_path: Path) -> "WsgiResponse":
        if not valid_preflop_class_key(class_key):
            return json_response({"ok": False, "error": "invalid preflop class key"}, HTTPStatus.BAD_REQUEST)
        if not data_path.exists():
            return json_response({"hit": False}, HTTPStatus.NOT_FOUND)
        return WsgiResponse(
            HTTPStatus.OK,
            data_path.read_bytes(),
            [
                *cors_headers(),
                ("Content-Type", "application/json"),
                ("Content-Encoding", "gzip"),
                ("Cache-Control", "public, max-age=31536000, immutable"),
            ],
        )

    def static_file(self, request: "WsgiRequest") -> "WsgiResponse":
        relative = "index.html" if request.path in {"", "/"} else unquote(request.path).lstrip("/")
        path = (self.dashboard_root / relative).resolve()
        if not path.is_file() or self.dashboard_root not in path.parents:
            return WsgiResponse(HTTPStatus.NOT_FOUND, b"not found", [("Content-Type", "text/plain; charset=utf-8")])
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return WsgiResponse(
            HTTPStatus.OK,
            path.read_bytes(),
            [
                ("Content-Type", content_type),
                ("Cache-Control", static_cache_control(request.raw_uri)),
            ],
        )


class WsgiRequest:
    def __init__(self, environ) -> None:
        self.environ = environ
        self.method = str(environ.get("REQUEST_METHOD", "GET")).upper()
        self.path = str(environ.get("PATH_INFO", "/") or "/")
        self.raw_uri = str(environ.get("RAW_URI") or self.path)
        self.query = parse_qs(str(environ.get("QUERY_STRING", "")))
        self.remote_addr = str(environ.get("REMOTE_ADDR", ""))
        self.content_length = int(environ.get("CONTENT_LENGTH") or 0)
        self.headers = headers_from_environ(environ)
        self.body = environ["wsgi.input"].read(self.content_length) if self.content_length else b""


class WsgiResponse:
    def __init__(self, status: HTTPStatus, body: bytes, headers: list[tuple[str, str]] | None = None) -> None:
        self.status = status
        self.body = body
        self.headers = headers or []
        self.headers.append(("Content-Length", str(len(body))))

    @property
    def status_line(self) -> str:
        return f"{self.status.value} {self.status.phrase}"


def json_response(payload: dict, status: HTTPStatus = HTTPStatus.OK) -> WsgiResponse:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return WsgiResponse(
        status,
        body,
        [
            *cors_headers(),
            ("Content-Type", "application/json"),
            ("Cache-Control", "no-store"),
        ],
    )


def cors_headers() -> list[tuple[str, str]]:
    return [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, PUT, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type, X-Essence-Cache-Token"),
    ]


def headers_from_environ(environ) -> dict[str, str]:
    headers = {}
    for key, value in environ.items():
        if key.startswith("HTTP_"):
            normalized = "-".join(part.capitalize() for part in key.removeprefix("HTTP_").split("_"))
            headers[normalized] = str(value)
    return headers


def cache_key_from_path(path: str) -> str:
    suffix = path.removeprefix("/api/cache/")
    return f"eop:{unquote(suffix)}"


def first_query(query: dict[str, list[str]], key: str, default: str | None) -> str | None:
    values = query.get(key)
    if not values:
        return default
    return values[0]


application = EssencePokerWsgiApp()
