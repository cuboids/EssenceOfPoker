import { rankSymbol, suitSymbol } from "./cards.mjs";

export function compactTokenHtml(token) {
  return token.replace("_1", "<sub>1</sub>").replace("_2", "<sub>2</sub>").replace("_3", "<sub>3</sub>");
}

export function cardHtml(card) {
  if (card.relativeSuit == null) {
    return physicalCardHtml(card);
  }
  return `<span class="known-card">${rankSymbol(card.rank)}<sub>${card.relativeSuit}</sub></span>`;
}

export function physicalCardHtml(card) {
  return `<span class="known-card physical-card">${rankSymbol(card.rank)}${suitSymbol(card.suit)}</span>`;
}

export function cardText(card) {
  return `${rankSymbol(card.rank)}_${card.relativeSuit}`;
}

export function compactTokenText(token) {
  return token.replace("_", "");
}

export function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatCombos(value) {
  if (value >= 1_000_000_000) {
    return `${formatShortNumber(value / 1_000_000_000)}b`;
  }
  if (value >= 1_000_000) {
    return `${formatShortNumber(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${formatShortNumber(value / 1_000)}k`;
  }
  return value.toLocaleString();
}

export function formatShortNumber(value) {
  if (value >= 100) {
    return Math.round(value).toString();
  }
  return value.toFixed(1).replace(/\.0$/, "");
}

export function formatPercent(value) {
  const percent = value * 100;
  if (percent >= 10) {
    return `${percent.toFixed(1).replace(/\.0$/, "")}%`;
  }
  if (percent >= 1) {
    return `${percent.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}%`;
  }
  return `${percent.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}
