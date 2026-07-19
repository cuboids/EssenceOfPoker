#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "essence_of_poker", "data", "preflop_primary_prior_cache.json");
const outputDir = path.join(root, "essence_of_poker", "data", "preflop_primary_classes");
const manifestPath = path.join(root, "essence_of_poker", "data", "preflop_primary_manifest.json");

const cache = JSON.parse(fs.readFileSync(inputPath, "utf8"));
fs.mkdirSync(outputDir, { recursive: true });

for (const [classKey, assets] of Object.entries(cache.classes)) {
  const payload = `${JSON.stringify({
    source: cache.source,
    exact: cache.exact,
    sampleSpace: cache.sampleSpace,
    totalCombos: cache.totalCombos,
    bucketCount: cache.bucketCount,
    classKey,
    assets,
  })}\n`;
  fs.writeFileSync(path.join(outputDir, `${classKey}.json.gz`), zlib.gzipSync(payload));
}

const manifest = {
  source: cache.source,
  exact: cache.exact,
  sampleSpace: cache.sampleSpace,
  totalCombos: cache.totalCombos,
  bucketCount: cache.bucketCount,
  classes: Object.keys(cache.classes).sort((first, second) => first.localeCompare(second, undefined, { numeric: true })),
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${manifest.classes.length} primary preflop classes to ${outputDir}`);
console.log(`Wrote ${manifestPath}`);
