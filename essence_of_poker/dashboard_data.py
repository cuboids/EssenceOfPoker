"""Generate JSON data for portfolio dashboards."""

import json
import gzip
from functools import cache
from pathlib import Path

from essence_of_poker.assets import empty_asset
from essence_of_poker.hand_buckets import HandBucket, HandCategory, bucket_key
from essence_of_poker.portfolio import (
    PORTFOLIO_DEFINITIONS,
    PORTFOLIO_AGGREGATE_DEFINITIONS,
    build_prior_a2c_villain_portfolio,
    build_prior_nlhe_portfolio,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "dashboard" / "data" / "prior_portfolio.json"
PRIOR_AGGREGATE_COUNTS_PATH = PROJECT_ROOT / "essence_of_poker" / "data" / "prior_aggregate_counts.json"
PREFLOP_AGGREGATE_CACHE_PATH = PROJECT_ROOT / "dashboard" / "data" / "preflop_aggregate_cache.json"
PREFLOP_PRIMARY_PRIOR_CACHE_PATH = PROJECT_ROOT / "essence_of_poker" / "data" / "preflop_primary_prior_cache.json"

CATEGORY_DISPLAY_NAMES = {
    HandCategory.STRAIGHT_FLUSH: "Straight flush",
    HandCategory.FOUR_OF_A_KIND: "Four of a kind",
    HandCategory.FULL_HOUSE: "Full house",
    HandCategory.FLUSH: "Flush",
    HandCategory.STRAIGHT: "Straight",
    HandCategory.THREE_OF_A_KIND: "Three of a kind",
    HandCategory.TWO_PAIR: "Two pair",
    HandCategory.ONE_PAIR: "One pair",
    HandCategory.HIGH_CARD: "High card",
}

CATEGORY_COLORS = {
    HandCategory.STRAIGHT_FLUSH: "#00796b",
    HandCategory.FOUR_OF_A_KIND: "#c62828",
    HandCategory.FULL_HOUSE: "#6a1b9a",
    HandCategory.FLUSH: "#1565c0",
    HandCategory.STRAIGHT: "#ef6c00",
    HandCategory.THREE_OF_A_KIND: "#5d4037",
    HandCategory.TWO_PAIR: "#ad1457",
    HandCategory.ONE_PAIR: "#2e7d32",
    HandCategory.HIGH_CARD: "#455a64",
}


def prior_dashboard_data() -> dict:
    hero_portfolio = build_prior_nlhe_portfolio()
    a2c_villain_portfolio = build_prior_a2c_villain_portfolio()
    distribution = empty_asset().bucket_distribution()
    prior_aggregate_counts = _prior_aggregate_counts()
    primary_priors = _portfolio_primary_priors()
    aggregate_priors = _portfolio_aggregate_priors(distribution, prior_aggregate_counts)
    buckets = tuple(distribution)
    total_combos = sum(distribution.values())
    cumulative = 0
    cumulative_curve = []
    cumulative_by_gradation = {0: 0}

    for bucket in buckets:
        cumulative += distribution[bucket]
        cumulative_probability = cumulative / total_combos
        cumulative_by_gradation[bucket.gradation] = cumulative_probability
        cumulative_curve.append(
            {
                "gradation": bucket.gradation,
                "probability": cumulative_probability,
                "x": cumulative_probability,
            }
        )

    return {
        "title": "Prior NLHE Portfolio",
        "totalCombos": total_combos,
        "bucketCount": len(buckets),
        "curve": cumulative_curve,
        "priorAggregate": {
            "counts": prior_aggregate_counts,
            "totalCombos": sum(prior_aggregate_counts),
            "bestGradation": next(index for index, count in enumerate(prior_aggregate_counts) if count),
            "worstGradation": max(index for index, count in enumerate(prior_aggregate_counts) if count),
        },
        "bucketKeys": _bucket_keys(buckets),
        "categoryBands": _category_bands(buckets, cumulative_by_gradation),
        "subcategoryBands": _subcategory_bands(buckets, cumulative_by_gradation),
        "portfolios": {
            "hero": {
                "name": "Hero",
                "assets": _portfolio_assets(hero_portfolio.assets, primary_priors),
                "aggregates": _portfolio_aggregates(PORTFOLIO_AGGREGATE_DEFINITIONS, aggregate_priors),
            },
            "a2cVillain": {
                "name": "Villain",
                "assets": _portfolio_assets(a2c_villain_portfolio.assets, primary_priors),
                "aggregates": _portfolio_aggregates(PORTFOLIO_AGGREGATE_DEFINITIONS, aggregate_priors),
            },
        },
        "assets": _portfolio_assets(hero_portfolio.assets, primary_priors),
    }


def _prior_aggregate_counts() -> list[int]:
    return list(_cached_prior_aggregate_counts())


@cache
def _cached_prior_aggregate_counts() -> tuple[int, ...]:
    return tuple(json.loads(PRIOR_AGGREGATE_COUNTS_PATH.read_text(encoding="utf-8")))


def _portfolio_assets(portfolio_assets: tuple, primary_priors: dict[str, dict]) -> list[dict]:
    return [
            {
                "code": portfolio_asset.definition.code,
                "category": portfolio_asset.definition.category.name,
                "name": portfolio_asset.definition.name,
                "positions": portfolio_asset.definition.positions,
                "active": True,
                "emptySlots": portfolio_asset.asset.empty_slot_count,
                "totalCombos": primary_priors[portfolio_asset.definition.code]["totalCombos"],
                "prior": primary_priors[portfolio_asset.definition.code],
            }
            for portfolio_asset in portfolio_assets
        ]


def _portfolio_aggregates(aggregates: tuple, aggregate_priors: dict[str, dict]) -> list[dict]:
    return [
        {
            "code": aggregate.code,
            "category": aggregate.category.name if aggregate.category is not None else "AGGREGATE",
            "name": aggregate.name,
            "assetCodes": aggregate.asset_codes,
            "active": True,
            "isAggregate": True,
            "prior": aggregate_priors[aggregate.code],
        }
        for aggregate in aggregates
    ]


def _portfolio_aggregate_priors(
    generic_five_card_distribution: dict[HandBucket, int],
    prior_aggregate_counts: list[int],
) -> dict[str, dict]:
    """Build exact empty-street priors for portfolio aggregates.

    The preflop aggregate cache stores exact board distributions conditional on
    each canonical starting-hand class.  Folding those 169 classes back together
    by physical combo count gives the unconditional prior for the aggregate
    machinery, without asking the browser to rediscover it on load.
    """
    generic_five_counts = _counts_array_from_distribution(generic_five_card_distribution)
    aggregate_priors = {
        "AGG": _trim_counts([count * 21 for count in prior_aggregate_counts]),
        "AGG_ZERO": _trim_counts([count * 1081 for count in generic_five_counts]),
    }

    for aggregate_code in ("AGG_BOTH", "AGG_H1", "AGG_H2"):
        aggregate_priors[aggregate_code] = _trim_counts(list(_folded_preflop_aggregate_counts(aggregate_code)))

    return aggregate_priors


def _portfolio_primary_priors() -> dict[str, dict]:
    return {
        asset_code: _trim_counts(list(counts))
        for asset_code, counts in _folded_preflop_primary_counts().items()
    }


@cache
def _folded_preflop_primary_counts() -> dict[str, tuple[int, ...]]:
    counts_by_code: dict[str, list[int]] = {
        definition.code: [0] * 7463
        for definition in PORTFOLIO_DEFINITIONS
    }
    for class_key, class_counts in _preflop_primary_prior_cache_classes().items():
        weight = _starting_hand_class_weight(class_key)
        for asset_code, trimmed in class_counts.items():
            first = trimmed["first"]
            for offset, count in enumerate(trimmed["counts"]):
                counts_by_code[asset_code][first + offset] += count * weight
    return {
        asset_code: tuple(counts)
        for asset_code, counts in counts_by_code.items()
    }


@cache
def _folded_preflop_aggregate_counts(aggregate_code: str) -> tuple[int, ...]:
    counts = [0] * 7463
    for class_key, class_counts in _preflop_aggregate_cache_classes().items():
        weight = _starting_hand_class_weight(class_key)
        trimmed = class_counts[aggregate_code]
        first = trimmed["first"]
        for offset, count in enumerate(trimmed["counts"]):
            counts[first + offset] += count * weight
    return tuple(counts)


@cache
def _preflop_aggregate_cache_classes() -> dict:
    return json.loads(PREFLOP_AGGREGATE_CACHE_PATH.read_text(encoding="utf-8"))["classes"]


@cache
def _preflop_primary_prior_cache_classes() -> dict:
    if PREFLOP_PRIMARY_PRIOR_CACHE_PATH.exists():
        return json.loads(PREFLOP_PRIMARY_PRIOR_CACHE_PATH.read_text(encoding="utf-8"))["classes"]
    compressed_path = PREFLOP_PRIMARY_PRIOR_CACHE_PATH.with_suffix(PREFLOP_PRIMARY_PRIOR_CACHE_PATH.suffix + ".gz")
    with gzip.open(compressed_path, "rt", encoding="utf-8") as file:
        return json.load(file)["classes"]


def _starting_hand_class_weight(class_key: str) -> int:
    if class_key.endswith("-pair"):
        return 6
    if class_key.endswith("-suited"):
        return 4
    if class_key.endswith("-offsuit"):
        return 12
    raise ValueError(f"unknown starting hand class key: {class_key}")


def _trim_distribution(distribution: dict[HandBucket, int]) -> dict:
    return _trim_counts(_counts_array_from_distribution(distribution))


def _counts_array_from_distribution(distribution: dict[HandBucket, int]) -> list[int]:
    counts = [0] * (max(bucket.gradation for bucket in distribution) + 1)
    for bucket, count in distribution.items():
        counts[bucket.gradation] = count
    return counts


def _trim_counts(counts: list[int]) -> dict:
    first = next(index for index, count in enumerate(counts) if index > 0 and count)
    last = max(index for index, count in enumerate(counts) if index > 0 and count)
    trimmed_counts = counts[first : last + 1]
    return {
        "first": first,
        "counts": trimmed_counts,
        "totalCombos": sum(trimmed_counts),
        "bestGradation": first,
        "worstGradation": last,
    }


def write_prior_dashboard_data(path: Path = DEFAULT_OUTPUT_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(prior_dashboard_data(), indent=2), encoding="utf-8")


def _category_bands(buckets: tuple, cumulative_by_gradation: dict[int, float]) -> list[dict]:
    bands = []
    for category in HandCategory:
        category_buckets = tuple(bucket for bucket in buckets if bucket.category == category)
        bands.append(
            {
                "category": category.name,
                "name": CATEGORY_DISPLAY_NAMES[category],
                "color": CATEGORY_COLORS[category],
                "start": category_buckets[0].gradation,
                "end": category_buckets[-1].gradation,
                "startX": cumulative_by_gradation[category_buckets[0].gradation - 1],
                "endX": cumulative_by_gradation[category_buckets[-1].gradation],
            }
        )
    return bands


def _bucket_keys(buckets: tuple[HandBucket, ...]) -> list[dict]:
    return [
        {
            "gradation": bucket.gradation,
            "key": _key_string(bucket_key(bucket)),
        }
        for bucket in buckets
    ]


def _key_string(key: tuple) -> str:
    return ":".join(str(int(value)) for value in key)


def _subcategory_bands(
    buckets: tuple,
    cumulative_by_gradation: dict[int, float],
) -> list[dict]:
    bands = []
    by_category: dict[HandCategory, list[dict]] = {category: [] for category in HandCategory}

    current_bucket = buckets[0]
    current = {
        "category": current_bucket.category,
        "name": current_bucket.subcategory_name,
        "start": current_bucket.gradation,
        "end": current_bucket.gradation,
    }

    for bucket in buckets[1:]:
        if bucket.category == current["category"] and bucket.subcategory_name == current["name"]:
            current["end"] = bucket.gradation
        else:
            by_category[current["category"]].append(current)
            current = {
                "category": bucket.category,
                "name": bucket.subcategory_name,
                "start": bucket.gradation,
                "end": bucket.gradation,
            }

    by_category[current["category"]].append(current)

    for category, category_bands in by_category.items():
        total = max(len(category_bands) - 1, 1)
        for index, band in enumerate(category_bands):
            bands.append(
                {
                    "category": category.name,
                    "name": band["name"],
                    "color": CATEGORY_COLORS[category],
                    "shade": 0.34 + (index / total) * 0.34,
                    "start": band["start"],
                    "end": band["end"],
                    "startX": cumulative_by_gradation[band["start"] - 1],
                    "endX": cumulative_by_gradation[band["end"]],
                }
            )

    return bands


def main() -> None:
    write_prior_dashboard_data()


if __name__ == "__main__":
    main()
