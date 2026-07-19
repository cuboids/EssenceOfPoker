import { formatChipAmount } from "../showdown.mjs";
import { cardHtml, escapeHtml } from "../ui.mjs";

export function renderShowdownSectionHtml({ settlement, summaryText, rows, pots }) {
  return `
    <div class="section-header">
      <div>
        <h2>Showdown</h2>
        <p>${settlement.complete ? escapeHtml(summaryText) : escapeHtml(settlement.reason)}</p>
      </div>
      <span class="showdown-pot">Pot ${formatChipAmount(settlement.potSize)}</span>
    </div>
    ${settlement.complete ? showdownCompleteHtml(rows, pots) : showdownPendingHtml(rows)}
  `;
}

function showdownCompleteHtml(rows, pots) {
  return `
    <div class="showdown-grid">
      ${rows.map(showdownRowHtml).join("")}
    </div>
    ${pots.length > 1 ? `
      <div class="showdown-pots">
        ${pots.map((pot) => `
          <span>${escapeHtml(pot.label)} ${formatChipAmount(pot.amount)} → ${pot.winnerLabels.map(escapeHtml).join(", ")}</span>
        `).join("")}
      </div>
    ` : ""}
  `;
}

function showdownPendingHtml(rows) {
  return `
    <div class="showdown-grid">
      ${rows.map(showdownRowHtml).join("")}
    </div>
  `;
}

function showdownRowHtml(row) {
  const resultClass = row.winnings > 0 ? "is-winner" : row.folded ? "is-folded" : "";
  return `
    <article class="showdown-card ${resultClass}" style="${row.category ? `--showdown-color: ${row.category.color}` : ""}">
      <div class="showdown-player">
        <span class="showdown-name">${escapeHtml(row.label)}</span>
        <span class="showdown-net ${row.net > 0 ? "is-positive" : row.net < 0 ? "is-negative" : ""}">
          ${row.net > 0 ? "+" : ""}${formatChipAmount(row.net)}
        </span>
      </div>
      <div class="showdown-cards">
        ${row.holeCards?.length ? row.holeCards.map(cardHtml).join("") : `<span class="showdown-unknown">hidden</span>`}
      </div>
      <div class="showdown-result">
        ${row.folded
          ? "Folded"
          : row.gradation
            ? `${escapeHtml(row.category?.name || "Hand")} · ${row.gradation}`
            : "Needs cards"}
      </div>
      <div class="showdown-money">
        <span>Put in ${formatChipAmount(row.contribution)}</span>
        <span>Wins ${formatChipAmount(row.winnings)}</span>
      </div>
    </article>
  `;
}
