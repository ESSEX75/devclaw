#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const testFiles = [];

for await (const file of walk(path.join(root, "lib"))) {
  if (!file.endsWith(".test.ts") && !file.endsWith(".e2e.test.ts")) continue;
  const content = await readFile(file, "utf8");

  if (content.includes("from \"node:test\"") || content.includes("from 'node:test'")) {
    testFiles.push(path.relative(root, file));
  }
}

testFiles.sort();

if (testFiles.length === 0) {
  console.error("No node:test TypeScript test files found.");
  process.exit(1);
}

const cmd = process.platform === "win32" ? "tsx.cmd" : "tsx";
const child = spawn(cmd, ["--test", ...testFiles], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Test runner terminated by ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
