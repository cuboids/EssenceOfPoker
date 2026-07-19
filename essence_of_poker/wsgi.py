"""WSGI application boundary for production-style dashboard serving."""

from __future__ import annotations

import mimetypes
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
)
from essence_of_poker.api_handlers import (
    cache_get_api_response,
    cache_put_api_response,
    dashboard_root_from_environment,
    empirical_spot_api_response,
    health_api_response,
    json_api_response,
    not_found_api_response,
    options_api_response,
    preflop_class_api_response,
    random_interesting_hand_api_response,
    static_cache_control,
)
from essence_of_poker.cache import CacheBackend, cache_from_environment


class EssencePokerWsgiApp:
    def __init__(self, *, cache: CacheBackend | None = None, dashboard_root: Path | None = None) -> None:
        self.cache = cache or cache_from_environment()
        self.dashboard_root = (dashboard_root or dashboard_root_from_environment()).resolve()

    def __call__(self, environ, start_response):
        request = WsgiRequest(environ)
        try:
            response = self.route(request)
        except Exception as exc:  # pragma: no cover - defensive production boundary
            response = wsgi_response_from_api(json_api_response({"ok": False, "error": exc.__class__.__name__}, HTTPStatus.INTERNAL_SERVER_ERROR))
        start_response(response.status_line, response.headers)
        return [response.body]

    def route(self, request: "WsgiRequest") -> "WsgiResponse":
        route = match_api_route(request.method, request.path)
        if route is None:
            return self.static_file(request)
        if route.name == API_OPTIONS:
            return wsgi_response_from_api(options_api_response())
        if route.name == API_HEALTH:
            return wsgi_response_from_api(health_api_response(self.cache, self.dashboard_root))
        if route.name == API_EMPIRICAL_SPOT:
            return wsgi_response_from_api(empirical_spot_api_response(request.query))
        if route.name == API_INTERESTING_HAND:
            return wsgi_response_from_api(random_interesting_hand_api_response())
        if route.name == API_PREFLOP_CLASS_DATA:
            return wsgi_response_from_api(preflop_class_api_response(route.data_family, route.class_key))
        if route.name == API_CACHE:
            return wsgi_response_from_api(
                cache_get_api_response(self.cache, request.path)
                if route.method == "GET"
                else cache_put_api_response(self.cache, request.path, request.body, request.headers, (request.remote_addr, 0))
            )
        if route.name == API_NOT_FOUND:
            return wsgi_response_from_api(not_found_api_response())
        return wsgi_response_from_api(not_found_api_response())

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


def wsgi_response_from_api(response) -> WsgiResponse:
    headers = [(name, value) for name, value in response.headers if name.lower() != "content-length"]
    return WsgiResponse(response.status, response.body, headers)


def headers_from_environ(environ) -> dict[str, str]:
    headers = {}
    for key, value in environ.items():
        if key.startswith("HTTP_"):
            normalized = "-".join(part.capitalize() for part in key.removeprefix("HTTP_").split("_"))
            headers[normalized] = str(value)
    return headers


application = EssencePokerWsgiApp()
