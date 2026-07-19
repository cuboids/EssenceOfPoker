export function bindDashboardControls({
  documentRef = document,
  handlers,
}) {
  byId(documentRef, "new-hand-button").addEventListener("click", handlers.resetNewHand);
  byId(documentRef, "previous-street-button").addEventListener("click", () => handlers.navigateStreet(-1));
  byId(documentRef, "next-street-button").addEventListener("click", () => handlers.navigateStreet(1));
  byId(documentRef, "new-round-button").addEventListener("click", handlers.dealNewRound);
  byId(documentRef, "interesting-hand-button").addEventListener("click", handlers.loadRandomInterestingHand);
  byId(documentRef, "showdown-button").addEventListener("click", handlers.revealVillain);
  byId(documentRef, "holding-display").addEventListener("click", handlers.handleCardEditClick);
  byId(documentRef, "action-controls").addEventListener("click", handlers.handlePlayerActionClick);
  byId(documentRef, "action-controls").addEventListener("change", handlers.handleRaisePercentChange);
  byId(documentRef, "config-page-button").addEventListener("click", () => handlers.switchPage("config"));

  for (const input of documentRef.querySelectorAll('input[name="chart-mode"]')) {
    input.addEventListener("change", handlers.changeChartMode);
  }
  byId(documentRef, "theme-toggle").addEventListener("change", handlers.toggleThemeMode);
}

export function bindConfigControls({
  documentRef = document,
  handlers,
}) {
  for (const input of documentRef.querySelectorAll('input[name="player-count"]')) {
    input.addEventListener("change", handlers.changePlayerCount);
  }
  for (const input of documentRef.querySelectorAll('input[name="hero-position"]')) {
    input.addEventListener("change", handlers.changeHeroPosition);
  }
  for (const input of documentRef.querySelectorAll('input[name="player-stack"]')) {
    input.addEventListener("change", handlers.changePlayerStack);
  }
  byId(documentRef, "hide-inactive-toggle").addEventListener("change", handlers.toggleHideInactiveAssets);
  for (const input of documentRef.querySelectorAll('input[name="calibration-stake-bucket"]')) {
    input.addEventListener("change", handlers.changeCalibrationStakeBucket);
  }
  for (const input of documentRef.querySelectorAll('input[name="calibration-year-bucket"]')) {
    input.addEventListener("change", handlers.changeCalibrationYearBucket);
  }
  for (const input of documentRef.querySelectorAll("[data-archetype-player]")) {
    input.addEventListener("input", handlers.changePlayerArchetypeWeight);
    input.addEventListener("change", handlers.changePlayerArchetypeWeight);
  }
}

function byId(documentRef, id) {
  const element = documentRef.getElementById(id);
  if (!element) {
    throw new Error(`Missing dashboard control: ${id}`);
  }
  return element;
}
