#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const warnOnly = process.argv.includes("--warn-only");
const openClawToolContextImportCache = new Map();
const LEGACY_ROOT_DIRS = [
  "lib/workflow",
  "lib/providers",
  "lib/projects",
  "lib/issues",
  "lib/config",
  "lib/dispatch",
  "lib/services",
  "lib/setup",
];

const productionFiles = await collectProductionFiles(root);
const graph = await buildImportGraph(productionFiles);
const cycles = findCycles(graph);
const boundaryViolations = await findBoundaryViolations(productionFiles);
const legacyDirectoryViolations = findLegacyDirectoryViolations(root);
const toolFactories = await findToolFactories(productionFiles);
const registration = await findRegisteredToolFactories(productionFiles);
const unregistered = [...toolFactories].filter(
  (factory) => !registration.registered.has(factory),
);

printReport({
  cycles,
  boundaryViolations,
  legacyDirectoryViolations,
  toolFactories,
  registered: registration.registered,
  unregistered,
});

const hasBlockingFailures =
  cycles.length > 0 ||
  boundaryViolations.length > 0 ||
  legacyDirectoryViolations.length > 0 ||
  unregistered.length > 0;

if (hasBlockingFailures && !warnOnly) {
  process.exitCode = 1;
}

async function collectProductionFiles(repoRoot) {
  const files = [path.join(repoRoot, "index.ts")];
  const libRoot = path.join(repoRoot, "lib");

  for await (const file of walk(libRoot)) {
    if (!file.endsWith(".ts")) continue;
    if (file.endsWith(".test.ts") || file.endsWith(".e2e.test.ts")) continue;
    if (file.includes(`${path.sep}testing${path.sep}`)) continue;
    files.push(file);
  }

  return files.sort();
}

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

async function buildImportGraph(files) {
  const fileSet = new Set(files.map(normalize));
  const graph = new Map(files.map((file) => [normalize(file), []]));
  const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;

  for (const file of files) {
    const content = stripComments(await readFile(file, "utf8"));
    const edges = [];

    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1];

      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelativeTsImport(path.dirname(file), specifier);

      if (resolved && normalize(resolved) !== normalize(file) && fileSet.has(normalize(resolved))) {
        edges.push(normalize(resolved));
      }
    }

    graph.set(normalize(file), [...new Set(edges)].sort());
  }

  return graph;
}

async function findBoundaryViolations(files) {
  const violations = [];

  for (const file of files) {
    const content = stripComments(await readFile(file, "utf8"));
    const sourceLayer = layerForFile(file);
    const relativeSource = relative(file);

    openClawToolContextImportCache.set(
      file,
      /\bOpenClawPluginToolContext\b/.test(content),
    );

    for (const record of parseImportRecords(content, file)) {
      const targetFile = record.specifier.startsWith(".")
        ? resolveRelativeTsImport(path.dirname(file), record.specifier)
        : undefined;
      const targetLayer = targetFile ? layerForFile(targetFile) : undefined;
      const normalizedTarget = targetFile ? relative(targetFile) : record.specifier;

      const violation = checkImportBoundary({
        sourceFile: file,
        sourceLayer,
        targetFile,
        targetLayer,
        specifier: record.specifier,
      });

      if (violation) {
        violations.push({
          file: relativeSource,
          import: record.specifier,
          target: normalizedTarget,
          rule: violation,
        });
      }
    }
  }

  return violations.sort((a, b) =>
    `${a.file}:${a.import}:${a.rule}`.localeCompare(`${b.file}:${b.import}:${b.rule}`),
  );
}

function parseImportRecords(content) {
  const records = [];
  const staticImportPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of content.matchAll(staticImportPattern)) {
    records.push({ specifier: match[1] });
  }

  for (const match of content.matchAll(dynamicImportPattern)) {
    records.push({ specifier: match[1] });
  }

  return records;
}

function checkImportBoundary({ sourceFile, sourceLayer, targetFile, targetLayer, specifier }) {
  const targetRelative = targetFile ? relative(targetFile) : specifier;

  if (isLegacyRootImport(sourceFile, targetFile, specifier)) {
    return "legacy root package imports are forbidden after migration";
  }

  if (targetLayer === "testing") {
    return "production modules must not import lib/testing";
  }

  if (sourceLayer === "domain" && ["application", "state", "integrations", "tools", "cli"].includes(targetLayer)) {
    return "domain must not import application, state, integrations, tools, or cli";
  }

  if (sourceLayer === "state" && ["tools", "cli"].includes(targetLayer)) {
    return "state must not import tools or cli";
  }

  if (sourceLayer === "application") {
    if (specifier === "openclaw/plugin-sdk/core" && importsOpenClawToolContext(sourceFile)) {
      return "application must not import OpenClaw tool context";
    }

    if (targetLayer === "cli" && targetRelative.startsWith("lib/cli/commands/")) {
      return "application must not import CLI command adapters";
    }

    if (targetRelative === "lib/context.ts" && importsOpenClawToolContext(sourceFile)) {
      return "application must not import OpenClaw tool context";
    }
  }

  return null;
}

function importsOpenClawToolContext(sourceFile) {
  return openClawToolContextImportCache.get(sourceFile) ?? false;
}

function isLegacyRootImport(sourceFile, targetFile, specifier) {
  if (!specifier.startsWith(".")) return false;

  const targetRelative = targetFile
    ? relative(targetFile)
    : relative(path.resolve(path.dirname(sourceFile), specifier.endsWith(".js") ? specifier.slice(0, -3) : specifier));

  return LEGACY_ROOT_DIRS.some(
    (dir) => targetRelative === dir || targetRelative.startsWith(`${dir}/`),
  );
}

function findLegacyDirectoryViolations(repoRoot) {
  return LEGACY_ROOT_DIRS
    .map((dir) => path.join(repoRoot, dir))
    .filter((dir) => existsSync(dir))
    .map((dir) => relative(dir));
}

function layerForFile(file) {
  const rel = relative(file);
  const parts = rel.split(path.sep);

  if (parts[0] !== "lib") return "root";

  return parts[1] ?? "root";
}

function resolveRelativeTsImport(baseDir, specifier) {
  const withoutJs = specifier.endsWith(".js") ? specifier.slice(0, -3) : specifier;
  const candidates = [
    path.resolve(baseDir, `${withoutJs}.ts`),
    path.resolve(baseDir, withoutJs, "index.ts"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const seen = new Set();

  for (const node of graph.keys()) {
    visit(node);
  }

  return cycles;

  function visit(node) {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      const cycle = [...stack.slice(start), node];
      const key = canonicalCycleKey(cycle);

      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(cycle);
      }

      return;
    }

    visiting.add(node);
    stack.push(node);
    for (const target of graph.get(node) ?? []) {
      visit(target);
    }

    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
}

function canonicalCycleKey(cycle) {
  const nodes = cycle.slice(0, -1);
  const rotations = nodes.map((_, index) => [
    ...nodes.slice(index),
    ...nodes.slice(0, index),
  ].join(">"));

  return rotations.sort()[0];
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

async function findToolFactories(files) {
  const factories = new Set();
  const factoryPattern = /\bexport\s+(?:async\s+)?function\s+(create[A-Z][A-Za-z0-9]*Tool)\b|\bexport\s+const\s+(create[A-Z][A-Za-z0-9]*Tool)\b/g;

  for (const file of files) {
    if (!file.includes(`${path.sep}lib${path.sep}tools${path.sep}`)) continue;
    const content = await readFile(file, "utf8");

    for (const match of content.matchAll(factoryPattern)) {
      factories.add(match[1] ?? match[2]);
    }
  }

  return factories;
}

async function findRegisteredToolFactories(files) {
  const registered = new Set();
  const registerPattern = /registerTool\(\s*(create[A-Z][A-Za-z0-9]*Tool)\s*\(/g;
  const registryPattern = /factory:\s*(create[A-Z][A-Za-z0-9]*Tool)\b/g;

  for (const file of files) {
    const content = stripComments(await readFile(file, "utf8"));

    for (const match of content.matchAll(registerPattern)) {
      registered.add(match[1]);
    }

    for (const match of content.matchAll(registryPattern)) {
      registered.add(match[1]);
    }
  }

  return { registered };
}

function printReport({ cycles, boundaryViolations, legacyDirectoryViolations, toolFactories, registered, unregistered }) {
  console.log("Architecture check");
  console.log("==================");
  console.log(`Mode: ${warnOnly ? "warn-only" : "strict"}`);
  console.log(`Production files scanned: ${productionFiles.length}`);
  console.log(`Tool factories found: ${toolFactories.size}`);
  console.log(`Tool factories registered: ${registered.size}`);
  console.log("");

  if (cycles.length === 0) {
    console.log("Import cycles: none");
  } else {
    console.log(`Import cycles: ${cycles.length}`);
    for (const cycle of cycles) {
      console.log(`- ${cycle.map(relative).join(" -> ")}`);
    }
  }

  console.log("");

  if (boundaryViolations.length === 0) {
    console.log("Boundary violations: none");
  } else {
    console.log(`Boundary violations: ${boundaryViolations.length}`);
    for (const violation of boundaryViolations) {
      console.log(`- ${violation.file} imports ${violation.import} (${violation.rule})`);
    }
  }

  console.log("");

  if (legacyDirectoryViolations.length === 0) {
    console.log("Legacy root directories: none");
  } else {
    console.log(`Legacy root directories: ${legacyDirectoryViolations.length}`);
    for (const dir of legacyDirectoryViolations) {
      console.log(`- ${dir}`);
    }
  }

  console.log("");

  if (unregistered.length === 0) {
    console.log("Unregistered public tool factories: none");
  } else {
    console.log(`Unregistered public tool factories: ${unregistered.length}`);
    for (const factory of unregistered.sort()) {
      console.log(`- ${factory}`);
    }
  }

  if (
    warnOnly &&
    (
      cycles.length > 0 ||
      boundaryViolations.length > 0 ||
      legacyDirectoryViolations.length > 0 ||
      unregistered.length > 0
    )
  ) {
    console.log("");
    console.log("Warn-only mode: findings reported without failing the command.");
  }
}

function relative(file) {
  return path.relative(root, file);
}

function normalize(file) {
  return path.resolve(file);
}
