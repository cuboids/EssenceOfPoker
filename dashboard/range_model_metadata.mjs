import { VERSION_REGISTRY } from "./version_registry.mjs";

export function rangeModelMetadata({
  source = "uniform",
  model = null,
  empiricalSpot = null,
  action = null,
} = {}) {
  return {
    kind: "range_engine_output",
    version: VERSION_REGISTRY.models.rangeEngine,
    source,
    model: model?.name || "heuristic_empirical_hybrid",
    generatedData: {
      empiricalBaselineTables: VERSION_REGISTRY.generatedData.empiricalBaselineTables,
      empiricalSpotCache: VERSION_REGISTRY.generatedData.empiricalSpotCache,
    },
    actionId: action?.id || null,
    empirical: empiricalSpot?.handClasses
      ? {
        spotVersion: empiricalSpot.version || null,
        sourceKey: empiricalSpot.source?.sourceKey || null,
        cacheHit: empiricalSpot.cache?.hit ?? null,
        request: empiricalSpot.request || null,
        smoothing: empiricalSpot.smoothing || null,
      }
      : null,
  };
}
