import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import type { Plugin } from "esbuild";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distPkgDir = path.join(projectDir, "dist-pkg");
const distBinDir = path.join(projectDir, "dist-bin");
const bundleFile = path.join(distPkgDir, "search-bibtex.cjs");

const allTargets = [
  "node20-linux-x64",
  "node20-linux-arm64",
  "node20-macos-x64",
  "node20-macos-arm64",
  "node20-win-x64",
  "node20-win-arm64"
] as const;

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "all";
  if (mode !== "bundle" && mode !== "all" && mode !== "current") {
    throw new Error(`Unknown binary build mode: ${mode}. Expected bundle, current, or all.`);
  }

  if (mode === "bundle" || mode === "all" || mode === "current") {
    await buildBundle();
  }

  if (mode === "bundle") {
    process.stdout.write(`${JSON.stringify({ bundleFile }, null, 2)}\n`);
    return;
  }

  const targets = mode === "current" ? [currentTarget()] : allTargets;
  await buildBinaries(targets);
  process.stdout.write(`${JSON.stringify({ targets, distBinDir }, null, 2)}\n`);
}

async function buildBundle(): Promise<void> {
  await mkdir(distPkgDir, { recursive: true });
  await build({
    entryPoints: [path.join(projectDir, "src", "cli.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: bundleFile,
    plugins: [pdfParseLibAlias()]
  });
}

function pdfParseLibAlias(): Plugin {
  return {
    name: "pdf-parse-lib-alias",
    setup(buildContext) {
      buildContext.onResolve({ filter: /^pdf-parse\/lib\/pdf-parse\.js$/ }, () => ({
        path: path.join(projectDir, "node_modules", "pdf-parse", "lib", "pdf-parse.js")
      }));
    }
  };
}

async function buildBinaries(targets: readonly string[]): Promise<void> {
  await mkdir(distBinDir, { recursive: true });
  const failures: string[] = [];

  for (const target of targets) {
    const output = path.join(distBinDir, outputNameForTarget(target));
    const result = spawnSync(pnpmCommand(), [
      "exec",
      "pkg",
      bundleFile,
      "--targets",
      target,
      "--output",
      output,
      "--compress",
      "GZip",
      "--public",
      "--no-bytecode"
    ], {
      cwd: projectDir,
      stdio: "inherit"
    });

    if (result.status !== 0) {
      failures.push(target);
    }
  }

  if (failures.length > 0) {
    throw new Error(`pkg failed for targets: ${failures.join(", ")}`);
  }
}

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function currentTarget(): string {
  const platform = normalizePlatform(process.platform);
  const arch = normalizeArch(process.arch);
  return `node20-${platform}-${arch}`;
}

function normalizePlatform(value: string): string {
  if (value === "darwin") {
    return "macos";
  }
  if (value === "win32") {
    return "win";
  }
  if (value === "linux") {
    return value;
  }
  throw new Error(`Unsupported platform for binary packaging: ${value}`);
}

function normalizeArch(value: string): string {
  if (value === "x64" || value === "arm64") {
    return value;
  }
  throw new Error(`Unsupported architecture for binary packaging: ${value}`);
}

function outputNameForTarget(target: string): string {
  const [, platform, arch] = target.split("-");
  if (!platform || !arch) {
    throw new Error(`Invalid pkg target: ${target}`);
  }
  return `search-bibtex-${platform}-${arch}${platform === "win" ? ".exe" : ""}`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
