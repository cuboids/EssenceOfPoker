#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultInputPath = path.join(root, "essence_of_poker", "data", "preflop_hidden_villain_cache.json");
const legacyInputPath = path.join(root, "dashboard", "data", "preflop_hidden_villain_cache.json");
const inputPath = fs.existsSync(defaultInputPath) ? defaultInputPath : legacyInputPath;
const outputDir = path.join(root, "essence_of_poker", "data", "preflop_hidden_villain_classes");
const manifestPath = path.join(root, "essence_of_poker", "data", "preflop_hidden_villain_manifest.json");

if (!fs.existsSync(inputPath)) {
  const existingClassCount = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((name) => name.endsWith(".json.gz")).length
    : 0;
  if (existingClassCount === 169 && fs.existsSync(manifestPath)) {
    console.log("Skipping hidden-villain split; tracked class artifacts are already present.");
    process.exit(0);
  }
  throw new Error(`missing hidden-villain source cache: ${defaultInputPath}`);
}

const cache = JSON.parse(fs.readFileSync(inputPath, "utf8"));
fs.mkdirSync(outputDir, { recursive: true });

for (const [classKey, curves] of Object.entries(cache.classes)) {
  const payload = `${JSON.stringify({
    source: cache.source,
    exact: true,
    probabilitySpace: "hidden-villain-preflop-primary",
    sampleSpace: "hero blockers removed; villain hole cards hidden; primary assets grouped by visible villain-card usage",
    bucketCount: cache.bucketCount,
    classKey,
    curves,
  })}\n`;
  fs.writeFileSync(path.join(outputDir, `${classKey}.json.gz`), zlib.gzipSync(payload));
}

const manifest = {
  source: cache.source,
  exact: true,
  probabilitySpace: "hidden-villain-preflop-primary",
  sampleSpace: "hero blockers removed; villain hole cards hidden; primary assets grouped by visible villain-card usage",
  bucketCount: cache.bucketCount,
  classes: Object.keys(cache.classes).sort((first, second) => first.localeCompare(second, undefined, { numeric: true })),
};
fs.writeFileSync(
  manifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${manifest.classes.length} class files to ${outputDir}`);
