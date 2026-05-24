import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  collectInteractiveTitleSelections,
  collectTitleSearchResponses,
  formatSelectedTitleSearchResults,
  shouldUseInteractiveSearch,
  splitDelimitedValues
} from "../src/cli.js";
import type { SearchResponse, SearchResult } from "../src/types.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("cli help", () => {
  it.each(["--help", "-h"])("prints root help with %s", (flag) => {
    const result = runCli([flag]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: search-bibtex [options] [command]");
    expect(result.stdout).toContain("-h, --help");
    expect(result.stdout).toContain("config-template");
    expect(result.stdout).toContain("search-title");
  });

  it.each(["select", "update"])("prints subcommand help for %s", (command) => {
    const result = runCli([command, "--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Usage: search-bibtex ${command} [options]`);
    expect(result.stdout).toContain("--config <path>");
    expect(result.stdout).toContain("-h, --help");
  });

  it("prints timeout help for search", () => {
    const result = runCli(["search", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--config <path>");
    expect(result.stdout).toContain("--parallel");
    expect(result.stdout).toContain("--timeout <seconds>");
  });

  it("prints a TOML config template", () => {
    const result = runCli(["config-template"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("[search]");
    expect(result.stdout).toContain("source_priority");
  });

  it("prints search-title help with delimiter guidance", () => {
    const result = runCli(["search-title", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--delimiter <delimiter>");
    expect(result.stdout).toContain("Default: ';'");
    expect(result.stdout).toContain("stdin");
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

describe("title splitting", () => {
  it("splits semicolon-delimited title strings by default", () => {
    expect(splitDelimitedValues("Paper A; Paper B;Paper C")).toEqual([
      "Paper A",
      "Paper B",
      "Paper C"
    ]);
  });
});

describe("title search workflow", () => {
  it("searches and selects multiple titles sequentially", async () => {
    const first = makeResult("PagedAttention", "@article{paged}");
    const second = makeResult("DistServe", "@article{dist}");
    const events: string[] = [];

    const selected = await collectInteractiveTitleSelections(
      ["PagedAttention", "DistServe"],
      async (title, index) => {
        events.push(`search:${index}:${title}`);
        return makeResponse(title, [index === 0 ? first : second]);
      },
      async (results, options) => {
        events.push(`select:${results[0].title}:${options.sourceErrors?.length ?? 0}`);
        return results[0];
      }
    );

    expect(events).toEqual([
      "search:0:PagedAttention",
      "select:PagedAttention:0",
      "search:1:DistServe",
      "select:DistServe:0"
    ]);
    expect(selected).toEqual([first, second]);
  });

  it("returns undefined when a title selection is cancelled", async () => {
    const selected = await collectInteractiveTitleSelections(
      ["PagedAttention"],
      async (title) => makeResponse(title, [makeResult(title, "@article{paged}")]),
      async () => undefined
    );

    expect(selected).toBeUndefined();
  });

  it("collects non-interactive title responses in input order", async () => {
    const responses = await collectTitleSearchResponses(
      ["PagedAttention", "DistServe"],
      async (title, index) => makeResponse(title, [makeResult(`${index}:${title}`, `@article{${index}}`)])
    );

    expect(responses.map((entry) => entry.title)).toEqual(["PagedAttention", "DistServe"]);
    expect(responses[0].response.results[0].bibtex).toBe("@article{0}");
    expect(responses[1].response.results[0].bibtex).toBe("@article{1}");
  });

  it("formats selected title results as final BibTeX output", () => {
    expect(formatSelectedTitleSearchResults([
      makeResult("PagedAttention", "@article{paged}"),
      makeResult("DistServe", "@inproceedings{dist}")
    ])).toBe("@article{paged}\n\n@inproceedings{dist}\n");
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

function makeResponse(title: string, results: SearchResult[]): SearchResponse {
  return {
    metadata: {
      filePath: `stdin:title:${title}`,
      pageCount: 0,
      title,
      authors: [],
      textSample: title
    },
    queries: [{
      kind: "title",
      value: title,
      confidence: 0.78
    }],
    results,
    sourceErrors: []
  };
}

function makeResult(title: string, bibtex: string): SearchResult {
  return {
    source: "dblp",
    title,
    authors: ["Example Author"],
    year: 2024,
    venue: "OSDI",
    matchedQuery: "title",
    score: 1,
    scoreBreakdown: {
      title: 1,
      author: 0,
      year: 0,
      identifier: 0,
      source: 1
    },
    bibtex
  };
}
