#!/usr/bin/env node
import { Command } from "commander";
import { writeFile } from "node:fs/promises";

import { refineBibtexFile } from "./bibtex-file.js";
import {
  defaultConfigToml,
  defaultSearchPreferences,
  loadResolvedAppConfig,
  type ResolvedAppConfig
} from "./config.js";
import { buildMetadataCandidate, generateSearchQueries } from "./metadata.js";
import { extractPdfDocumentSnapshot } from "./pdf.js";
import { searchBibtexFromPdf } from "./search.js";
import {
  formatSelectedResult,
  runInteractiveSelection,
  selectedResultByIndex
} from "./selection.js";
import { builtinPaperSources, type PaperSource, type SearchPreferences, type SortWeights } from "./types.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("search-bibtex")
    .description("Extract paper PDF metadata, search bibliographic sources, and choose a BibTeX entry.")
    .helpOption("-h, --help", "Display help for command.")
    .version("0.1.0");

  program
    .command("config-defaults")
    .description("Print the default search ranking preferences as JSON.")
    .action(() => {
      process.stdout.write(`${JSON.stringify(defaultSearchPreferences, null, 2)}\n`);
    });

  program
    .command("config-template")
    .description("Print a TOML configuration template with the built-in defaults.")
    .action(() => {
      process.stdout.write(`${defaultConfigToml}\n`);
    });

  program
    .command("metadata")
    .description("Extract local PDF metadata and generate search queries.")
    .argument("<pdf>", "Path to a local PDF file.")
    .option("-p, --pages <count>", "Number of leading pages to inspect.", parsePositiveInteger, 2)
    .action(async (pdf: string, options: { pages: number }) => {
      const snapshot = await extractPdfDocumentSnapshot(pdf, { pages: options.pages });
      const metadata = buildMetadataCandidate(snapshot);
      const queries = generateSearchQueries(metadata);

      process.stdout.write(`${JSON.stringify({ metadata, queries }, null, 2)}\n`);
    });

  program
    .command("search")
    .description("Extract local PDF metadata, search bibliographic sources, rank candidates, and choose interactively in a TTY.")
    .argument("<pdf>", "Path to a local PDF file.")
    .option("-c, --config <path>", "Path to a config.toml file.")
    .option("-p, --pages <count>", "Number of leading pages to inspect.", parsePositiveInteger, 2)
    .option("-l, --limit <count>", "Maximum ranked BibTeX candidates to return.", parsePositiveInteger)
    .option(
      "--source-priority <sources>",
      "Comma-separated source priority, e.g. dblp,arxiv,crossref,openalex,doi."
    )
    .option(
      "--weights <weights>",
      "Comma-separated scoring weights, e.g. title=0.5,author=0.2,year=0.1,identifier=0.15,source=0.05."
    )
    .option("--parallel", "Search sources in parallel.")
    .option("--no-parallel", "Search sources serially.")
    .option("-t, --timeout <seconds>", "Maximum search stage duration in seconds.", parsePositiveInteger)
    .action(async (pdf: string, options: SearchCommandOptions) => {
      const config = await loadResolvedAppConfig({ configPath: options.config });
      const response = await searchBibtexFromPdf(pdf, {
        pages: options.pages,
        parallel: options.parallel ?? config.search.parallel,
        timeoutMs: (options.timeout ?? config.search.timeoutSeconds) * 1000,
        preferences: buildSearchPreferences(options, config),
        customSources: config.sources,
        onProgress: createSearchProgressReporter("search")
      });

      if (response.results.length === 0 && response.sourceErrors.length > 0) {
        throw new Error(`Search returned no results. Source errors: ${JSON.stringify(response.sourceErrors)}`);
      }

      if (shouldUseInteractiveSearch() && response.results.length > 1) {
        const selected = await runInteractiveSelection(response.results, { sourceErrors: response.sourceErrors });
        if (!selected) {
          return;
        }
        return;
      }

      process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    });

  program
    .command("update")
    .description("Refresh an existing BibTeX file by fuzzy-matching titles and preserving citation keys.")
    .argument("<bibtex>", "Path to a local BibTeX file.")
    .option("-c, --config <path>", "Path to a config.toml file.")
    .option("-o, --output <path>", "Write the updated BibTeX to a file.")
    .option("-i, --in-place", "Overwrite the input BibTeX file.")
    .option("-l, --limit <count>", "Maximum ranked BibTeX candidates to return.", parsePositiveInteger)
    .option(
      "--source-priority <sources>",
      "Comma-separated source priority, e.g. dblp,arxiv,crossref,openalex,doi."
    )
    .option(
      "--weights <weights>",
      "Comma-separated scoring weights, e.g. title=0.5,author=0.2,year=0.1,identifier=0.15,source=0.05."
    )
    .option("--parallel", "Search sources in parallel.")
    .option("--no-parallel", "Search sources serially.")
    .option("-t, --timeout <seconds>", "Maximum search stage duration in seconds.", parsePositiveInteger)
    .action(async (bibtexPath: string, options: UpdateBibtexCommandOptions) => {
      if (options.output && options.inPlace) {
        throw new Error("Use either --output or --in-place, not both.");
      }

      const config = await loadResolvedAppConfig({ configPath: options.config });
      const result = await refineBibtexFile(bibtexPath, {
        preferences: buildSearchPreferences(options, config),
        customSources: config.sources,
        parallel: options.parallel ?? config.search.parallel,
        timeoutMs: (options.timeout ?? config.search.timeoutSeconds) * 1000
      });

      if (result.sourceErrors.length > 0) {
        process.stderr.write(`${JSON.stringify({ sourceErrors: result.sourceErrors }, null, 2)}\n`);
      }

      if (options.output) {
        await writeFile(options.output, result.text);
        return;
      }

      if (options.inPlace) {
        await writeFile(bibtexPath, result.text);
        return;
      }

      process.stdout.write(result.text);
    });

  program
    .command("select")
    .description("Search a local PDF and choose one BibTeX candidate interactively or by index.")
    .argument("<pdf>", "Path to a local PDF file.")
    .option("-c, --config <path>", "Path to a config.toml file.")
    .option("-p, --pages <count>", "Number of leading pages to inspect.", parsePositiveInteger, 2)
    .option("-l, --limit <count>", "Maximum ranked BibTeX candidates to return.", parsePositiveInteger)
    .option("--select-index <index>", "Choose a result by 0-based index without interactive UI.", parseNonNegativeInteger)
    .option(
      "--format <format>",
      "Output format for the selected result.",
      parseOutputFormat,
      "bibtex"
    )
    .option(
      "--source-priority <sources>",
      "Comma-separated source priority, e.g. dblp,arxiv,crossref,openalex,doi."
    )
    .option(
      "--weights <weights>",
      "Comma-separated scoring weights, e.g. title=0.5,author=0.2,year=0.1,identifier=0.15,source=0.05."
    )
    .option("--parallel", "Search sources in parallel.")
    .option("--no-parallel", "Search sources serially.")
    .option("-t, --timeout <seconds>", "Maximum search stage duration in seconds.", parsePositiveInteger)
    .action(async (pdf: string, options: SelectCommandOptions) => {
      const config = await loadResolvedAppConfig({ configPath: options.config });
      const response = await searchBibtexFromPdf(pdf, {
        pages: options.pages,
        parallel: options.parallel ?? config.search.parallel,
        timeoutMs: (options.timeout ?? config.search.timeoutSeconds) * 1000,
        preferences: buildSearchPreferences(options, config),
        customSources: config.sources,
        onProgress: createSearchProgressReporter("select")
      });

      if (response.sourceErrors.length > 0) {
        process.stderr.write(`${JSON.stringify({ sourceErrors: response.sourceErrors }, null, 2)}\n`);
      }

      const selected = options.selectIndex !== undefined
        ? selectedResultByIndex(response.results, options.selectIndex)
        : await runInteractiveSelection(response.results, { sourceErrors: response.sourceErrors });

      if (!selected) {
        return;
      }

      if (options.selectIndex === undefined) {
        return;
      }

      process.stdout.write(formatSelectedResult(selected, options.format));
    });

  return program;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got ${value}`);
  }
  return parsed;
}

interface SearchCommandOptions {
  config?: string;
  pages: number;
  limit?: number;
  sourcePriority?: string;
  weights?: string;
  parallel?: boolean;
  timeout?: number;
}

interface SelectCommandOptions extends SearchCommandOptions {
  selectIndex?: number;
  format: "bibtex" | "json";
}

interface UpdateBibtexCommandOptions extends SearchCommandOptions {
  output?: string;
  inPlace?: boolean;
}

function buildSearchPreferences(options: SearchCommandOptions, config: ResolvedAppConfig): SearchPreferences {
  const knownSources = new Set<PaperSource>([
    ...builtinPaperSources,
    ...config.sources.map((source) => source.name)
  ]);

  return {
    limit: options.limit ?? config.search.limit,
    sourcePriority: options.sourcePriority ? parseSourcePriority(options.sourcePriority, knownSources) : config.search.sourcePriority,
    weights: options.weights
      ? {
        ...config.search.weights,
        ...parseWeights(options.weights)
      }
      : config.search.weights
  };
}

function parseSourcePriority(value: string, knownSources: ReadonlySet<PaperSource>): PaperSource[] {
  const sources = value.split(",").map((source) => source.trim()).filter(Boolean);
  const unknown = sources.filter((source) => !knownSources.has(source as PaperSource));
  if (unknown.length > 0) {
    throw new Error(`Unknown source(s): ${unknown.join(", ")}`);
  }
  return sources as PaperSource[];
}

function parseWeights(value: string): Partial<SortWeights> {
  const weights: Partial<SortWeights> = {};
  const knownWeights = new Set(Object.keys(defaultSearchPreferences.weights));

  for (const pair of value.split(",")) {
    const [key, rawNumber] = pair.split("=");
    if (!key || rawNumber === undefined) {
      throw new Error(`Invalid weight expression: ${pair}`);
    }
    if (!knownWeights.has(key)) {
      throw new Error(`Unknown weight: ${key}`);
    }
    const number = Number.parseFloat(rawNumber);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`Invalid weight value for ${key}: ${rawNumber}`);
    }
    weights[key as keyof SortWeights] = number;
  }

  return weights;
}

function parseOutputFormat(value: string): "bibtex" | "json" {
  if (value !== "bibtex" && value !== "json") {
    throw new Error(`Unknown output format: ${value}`);
  }
  return value;
}

export function shouldUseInteractiveSearch(
  stdinIsTTY: boolean | undefined = process.stdin.isTTY,
  stdoutIsTTY: boolean | undefined = process.stdout.isTTY
): boolean {
  return Boolean(stdinIsTTY && stdoutIsTTY);
}

export async function main(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

function createSearchProgressReporter(prefix: string): (event: { completed: number; total: number; completedSources: PaperSource[]; failedSources: PaperSource[]; }) => void {
  if (!process.stderr.isTTY) {
    return () => {};
  }

  return (event) => {
    if (event.completed === 0) {
      process.stderr.write(`${prefix}: searching ${event.total} source channels...\n`);
      return;
    }

    const completed = event.completedSources.length > 0 ? `completed [${event.completedSources.join(", ")}]` : "completed []";
    const failed = event.failedSources.length > 0 ? ` failed [${event.failedSources.join(", ")}]` : "";
    process.stderr.write(`${prefix}: ${event.completed}/${event.total} source channels ${completed}${failed}\n`);
  };
}
