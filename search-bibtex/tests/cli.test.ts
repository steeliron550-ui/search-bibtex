import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { shouldUseInteractiveSearch } from "../src/cli.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("cli help", () => {
  it.each(["--help", "-h"])("prints root help with %s", (flag) => {
    const result = runCli([flag]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: search-bibtex [options] [command]");
    expect(result.stdout).toContain("-h, --help");
  });

  it.each(["select", "update"])("prints subcommand help for %s", (command) => {
    const result = runCli([command, "--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Usage: search-bibtex ${command} [options]`);
    expect(result.stdout).toContain("-h, --help");
  });

  it("prints timeout help for search", () => {
    const result = runCli(["search", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--parallel");
    expect(result.stdout).toContain("--timeout <seconds>");
  });
});

describe("interactive search mode", () => {
  it("uses the interactive selector only when both stdio streams are ttys", () => {
    expect(shouldUseInteractiveSearch(true, true)).toBe(true);
    expect(shouldUseInteractiveSearch(true, false)).toBe(false);
    expect(shouldUseInteractiveSearch(false, true)).toBe(false);
    expect(shouldUseInteractiveSearch(undefined, true)).toBe(false);
  });
});

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(pnpmCommand(), ["exec", "tsx", "src/main.ts", ...args], {
    cwd: projectDir,
    encoding: "utf8"
  });
}

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}
