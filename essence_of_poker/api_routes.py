"""Shared dashboard API route matching for HTTP and WSGI adapters."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote


API_HEALTH = "health"
API_EMPIRICAL_SPOT = "empirical_spot"
API_INTERESTING_HAND = "interesting_hand"
API_PREFLOP_CLASS_DATA = "preflop_class_data"
API_CACHE = "cache"
API_OPTIONS = "options"
API_NOT_FOUND = "api_not_found"

PREFLOP_DATA_PREFIXES = {
    "hidden_villain": "/api/data/preflop-hidden-villain/",
    "aggregate": "/api/data/preflop-aggregate/",
    "primary": "/api/data/preflop-primary/",
}
PREFLOP_DATA_DIRECTORIES = {
    "hidden_villain": "preflop_hidden_villain_classes",
    "aggregate": "preflop_aggregate_classes",
    "primary": "preflop_primary_classes",
}


@dataclass(frozen=True)
class ApiRoute:
    name: str
    method: str
    path: str
    class_key: str | None = None
    data_family: str | None = None


def match_api_route(method: str, path: str) -> ApiRoute | None:
    normalized_method = method.upper()
    if normalized_method == "OPTIONS":
        return ApiRoute(API_OPTIONS, normalized_method, path)
    if path == "/api/health" and normalized_method == "GET":
        return ApiRoute(API_HEALTH, normalized_method, path)
    if path.startswith("/api/calibration/empirical-spot") and normalized_method == "GET":
        return ApiRoute(API_EMPIRICAL_SPOT, normalized_method, path)
    if path.startswith("/api/interesting-hands/random") and normalized_method == "GET":
        return ApiRoute(API_INTERESTING_HAND, normalized_method, path)
    for family, prefix in PREFLOP_DATA_PREFIXES.items():
        if path.startswith(prefix) and normalized_method == "GET":
            return ApiRoute(
                API_PREFLOP_CLASS_DATA,
                normalized_method,
                path,
                class_key=unquote(path.removeprefix(prefix)),
                data_family=family,
            )
    if path.startswith("/api/cache/") and normalized_method in {"GET", "PUT"}:
        return ApiRoute(API_CACHE, normalized_method, path)
    if path.startswith("/api/"):
        return ApiRoute(API_NOT_FOUND, normalized_method, path)
    return None


def preflop_class_data_path(project_root: Path, family: str, class_key: str) -> Path:
    return (
        project_root /
        "essence_of_poker" /
        "data" /
        PREFLOP_DATA_DIRECTORIES[family] /
        f"{class_key}.json.gz"
    )
