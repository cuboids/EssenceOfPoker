"""Feature extraction for empirical range calibration."""

from __future__ import annotations

import math
from collections import defaultdict

from essence_of_poker.calibration.schema import ActionRecord, HandHistoryRecord, TrainingExample

POSITION_ORDER = ("LJ", "HJ", "CO", "BTN", "SB", "BB")
ACTION_ORDER = ("fold", "check", "call", "bet", "raise", "all-in")
STREET_ORDER = ("preflop", "flop", "turn", "river")


def extract_training_examples(hand_key: str, hand: HandHistoryRecord) -> list[TrainingExample]:
    players = {player.source_player_id: player for player in hand.players}
    examples: list[TrainingExample] = []
    prior_aggression_by_street: dict[str, int] = defaultdict(int)
    prior_actions_by_player: dict[str, int] = defaultdict(int)
    pot_bb = initial_pot_bb(hand)

    for action in sorted(hand.actions, key=lambda item: item.index):
        player = players.get(action.player_id)
        if player is None or not player.position:
            continue
        features = base_features(hand, action, player.position)
        features.update(
            {
                "prior_aggressive_actions_street": prior_aggression_by_street[action.street],
                "prior_actions_player": prior_actions_by_player[action.player_id],
                "pot_bb_log": math.log1p(max(0.0, pot_bb)),
                "amount_to_pot": amount_to_pot(action, pot_bb),
                "known_hole_cards": len(player.hole_cards),
            }
        )
        if len(player.hole_cards) == 2:
            features.update(hole_card_features(player.hole_cards))
        examples.append(
            TrainingExample(
                hand_key=hand_key,
                player_id=action.player_id,
                action_index=action.index,
                street=action.street,
                position=player.position,
                action_type=action.action_type,
                features=features,
            )
        )
        if action.action_type in {"bet", "raise", "all-in"}:
            prior_aggression_by_street[action.street] += 1
        prior_actions_by_player[action.player_id] += 1
        if action.amount_bb:
            pot_bb += max(0.0, action.amount_bb)

    return examples


def base_features(hand: HandHistoryRecord, action: ActionRecord, position: str) -> dict[str, float | str]:
    year = hand.played_at.year if hand.played_at else 2009
    return {
        "bias": 1.0,
        "street": action.street,
        "street_index": STREET_ORDER.index(action.street),
        "position": position,
        "position_index": POSITION_ORDER.index(position) if position in POSITION_ORDER else len(POSITION_ORDER),
        "players": float(hand.max_players or len(hand.players) or 6),
        "stake_bb_log": math.log1p(max(0.0, hand.stake_bb or 0.0)),
        "played_year": float(year),
        "years_since_2009": float(year - 2009),
        "skill_proxy": skill_proxy(hand.stake_bb, year),
        "facing_all_in": 1.0 if action.all_in else 0.0,
    }


def hole_card_features(cards: tuple[object, ...]) -> dict[str, float | str]:
    first = cards[0]
    second = cards[1]
    ranks = sorted((int(first.rank), int(second.rank)))
    suited = 1.0 if int(first.suit) == int(second.suit) else 0.0
    pair = 1.0 if ranks[0] == ranks[1] else 0.0
    gap = abs(ranks[0] - ranks[1])
    return {
        "rank_1": float(ranks[0]),
        "rank_2": float(ranks[1]),
        "pair": pair,
        "suited": suited,
        "gap": float(gap),
        "broadway_count": float(sum(1 for rank in ranks if rank <= 5)),
        "wheel_count": float(sum(1 for rank in ranks if rank in {1, 10, 11, 12, 13})),
        "hand_class": hand_class_label(ranks, suited, pair),
    }


def hand_class_label(ranks: list[int], suited: float, pair: float) -> str:
    if pair:
        return f"{ranks[0]}-{ranks[0]}-pair"
    suffix = "suited" if suited else "offsuit"
    return f"{ranks[0]}-{ranks[1]}-{suffix}"


def skill_proxy(stake_bb: float | None, year: int) -> float:
    stake_component = math.log1p(max(0.0, stake_bb or 0.0)) / math.log1p(1000.0)
    time_component = max(0.0, min(1.0, (year - 2009) / 20.0))
    return 0.72 * stake_component + 0.28 * time_component


def amount_to_pot(action: ActionRecord, pot_bb: float) -> float:
    if action.pot_fraction is not None:
        return max(0.0, action.pot_fraction)
    if not action.amount_bb:
        return 0.0
    return action.amount_bb / max(1.0, pot_bb)


def initial_pot_bb(hand: HandHistoryRecord) -> float:
    if not hand.players:
        return 1.5
    return 1.5 + max(0, len(hand.players) - 2) * 0.0


def aggregate_player_stats(examples: list[TrainingExample]) -> dict[str, dict[str, float]]:
    stats: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for example in examples:
        player_stats = stats[example.player_id]
        player_stats["actions"] += 1
        player_stats[f"action_{example.action_type}"] += 1
        player_stats[f"street_{example.street}"] += 1
        if example.street == "preflop" and example.action_type in {"bet", "raise", "all-in"}:
            player_stats["pfr"] += 1
        if example.action_type == "call":
            player_stats["calls"] += 1
        if example.action_type == "fold":
            player_stats["folds"] += 1
        if example.action_type in {"bet", "raise", "all-in"}:
            player_stats["aggressive"] += 1
    return {player: normalize_player_stats(values) for player, values in stats.items()}


def normalize_player_stats(values: dict[str, float]) -> dict[str, float]:
    total = max(1.0, values["actions"])
    return {
        "vpip": (total - values["action_fold"]) / total,
        "pfr": values["pfr"] / total,
        "call_rate": values["calls"] / total,
        "fold_rate": values["folds"] / total,
        "aggression": values["aggressive"] / max(1.0, values["calls"] + values["folds"]),
        "sample_size": total,
    }
