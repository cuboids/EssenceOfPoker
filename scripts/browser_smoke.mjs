#!/usr/bin/env node

import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || 8781);
const dashboardRoot = args["dashboard-root"] || "dist/dashboard";
const requireBrowser = Boolean(args["require-browser"]);
const playwright = loadPlaywright();

if (args.help) {
  console.log("Usage: node scripts/browser_smoke.mjs [--port 8781] [--dashboard-root dist/dashboard] [--require-browser]");
  process.exit(0);
}

if (!playwright) {
  skipOrFail("Playwright is not installed. Set NODE_PATH or PLAYWRIGHT_NODE_MODULES.");
}

const server = spawn("python3", [
  "-m",
  "essence_of_poker.server",
  "--port",
  String(port),
  "--dashboard-root",
  dashboardRoot,
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForHealth(port);
  const result = await runBrowserSmoke(`http://127.0.0.1:${port}/`);
  if (result.skipped) {
    skipOrFail(result.reason);
  }
  console.log(`ok browser-smoke http://127.0.0.1:${port}/`);
} finally {
  server.kill("SIGINT");
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    null,
    process.env.PLAYWRIGHT_NODE_MODULES,
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return candidate ? require(candidate) : require("playwright");
    } catch {
      // Try the next known location.
    }
  }
  return null;
}

async function waitForHealth(serverPort) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) {
      throw new Error(`server exited before health check passed: ${server.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/api/health`, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server health check timed out");
}

async function runBrowserSmoke(url) {
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    if (/Executable doesn't exist|browser executable/i.test(error.message)) {
      return { skipped: true, reason: "Playwright browser binary is not installed. Run `npx playwright install chromium`." };
    }
    throw error;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const httpErrors = [];
  const requestedUrls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      if (message.text().startsWith("Failed to load resource:")) {
        return;
      }
      errors.push(message.text());
    }
  });
  page.on("request", (request) => requestedUrls.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      httpErrors.push({ status: response.status(), url: response.url() });
    }
  });

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector(".asset-card", { timeout: 10_000 });
    const initialCards = await page.locator(".asset-card").count();
    if (initialCards < 21) {
      throw new Error(`expected at least 21 asset cards, got ${initialCards}`);
    }
    const assetCount = await page.locator("#asset-count").textContent();
    if (assetCount?.trim() !== "21") {
      throw new Error(`expected concrete asset count 21, got ${assetCount}`);
    }

    await page.locator("#new-round-button").click();
    await page.waitForFunction(() => document.querySelector("#holding-display")?.textContent.includes("Holding"), null, { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelectorAll(".known-card").length >= 2, null, { timeout: 10_000 });
    await page.waitForFunction(() => [...document.querySelectorAll(".win-bars")].some((element) => /Win share|equity/i.test(element.getAttribute("title") || "")), null, { timeout: 10_000 });

    await page.waitForSelector('[data-instant-action="call"], [data-instant-action="check"], [data-instant-action="fold"]', { timeout: 10_000 });
    const firstInstantAction = page.locator('[data-instant-action="call"], [data-instant-action="check"], [data-instant-action="fold"]').first();
    await firstInstantAction.click();
    await page.waitForFunction(() => document.querySelectorAll(".action-tag:not(.action-tag-forced)").length >= 1, null, { timeout: 10_000 });
    await page.locator("#previous-street-button").click();
    await page.waitForFunction(() => document.querySelectorAll(".action-tag:not(.action-tag-forced)").length === 0, null, { timeout: 10_000 });
    await page.locator("#next-street-button").click();
    await page.waitForFunction(() => document.querySelectorAll(".action-tag:not(.action-tag-forced)").length >= 1, null, { timeout: 10_000 });

    await page.locator("#new-round-button").click();
    await page.waitForFunction(() => document.querySelectorAll(".known-card").length >= 5, null, { timeout: 10_000 });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-action-street="flop"]')), null, { timeout: 10_000 });
    await page.locator("#previous-street-button").click();
    await page.waitForFunction(() => document.querySelector("#new-round-button")?.textContent.includes("Deal flop"), null, { timeout: 10_000 });
    await page.locator("#next-street-button").click();
    await page.waitForFunction(() => document.querySelector("#new-round-button")?.textContent.includes("Deal turn"), null, { timeout: 10_000 });

    if (requestedUrls.some((requestUrl) => requestUrl.includes("data/preflop_aggregate_cache.json"))) {
      throw new Error("browser requested removed monolithic preflop aggregate cache");
    }
    if (!requestedUrls.some((requestUrl) => requestUrl.includes("/api/data/preflop-aggregate/"))) {
      throw new Error("browser did not request typed preflop aggregate class data");
    }
    if (!requestedUrls.some((requestUrl) => requestUrl.includes("/api/data/preflop-hidden-villain/"))) {
      throw new Error("browser did not request typed hidden-villain class data");
    }

    await page.locator("#config-page-button").click();
    await page.waitForSelector(".config-panel", { timeout: 10_000 });
    await page.locator('input[name="player-count"][value="6"]').click({ force: true });
    await page.locator('input[name="hero-position"][value="CO"]').click({ force: true });
    const pages = await page.locator("#portfolio-tabs [data-page]").evaluateAll((elements) =>
      elements.map((element) => [element.getAttribute("data-page"), element.textContent.trim()]),
    );
    const expectedPages = [
      ["hero", "Hero"],
      ["villain:BTN", "BTN"],
      ["villain:SB", "SB"],
      ["villain:BB", "BB"],
      ["villain:LJ", "LJ"],
      ["villain:HJ", "HJ"],
    ];
    if (JSON.stringify(pages) !== JSON.stringify(expectedPages)) {
      throw new Error(`unexpected 6-player tabs: ${JSON.stringify(pages)}`);
    }
    await page.locator('input[name="player-count"][value="2"]').click({ force: true });
    await page.locator('input[name="hero-position"][value="BB"]').click({ force: true });
    await page.locator("#new-hand-button").click();
    await page.locator("#config-page-button").click();
    const headsUpHero = await page.locator('input[name="hero-position"]:checked').evaluate((input) => input.value);
    const headsUpPages = await page.locator("#portfolio-tabs [data-page]").evaluateAll((elements) =>
      elements.map((element) => [element.getAttribute("data-page"), element.textContent.trim()]),
    );
    if (headsUpHero !== "SB" || JSON.stringify(headsUpPages) !== JSON.stringify([["hero", "Hero"], ["villain:BB", "BB"]])) {
      throw new Error(`unexpected heads-up New hand rotation: hero=${headsUpHero} pages=${JSON.stringify(headsUpPages)}`);
    }
    const unexpectedHttpErrors = httpErrors.filter((response) =>
      !(response.status === 404 && response.url.includes("/api/cache/")),
    );
    if (errors.length || unexpectedHttpErrors.length) {
      const parts = [
        ...errors,
        ...unexpectedHttpErrors.map((response) => `${response.status} ${response.url}`),
      ];
      throw new Error(`browser errors: ${parts.join(" | ")}`);
    }
  } finally {
    await browser.close();
  }
  return { skipped: false };
}

function skipOrFail(reason) {
  const message = `Skipping browser smoke: ${reason}`;
  if (requireBrowser) {
    throw new Error(message);
  }
  console.log(message);
  process.exit(0);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[name] = true;
    } else {
      parsed[name] = next;
      index += 1;
    }
  }
  return parsed;
}
