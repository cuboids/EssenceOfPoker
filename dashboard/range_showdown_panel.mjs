import { computeShowdownSettlement, formatChipAmount } from "./showdown.mjs";
import { rangeMatrixSummary } from "./range_matrix.mjs";
import { rangeExplanation } from "./range_explainability.mjs";
import {
  renderRangeMatrixHtml,
  renderRangeMatrixSectionHtml,
} from "./renderers/range_matrix_renderer.mjs";
import { renderShowdownSectionHtml } from "./renderers/showdown_renderer.mjs";
import { formatPercent } from "./ui.mjs";
import { positionDisplayName } from "./table_positions.mjs";

export function createRangeShowdownPanel(deps) {
  function rangeMatrixSection(page) {
    const section = deps.documentRef.createElement("section");
    const matrix = rangeMatrixViewModel(page);
    section.className = "asset-section range-matrix-section";
    section.innerHTML = renderRangeMatrixSectionHtml(matrix);
    section.querySelector(".range-matrix-card").addEventListener("click", () => openRangeMatrixFocus(page));
    return section;
  }

  function rangeMatrixViewModel(page) {
    const range = deps.estimatedRangeForPage(page);
    const summary = rangeMatrixSummary(range);
    const evidence = deps.empiricalEvidenceForRange(range);
    return {
      page,
      range,
      summary,
      evidence,
      title: rangeMatrixTitle(page),
      description: rangeMatrixDescription(page),
      explanation: rangeExplanation(range),
      percent: formatPercent(summary.frequency),
    };
  }

  function rangeMatrixTitle(page) {
    if (page === "hero") {
      return `Hero (${positionDisplayName(deps.tableConfig().heroPosition)}) range`;
    }
    return `${deps.dashboardData().portfolios[page]?.name || deps.actionPlayerLabel(page)} range`;
  }

  function rangeMatrixDescription(page) {
    if (page === "hero") {
      return "Hero's estimated preflop range weights";
    }
    return "Current preflop range weights from hero's perspective";
  }

  function openRangeMatrixFocus(page) {
    deps.setFocusedAsset(null);
    const matrix = rangeMatrixViewModel(page);
    const layer = deps.documentRef.getElementById("focus-layer");
    layer.hidden = false;
    deps.documentRef.body.classList.add("has-focus-layer");
    layer.querySelector(".focus-code").textContent = "RNG";
    layer.querySelector("#focus-title").textContent = matrix.title;
    layer.querySelector(".focus-subtitle").textContent =
      `${matrix.description} · ${matrix.explanation} · ${matrix.summary.weightedCombos.toFixed(1)} weighted combos of ${matrix.summary.totalCombos.toLocaleString()}`;
    layer.querySelector(".focus-state").textContent = matrix.percent;
    layer.querySelector(".focus-chart").innerHTML = renderRangeMatrixHtml(matrix, "large");
  }

  function currentShowdownSection() {
    if (!deps.handState() || deps.handState().round !== "river") {
      return null;
    }
    const settlement = currentShowdownSettlement();
    const section = deps.documentRef.createElement("section");
    section.className = `asset-section showdown-section ${settlement.complete ? "is-complete" : "is-pending"}`;
    section.innerHTML = renderShowdownSectionHtml({
      settlement,
      summaryText: showdownSummaryText(settlement),
      rows: settlement.rows.map((row) => ({
        ...row,
        category: row.gradation ? deps.categoryForGradation(row.gradation) : null,
      })),
      pots: settlement.pots.map((pot) => ({
        ...pot,
        winnerLabels: pot.winnerIds.map(deps.actionPlayerLabel),
      })),
    });
    return section;
  }

  function currentShowdownSettlement() {
    const order = deps.actionPlayerOrder("river").map((player) => player.id);
    return computeShowdownSettlement({
      participants: showdownParticipants(order),
      board: deps.currentBoardCards(),
      actions: deps.visiblePlayerActionsForCurrentStreet(),
      order,
      stacks: deps.playerStacksById(),
      smallBlindPlayer: deps.playerIdForPosition("SB"),
      bigBlindPlayer: deps.playerIdForPosition("BB"),
      evaluateGradationFive: deps.evaluateGradationFive,
    });
  }

  function showdownParticipants(order) {
    return order.map((playerId) => ({
      id: playerId,
      label: deps.actionPlayerLabel(playerId),
      holeCards: deps.showdownHoleCardsForPlayer(playerId),
      folded: deps.playerHasFoldedByStreet(deps.visiblePlayerActionsForCurrentStreet(), playerId, "river"),
    }));
  }

  function showdownSummaryText(settlement) {
    if (!settlement.winners.length) {
      return "No winner could be determined.";
    }
    return settlement.winners
      .map((winner) => `${winner.label} wins ${formatChipAmount(winner.winnings)}`)
      .join(" · ");
  }

  return {
    currentShowdownSection,
    openRangeMatrixFocus,
    rangeMatrixSection,
  };
}
