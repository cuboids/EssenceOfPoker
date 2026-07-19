import { concreteAssetCount } from "./asset_status.mjs";
import { curveFromTrimmedCounts } from "./curve_distributions.mjs";
import { positionDisplayName, positionPageKey, villainPositionsForConfig } from "./table_positions.mjs";

export function normalizedPortfolios(data, tableConfig) {
  const heroAssets = withDisplayCodes(data.portfolios?.hero?.assets || data.assets);
  const heroAggregates = namedAggregateCards(
    data.portfolios?.hero?.aggregates || defaultAggregates(heroAssets),
    `Hero (${positionDisplayName(tableConfig.heroPosition)})`,
  );
  const villainAssets = withDisplayCodes(data.portfolios?.villain?.assets || heroAssets.map((asset) => ({
    ...asset,
    name: asset.name.replaceAll("H_1", "V_1").replaceAll("H_2", "V_2"),
    positions: asset.positions?.map((position) =>
      position.replace("hole_1", "villain_1").replace("hole_2", "villain_2"),
    ),
  })));
  const villainAggregates = data.portfolios?.villain?.aggregates || defaultAggregates(villainAssets);
  const portfolios = {
    hero: { name: "Hero", assets: heroAssets, aggregates: heroAggregates },
  };
  for (const position of villainPositionsForConfig(tableConfig)) {
    portfolios[positionPageKey(position)] = {
      name: position,
      position,
      assets: villainAssets,
      aggregates: namedAggregateCards(villainAggregates, positionDisplayName(position)),
    };
  }
  return portfolios;
}

export function withDisplayCodes(assets) {
  const counters = {};
  return assets.map((asset) => {
    const categoryNumber = {
      ZERO: 1,
      CARD_1: 2,
      CARD_2: 3,
      CARD_1_PLUS_CARD_2: 4,
    }[asset.category];
    if (!categoryNumber) {
      return asset;
    }
    counters[asset.category] = (counters[asset.category] || 0) + 1;
    return { ...asset, displayCode: `${categoryNumber}.${counters[asset.category]}` };
  });
}

export function namedAggregateCards(aggregates, primaryAggregateName) {
  return aggregates.map((aggregate) =>
    aggregate.code === "AGG"
      ? { ...aggregate, name: primaryAggregateName }
      : aggregate,
  );
}

export function defaultAggregates(assets) {
  return [
    aggregateSpec("AGG", "Hand Aggregate", "AGGREGATE", assets),
    aggregateSpec("AGG_BOTH", "Both hole cards aggregate", "CARD_1_PLUS_CARD_2", assets.filter((asset) => asset.category === "CARD_1_PLUS_CARD_2")),
    aggregateSpec("AGG_H1", "First hole card aggregate", "CARD_1", assets.filter((asset) => asset.category === "CARD_1")),
    aggregateSpec("AGG_H2", "Second hole card aggregate", "CARD_2", assets.filter((asset) => asset.category === "CARD_2")),
    aggregateSpec("AGG_ZERO", "Only community cards aggregate", "ZERO", assets.filter((asset) => asset.category === "ZERO")),
  ];
}

export function aggregateSpec(code, name, category, assets) {
  return {
    code,
    category,
    name,
    assetCodes: assets.map((asset) => asset.code),
    active: true,
    isAggregate: true,
  };
}

export function priorCurvesByPage(data, priorXByGradation) {
  return Object.fromEntries(
    Object.keys(data.portfolios).map((page) => {
      const curves = priorCurvesForAssets(data.portfolios[page].assets, data, priorXByGradation);
      for (const aggregate of data.portfolios[page].aggregates || []) {
        curves[aggregate.code] = priorCurveForModel(aggregate, data, priorXByGradation, priorAggregateCurve(data, priorXByGradation));
      }
      return [page, curves];
    }),
  );
}

export function priorAggregateCurve(data, priorXByGradation) {
  const aggregate = data.priorAggregate;
  if (!aggregate?.counts) {
    return fallbackCurve(data);
  }

  let cumulative = 0;
  const curve = [];
  for (let gradation = 1; gradation <= data.bucketCount; gradation += 1) {
    cumulative += aggregate.counts[gradation] || 0;
    curve.push({
      gradation,
      probability: cumulative / aggregate.totalCombos,
      x: priorXByGradation.get(gradation),
    });
  }
  return {
    curve,
    totalCombos: aggregate.totalCombos,
    bestGradation: aggregate.bestGradation,
    worstGradation: aggregate.worstGradation,
  };
}

export function priorCurvesForAssets(assets, data, priorXByGradation) {
  const fallback = fallbackCurve(data);
  return Object.fromEntries(assets.map((asset) => [asset.code, priorCurveForModel(asset, data, priorXByGradation, fallback)]));
}

export function priorCurveForModel(model, data, priorXByGradation, fallback = null) {
  if (!model?.prior) {
    return fallback;
  }
  return curveFromTrimmedCounts(
    model.prior,
    model.prior.totalCombos,
    data.bucketCount,
    priorXByGradation,
  );
}

export function priorNaturalXMapsByPage(curvesByPage) {
  return Object.fromEntries(
    Object.entries(curvesByPage).map(([page, curves]) => [
      page,
      Object.fromEntries(
        Object.entries(curves).map(([code, curveData]) => [code, naturalXMapFromCurve(curveData?.curve || [])]),
      ),
    ]),
  );
}

export function naturalXMapFromCurve(curve) {
  return new Map(curve.map((point) => [point.gradation, point.probability]));
}

export function currentConcreteAssetCount({ activePage, dashboardData, currentPortfolio }) {
  if (activePage === "config") {
    return concreteAssetCount(dashboardData.portfolios.hero);
  }
  return concreteAssetCount(currentPortfolio);
}

function fallbackCurve(data) {
  return {
    curve: data.curve,
    totalCombos: data.totalCombos,
    bestGradation: 1,
    worstGradation: data.bucketCount,
  };
}
