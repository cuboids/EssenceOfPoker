export function isLockedCurve(curveData) {
  return curveData.bestGradation != null && curveData.bestGradation === curveData.worstGradation;
}

export function concreteAssetIsActive({ curveData, ceilingGradation, hasHandState }) {
  if (!curveData) {
    return true;
  }
  if (!hasHandState || ceilingGradation == null) {
    return true;
  }
  if (isLockedCurve(curveData)) {
    return ceilingGradation >= curveData.bestGradation;
  }
  return ceilingGradation > curveData.bestGradation;
}

export function ceilingForOtherAssetsInPortfolio({ assetCode, assets, curvesByCode, bucketCount }) {
  return assets
    .filter((asset) => asset.code !== assetCode)
    .reduce((ceiling, otherAsset) => {
      const otherWorst = curvesByCode?.[otherAsset.code]?.worstGradation;
      return Math.min(ceiling, otherWorst ?? bucketCount);
    }, bucketCount);
}

export function aggregateIsActive({ aggregate, assets, hasHandState, isUnderlyingAssetActive }) {
  if (!hasHandState) {
    return true;
  }

  const underlyingAssets = assets.filter((asset) => aggregate.assetCodes?.includes(asset.code));
  if (!underlyingAssets.length) {
    return true;
  }

  return underlyingAssets.some((asset) => isUnderlyingAssetActive(asset));
}

export function concreteAssetCount(portfolio) {
  return portfolio.assets.length;
}
