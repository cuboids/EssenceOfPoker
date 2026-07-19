#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const tier = process.argv[2] || "all";
const tests = fs.readdirSync("tests")
  .filter((file) => file.endsWith(".test.mjs"))
  .map((file) => `tests/${file}`)
  .sort();

const tierPredicates = {
  all: () => true,
  browser: (file) => file.includes("browser_"),
  data: (file) => (
    file.includes("data_contracts") ||
    file.includes("cache_payload_contracts") ||
    file.includes("prewarm_smoke")
  ),
  integration: (file) => (
    file.includes("golden_scenarios") ||
    file.includes("imported_hand_replay") ||
    file.includes("performance_budgets") ||
    file.includes("property_math")
  ),
  unit: (file) => !tierPredicates.browser(file) && !tierPredicates.data(file) && !tierPredicates.integration(file),
  fast: (file) => !file.includes("browser_") && !file.includes("performance_budgets"),
};

if (!tierPredicates[tier]) {
  console.error(`Unknown JS test tier: ${tier}`);
  console.error(`Available tiers: ${Object.keys(tierPredicates).join(", ")}`);
  process.exit(2);
}

const selected = tests.filter(tierPredicates[tier]);
if (!selected.length) {
  console.error(`No JS tests matched tier: ${tier}`);
  process.exit(2);
}

const result = spawnSync(process.execPath, ["--test", ...selected], {
  cwd: process.cwd(),
  stdio: "inherit",
});
process.exit(result.status ?? 1);
