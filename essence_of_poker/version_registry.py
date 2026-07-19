"""Central backend registry for cache and generated-data contract versions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VersionRegistry:
    cache_schema: str
    cache_families: dict[str, str]
    models: dict[str, str]
    generated_data: dict[str, str]

    def payload(self) -> dict:
        return {
            "cacheSchema": self.cache_schema,
            "cacheFamilies": dict(self.cache_families),
            "models": dict(self.models),
            "generatedData": dict(self.generated_data),
        }


VERSION_REGISTRY = VersionRegistry(
    cache_schema="cache-schema-v1",
    cache_families={
        "winShareRunouts": "winshare-runouts-v2",
        "multiwayEquity": "multiway-equity-v1",
    },
    models={
        "rangeEngine": "range-engine-v1",
    },
    generated_data={
        "empiricalBaselineTables": "empirical-baseline-tables-v1",
        "empiricalSpotCache": "empirical-spot-cache-v1",
        "preflopAggregateClasses": "preflop-aggregate-classes-v1",
        "preflopHiddenVillainClasses": "preflop-hidden-villain-classes-v1",
        "preflopPrimaryClasses": "preflop-primary-classes-v1",
        "priorPortfolio": "prior-portfolio-v1",
        "priorWinShares": "prior-win-shares-v1",
        "preflopHandEquity": "preflop-hand-equity-v1",
    },
)
