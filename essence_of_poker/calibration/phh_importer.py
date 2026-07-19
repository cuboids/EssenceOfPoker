"""Import PHH-like hand histories into the canonical calibration schema."""

from __future__ import annotations

import json
import tomllib
from zipfile import ZipFile
from collections.abc import Iterable, Iterator
from datetime import datetime, time, timezone
from pathlib import Path
from typing import Any

from essence_of_poker.calibration.card_codec import parse_cards
from essence_of_poker.calibration.schema import ActionRecord, HandHistoryRecord, PlayerRecord

ACTION_ALIASES = {
    "folds": "fold",
    "fold": "fold",
    "checks": "check",
    "check": "check",
    "calls": "call",
    "call": "call",
    "bets": "bet",
    "bet": "bet",
    "raises": "raise",
    "raise": "raise",
    "all-in": "all-in",
    "allin": "all-in",
}


def iter_hand_histories(path: str | Path) -> Iterator[HandHistoryRecord]:
    """Yield canonical records from a file or directory.

    Supported inputs are PHH/TOML files, JSON files containing one hand, and
    JSONL files containing one hand per line. JSON support is included for
    normalized vendor adapters and for fast deterministic tests.
    """

    root = Path(path)
    if root.is_file() and root.suffix.lower() == ".zip":
        yield from iter_zip_hand_histories(root)
        return
    files = [root] if root.is_file() else sorted(candidate for candidate in root.rglob("*") if candidate.is_file())
    for file_path in files:
        suffix = "".join(file_path.suffixes[-2:])
        if file_path.suffix.lower() in {".phh", ".phhs", ".toml"}:
            yield from parse_phh_toml(file_path.read_bytes(), source_path=file_path)
        elif file_path.suffix.lower() == ".json":
            yield parse_mapping(json.loads(file_path.read_text()), source_path=file_path)
        elif file_path.suffix.lower() == ".jsonl":
            for line_number, line in enumerate(file_path.read_text().splitlines(), start=1):
                if line.strip():
                    yield parse_mapping(json.loads(line), source_path=file_path, line_number=line_number)
        elif suffix.lower() == ".json.gz":
            continue


def iter_zip_hand_histories(path: Path) -> Iterator[HandHistoryRecord]:
    with ZipFile(path) as archive:
        for name in archive.namelist():
            if name.endswith("/") or not name.lower().endswith((".phh", ".phhs", ".toml", ".json", ".jsonl")):
                continue
            with archive.open(name) as file:
                payload = file.read()
            source_path = Path(name)
            if name.lower().endswith((".phh", ".phhs", ".toml")):
                yield from parse_phh_toml(payload, source_path=source_path)
            elif name.lower().endswith(".json"):
                yield parse_mapping(json.loads(payload), source_path=source_path)
            elif name.lower().endswith(".jsonl"):
                for line_number, line in enumerate(payload.decode("utf-8").splitlines(), start=1):
                    if line.strip():
                        yield parse_mapping(json.loads(line), source_path=source_path, line_number=line_number)


def parse_phh_toml(payload: bytes, *, source_path: Path | None = None) -> Iterator[HandHistoryRecord]:
    parsed = tomllib.loads(payload.decode("utf-8"))
    if looks_like_phh_container(parsed):
        for table_key, hand_data in sorted(parsed.items(), key=lambda item: natural_table_key(item[0])):
            if isinstance(hand_data, dict):
                yield parse_mapping(hand_data, source_path=source_path, line_number=integer(table_key))
        return
    yield parse_mapping(parsed, source_path=source_path)


def parse_mapping(data: dict[str, Any], *, source_path: Path | None = None, line_number: int | None = None) -> HandHistoryRecord:
    if "actions" in data and any(isinstance(action, str) for action in data.get("actions", [])):
        return parse_phh_mapping(data, source_path=source_path, line_number=line_number)
    source = str(data.get("source") or data.get("site") or "phh")
    hand_id = str(data.get("hand_id") or data.get("handId") or data.get("id") or fallback_hand_id(source_path, line_number))
    players = tuple(parse_player(player) for player in list_value(data, "players", "seats"))
    actions = tuple(parse_action(index, action) for index, action in enumerate(list_value(data, "actions", "state_actions"), start=1))
    board = parse_cards(data.get("board") or flatten_board(data.get("flop"), data.get("turn"), data.get("river")))
    small_blind = numeric(data.get("small_blind") or data.get("smallBlind"))
    big_blind = numeric(data.get("big_blind") or data.get("bigBlind") or data.get("stake_bb") or data.get("stakeBB"))
    stake_bb = big_blind or numeric(data.get("stakes"))
    metadata = {
        "source_path": str(source_path) if source_path else None,
        "line_number": line_number,
        "small_blind": small_blind,
        "raw_stakes": data.get("stakes"),
    }
    return HandHistoryRecord(
        source=source,
        source_hand_id=hand_id,
        game=str(data.get("game") or data.get("variant") or "NLHE"),
        played_at=parse_datetime(data.get("played_at") or data.get("date") or data.get("time")),
        site=optional_string(data.get("site") or data.get("venue")),
        stake_bb=stake_bb,
        max_players=integer(data.get("max_players") or data.get("maxPlayers") or len(players) or None),
        button_seat=integer(data.get("button_seat") or data.get("buttonSeat")),
        players=players,
        actions=actions,
        board=board,
        metadata={key: value for key, value in metadata.items() if value is not None},
    )


def parse_player(player: dict[str, Any]) -> PlayerRecord:
    return PlayerRecord(
        source_player_id=str(player.get("id") or player.get("player_id") or player.get("name") or player.get("seat")),
        seat=integer(player.get("seat")),
        position=optional_string(player.get("position")),
        stack_bb=numeric(player.get("stack_bb") or player.get("stack")),
        is_hero=bool(player.get("is_hero") or player.get("hero")),
        hole_cards=parse_cards(player.get("hole_cards") or player.get("cards")),
    )


def parse_action(index: int, action: dict[str, Any] | str) -> ActionRecord:
    if isinstance(action, str):
        action = parse_action_string(action)
    action_type = normalize_action_type(action.get("type") or action.get("action"))
    return ActionRecord(
        index=integer(action.get("index")) or index,
        player_id=str(action.get("player_id") or action.get("player") or action.get("actor")),
        street=normalize_street(action.get("street")),
        action_type=action_type,
        amount_bb=numeric(action.get("amount_bb") or action.get("amount")),
        pot_fraction=numeric(action.get("pot_fraction") or action.get("potFraction")),
        all_in=bool(action.get("all_in") or action_type == "all-in"),
    )


def parse_action_string(text: str) -> dict[str, Any]:
    parts = text.replace(",", " ").split()
    if len(parts) < 2:
        raise ValueError(f"cannot parse action string: {text!r}")
    street = parts[0] if parts[0] in {"preflop", "flop", "turn", "river"} else "preflop"
    offset = 1 if street != "preflop" or parts[0] == "preflop" else 0
    player = parts[offset]
    action_type = parts[offset + 1]
    amount = numeric(parts[offset + 2]) if len(parts) > offset + 2 else None
    return {"street": street, "player": player, "type": action_type, "amount_bb": amount}


def parse_phh_mapping(data: dict[str, Any], *, source_path: Path | None = None, line_number: int | None = None) -> HandHistoryRecord:
    players = [str(player) for player in data.get("players", [])]
    starting_stacks = [numeric(value) for value in data.get("starting_stacks", [])]
    blinds = [numeric(value) or 0.0 for value in data.get("blinds_or_straddles", [])]
    big_blind = next((blind for blind in blinds if blind), numeric(data.get("min_bet")) or 1.0)
    if len([blind for blind in blinds if blind]) >= 2:
        big_blind = sorted(blind for blind in blinds if blind)[1]
    board: list[Any] = []
    actions: list[ActionRecord] = []
    hole_cards_by_player: dict[int, tuple[Any, ...]] = {}
    current_street = "preflop"
    aggressive_count_by_street: dict[str, int] = {"preflop": 1, "flop": 0, "turn": 0, "river": 0}

    for raw_action in data.get("actions", []):
        parts = str(raw_action).split()
        if len(parts) < 2:
            continue
        if parts[0] == "d":
            if len(parts) >= 4 and parts[1] == "dh":
                player_index = player_number(parts[2])
                hole_cards_by_player[player_index] = parse_cards(parts[3])
            elif len(parts) >= 3 and parts[1] == "db":
                dealt_board = parse_cards(parts[2])
                board.extend(dealt_board)
                current_street = street_for_board_count(len(board))
                aggressive_count_by_street[current_street] = 0
            continue
        if parts[0].startswith("p"):
            player_index = player_number(parts[0])
            code = parts[1]
            amount = numeric(parts[2]) if len(parts) >= 3 else None
            action_type = phh_action_type(code, current_street, aggressive_count_by_street[current_street])
            if action_type is None:
                continue
            if action_type in {"bet", "raise", "all-in"}:
                aggressive_count_by_street[current_street] += 1
            actions.append(
                ActionRecord(
                    index=len(actions) + 1,
                    player_id=player_id_for_index(players, player_index),
                    street=current_street,
                    action_type=action_type,
                    amount_bb=to_bb(amount, big_blind),
                    pot_fraction=None,
                    all_in=action_type == "all-in",
                )
            )

    player_records = tuple(
        PlayerRecord(
            source_player_id=player_id_for_index(players, index),
            seat=seat_for_index(data, index),
            position=position_for_index(len(players), index),
            stack_bb=to_bb(starting_stacks[index - 1] if index - 1 < len(starting_stacks) else None, big_blind),
            is_hero=False,
            hole_cards=tuple(hole_cards_by_player.get(index, ())),
        )
        for index in range(1, len(players) + 1)
    )
    hand_id = str(data.get("hand") or fallback_hand_id(source_path, line_number))
    return HandHistoryRecord(
        source="phh",
        source_hand_id=hand_id if source_path is None else f"{source_path}:{hand_id}",
        game=str(data.get("variant") or "NLHE"),
        played_at=phh_datetime(data),
        site=optional_string(data.get("venue")),
        stake_bb=to_bb(big_blind, big_blind),
        max_players=len(players) or None,
        button_seat=None,
        players=player_records,
        actions=tuple(actions),
        board=tuple(board),
        metadata={
            "source_path": str(source_path) if source_path else None,
            "line_number": line_number,
            "currency_symbol": data.get("currency_symbol"),
            "table": data.get("table"),
            "raw_big_blind": big_blind,
        },
    )


def looks_like_phh_container(parsed: dict[str, Any]) -> bool:
    return bool(parsed) and all(isinstance(value, dict) for value in parsed.values())


def natural_table_key(value: str) -> tuple[int, str]:
    number = integer(value)
    return (number if number is not None else 10**12, str(value))


def phh_action_type(code: str, street: str, aggressive_count: int) -> str | None:
    if code == "f":
        return "fold"
    if code == "cc":
        return "call" if aggressive_count > 0 else "check"
    if code == "cbr":
        if street == "preflop" or aggressive_count > 0:
            return "raise"
        return "bet"
    if code == "sm":
        return None
    return None


def player_number(token: str) -> int:
    if not token.startswith("p"):
        raise ValueError(f"unknown PHH player token: {token!r}")
    return int(token[1:])


def player_id_for_index(players: list[str], index: int) -> str:
    if 1 <= index <= len(players) and players[index - 1]:
        return players[index - 1]
    return f"p{index}"


def seat_for_index(data: dict[str, Any], index: int) -> int | None:
    seats = data.get("seats") or []
    if index - 1 < len(seats):
        return integer(seats[index - 1])
    return index


def position_for_index(player_count: int, index: int) -> str:
    positions_by_count = {
        2: ("SB", "BB"),
        3: ("SB", "BB", "BTN"),
        4: ("SB", "BB", "CO", "BTN"),
        5: ("SB", "BB", "HJ", "CO", "BTN"),
        6: ("SB", "BB", "LJ", "HJ", "CO", "BTN"),
    }
    positions = positions_by_count.get(player_count)
    if positions and 1 <= index <= len(positions):
        return positions[index - 1]
    if index == 1:
        return "SB"
    if index == 2:
        return "BB"
    if index == player_count:
        return "BTN"
    return f"EP{index - 2}"


def street_for_board_count(count: int) -> str:
    if count >= 5:
        return "river"
    if count == 4:
        return "turn"
    if count >= 3:
        return "flop"
    return "preflop"


def to_bb(amount: float | None, big_blind: float | None) -> float | None:
    if amount is None:
        return None
    blind = big_blind or 1.0
    return round(amount / blind, 6)


def phh_datetime(data: dict[str, Any]) -> datetime | None:
    year = integer(data.get("year"))
    month = integer(data.get("month"))
    day = integer(data.get("day"))
    if not (year and month and day):
        return parse_datetime(data.get("time"))
    raw_time = data.get("time")
    parsed_time = time(0, 0, 0)
    if raw_time is not None:
        if isinstance(raw_time, time):
            parsed_time = raw_time
        else:
            try:
                parsed_time = time.fromisoformat(str(raw_time))
            except ValueError:
                parsed_time = time(0, 0, 0)
    return datetime(year, month, day, parsed_time.hour, parsed_time.minute, parsed_time.second, tzinfo=timezone.utc)


def list_value(data: dict[str, Any], *keys: str) -> list[Any]:
    for key in keys:
        value = data.get(key)
        if isinstance(value, list):
            return value
    return []


def flatten_board(*parts: object) -> list[object]:
    cards: list[object] = []
    for part in parts:
        if part is None:
            continue
        if isinstance(part, list):
            cards.extend(part)
        else:
            cards.append(part)
    return cards


def parse_datetime(value: object) -> datetime | None:
    if value in (None, ""):
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def normalize_action_type(value: object) -> str:
    normalized = str(value or "").strip().lower()
    try:
        return ACTION_ALIASES[normalized]
    except KeyError as exc:
        raise ValueError(f"unknown action type: {value!r}") from exc


def normalize_street(value: object) -> str:
    normalized = str(value or "preflop").strip().lower()
    if normalized not in {"preflop", "flop", "turn", "river"}:
        raise ValueError(f"unknown street: {value!r}")
    return normalized


def optional_string(value: object) -> str | None:
    return None if value in (None, "") else str(value)


def numeric(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace("$", "").replace("€", "").replace(",", ""))
    except ValueError:
        return None


def integer(value: object) -> int | None:
    amount = numeric(value)
    return int(amount) if amount is not None else None


def fallback_hand_id(source_path: Path | None, line_number: int | None) -> str:
    if source_path is None:
        return "unknown"
    suffix = f":{line_number}" if line_number is not None else ""
    return f"{source_path.name}{suffix}"
