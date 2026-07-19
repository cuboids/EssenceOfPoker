import { escapeHtml } from "./ui.mjs";

export function createPageShellController(deps) {
  function renderPortfolioTabs() {
    const container = deps.documentRef.getElementById("portfolio-tabs");
    const dashboardData = deps.dashboardData();
    const villainTabs = deps.villainPageKeys()
      .map((page) => {
        const name = dashboardData.portfolios[page].name;
        const folded = deps.isVillainPageFolded(page);
        return `
          <button
            class="page-tab ${folded ? "is-folded" : ""}"
            type="button"
            data-page="${page}"
            title="${folded ? `${name} folded` : name}"
          >
            ${name}
          </button>
        `;
      })
      .join("");
    container.innerHTML = `
      <button class="page-tab" id="hero-page-button" type="button" data-page="hero">Hero</button>
      ${villainTabs}
      <button class="control-button showdown-button" id="showdown-button" type="button" hidden>Showdown</button>
    `;
    for (const button of container.querySelectorAll("[data-page]")) {
      const pageButton = /** @type {HTMLElement} */ (button);
      pageButton.addEventListener("click", () => switchPage(pageButton.dataset.page));
    }
    deps.documentRef.getElementById("showdown-button")?.addEventListener("click", deps.revealVillain);
  }

  function switchPage(page) {
    if (page !== "config" && !deps.dashboardData().portfolios[page]) {
      return;
    }
    deps.setActivePage(page);
    deps.setFocusedAsset(null);
    deps.closeFocus();
    deps.renderHoldingDisplay();
    updatePageTabs();
    if (deps.shouldDeferCurrentPageCurves()) {
      renderLoadingAssets();
      deps.scheduleCurrentPageCurves();
      return;
    }
    deps.ensureCurrentPageCurves();
    deps.updateLegend();
    deps.renderAssets();
  }

  function updatePageTabs() {
    for (const button of deps.documentRef.querySelectorAll("[data-page]")) {
      const pageButton = /** @type {HTMLElement} */ (button);
      pageButton.classList.toggle("is-active", pageButton.dataset.page === deps.activePage());
      pageButton.classList.toggle("is-folded", deps.isVillainPageFolded(pageButton.dataset.page));
    }
    const showdownButton = deps.documentRef.getElementById("showdown-button");
    if (showdownButton) {
      showdownButton.hidden = !(deps.handState()?.round === "river" && !deps.villainShowdown());
    }
  }

  function renderLoadingAssets({
    title = "Calculating villain distributions",
    copy = "The tab is active. Hidden-card curves are being rebuilt from hero's perspective.",
  } = {}) {
    const container = deps.documentRef.getElementById("asset-grid");
    container.innerHTML = `
      <section class="asset-loading" aria-live="polite">
        <span class="asset-loading-title">${escapeHtml(title)}</span>
        <span class="asset-loading-copy">${escapeHtml(copy)}</span>
      </section>
    `;
  }

  return {
    renderLoadingAssets,
    renderPortfolioTabs,
    switchPage,
    updatePageTabs,
  };
}
