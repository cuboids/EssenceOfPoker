"""Generate preflop Hero Aggregate equity versus any-two-card villain range."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import eval7


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / "dashboard" / "data" / "preflop_hand_equity_cache.json"
ITERATIONS = 500_000
ALL_HANDS_RANGE = "22+,A2+,K2+,Q2+,J2+,T2+,92+,82+,72+,62+,52+,42+,32"

RANK_VALUES = {
    "A": 1,
    "K": 2,
    "Q": 3,
    "J": 4,
    "T": 5,
    "9": 6,
    "8": 7,
    "7": 8,
    "6": 9,
    "5": 10,
    "4": 11,
    "3": 12,
    "2": 13,
}

SUIT_VALUES = {
    "s": 1,
    "h": 2,
    "d": 3,
    "c": 4,
}


def main() -> None:
    hand_range = eval7.HandRange(ALL_HANDS_RANGE)
    equities = eval7.py_all_hands_vs_range(hand_range, hand_range, [], ITERATIONS)
    grouped: dict[str, list[float]] = defaultdict(list)

    for hand, equity in equities.items():
        first, second = sorted((_card_to_model(card) for card in hand), key=lambda card: (card["rank"], card["suit"]))
        grouped[_class_key(first, second)].append(float(equity))

    classes = {
        class_key: sum(values) / len(values)
        for class_key, values in sorted(grouped.items(), key=lambda item: _class_sort_key(item[0]))
    }
    if len(classes) != 169:
        raise RuntimeError(f"expected 169 classes, got {len(classes)}")

    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "source": "eval7-py_all_hands_vs_range-monte-carlo",
                "exact": False,
                "iterations": ITERATIONS,
                "range": ALL_HANDS_RANGE,
                "classes": classes,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_PATH} with {len(classes)} classes")


def _card_to_model(card: eval7.Card) -> dict[str, int]:
    text = str(card)
    return {"rank": RANK_VALUES[text[0]], "suit": SUIT_VALUES[text[1]]}


def _class_key(first: dict[str, int], second: dict[str, int]) -> str:
    if first["rank"] == second["rank"]:
        return f"{first['rank']}-{second['rank']}-pair"
    suffix = "suited" if first["suit"] == second["suit"] else "offsuit"
    return f"{first['rank']}-{second['rank']}-{suffix}"


def _class_sort_key(class_key: str) -> tuple[int, int, str]:
    first, second, suffix = class_key.split("-")
    return int(first), int(second), suffix


if __name__ == "__main__":
    main()
