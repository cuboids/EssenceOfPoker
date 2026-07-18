export const NORMAL_EDGE = 3.8;

export function chartDomain(bestGradation, worstGradation, curve, chartMode, naturalXByGradation) {
  if (chartMode === "bell") {
    const start = bestGradation <= 1 ? -NORMAL_EDGE : normalQuantileClamped(curve[bestGradation - 2].probability);
    const end = worstGradation >= curve.length ? NORMAL_EDGE : normalQuantileClamped(curve[worstGradation - 1].probability);
    return end > start ? { start, end } : { start: -NORMAL_EDGE, end: NORMAL_EDGE };
  }
  if (chartMode === "cdf-straight") {
    return { start: 0, end: 1 };
  }

  const start = bestGradation <= 1 ? 0 : naturalXByGradation.get(bestGradation - 1);
  const end = naturalXByGradation.get(worstGradation);
  return end > start ? { start, end } : { start: 0, end: 1 };
}

export function normalizeX(value, domain) {
  return (value - domain.start) / (domain.end - domain.start);
}

export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function ceilingX(gradation, curve, chartMode, naturalXByGradation) {
  return bucketEndX(gradation, curve, chartMode, naturalXByGradation);
}

export function bandStartX(band, curve, chartMode, naturalXByGradation) {
  return band.start === 1 ? axisMinimum(chartMode) : bucketEndX(band.start - 1, curve, chartMode, naturalXByGradation);
}

export function bandEndX(band, curve, chartMode, naturalXByGradation) {
  return bucketEndX(band.end, curve, chartMode, naturalXByGradation);
}

export function bucketEndX(gradation, curve, chartMode, naturalXByGradation) {
  if (chartMode === "bell") {
    return normalQuantileClamped(curve[gradation - 1]?.probability ?? 1);
  }
  if (chartMode === "cdf-straight") {
    return curve[gradation - 1]?.probability ?? 1;
  }
  return naturalXByGradation.get(gradation) ?? axisMaximum(chartMode);
}

export function axisMinimum(chartMode) {
  return chartMode === "bell" ? -NORMAL_EDGE : 0;
}

export function axisMaximum(chartMode) {
  return chartMode === "bell" ? NORMAL_EDGE : 1;
}

export function normalPdf(value) {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

export function normalQuantileClamped(probability) {
  return normalQuantile(clamp(probability, normalCdf(-NORMAL_EDGE), normalCdf(NORMAL_EDGE)));
}

export function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

export function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const xValue = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * xValue);
  const approximation = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-xValue * xValue);
  return sign * approximation;
}

export function normalQuantile(probability) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;

  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function x(probability, plotWidth, padding) {
  return padding.left + probability * plotWidth;
}

export function y(probability, plotHeight, padding) {
  return padding.top + (1 - probability) * plotHeight;
}
