import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

test("JS test tier runner rejects unknown tiers and package exposes tier commands", async () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const script of ["test:fast", "test:unit", "test:integration", "test:data", "test:browser"]) {
    assert.match(packageJson.scripts[script], /run_js_tests_tier\.mjs/);
  }
  assert.match(packageJson.scripts.lint, /lint\.mjs/);
  assert.match(packageJson.scripts["format:check"], /lint\.mjs/);

  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/run_js_tests_tier.mjs", "nope"], { cwd: root }),
    /Unknown JS test tier/,
  );
});
