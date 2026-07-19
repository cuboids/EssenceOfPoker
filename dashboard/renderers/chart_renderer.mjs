import { largeChart, smallChart } from "../app_config.mjs";
import {
  bandEndX,
  bandStartX,
  bucketEndX,
  ceilingX,
  chartDomain,
  clamp,
  normalPdf,
  normalizeX,
  x,
  y,
} from "../charts.mjs";

export function chartSvg({
  curve,
  bands,
  categoryBands = [],
  bucketCount,
  bestGradation,
  worstGradation,
  ceilingGradation,
  config,
  showGrid,
  label,
  chartMode,
  naturalXByGradation,
  categoryForGradation,
}) {
  if (bestGradation === worstGradation) {
    return lockedResultSvg({
      gradation: bestGradation,
      config,
      showGrid,
      label,
      categoryForGradation,
    });
  }

  const { width, height, padding } = config;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const domain = chartDomain(bestGradation, worstGradation, curve, chartMode, naturalXByGradation);
  const visibleCurve = curve.filter((point) => point.gradation >= bestGradation && point.gradation <= worstGradation);
  const ceiling = ceilingOverlay(ceilingGradation, bucketCount, curve, domain, plotWidth, plotHeight, padding, chartMode, naturalXByGradation);
  const curvePoints = chartPoints(visibleCurve, domain, config, plotWidth, plotHeight, padding, chartMode, naturalXByGradation);
  const areaPoints = [
    `${padding.left},${height - padding.bottom}`,
    curvePoints,
    `${width - padding.right},${height - padding.bottom}`,
  ].join(" ");
  const bandRects = bands
    .map((band) => bandRect(band, curve, domain, plotWidth, plotHeight, padding, chartMode, naturalXByGradation, showGrid))
    .join("");
  const grid = showGrid ? gridLines(width, height, padding, plotHeight) : "";
  const categoryTicks = showGrid ? categoryMarkers(categoryBands, curve, domain, plotWidth, padding, height, chartMode, naturalXByGradation) : "";

  return `
    <svg class="${showGrid ? "focus-svg" : "sparkline"}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
      ${bandRects}
      ${grid}
      <line class="axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />
      <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" />
      <polygon class="area" points="${areaPoints}" />
      <polyline class="curve" points="${curvePoints}" />
      ${categoryTicks}
      ${ceiling}
    </svg>
  `;
}

function lockedResultSvg({ gradation, config, showGrid, label, categoryForGradation }) {
  const { width, height, padding } = config;
  const plotHeight = height - padding.top - padding.bottom;
  const category = categoryForGradation(gradation);

  return `
    <svg class="${showGrid ? "focus-svg locked-svg" : "sparkline locked-svg"}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
      <rect class="locked-svg-bg" style="--locked-color: ${category.color}" x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${plotHeight}" rx="6" />
      <text class="locked-svg-grade" x="${width / 2}" y="${padding.top + plotHeight / 2}" dominant-baseline="middle" text-anchor="middle">${gradation}</text>
    </svg>
  `;
}

function chartPoints(visibleCurve, domain, config, plotWidth, plotHeight, padding, chartMode, naturalXByGradation) {
  if (chartMode === "bell") {
    const densityPoints = bellDensityPoints(domain, config);
    const maxDensity = Math.max(...densityPoints.map((point) => point.density), Number.EPSILON);
    return densityPoints
      .map((point) => `${x(normalizeX(point.value, domain), plotWidth, padding)},${y(point.density / maxDensity, plotHeight, padding)}`)
      .join(" ");
  }
  const cumulativePoints = sampledChartCurve(visibleCurve, config)
    .map((point) => `${x(normalizeX(pointX(point, chartMode, naturalXByGradation), domain), plotWidth, padding)},${y(point.probability, plotHeight, padding)}`)
    .join(" ");
  return `${padding.left},${padding.top + plotHeight} ${cumulativePoints}`;
}

function sampledChartCurve(visibleCurve, config) {
  if (config !== smallChart || visibleCurve.length <= 140) {
    return visibleCurve;
  }
  const pointLimit = 120;
  const stride = Math.ceil((visibleCurve.length - 2) / (pointLimit - 2));
  const sampled = [visibleCurve[0]];
  for (let index = stride; index < visibleCurve.length - 1; index += stride) {
    sampled.push(visibleCurve[index]);
  }
  sampled.push(visibleCurve[visibleCurve.length - 1]);
  return sampled;
}

function bellDensityPoints(domain, config) {
  const pointCount = config === largeChart ? 220 : 96;
  return Array.from({ length: pointCount }, (_, index) => {
    const ratio = index / (pointCount - 1);
    const value = domain.start + ratio * (domain.end - domain.start);
    return { value, density: normalPdf(value) };
  });
}

function ceilingOverlay(ceilingGradation, bucketCount, curve, domain, plotWidth, plotHeight, padding, chartMode, naturalXByGradation) {
  if (ceilingGradation == null || ceilingGradation >= bucketCount) {
    return "";
  }

  const ceilingProbability = ceilingX(ceilingGradation, curve, chartMode, naturalXByGradation);
  if (ceilingProbability == null) {
    return "";
  }

  const visibleCeilingProbability = clamp(ceilingProbability, domain.start, domain.end);
  const ceilingPosition = x(normalizeX(visibleCeilingProbability, domain), plotWidth, padding);
  const tailWidth = Math.max(0, padding.left + plotWidth - ceilingPosition);
  const labelPadding = 5;
  const labelAnchor = ceilingPosition > padding.left + plotWidth - 42 ? "end" : "start";
  const labelX = labelAnchor === "end" ? ceilingPosition - labelPadding : ceilingPosition + labelPadding;
  const labelY = padding.top + 11;
  const tail = tailWidth > 0 ? `
    <rect class="ceiling-tail" x="${ceilingPosition}" y="${padding.top}" width="${tailWidth}" height="${plotHeight}">
      <title>Worse than the current ceiling from the other assets: gradation ${ceilingGradation}</title>
    </rect>
  ` : "";
  return `
    ${tail}
    <line class="ceiling-line" x1="${ceilingPosition}" y1="${padding.top}" x2="${ceilingPosition}" y2="${padding.top + plotHeight}">
      <title>Current ceiling from the other assets: gradation ${ceilingGradation}</title>
    </line>
    <text class="ceiling-label" x="${labelX}" y="${labelY}" text-anchor="${labelAnchor}">
      ${ceilingGradation}
    </text>
  `;
}

function bandRect(band, curve, domain, plotWidth, plotHeight, padding, chartMode, naturalXByGradation, includeTitle = true) {
  const bandStart = bandStartX(band, curve, chartMode, naturalXByGradation);
  const bandEnd = bandEndX(band, curve, chartMode, naturalXByGradation);
  const clippedStart = Math.max(bandStart, domain.start);
  const clippedEnd = Math.min(bandEnd, domain.end);
  if (clippedEnd <= clippedStart) {
    return "";
  }

  const start = x(normalizeX(clippedStart, domain), plotWidth, padding);
  const end = x(normalizeX(clippedEnd, domain), plotWidth, padding);
  const title = includeTitle ? `<title>${band.name}</title>` : "";
  return `<rect class="band" style="--band-color: ${band.color}; --band-opacity: ${band.shade}" x="${start}" y="${padding.top}" width="${end - start}" height="${plotHeight}">${title}</rect>`;
}

function gridLines(width, height, padding, plotHeight) {
  const lines = [];
  for (let tick = 0; tick <= 10; tick += 1) {
    const probability = tick / 10;
    const yPos = y(probability, plotHeight, padding);
    lines.push(`
      <line class="grid-line" x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" />
      <text class="grid-label" x="${padding.left - 10}" y="${yPos + 4}" text-anchor="end">${tick * 10}%</text>
    `);
  }
  return lines.join("");
}

function categoryMarkers(categoryBands, curve, domain, plotWidth, padding, height, chartMode, naturalXByGradation) {
  return categoryBands
    .map((band) => {
      const rawStart = bandStartX(band, curve, chartMode, naturalXByGradation);
      if (rawStart <= domain.start || rawStart >= domain.end) {
        return "";
      }

      const start = x(normalizeX(rawStart, domain), plotWidth, padding);
      return `
        <line class="category-marker" x1="${start}" y1="${padding.top}" x2="${start}" y2="${height - padding.bottom}" />
        <title>${band.name}</title>
      `;
    })
    .join("");
}

function pointX(point, chartMode, naturalXByGradation) {
  if (chartMode === "cdf-straight") {
    return point.probability;
  }
  return naturalXByGradation.get(point.gradation) ?? point.x;
}
