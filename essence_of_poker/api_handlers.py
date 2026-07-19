"""Shared dashboard API handlers for HTTP and WSGI adapters."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from contextlib import closing
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote

from essence_of_poker.api_routes import preflop_class_data_path
from essence_of_poker.cache import CacheBackend
from essence_of_poker.calibration.empirical_runtime import empirical_spot_cache_status, empirical_spot_payload_cached
from essence_of_poker.version_registry import VERSION_REGISTRY


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DASHBOARD_ROOT = PROJECT_ROOT / "dashboard"
MAX_CACHE_PAYLOAD_BYTES = 24 * 1024 * 1024
DASHBOARD_POSITIONS = frozenset(("SB", "BB", "LJ", "HJ", "CO", "BTN"))
DATA_HEALTH_TTL_SECONDS = 5.0
_DATA_HEALTH_CACHE: tuple[float, dict] | None = None


@dataclass(frozen=True)
class ApiResponse:
    status: HTTPStatus
    body: bytes
    headers: tuple[tuple[str, str], ...]


def health_api_response(cache: CacheBackend, dashboard_root: Path) -> ApiResponse:
    return json_api_response(health_payload(cache, dashboard_root))


def cache_get_api_response(cache: CacheBackend, path: str) -> ApiResponse:
    value = cache.get(cache_key_from_path(path))
    if value is None:
        return json_api_response({"hit": False}, HTTPStatus.NOT_FOUND)
    return ApiResponse(
        HTTPStatus.OK,
        value,
        (
            *cors_headers(),
            ("Content-Type", "application/json"),
            ("Cache-Control", "no-store"),
            ("X-Cache", cache.name),
        ),
    )


def cache_put_api_response(cache: CacheBackend, path: str, body: bytes, headers, client_address) -> ApiResponse:
    if not cache_write_is_authorized(headers, client_address):
        return json_api_response({"ok": False, "error": "cache writes are not authorized"}, HTTPStatus.FORBIDDEN)
    if len(body) <= 0 or len(body) > MAX_CACHE_PAYLOAD_BYTES:
        return json_api_response({"ok": False, "error": "invalid cache payload size"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
    try:
        json.loads(body)
    except json.JSONDecodeError:
        return json_api_response({"ok": False, "error": "cache payload must be JSON"}, HTTPStatus.BAD_REQUEST)

    cache.set(cache_key_from_path(path), body)
    digest = hashlib.sha256(body).hexdigest()[:16]
    return json_api_response({"ok": True, "cache": cache.name, "sha256": digest})


def preflop_class_api_response(data_family: str, class_key: str) -> ApiResponse:
    if not valid_preflop_class_key(class_key):
        return json_api_response({"ok": False, "error": "invalid preflop class key"}, HTTPStatus.BAD_REQUEST)
    data_path = preflop_class_data_path(PROJECT_ROOT, data_family, class_key)
    if not data_path.exists():
        return json_api_response({"hit": False}, HTTPStatus.NOT_FOUND)
    payload = data_path.read_bytes()
    return ApiResponse(
        HTTPStatus.OK,
        payload,
        (
            *cors_headers(),
            ("Content-Type", "application/json"),
            ("Content-Encoding", "gzip"),
            ("Cache-Control", "public, max-age=31536000, immutable"),
            ("Content-Length", str(len(payload))),
        ),
    )


def empirical_spot_api_response(query: dict[str, list[str]]) -> ApiResponse:
    try:
        payload = empirical_spot_payload_cached(
            cache_path=PROJECT_ROOT / "essence_of_poker" / "data" / "empirical_spot_cache.json",
            db_path=PROJECT_ROOT / "data" / "calibration_compact.sqlite3",
            street=required_query(query, "street"),
            position=required_query(query, "position"),
            player_count=int(required_query(query, "playerCount")),
            stake_bucket=first_query(query, "stakeBucket", "micro"),
            year_bucket=first_query(query, "yearBucket", "2009-2010"),
            facing_aggression=first_query(query, "facingAggression", "0") in {"1", "true", "True"},
            amount_bucket=first_query(query, "amountBucket", "none"),
        )
    except (KeyError, ValueError) as exc:
        return json_api_response({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
    return json_api_response(payload, HTTPStatus.OK if payload.get("ok") else HTTPStatus.NOT_FOUND)


def random_interesting_hand_api_response() -> ApiResponse:
    db_path = PROJECT_ROOT / "data" / "interesting_hands.sqlite3"
    if not db_path.exists():
        return json_api_response({"ok": False, "error": "interesting hand subset has not been generated"}, HTTPStatus.NOT_FOUND)
    try:
        payload = random_interesting_hand_payload(db_path)
    except sqlite3.Error as exc:
        return json_api_response({"ok": False, "error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
    if not payload:
        return json_api_response({"ok": False, "error": "interesting hand subset is empty"}, HTTPStatus.NOT_FOUND)
    return json_api_response(payload)


def options_api_response() -> ApiResponse:
    return ApiResponse(HTTPStatus.NO_CONTENT, b"", cors_headers())


def not_found_api_response() -> ApiResponse:
    return json_api_response({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)


def json_api_response(payload: dict, status: HTTPStatus = HTTPStatus.OK) -> ApiResponse:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return ApiResponse(
        status,
        body,
        (
            *cors_headers(),
            ("Content-Type", "application/json"),
            ("Cache-Control", "no-store"),
            ("Content-Length", str(len(body))),
        ),
    )


def cors_headers() -> tuple[tuple[str, str], ...]:
    return (
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, PUT, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type, X-Essence-Cache-Token"),
    )


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
        "security": security_status(),
        "dashboardRoot": str(dashboard_root),
        "build": load_build_info(dashboard_root),
        "versions": VERSION_REGISTRY.payload(),
        "data": cached_data_health_payload(),
    }


def cached_data_health_payload(ttl_seconds: float = DATA_HEALTH_TTL_SECONDS) -> dict:
    global _DATA_HEALTH_CACHE
    now = time.monotonic()
    if _DATA_HEALTH_CACHE and now - _DATA_HEALTH_CACHE[0] < ttl_seconds:
        return dict(_DATA_HEALTH_CACHE[1])
    payload = data_health_payload()
    _DATA_HEALTH_CACHE = (now, payload)
    return dict(payload)


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
        "empiricalCalibration": empirical_calibration_status(PROJECT_ROOT / "data" / "calibration_compact.sqlite3"),
        "empiricalSpotCache": empirical_spot_cache_status(
            PROJECT_ROOT / "essence_of_poker" / "data" / "empirical_spot_cache.json",
        ),
    }


def security_status() -> dict:
    return {
        "cacheWrites": {
            "mode": "token" if cache_write_token() else "loopback-only",
            "maxPayloadBytes": MAX_CACHE_PAYLOAD_BYTES,
        },
    }


def cache_write_is_authorized(headers, client_address: tuple[str, int] | tuple | None) -> bool:
    token = cache_write_token()
    if token:
        return str(headers.get("X-Essence-Cache-Token", "")) == token
    return client_is_loopback(client_address)


def cache_write_token() -> str:
    return os.environ.get("ESSENCE_CACHE_WRITE_TOKEN", "").strip()


def client_is_loopback(client_address: tuple[str, int] | tuple | None) -> bool:
    if not client_address:
        return False
    host = str(client_address[0])
    return host in {"127.0.0.1", "::1", "localhost"} or host.startswith("127.")


def class_data_status(manifest_path: Path, classes_dir: Path) -> dict:
    manifest = load_json_object(manifest_path)
    manifest_classes = sorted(str(class_key) for class_key in manifest.get("classes", [])) if manifest else []
    class_files = sorted(path.stem.removesuffix(".json") for path in classes_dir.glob("*.json.gz")) if classes_dir.exists() else []
    missing = sorted(set(manifest_classes) - set(class_files))
    extra = sorted(set(class_files) - set(manifest_classes))
    return {
        "ok": (
            manifest_path.exists() and
            classes_dir.exists() and
            len(manifest_classes) == 169 and
            class_files == manifest_classes
        ),
        "manifest": str(manifest_path),
        "classesDir": str(classes_dir),
        "manifestClasses": len(manifest_classes),
        "classCount": len(class_files),
        "missing": missing[:5],
        "extra": extra[:5],
    }


def load_json_object(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def empirical_calibration_status(db_path: Path) -> dict:
    if not db_path.exists():
        return {"ok": False, "path": str(db_path)}
    try:
        with closing(sqlite3.connect(db_path)) as connection:
            source_count = connection.execute("SELECT COUNT(*) FROM corpus_sources").fetchone()[0]
            file_count, hand_count, action_count = connection.execute(
                "SELECT COUNT(*), COALESCE(SUM(hand_count), 0), COALESCE(SUM(action_count), 0) FROM corpus_files"
            ).fetchone()
            feature_rows, feature_actions = connection.execute(
                "SELECT COUNT(*), COALESCE(SUM(count), 0) FROM action_feature_counts"
            ).fetchone()
    except sqlite3.Error as exc:
        return {"ok": False, "path": str(db_path), "error": str(exc)}
    return {
        "ok": source_count > 0 and hand_count > 0 and action_count == feature_actions,
        "path": str(db_path),
        "sources": source_count,
        "files": file_count,
        "hands": hand_count,
        "actions": action_count,
        "featureRows": feature_rows,
    }


def random_interesting_hand_payload(db_path: Path) -> dict | None:
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT hand_key, score, reasons_json, metrics_json, hand_json, source_path
            FROM interesting_hands
            WHERE COALESCE(json_extract(metrics_json, '$.players'), 0) BETWEEN 2 AND 6
            ORDER BY random()
            LIMIT 64
            """
        ).fetchall()
    for row in rows:
        hand = json.loads(row["hand_json"])
        if not dashboard_compatible_interesting_hand(hand):
            continue
        return {
            "ok": True,
            "handKey": row["hand_key"],
            "score": row["score"],
            "reasons": json.loads(row["reasons_json"]),
            "metrics": json.loads(row["metrics_json"]),
            "hand": hand,
            "sourcePath": row["source_path"],
        }
    if rows:
        return None

    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            """
            SELECT hand_key, score, reasons_json, metrics_json, hand_json, source_path
            FROM interesting_hands
            WHERE COALESCE(json_extract(metrics_json, '$.players'), 0) BETWEEN 2 AND 6
            ORDER BY score DESC
            LIMIT 1
            """
        ).fetchone()
    if not row:
        return None
    hand = json.loads(row["hand_json"])
    if not dashboard_compatible_interesting_hand(hand):
        return None
    return {
        "ok": True,
        "handKey": row["hand_key"],
        "score": row["score"],
        "reasons": json.loads(row["reasons_json"]),
        "metrics": json.loads(row["metrics_json"]),
        "hand": hand,
        "sourcePath": row["source_path"],
    }


def dashboard_compatible_interesting_hand(hand: dict) -> bool:
    players = [
        player for player in hand.get("players", [])
        if player.get("position") in DASHBOARD_POSITIONS and player.get("source_player_id")
    ]
    if not (2 <= len(players) <= 6):
        return False
    positions = [player["position"] for player in players]
    if len(set(positions)) != len(positions):
        return False
    source_ids = {player["source_player_id"] for player in players}
    if not any(len(player.get("hole_cards") or []) == 2 for player in players):
        return False
    if any(action.get("player_id") not in source_ids for action in hand.get("actions", [])):
        return False
    known_cards = []
    for player in players:
        known_cards.extend(player.get("hole_cards") or [])
    known_cards.extend(hand.get("board") or [])
    normalized_cards = [str(card).strip().lower() for card in known_cards if card]
    return len(normalized_cards) == len(set(normalized_cards))


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


def required_query(query: dict[str, list[str]], key: str) -> str:
    value = first_query(query, key, None)
    if value is None:
        raise KeyError(f"missing required query parameter: {key}")
    return value


def first_query(query: dict[str, list[str]], key: str, default: str | None) -> str | None:
    values = query.get(key)
    if not values:
        return default
    return values[0]


def cache_key_from_path(path: str) -> str:
    suffix = path.removeprefix("/api/cache/")
    return f"eop:{unquote(suffix)}"
