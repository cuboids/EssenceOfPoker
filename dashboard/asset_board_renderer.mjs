import { POSITION_TOKENS, largeChart, smallChart } from "./app_config.mjs";
import { isLockedCurve } from "./asset_status.mjs";
import { rankSymbol, suitSymbol } from "./cards.mjs";
import { chartSvg } from "./renderers/chart_renderer.mjs";
import { winShareSignal } from "./win_signal.mjs";
import {
  cardHtml,
  cardText,
  compactTokenHtml,
  compactTokenText,
  escapeHtml,
  formatCombos,
  formatPercent,
} from "./ui.mjs";

export function createAssetBoardRenderer(deps) {
  function renderFocusLayer() {
    if (deps.documentRef.getElementById("focus-layer")) {
      return;
    }

    const layer = deps.documentRef.createElement("div");
    layer.id = "focus-layer";
    layer.className = "focus-layer";
    layer.hidden = true;
    layer.innerHTML = `
      <div class="focus-backdrop" data-close-focus></div>
      <section class="focus-panel" role="dialog" aria-modal="true" aria-labelledby="focus-title">
        <button class="focus-close" type="button" data-close-focus aria-label="Close">x</button>
        <div class="focus-header">
          <div>
            <span class="focus-code"></span>
            <h2 id="focus-title"></h2>
            <p class="focus-subtitle"></p>
          </div>
          <span class="focus-state"></span>
        </div>
        <div class="focus-chart"></div>
      </section>
    `;
    layer.addEventListener("click", (event) => {
      if (event.target.matches("[data-close-focus]")) {
        closeFocus();
      }
    });
    deps.documentRef.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeFocus();
      }
    });
    deps.documentRef.body.appendChild(layer);
  }

  function assetSection(category, assets, allAssets = assets) {
    const section = deps.documentRef.createElement("section");
    section.className = "asset-section";
    const activeCount = allAssets.filter((asset) => deps.isAssetCurrentlyActive(asset)).length;
    section.innerHTML = `
      <div class="section-header">
        <div>
          <h2>${deps.categoryLabels[category]}</h2>
          <p>${deps.categoryDescriptions[category]}</p>
        </div>
        <span class="section-count">${activeCount} active</span>
      </div>
      <div class="asset-grid-inner"></div>
    `;

    const grid = section.querySelector(".asset-grid-inner");
    for (const asset of sortedAssetsByActiveState(assets)) {
      grid.appendChild(assetCard(asset));
    }

    return section;
  }

  function sortedAssetsByActiveState(assets) {
    return [
      ...assets.filter((asset) => deps.isAssetCurrentlyActive(asset)),
      ...assets.filter((asset) => !deps.isAssetCurrentlyActive(asset)),
    ];
  }

  function assetCard(asset) {
    const card = deps.documentRef.createElement("button");
    const curveData = deps.curveForAsset(asset);
    const ceilingGradation = deps.ceilingForOtherAssets(asset);
    const isActive = deps.isAssetCurrentlyActive(asset, curveData, ceilingGradation);
    const streetBadge = asset.isAggregate
      ? `<span class="asset-street asset-street-aggregate" title="Aggregate">A</span>`
      : `<span class="asset-street" title="${completionStreetTitle(asset)}">${completionStreetLabel(asset)}</span>`;
    const winBars = winBarsHtml(asset, isActive);
    card.type = "button";
    card.className = `asset-card ${asset.isAggregate ? "is-aggregate" : "is-primary"} ${isActive ? "is-active" : "is-inactive"}`;
    card.addEventListener("click", () => openFocus(asset));
    if (!curveData) {
      const pendingCopy = pendingCurveCopy(asset);
      card.innerHTML = `
        <span class="asset-header">
          <span class="asset-code">${assetDisplayCode(asset)}</span>
          <span class="asset-name" title="${assetDisplayText(asset.name)}">${assetDisplayHtml(asset.name)}</span>
          ${winBars}
          <span class="asset-state">Pending</span>
        </span>
        <span class="asset-pending">${escapeHtml(pendingCopy.short)}</span>
        <span class="spark-labels">
          <span>-</span>
          <span>${escapeHtml(pendingCopy.axis)}</span>
          <span>-</span>
        </span>
      `;
      return card;
    }
    const locked = isLockedCurve(curveData);
    card.innerHTML = `
      <span class="asset-header">
        <span class="asset-code">${assetDisplayCode(asset)}</span>
        <span class="asset-name" title="${assetDisplayText(asset.name)}">${assetDisplayHtml(asset.name)}</span>
        ${winBars}
        ${streetBadge}
        <span class="asset-state">${isActive ? "Active" : "Inactive"}</span>
      </span>
      ${chartSvg({
        curve: curveData.curve,
        bands: deps.dashboardData().subcategoryBands,
        bucketCount: deps.dashboardData().bucketCount,
        bestGradation: curveData.bestGradation,
        worstGradation: curveData.worstGradation,
        ceilingGradation,
        config: smallChart,
        showGrid: false,
        label: assetChartLabel(asset),
        chartMode: deps.chartMode(),
        naturalXByGradation: naturalXByGradationForAsset(asset),
        categoryForGradation: deps.categoryForGradation,
      })}
      <span class="spark-labels">
        <span>${locked ? "Locked" : curveData.bestGradation}</span>
        <span>${formatCombos(curveData.totalCombos)}</span>
        <span>${curveData.worstGradation}</span>
      </span>
    `;
    return card;
  }

  function openFocus(asset) {
    deps.setFocusedAsset(asset);
    const layer = deps.documentRef.getElementById("focus-layer");
    const curveData = deps.curveForAsset(asset);
    const ceilingGradation = deps.ceilingForOtherAssets(asset);
    const isActive = deps.isAssetCurrentlyActive(asset, curveData, ceilingGradation);
    layer.hidden = false;
    deps.documentRef.body.classList.add("has-focus-layer");

    layer.querySelector(".focus-code").textContent = assetDisplayCode(asset);
    layer.querySelector("#focus-title").innerHTML = assetDisplayHtml(asset.name);
    if (!curveData) {
      const pendingCopy = pendingCurveCopy(asset);
      layer.querySelector(".focus-subtitle").textContent = pendingCopy.long;
      layer.querySelector(".focus-state").textContent = "Pending";
      layer.querySelector(".focus-chart").innerHTML = `<div class="asset-pending asset-pending-large">${escapeHtml(pendingCopy.detail)}</div>`;
      return;
    }
    const winShare = deps.winShareForAsset(asset);
    const winShareText = winShareDetailText(asset, winShare);
    layer.querySelector(".focus-subtitle").innerHTML = asset.isAggregate
      ? `${deps.categoryLabels[asset.category]} · ${curveData.totalCombos.toLocaleString()} seven-card completions · ${curveData.bestGradation} to ${curveData.worstGradation}${winShareText}`
      : `${deps.categoryLabels[asset.category]} · ${completionStreetTitle(asset)} · ${curveData.totalCombos.toLocaleString()} combos · ${curveData.bestGradation} best to ${curveData.worstGradation} worst${winShareText}`;
    layer.querySelector(".focus-state").textContent = isActive ? "Active" : "Inactive";
    layer.querySelector(".focus-chart").innerHTML = isLockedCurve(curveData)
      ? lockedResultPanel(curveData)
      : chartSvg({
        curve: curveData.curve,
        bands: deps.dashboardData().subcategoryBands,
        categoryBands: deps.dashboardData().categoryBands,
        bucketCount: deps.dashboardData().bucketCount,
        bestGradation: curveData.bestGradation,
        worstGradation: curveData.worstGradation,
        ceilingGradation,
        config: largeChart,
        showGrid: true,
        label: `Expanded ${assetChartKind()} for ${assetDisplayText(asset.name)}`,
        chartMode: deps.chartMode(),
        naturalXByGradation: naturalXByGradationForAsset(asset),
        categoryForGradation: deps.categoryForGradation,
      });
  }

  function closeFocus() {
    const layer = deps.documentRef.getElementById("focus-layer");
    if (!layer) {
      return;
    }
    deps.setFocusedAsset(null);
    layer.hidden = true;
    deps.documentRef.body.classList.remove("has-focus-layer");
  }

  function editableCardHtml(token, card) {
    if (deps.editingCardToken() === token) {
      return `
        <span class="card-editor" data-editor-token="${token}" aria-label="Edit ${compactTokenText(token)}">
          <select class="card-editor-select" data-card-editor-rank aria-label="${compactTokenText(token)} rank">
            ${Array.from({ length: 13 }, (_, index) => {
              const rank = index + 1;
              return `<option value="${rank}"${card && rank === card.rank ? " selected" : ""}>${rankSymbol(rank)}</option>`;
            }).join("")}
          </select>
          <select class="card-editor-select" data-card-editor-suit aria-label="${compactTokenText(token)} suit">
            ${[
              [1, suitSymbol(1)],
              [2, suitSymbol(2)],
              [3, suitSymbol(3)],
              [4, suitSymbol(4)],
            ].map(([suit, label]) => `<option value="${suit}"${card && suit === card.suit ? " selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="card-editor-action" type="button" data-card-edit-action="save" title="Save ${compactTokenText(token)}">OK</button>
          <button class="card-editor-action" type="button" data-card-edit-action="cancel" title="Cancel edit">X</button>
        </span>
      `;
    }
    return `
      <button class="holding-card editable-card" type="button" data-card-token="${token}" title="Edit ${compactTokenText(token)}">
        ${card ? cardHtml(card) : compactTokenHtml(token)}
      </button>
    `;
  }

  function lockedResultPanel(curveData) {
    const category = deps.categoryForGradation(curveData.bestGradation);
    return `
      <div class="locked-panel" style="--locked-color: ${category.color}">
        <span class="locked-grade">${curveData.bestGradation}</span>
      </div>
    `;
  }

  function pendingCurveCopy(asset) {
    const page = asset.sourcePage || deps.activePage();
    if (deps.preflopActionDerivedRangesActive() && (page === "range" || deps.isOpponentPage(page))) {
      return {
        short: "Range-adjusted curve pending",
        axis: "weighted range",
        long: "Range-adjusted curve pending",
        detail: "Actions changed this hidden range. Equity already uses the inferred weights; exact range-weighted asset curves are not generated yet.",
      };
    }
    return {
      short: "Exact aggregate curve pending",
      axis: "same-world min",
      long: "Exact same-world aggregate curve pending",
      detail: "This aggregate is visible, but its exact curve is not available for the current hidden state yet.",
    };
  }

  function winBarsHtml(asset, isActive) {
    if (asset.isAggregate && !deps.isCategoryAggregate(asset) && !deps.isAggregateMatchup(asset)) {
      return "";
    }
    if (!isActive) {
      return "";
    }
    const share = deps.cachedWinShareForAsset(asset);
    const signal = winShareSignal(share);
    const title = share == null
      ? "Win share calculating"
      : deps.aggregateMatchupTitle(asset, share) || `Win share ${formatPercent(share)}`;
    const colorClass = asset.isAggregate ? "win-bars-aggregate" : "";
    const content = signal.isCertain
      ? '<span class="win-check" aria-hidden="true">&#10003;</span>'
      : Array.from({ length: 5 }, (_, index) => {
        const classes = [
          "win-bar",
          index < signal.level ? "is-lit" : "",
          index < signal.deepLevel ? "is-deep" : "",
        ].filter(Boolean).join(" ");
        return `<span class="${classes}"></span>`;
      }).join("");
    return `
      <span class="win-bars ${colorClass} ${share == null ? "is-pending" : ""}" title="${title}" aria-label="${title}">
        ${content}
      </span>
    `;
  }

  function winShareDetailText(asset, winShare) {
    if (winShare == null) {
      return "";
    }
    const matchupTitle = deps.aggregateMatchupTitle(asset, winShare);
    if (matchupTitle) {
      return ` · ${matchupTitle}`;
    }
    return ` · Win ${formatPercent(winShare)}`;
  }

  function naturalXByGradationForAsset(asset) {
    const curvePage = asset.sourcePage || deps.activePage();
    const curveCode = asset.sourceCode || asset.code;
    return deps.priorNaturalXMaps()[curvePage]?.[curveCode]
      || (asset.isAggregate ? deps.aggregatePriorXByGradation() : deps.priorXByGradation());
  }

  function assetChartLabel(asset) {
    return `${assetChartKind()} for ${assetDisplayText(asset.name)}`;
  }

  function assetChartKind() {
    return deps.chartMode() === "bell" ? "bell density distribution" : "cumulative distribution";
  }

  function completionStreetLabel(asset) {
    if (asset.name.includes("R")) {
      return "R";
    }
    if (asset.name.includes("T")) {
      return "T";
    }
    return "F";
  }

  function completionStreetTitle(asset) {
    const titles = {
      F: "Full on flop",
      T: "Full on turn",
      R: "Full on river",
    };
    return titles[completionStreetLabel(asset)];
  }

  function assetDisplayHtml(name) {
    return name
      .split(" + ")
      .map((token) => {
        const card = deps.cardForToken(token);
        if (card) {
          return cardHtml(card);
        }
        return compactTokenHtml(token);
      })
      .join("");
  }

  function assetDisplayCode(asset) {
    return asset.displayCode || asset.code;
  }

  function assetDisplayText(name) {
    return name
      .split(" + ")
      .map((token) => {
        const card = deps.cardForToken(token);
        if (card) {
          return cardText(card);
        }
        return token;
      })
      .join("");
  }

  function cardForTokenOnPage(token, page) {
    const handState = deps.handState();
    if (!handState) {
      return null;
    }
    const position = POSITION_TOKENS[token];
    if (!position) {
      return null;
    }

    if (position === "f1") {
      return handState.flop[0] || null;
    }
    if (position === "f2") {
      return handState.flop[1] || null;
    }
    if (position === "f3") {
      return handState.flop[2] || null;
    }
    if (position === "turn") {
      return handState.turn || null;
    }
    if (position === "river") {
      return handState.river || null;
    }
    if (position === "v1" || position === "v2") {
      if (!deps.isOpponentPage(page) || !deps.villainShowdown()) {
        return null;
      }
      return deps.showdownHoleCardsForPlayer(page)[position === "v1" ? 0 : 1] || null;
    }
    return handState[position] || null;
  }

  return {
    assetSection,
    closeFocus,
    editableCardHtml,
    openFocus,
    renderFocusLayer,
    cardForTokenOnPage,
  };
}
