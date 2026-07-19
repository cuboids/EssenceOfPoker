"""Select reusable interesting-hand subsets from calibration corpora."""

from __future__ import annotations

import heapq
import json
import sqlite3
import tomllib
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zipfile import ZipFile

from essence_of_poker.calibration.phh_importer import iter_hand_histories, parse_phh_toml
from essence_of_poker.calibration.schema import ActionRecord, HandHistoryRecord, PlayerRecord


DEFAULT_LIMIT = 1_000
DEFAULT_MIN_SCORE = 12.0


def build_interesting_hand_subset(
    input_path: str | Path | None = None,
    *,
    compact_db: str | Path = "data/calibration_compact.sqlite3",
    output_db: str | Path = "data/interesting_hands.sqlite3",
    output_jsonl: str | Path | None = "data/interesting_hands.jsonl",
    limit: int = DEFAULT_LIMIT,
    min_score: float = DEFAULT_MIN_SCORE,
    scan_limit: int | None = None,
) -> dict[str, Any]:
    source_path = Path(input_path) if input_path else source_path_from_compact_db(compact_db)
    if not source_path.exists():
        raise FileNotFoundError(f"training source archive not found: {source_path}")

    selected = select_interesting_hands(source_path, limit=limit, min_score=min_score, scan_limit=scan_limit)
    write_interesting_subset(selected, output_db=output_db, output_jsonl=output_jsonl, source_path=source_path)
    return {
        "source": str(source_path),
        "output_db": str(output_db),
        "output_jsonl": str(output_jsonl) if output_jsonl else None,
        "selected_hands": len(selected),
        "limit": limit,
        "min_score": min_score,
        "scan_limit": scan_limit,
        "top_score": selected[0]["score"] if selected else 0,
    }


def source_path_from_compact_db(compact_db: str | Path) -> Path:
    with closing(sqlite3.connect(compact_db)) as connection:
        row = connection.execute(
            """
            SELECT path
            FROM corpus_sources
            ORDER BY imported_at DESC
            LIMIT 1
            """
        ).fetchone()
    if not row:
        raise ValueError(f"no corpus source is registered in {compact_db}")
    return Path(row[0])


def select_interesting_hands(
    input_path: str | Path,
    *,
    limit: int = DEFAULT_LIMIT,
    min_score: float = DEFAULT_MIN_SCORE,
    scan_limit: int | None = None,
) -> list[dict[str, Any]]:
    heap: list[tuple[float, str, dict[str, Any]]] = []
    seen = 0
    for hand in iter_hands_fast(Path(input_path)):
        seen += 1
        label = interesting_label(hand)
        if label["score"] < min_score:
            if scan_limit and seen >= scan_limit:
                break
            continue
        item = {
            "hand_key": hand_key(hand),
            "score": label["score"],
            "reasons": label["reasons"],
            "metrics": label["metrics"],
            "hand": serialize_hand(hand),
        }
        heapq.heappush(heap, (item["score"], item["hand_key"], item))
        if len(heap) > limit:
            heapq.heappop(heap)
        if scan_limit and seen >= scan_limit:
            break
    return [
        item
        for _, _, item in sorted(heap, key=lambda row: (-row[0], row[1]))
    ]


def iter_hands_fast(input_path: Path):
    if input_path.is_file() and input_path.suffix.lower() == ".zip":
        with ZipFile(input_path) as archive:
            for info in archive.infolist():
                if info.is_dir() or not info.filename.lower().endswith((".phh", ".phhs", ".toml")):
                    continue
                payload = archive.read(info)
                try:
                    yield from parse_phh_toml(payload, source_path=Path(info.filename))
                except (tomllib.TOMLDecodeError, ValueError):
                    continue
        return
    yield from iter_hand_histories(input_path)


def interesting_label(hand: HandHistoryRecord) -> dict[str, Any]:
    actions = list(hand.actions)
    aggressive = [action for action in actions if action.action_type in {"bet", "raise", "all-in"}]
    all_ins = [action for action in actions if action.all_in or action.action_type == "all-in"]
    streets = {action.street for action in actions}
    street_actions = {street: [action for action in actions if action.street == street] for street in ("preflop", "flop", "turn", "river")}
    raises_by_street = {
        street: sum(1 for action in street_actions[street] if action.action_type in {"raise", "all-in"})
        for street in street_actions
    }
    max_amount = max((action.amount_bb or 0.0 for action in actions), default=0.0)
    callers = sum(1 for action in actions if action.action_type == "call")
    folds = sum(1 for action in actions if action.action_type == "fold")
    board_count = len(hand.board)
    player_count = len(hand.players) or hand.max_players or 0

    score = 0.0
    reasons: list[str] = []
    score += min(len(actions), 20) * 0.6
    score += len(aggressive) * 1.8
    score += callers * 0.45
    if len(streets) >= 2:
        score += 3
        reasons.append("multi-street action")
    if len(streets) >= 3:
        score += 4
        reasons.append("turn-or-river continuation")
    if street_actions["river"]:
        score += 6
        reasons.append("river decision")
    if all_ins:
        score += 10 + 2 * len(all_ins)
        reasons.append("all-in")
    if max(raises_by_street.values(), default=0) >= 2:
        score += 7
        reasons.append("multi-raise street")
    if len(aggressive) >= 4:
        score += 5
        reasons.append("high aggression")
    if len(actions) >= 10:
        score += 4
        reasons.append("long action sequence")
    if max_amount >= 20:
        score += 5
        reasons.append("large wager")
    elif max_amount >= 8:
        score += 2
        reasons.append("medium-large wager")
    if player_count >= 5 and callers >= 3:
        score += 3
        reasons.append("multiway action")
    if board_count == 5 and len(streets) >= 2:
        score += 2
        reasons.append("complete board")
    if folds >= max(2, player_count - 2):
        score += 1.5
        reasons.append("many folds")
    if not reasons:
        reasons.append("above-average action density")

    return {
        "score": round(score, 3),
        "reasons": reasons,
        "metrics": {
            "actions": len(actions),
            "aggressive_actions": len(aggressive),
            "calls": callers,
            "folds": folds,
            "all_ins": len(all_ins),
            "streets": sorted(streets),
            "max_amount_bb": max_amount,
            "board_cards": board_count,
            "players": player_count,
            "raises_by_street": raises_by_street,
        },
    }


def write_interesting_subset(
    selected: list[dict[str, Any]],
    *,
    output_db: str | Path,
    output_jsonl: str | Path | None,
    source_path: Path,
) -> None:
    db_path = Path(output_db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path)) as connection:
        with connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS interesting_hands (
                  hand_key TEXT PRIMARY KEY,
                  score REAL NOT NULL,
                  reasons_json TEXT NOT NULL,
                  metrics_json TEXT NOT NULL,
                  hand_json TEXT NOT NULL,
                  source_path TEXT NOT NULL,
                  selected_at TEXT NOT NULL
                );
                DELETE FROM interesting_hands;
                """
            )
            selected_at = datetime.now(timezone.utc).isoformat()
            connection.executemany(
                """
                INSERT INTO interesting_hands (
                  hand_key, score, reasons_json, metrics_json, hand_json, source_path, selected_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item["hand_key"],
                        item["score"],
                        json.dumps(item["reasons"], sort_keys=True),
                        json.dumps(item["metrics"], sort_keys=True),
                        json.dumps(item["hand"], sort_keys=True),
                        str(source_path),
                        selected_at,
                    )
                    for item in selected
                ],
            )
    if output_jsonl:
        jsonl_path = Path(output_jsonl)
        jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        jsonl_path.write_text("\n".join(json.dumps(item, sort_keys=True) for item in selected) + ("\n" if selected else ""))


def hand_key(hand: HandHistoryRecord) -> str:
    return f"{hand.source}:{hand.source_hand_id}"


def serialize_hand(hand: HandHistoryRecord) -> dict[str, Any]:
    return {
        "source": hand.source,
        "source_hand_id": hand.source_hand_id,
        "game": hand.game,
        "played_at": hand.played_at.isoformat() if hand.played_at else None,
        "site": hand.site,
        "stake_bb": hand.stake_bb,
        "max_players": hand.max_players,
        "button_seat": hand.button_seat,
        "players": [serialize_player(player) for player in hand.players],
        "actions": [serialize_action(action) for action in hand.actions],
        "board": [card.token for card in hand.board],
        "metadata": hand.metadata,
    }


def serialize_player(player: PlayerRecord) -> dict[str, Any]:
    return {
        "source_player_id": player.source_player_id,
        "seat": player.seat,
        "position": player.position,
        "stack_bb": player.stack_bb,
        "is_hero": player.is_hero,
        "hole_cards": [card.token for card in player.hole_cards],
    }


def serialize_action(action: ActionRecord) -> dict[str, Any]:
    return {
        "index": action.index,
        "player_id": action.player_id,
        "street": action.street,
        "action_type": action.action_type,
        "amount_bb": action.amount_bb,
        "pot_fraction": action.pot_fraction,
        "all_in": action.all_in,
    }
