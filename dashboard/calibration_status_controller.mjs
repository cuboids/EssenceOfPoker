import { empiricalStatusLabel } from "./stores/empirical_spot_store.mjs";
import {
  escapeHtml,
} from "./ui.mjs";

export function createCalibrationStatusController(deps) {
  function renderCalibrationStatus() {
    const container = deps.documentRef.getElementById("calibration-status");
    if (!container) {
      return;
    }
    const store = deps.empiricalSpotStore();
    const health = store.health?.data?.empiricalCalibration;
    const actions = deps.visiblePlayerActionsForCurrentStreet();
    const summary = store.summary(actions);
    const status = store.status(actions);
    const corpusLabel = !store.health
      ? "Checking empirical calibration"
      : health?.ok
        ? `${formatInteger(health.hands)} hands · ${formatInteger(health.actions)} actions`
        : "Empirical calibration unavailable";
    const calibrationContext = deps.calibrationContext();
    const spotLabel = summary.total
      ? `${summary.ready}/${summary.total} action spots loaded${summary.pending ? " · loading" : ""}`
      : "No action spots yet";
    const latestWorkerFailure = deps.workerFailures().at(-1);
    const workerStatus = latestWorkerFailure
      ? `<span class="empirical-pill fallback" title="${escapeHtml(latestWorkerFailure.message)}">Worker fallback</span>`
      : "";
    container.innerHTML = `
      <span class="empirical-pill ${status}">${escapeHtml(empiricalStatusLabel(status))}</span>
      <span>${escapeHtml(corpusLabel)}</span>
      <span>${escapeHtml(calibrationContext.stakeBucket)} · ${escapeHtml(calibrationContext.yearBucket)}</span>
      <span>${escapeHtml(spotLabel)}</span>
      ${workerStatus}
    `;
  }

  async function hydrateEmpiricalCalibrationHealth() {
    await deps.empiricalSpotStore().hydrateHealth();
  }

  function recordWorkerFailure(failure) {
    const workerFailures = [...deps.workerFailures().slice(-4), failure];
    deps.setWorkerFailures(workerFailures);
    renderCalibrationStatus();
  }

  function recordAsyncJobFailure(failure) {
    recordWorkerFailure({
      type: `async:${failure.key}`,
      message: failure.error?.message || "async dashboard job failed",
      error: failure.error,
      at: failure.at,
    });
  }

  return {
    hydrateEmpiricalCalibrationHealth,
    recordAsyncJobFailure,
    recordWorkerFailure,
    renderCalibrationStatus,
  };
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString();
}
