#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const workers = Number(args.workers || Math.min(8, Math.max(1, os.availableParallelism?.() || os.cpus().length || 1)));

if (args.help) {
  console.log("Usage: node scripts/prewarm_preflop_winshares_parallel.mjs [--workers 8] [--api http://127.0.0.1:8766] [--cache-version VERSION]");
  process.exit(0);
}

if (!Number.isInteger(workers) || workers < 1) {
  throw new Error("--workers must be a positive integer");
}

const passThroughArgs = [];
for (const key of ["api", "cache-version"]) {
  if (args[key]) {
    passThroughArgs.push(`--${key}`, String(args[key]));
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: workers }, (_, shardIndex) => runShard(shardIndex)));
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`Done parallel prewarm. workers=${workers} elapsed=${elapsed}s`);

function runShard(shardIndex) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "scripts", "prewarm_preflop_winshares.mjs"),
      "--shard-count",
      String(workers),
      "--shard-index",
      String(shardIndex),
      ...passThroughArgs,
    ], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => process.stdout.write(`[shard ${shardIndex}] ${chunk}`));
    child.stderr.on("data", (chunk) => process.stderr.write(`[shard ${shardIndex}] ${chunk}`));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`prewarm shard ${shardIndex} exited with ${code}`));
      }
    });
  });
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
