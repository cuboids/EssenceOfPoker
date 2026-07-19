export function createDisplayPreferencesController(deps) {
  function changeChartMode(event) {
    deps.setChartMode(/** @type {HTMLSelectElement} */ (event.target).value);
    deps.renderAssets();
    if (deps.focusedAsset()) {
      deps.openFocus(deps.focusedAsset());
    }
  }

  function toggleThemeMode(event) {
    const enabled = /** @type {HTMLInputElement} */ (event.target).checked;
    deps.setUseDarkTheme(enabled);
    deps.persistTheme(enabled);
    applyThemeMode();
  }

  function applyThemeMode() {
    deps.documentRef.body.classList.toggle("theme-dark", deps.useDarkTheme());
    const themeToggle = /** @type {HTMLInputElement | null} */ (deps.documentRef.getElementById("theme-toggle"));
    if (themeToggle) {
      themeToggle.checked = deps.useDarkTheme();
    }
  }

  return {
    applyThemeMode,
    changeChartMode,
    toggleThemeMode,
  };
}
