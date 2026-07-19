import { rangeMatrixCells } from "../range_matrix.mjs";
import { escapeHtml, formatPercent } from "../ui.mjs";

export function renderRangeMatrixSectionHtml(matrix) {
  return `
    <div class="section-header">
      <div>
        <h2>Estimated range</h2>
        <p>${escapeHtml(matrix.description)}</p>
      </div>
    </div>
    <div class="asset-grid-inner">
      <button type="button" class="asset-card range-matrix-card">
        ${renderRangeMatrixCardHtml(matrix)}
      </button>
    </div>
  `;
}

export function renderRangeMatrixCardHtml(matrix) {
  return `
    <span class="asset-header">
      <span class="asset-code">RNG</span>
      <span class="asset-name" title="${escapeHtml(matrix.title)}">${escapeHtml(matrix.title)}</span>
      <span class="asset-street asset-street-aggregate" title="Range">R</span>
      <span class="asset-state">${escapeHtml(matrix.percent)}</span>
    </span>
    ${renderRangeMatrixHtml(matrix, "compact")}
  `;
}

export function renderRangeMatrixHtml(matrix, size = "large") {
  const header = size === "large"
    ? `
      <div class="range-matrix-header">
        <div>
          <h2>${escapeHtml(matrix.title)}</h2>
          <p>${escapeHtml(matrix.description)} · ${escapeHtml(matrix.explanation)}</p>
        </div>
        <span class="range-matrix-percent">${escapeHtml(matrix.percent)}</span>
      </div>
    `
    : "";
  return `
    ${header}
    <div class="range-matrix range-matrix-${size}" role="img" aria-label="${escapeHtml(matrix.title)} matrix">
      ${rangeMatrixCells(matrix.range).flat().map((cell) => rangeMatrixCellHtml(cell, matrix)).join("")}
    </div>
    ${size === "large" ? empiricalEvidenceHtml(matrix) : ""}
  `;
}

function rangeMatrixCellHtml(cell, matrix = null) {
  const frequency = Math.max(0, Math.min(1, cell.frequency || 0));
  const isActive = frequency > 0.0025;
  const evidence = matrix?.evidence?.payload?.handClasses?.[cell.classKey];
  const evidenceText = evidence
    ? ` · ${evidence.level}, n=${formatInteger(evidence.count)}, action p=${formatEvidenceProbabilities(evidence.probabilities)}`
    : "";
  const title = `${cell.label}${cell.type === "pair" ? "" : ` ${cell.type}`} - ${formatPercent(frequency)}${evidenceText}`;
  return `
    <div
      class="range-cell ${isActive ? "is-active" : ""}"
      style="--range-frequency: ${frequency.toFixed(4)}"
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(title)}"
    >
      <span>${escapeHtml(cell.label)}</span>
    </div>
  `;
}

function empiricalEvidenceHtml(matrix) {
  const evidence = matrix.evidence;
  if (!evidence?.payload) {
    return `
      <div class="empirical-detail-panel">
        <span class="empirical-pill ${evidence?.status || "fallback"}">${escapeHtml(empiricalStatusLabel(evidence?.status))}</span>
        <span>${escapeHtml(evidence?.message || "No empirical action evidence has been applied to this range yet.")}</span>
      </div>
    `;
  }
  const payload = evidence.payload;
  const fallbackRows = Object.entries(payload.fallbackUsage || {})
    .filter(([, count]) => count)
    .map(([level, count]) => `<span>${escapeHtml(level)} ${count}</span>`)
    .join("");
  const source = payload.source || {};
  return `
    <div class="empirical-detail-panel">
      <span class="empirical-pill ready">Empirical</span>
      <span>${escapeHtml(matrix.explanation)}</span>
      <span>${formatInteger(source.hands || 0)} hands · ${formatInteger(source.actions || 0)} actions</span>
      <span>source ${escapeHtml(String(source.sha256 || "").slice(0, 12))}</span>
      <span class="empirical-fallbacks">${fallbackRows}</span>
    </div>
  `;
}

function empiricalStatusLabel(status) {
  if (status === "ready") {
    return "Empirical";
  }
  if (status === "pending") {
    return "Loading";
  }
  if (status === "idle") {
    return "Idle";
  }
  return "Fallback";
}

function formatEvidenceProbabilities(probabilities = {}) {
  return ["fold", "check", "call", "bet", "raise", "all-in"]
    .filter((action) => Number.isFinite(probabilities[action]))
    .map((action) => `${action}:${Math.round(probabilities[action] * 100)}%`)
    .join(" ");
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString();
}
