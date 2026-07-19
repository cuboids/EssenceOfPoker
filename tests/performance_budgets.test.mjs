import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

test("performance budget script reports named benchmark budgets", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "scripts/performance_budgets.mjs",
    "--json",
    "--no-fail",
  ], { cwd: root });
  const report = JSON.parse(stdout);

  assert.ok(Array.isArray(report.results));
  assert.deepEqual(
    report.results.map((result) => result.name),
    [
      "evaluate-five-card-cache",
      "known-card-distribution-reduced",
      "hidden-villain-complete-board-reduced",
      "preflop-win-share-kernel-reduced",
      "multiway-equity-six-max-5k",
    ],
  );
  assert.ok(report.results.every((result) => Number.isFinite(result.durationMs) && result.budgetMs > 0));
});
