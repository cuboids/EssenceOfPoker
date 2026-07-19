import assert from "node:assert/strict";
import test from "node:test";

import {
  bindConfigControls,
  bindDashboardControls,
} from "../dashboard/controllers/dashboard_controls.mjs";

test("dashboard controls bind required handlers through the controller", () => {
  const documentRef = fakeDocument([
    "new-hand-button",
    "previous-street-button",
    "next-street-button",
    "new-round-button",
    "interesting-hand-button",
    "showdown-button",
    "holding-display",
    "action-controls",
    "config-page-button",
    "theme-toggle",
  ], {
    'input[name="chart-mode"]': [fakeElement("chart-a"), fakeElement("chart-b")],
  });
  const calls = [];
  bindDashboardControls({
    documentRef,
    handlers: {
      resetNewHand: () => calls.push("reset"),
      navigateStreet: (direction) => calls.push(`nav:${direction}`),
      dealNewRound: () => calls.push("deal"),
      loadRandomInterestingHand: () => calls.push("random"),
      revealVillain: () => calls.push("showdown"),
      handleCardEditClick: () => calls.push("edit"),
      handlePlayerActionClick: () => calls.push("action"),
      handleRaisePercentChange: () => calls.push("raise-change"),
      switchPage: (page) => calls.push(`page:${page}`),
      changeChartMode: () => calls.push("chart"),
      toggleThemeMode: () => calls.push("theme"),
    },
  });

  documentRef.getElementById("previous-street-button").emit("click");
  documentRef.getElementById("next-street-button").emit("click");
  documentRef.querySelectorAll('input[name="chart-mode"]')[0].emit("change");
  documentRef.getElementById("config-page-button").emit("click");

  assert.deepEqual(calls, ["nav:-1", "nav:1", "chart", "page:config"]);
});

test("config controls bind dynamic config inputs", () => {
  const documentRef = fakeDocument(["hide-inactive-toggle"], {
    'input[name="player-count"]': [fakeElement("players")],
    'input[name="hero-position"]': [fakeElement("hero")],
    'input[name="player-stack"]': [fakeElement("stack")],
    'input[name="calibration-stake-bucket"]': [fakeElement("stake")],
    'input[name="calibration-year-bucket"]': [fakeElement("year")],
    "[data-archetype-player]": [fakeElement("arch")],
  });
  const calls = [];

  bindConfigControls({
    documentRef,
    handlers: {
      changePlayerCount: () => calls.push("players"),
      changeHeroPosition: () => calls.push("hero"),
      changePlayerStack: () => calls.push("stack"),
      toggleHideInactiveAssets: () => calls.push("hide"),
      changeCalibrationStakeBucket: () => calls.push("stake"),
      changeCalibrationYearBucket: () => calls.push("year"),
      changePlayerArchetypeWeight: () => calls.push("arch"),
    },
  });

  documentRef.querySelectorAll('input[name="player-count"]')[0].emit("change");
  documentRef.getElementById("hide-inactive-toggle").emit("change");
  documentRef.querySelectorAll("[data-archetype-player]")[0].emit("input");
  documentRef.querySelectorAll("[data-archetype-player]")[0].emit("change");

  assert.deepEqual(calls, ["players", "hide", "arch", "arch"]);
});

function fakeDocument(ids, queryResults = {}) {
  const elements = new Map(ids.map((id) => [id, fakeElement(id)]));
  return {
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (selector) => queryResults[selector] || [],
  };
}

function fakeElement(id) {
  const listeners = new Map();
  return {
    id,
    addEventListener: (event, handler) => {
      listeners.set(event, [...(listeners.get(event) || []), handler]);
    },
    emit: (event) => {
      for (const handler of listeners.get(event) || []) {
        handler({ target: { id } });
      }
    },
  };
}
