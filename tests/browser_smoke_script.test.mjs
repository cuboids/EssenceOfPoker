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

test("browser smoke script exposes a stable command-line entrypoint", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/browser_smoke.mjs", "--help"], { cwd: root });

  assert.match(stdout, /Usage: node scripts\/browser_smoke\.mjs/);
});

test("package exposes browser e2e command", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.match(packageJson.scripts["test:e2e"], /browser_smoke\.mjs/);
  assert.match(packageJson.scripts["test:e2e"], /--require-browser/);
});
