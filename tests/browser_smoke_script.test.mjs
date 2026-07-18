import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
