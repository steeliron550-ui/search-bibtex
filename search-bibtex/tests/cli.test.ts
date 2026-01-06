import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("cli help", () => {
  it.each(["--help", "-h"])("prints root help with %s", (flag) => {
    const result = runCli([flag]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: search-bibtex [options] [command]");
    expect(result.stdout).toContain("-h, --help");
  });

  it.each(["--help", "-h"])("prints subcommand help with %s", (flag) => {
    const result = runCli(["select", flag]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: search-bibtex select [options] <pdf>");
    expect(result.stdout).toContain("-h, --help");
  });
});

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(pnpmCommand(), ["exec", "tsx", "src/cli.ts", ...args], {
    cwd: projectDir,
    encoding: "utf8"
  });
}

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}
