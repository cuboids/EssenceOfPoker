"""Rank encoding for poker cards.

The project uses a high-card-first ordering:

    Ace = 1, King = 2, Queen = 3, Jack = 4, Ten = 5, ..., Two = 13
"""

from enum import IntEnum


class Rank(IntEnum):
    ACE = 1
    KING = 2
    QUEEN = 3
    JACK = 4
    TEN = 5
    NINE = 6
    EIGHT = 7
    SEVEN = 8
    SIX = 9
    FIVE = 10
    FOUR = 11
    THREE = 12
    TWO = 13


RANK_SYMBOLS: dict[Rank, str] = {
    Rank.ACE: "A",
    Rank.KING: "K",
    Rank.QUEEN: "Q",
    Rank.JACK: "J",
    Rank.TEN: "T",
    Rank.NINE: "9",
    Rank.EIGHT: "8",
    Rank.SEVEN: "7",
    Rank.SIX: "6",
    Rank.FIVE: "5",
    Rank.FOUR: "4",
    Rank.THREE: "3",
    Rank.TWO: "2",
}

SYMBOL_RANKS: dict[str, Rank] = {symbol: rank for rank, symbol in RANK_SYMBOLS.items()}


def rank_to_symbol(rank: Rank) -> str:
    """Return the compact poker symbol for a rank."""
    return RANK_SYMBOLS[Rank(rank)]


def parse_rank(symbol: str) -> Rank:
    """Parse a compact poker rank symbol into a Rank."""
    normalized = symbol.strip().upper()
    if normalized == "10":
        normalized = "T"

    try:
        return SYMBOL_RANKS[normalized]
    except KeyError as exc:
        raise ValueError(f"unknown rank symbol: {symbol!r}") from exc


def ranks_high_to_low() -> tuple[Rank, ...]:
    """Return all ranks from Ace down to Two in this project's ordering."""
    return tuple(Rank)

