"""Serve the dashboard with a Redis-backed cache API."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from essence_of_poker.api_routes import (
    API_CACHE,
    API_EMPIRICAL_SPOT,
    API_HEALTH,
    API_INTERESTING_HAND,
    API_NOT_FOUND,
    API_PREFLOP_CLASS_DATA,
    match_api_route,
    preflop_class_data_path,
)
from essence_of_poker.cache import CacheBackend, cache_from_environment
from essence_of_poker.calibration.empirical_runtime import empirical_spot_cache_status, empirical_spot_payload_cached
from essence_of_poker.version_registry import VERSION_REGISTRY


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DASHBOARD_ROOT = PROJECT_ROOT / "dashboard"
MAX_CACHE_PAYLOAD_BYTES = 24 * 1024 * 1024
DASHBOARD_POSITIONS = frozenset(("SB", "BB", "LJ", "HJ", "CO", "BTN"))
DATA_HEALTH_TTL_SECONDS = 5.0
_DATA_HEALTH_CACHE: tuple[float, dict] | None = None


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
            self._json_response(health_payload(self.cache, self.dashboard_root))
            return
        if route.name == API_EMPIRICAL_SPOT:
            self._handle_empirical_spot()
            return
        if route.name == API_INTERESTING_HAND:
            self._handle_random_interesting_hand()
            return
        if route.name == API_PREFLOP_CLASS_DATA:
            self._handle_preflop_class_data(route)
            return
        if route.name == API_CACHE:
            self._handle_cache_get()
            return
        if route.name == API_NOT_FOUND:
            self._json_response({"ok": False, "error": "not found"}, status=HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def do_PUT(self) -> None:
        route = match_api_route("PUT", urlparse(self.path).path)
        if route and route.name == API_CACHE:
            self._handle_cache_put()
            return
        self._json_response({"ok": False, "error": "not found"}, status=HTTPStatus.NOT_FOUND)

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
        if not cache_write_is_authorized(self.headers, self.client_address):
            self._json_response(
                {"ok": False, "error": "cache writes are not authorized"},
                status=HTTPStatus.FORBIDDEN,
            )
            return
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

    def _handle_preflop_class_data(self, route) -> None:
        self._serve_gzipped_class_payload(
            route.class_key,
            preflop_class_data_path(PROJECT_ROOT, route.data_family, route.class_key),
        )

    def _handle_empirical_spot(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
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
            self._json_response({"ok": False, "error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.NOT_FOUND
        self._json_response(payload, status=status)

    def _handle_random_interesting_hand(self) -> None:
        db_path = PROJECT_ROOT / "data" / "interesting_hands.sqlite3"
        if not db_path.exists():
            self._json_response(
                {"ok": False, "error": "interesting hand subset has not been generated"},
                status=HTTPStatus.NOT_FOUND,
            )
            return
        try:
            payload = random_interesting_hand_payload(db_path)
        except sqlite3.Error as exc:
            self._json_response({"ok": False, "error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if not payload:
            self._json_response({"ok": False, "error": "interesting hand subset is empty"}, status=HTTPStatus.NOT_FOUND)
            return
        self._json_response(payload)

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
        "empiricalCalibration": empirical_calibration_status(
            PROJECT_ROOT / "data" / "calibration_compact.sqlite3",
        ),
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
    class_count = len(list(classes_dir.glob("*.json.gz"))) if classes_dir.exists() else 0
    return {
        "ok": manifest_path.exists() and class_count == 169,
        "manifest": str(manifest_path),
        "classesDir": str(classes_dir),
        "classCount": class_count,
    }


def empirical_calibration_status(db_path: Path) -> dict:
    if not db_path.exists():
        return {"ok": False, "path": str(db_path)}
    import sqlite3

    try:
        with sqlite3.connect(db_path) as connection:
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
    with sqlite3.connect(db_path) as connection:
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

    with sqlite3.connect(db_path) as connection:
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
