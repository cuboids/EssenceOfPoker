import { escapeHtml } from "../ui.mjs";

export function holdingDisplayModel({
  activePage,
  assetCount,
  handState,
  draftHoleCards = [],
  cardEditError = "",
  currentPortfolioName = "",
  isConfigPage = activePage === "config",
  isOpponentPage = false,
  villainShowdown = false,
  villainCards = [],
  editableCardHtml,
}) {
  if (isConfigPage) {
    return {
      statusText: "Display configuration",
      displayHtml: null,
    };
  }
  if (!handState) {
    return {
      statusText: `${assetCount} five-card assets before any cards are dealt`,
      displayHtml: `
        <span class="holding-label">Holding</span>
        ${editableCardHtml("H_1", draftHoleCards[0])}
        ${editableCardHtml("H_2", draftHoleCards[1])}
        ${cardEditError ? `<span class="card-edit-error">${escapeHtml(cardEditError)}</span>` : ""}
      `,
    };
  }

  const statusByRound = {
    preflop: `${assetCount} five-card assets after hero's holding cards are known`,
    flop: `${assetCount} five-card assets after the flop is known`,
    turn: `${assetCount} five-card assets after the turn is known`,
    river: `${assetCount} five-card assets after the river is known`,
  };
  const flopHtml = handState.flop.length
    ? `
      <span class="holding-label">Flop</span>
      ${handState.flop.map((card, index) => editableCardHtml(`F_${index + 1}`, card)).join("")}
    `
    : "";
  const turnHtml = handState.turn
    ? `
      <span class="holding-label">Turn</span>
      ${editableCardHtml("T", handState.turn)}
    `
    : "";
  const riverHtml = handState.river
    ? `
      <span class="holding-label">River</span>
      ${editableCardHtml("R", handState.river)}
    `
    : "";
  const villainHtml = isOpponentPage && villainShowdown && villainCards.length === 2
    ? `
      <span class="holding-label">${escapeHtml(currentPortfolioName)}</span>
      ${editableCardHtml("V_1", villainCards[0])}
      ${editableCardHtml("V_2", villainCards[1])}
    `
    : "";

  return {
    statusText: statusByRound[handState.round],
    displayHtml: `
      <span class="holding-label">Holding</span>
      ${editableCardHtml("H_1", handState.h1)}
      ${editableCardHtml("H_2", handState.h2)}
      ${flopHtml}
      ${turnHtml}
      ${riverHtml}
      ${villainHtml}
      ${cardEditError ? `<span class="card-edit-error">${escapeHtml(cardEditError)}</span>` : ""}
    `,
  };
}
