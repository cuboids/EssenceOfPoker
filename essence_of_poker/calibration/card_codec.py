"""Card parsing helpers for calibration importers."""

from __future__ import annotations

from essence_of_poker.calibration.schema import CardRecord

RANK_BY_SYMBOL = {symbol: index + 1 for index, symbol in enumerate("AKQJT98765432")}
SUIT_BY_SYMBOL = {
    "s": 1,
    "♠": 1,
    "h": 2,
    "♥": 2,
    "d": 3,
    "♦": 3,
    "c": 4,
    "♣": 4,
}


def parse_card_token(token: str) -> CardRecord:
    normalized = str(token).strip()
    if normalized == "????":
        raise ValueError("unknown card token")
    if normalized[:2] == "10":
        normalized = f"T{normalized[2:]}"
    if len(normalized) != 2:
        raise ValueError(f"card token must contain rank and suit: {token!r}")
    rank_symbol = normalized[0].upper()
    suit_symbol = normalized[1].lower()
    try:
        return CardRecord(RANK_BY_SYMBOL[rank_symbol], SUIT_BY_SYMBOL[suit_symbol])
    except KeyError as exc:
        raise ValueError(f"unknown card token: {token!r}") from exc


def parse_cards(value: object) -> tuple[CardRecord, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        tokens = value.replace("[", " ").replace("]", " ").replace(",", " ").split()
        if len(tokens) == 1 and len(tokens[0]) > 2 and len(tokens[0]) % 2 == 0:
            token = tokens[0]
            tokens = [token[index : index + 2] for index in range(0, len(token), 2)]
    else:
        tokens = [str(token) for token in value]  # type: ignore[arg-type]
    cards = []
    for token in tokens:
        if not token or "?" in token:
            continue
        cards.append(parse_card_token(token))
    return tuple(cards)
