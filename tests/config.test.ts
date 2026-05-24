import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ConfigError,
  defaultSearchPreferences,
  loadConfig,
  parseConfigToml,
  resolveAppConfig
} from "../src/config.js";

describe("defaultSearchPreferences", () => {
  it("keeps source priorities and weights explicit", () => {
    expect(defaultSearchPreferences.sourcePriority).toEqual([
      "dblp",
      "arxiv",
      "crossref",
      "openalex",
      "doi",
      "semantic-scholar"
    ]);
    expect(defaultSearchPreferences.limit).toBeGreaterThan(0);
    expect(Object.values(defaultSearchPreferences.weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });
});

describe("config loading", () => {
  it("parses search defaults and custom source definitions", () => {
    const config = parseConfigToml(`
[search]
limit = 7
timeout_seconds = 12
parallel = false
source_priority = ["acm", "dblp"]

[search.weights]
title = 0.50
author = 0.20
year = 0.10
identifier = 0.15
source = 0.05

[[sources]]
name = "acm"
kind = "http-json"
enabled = true

[sources.search]
url = "https://example.test/search?query={title}&limit={limit}"

[sources.response]
items_path = "items"

[sources.response.fields]
title = "title"
authors = "authors"
year = "year"
doi = "doi"
arxiv_id = "arxiv"
venue = "venue"
url = "url"

[sources.bibtex]
strategy = "url"
url_template = "https://example.test/bibtex/{sourceId}"
accept = "application/x-bibtex"
`);

    const resolved = resolveAppConfig(config);

    expect(resolved.search).toMatchObject({
      limit: 7,
      timeoutSeconds: 12,
      timeoutMs: 12_000,
      parallel: false,
      sourcePriority: ["acm", "dblp"],
      weights: {
        title: 0.5,
        author: 0.2,
        year: 0.1,
        identifier: 0.15,
        source: 0.05
      }
    });
    expect(resolved.sources).toHaveLength(1);
    expect(resolved.sources[0]).toMatchObject({
      name: "acm",
      kind: "http-json",
      enabled: true,
      search: {
        url: "https://example.test/search?query={title}&limit={limit}"
      },
      response: {
        itemsPath: "items",
        fields: {
          title: "title",
          authors: "authors",
          year: "year",
          doi: "doi",
          arxivId: "arxiv",
          venue: "venue",
          url: "url"
        }
      },
      bibtex: {
        strategy: "url",
        urlTemplate: "https://example.test/bibtex/{sourceId}",
        accept: "application/x-bibtex"
      }
    });
  });

  it("uses built-in defaults when the default config path is missing", async () => {
    const homeDir = path.join(os.tmpdir(), `search-bibtex-home-${process.pid}-${Date.now()}`);
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);

    try {
      const loaded = await loadConfig();

      expect(loaded.configLoaded).toBe(false);
      expect(loaded.config).toEqual({});
      expect(loaded.configPath).toBe(path.join(homeDir, ".config", "search-bibtex", "config.toml"));
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects an explicit missing config file", async () => {
    await expect(loadConfig({ configPath: path.join(os.tmpdir(), "missing-search-bibtex-config.toml") }))
      .rejects
      .toBeInstanceOf(ConfigError);
  });
});
