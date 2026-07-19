#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "essence_of_poker", "data", "preflop_aggregate_cache.json");
const outputDir = path.join(root, "essence_of_poker", "data", "preflop_aggregate_classes");

const cache = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const dashboardData = JSON.parse(fs.readFileSync(path.join(root, "dashboard", "data", "prior_portfolio.json"), "utf8"));
const source = cache.source || "exact-hero-preflop-aggregate-v1";
const sampleSpace = cache.sampleSpace || "known hero holding class with every legal five-card board, scored by same-world asset minimum";
const bucketCount = cache.bucketCount || dashboardData.bucketCount;
fs.mkdirSync(outputDir, { recursive: true });

for (const [classKey, aggregates] of Object.entries(cache.classes)) {
  const payload = `${JSON.stringify({
    source,
    exact: true,
    probabilitySpace: "hero-preflop-aggregate",
    sampleSpace,
    totalCombos: cache.totalCombos,
    bucketCount,
    classKey,
    aggregates,
  })}\n`;
  fs.writeFileSync(path.join(outputDir, `${classKey}.json.gz`), zlib.gzipSync(payload));
}

const manifest = {
  source,
  exact: true,
  probabilitySpace: "hero-preflop-aggregate",
  sampleSpace,
  totalCombos: cache.totalCombos,
  bucketCount,
  classes: Object.keys(cache.classes).sort((first, second) => first.localeCompare(second, undefined, { numeric: true })),
};
fs.writeFileSync(
  path.join(root, "essence_of_poker", "data", "preflop_aggregate_manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${manifest.classes.length} class files to ${outputDir}`);
