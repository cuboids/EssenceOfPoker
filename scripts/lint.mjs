#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["dashboard", "scripts", "tests"];
const jsFiles = listFiles(roots, (file) => file.endsWith(".mjs"));
const textFiles = listFiles(["dashboard", "scripts", "tests", "essence_of_poker"], (file) =>
  /\.(mjs|js|py|css|html|json|md)$/.test(file) && !file.includes(`${path.sep}data${path.sep}`),
);

const errors = [];

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    errors.push(`${file}: JavaScript syntax check failed\n${result.stderr || result.stdout}`);
  }
}

for (const file of textFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("\r\n")) {
    errors.push(`${file}: use LF line endings`);
  }
  if (text.length && !text.endsWith("\n")) {
    errors.push(`${file}: missing trailing newline`);
  }
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (/[ \t]$/.test(lines[index])) {
      errors.push(`${file}:${index + 1}: trailing whitespace`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`ok lint ${jsFiles.length} js files, ${textFiles.length} text files`);

function listFiles(searchRoots, predicate) {
  const files = [];
  for (const root of searchRoots) {
    walk(root, files, predicate);
  }
  return files.sort();
}

function walk(current, files, predicate) {
  if (!fs.existsSync(current)) {
    return;
  }
  const stat = fs.statSync(current);
  if (stat.isDirectory()) {
    if ([".git", "node_modules", "dist", "__pycache__"].includes(path.basename(current))) {
      return;
    }
    for (const child of fs.readdirSync(current)) {
      walk(path.join(current, child), files, predicate);
    }
    return;
  }
  if (predicate(current)) {
    files.push(current);
  }
}
