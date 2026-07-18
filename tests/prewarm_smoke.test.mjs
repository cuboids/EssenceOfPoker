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
const scriptPath = path.join(root, "scripts", "prewarm_preflop_winshares.mjs");

test("preflop win-share prewarmer imports the real kernel directly", async () => {
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.match(source, /from "\.\.\/dashboard\/win_shares\.mjs"/);
  assert.doesNotMatch(source, /app\.js/);
  assert.doesNotMatch(source, /eval\s*\(/);
  assert.doesNotMatch(source, /globalThis\.__prewarm/);
  assert.doesNotMatch(source, /source\.replace/);

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--limit",
    "0",
    "--api",
    "http://127.0.0.1:9",
  ], { cwd: root });

  assert.match(stdout, /Done\. attempted=0 computed=0 skipped=0/);
});
