#!/usr/bin/env node
/**
 * CLI entry point for search-bibtex.
 *
 * Defines the Commander-based command-line interface with subcommands for metadata extraction,
 * bibliographic search, BibTeX file refinement, and interactive result selection from PDF or
 * title inputs.
 *
 * @module cli
 */
import { Command } from "commander";
import { writeFile } from "node:fs/promises";

import {
  KEEP_CURRENT_SELECTION_SOURCE,
  refineBibtexFile,
  type BibtexRefinementProgressEvent,
  type BibtexRefinementSelectionContext
} from "./bibtex-file.js";
import {
  defaultConfigToml,
  defaultSearchPreferences,
  loadResolvedAppConfig,
  type ResolvedAppConfig
} from "./config.js";
import { formatBibtexText } from "./bibtex.js";
import { downloadPdfForResult, resolveDefaultDownloadDir } from "./download.js";
import { buildMetadataCandidate, buildTitleMetadataCandidate, generateSearchQueries } from "./metadata.js";
import { extractPdfDocumentSnapshot } from "./pdf.js";
import { searchBibtex, searchBibtexFromPdf } from "./search.js";
import {
  formatSelectedResult,
  runInteractiveSelection,
  selectedResultByIndex
} from "./selection.js";
import {
  builtinPaperSources,
  type PaperSource,
  type SearchPreferences,
  type SearchResponse,
  type SearchResult,
  type SearchSourceError,
  type SortWeights
} from "./types.js";

/**
 * Build and return the Commander program with all subcommands registered.
 *
 * Subcommands: {@code config-defaults}, {@code config-template}, {@code metadata},
 * {@code search}, {@code update}, {@code select}, {@code search-title}.
 *
 * @returns The configured Commander instance.
 */
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
      const progress = createBibtexUpdateProgressReporter();
      let result: Awaited<ReturnType<typeof refineBibtexFile>> | undefined;

      try {
        result = await refineBibtexFile(bibtexPath, {
          preferences: buildSearchPreferences(options, config),
          customSources: config.sources,
          parallel: options.parallel ?? config.search.parallel,
          timeoutMs: (options.timeout ?? config.search.timeoutSeconds) * 1000,
          selectResult: shouldUseInteractiveSearch()
            ? async (context) => {
                return await runInteractiveSelection(
                  [buildKeepCurrentSelectionResult(context), ...context.response.results],
                  { sourceErrors: context.response.sourceErrors }
                );
              }
            : undefined,
          onProgress: progress.report
        });
      } finally {
        progress.finish();
      }

      if (!result) {
        throw new Error("BibTeX update did not produce a result.");
      }

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

  program
    .command("search-title")
    .description("Search bibliographic sources from title strings instead of PDFs. Multiple titles in one input are split by ';' by default, and stdin is accepted when no title is passed.")
    .argument("[titles...]", "Paper title string(s), or '-' to read from stdin.")
    .option("-c, --config <path>", "Path to a config.toml file.")
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
    .option("-d, --delimiter <delimiter>", "Delimiter for multiple title strings in one input. Default: ';'.", ";")
    .option("--download", "Download the PDF of the selected (or top-ranked) result.")
    .option("--download-dir <path>", "Directory to save downloaded PDFs. Default: ~/Downloads/search-bibtex/.")
    .action(async (titles: string[] | undefined, options: TitleSearchCommandOptions) => {
      const config = await loadResolvedAppConfig({ configPath: options.config });
      const titleInputs = await collectTitleInputs(titles ?? [], options.delimiter);
      if (titleInputs.length === 0) {
        throw new Error("Provide at least one title string or pipe title text on stdin.");
      }

      if (titleInputs.length === 1) {
        const response = await searchBibtex(buildTitleMetadataCandidate(titleInputs[0]), {
          parallel: options.parallel ?? config.search.parallel,
          timeoutMs: (options.timeout ?? config.search.timeoutSeconds) * 1000,
          preferences: buildSearchPreferences(options, config),
          customSources: config.sources,
          onProgress: createSearchProgressReporter("search-title")
        });

        if (response.results.length === 0 && response.sourceErrors.length > 0) {
          throw new Error(`Search returned no results for title ${titleInputs[0]}. Source errors: ${JSON.stringify(response.sourceErrors)}`);
        }

        if (shouldUseInteractiveSearch() && response.results.length > 1) {
          const selected = await runInteractiveSelection(response.results, { sourceErrors: response.sourceErrors });
          if (!selected) {
            return;
          }
          if (options.download) {
            const outputDir = options.downloadDir ?? resolveDefaultDownloadDir();
            const savedPath = await downloadPdfForResult(selected, outputDir);
            process.stderr.write(`Downloaded: ${savedPath}\n`);
          }
          return;
        }

        if (options.download && response.results.length > 0) {
          const outputDir = options.downloadDir ?? resolveDefaultDownloadDir();
          const savedPath = await downloadPdfForResult(response.results[0], outputDir);
          process.stderr.write(`Downloaded: ${savedPath}\n`);
        }

        process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
        return;
      }

      const runTitleSearch: TitleSearchRunner = async (title, index) => {
        return await searchBibtex(buildTitleMetadataCandidate(title, `stdin:title:${index + 1}`), {
          parallel: options.parallel ?? config.search.parallel,
          timeoutMs: (options.timeout ?? config.search.timeoutSeconds) * 1000,
          preferences: buildSearchPreferences(options, config),
          customSources: config.sources,
          onProgress: createSearchProgressReporter(`search-title[${index + 1}]`)
        });
      };

      if (shouldUseInteractiveSearch()) {
        const selectedResults = await collectInteractiveTitleSelections(titleInputs, runTitleSearch);
        if (!selectedResults) {
          return;
        }
        process.stdout.write(formatSelectedTitleSearchResults(selectedResults));
        if (options.download) {
          await downloadSelectedResults(selectedResults, options.downloadDir);
        }
        return;
      }

      const responses = await collectTitleSearchResponses(titleInputs, runTitleSearch);
      process.stdout.write(`${JSON.stringify({ titles: responses }, null, 2)}\n`);
      if (options.download) {
        const topResults = responses
          .map((entry) => entry.response.results[0])
          .filter((result): result is SearchResult => result !== undefined);
        await downloadSelectedResults(topResults, options.downloadDir);
      }
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

/**
 * Split a string by a delimiter into trimmed, non-empty substrings.
 *
 * @param value - The string to split.
 * @param delimiter - The delimiter character or string. Defaults to {@code ";"}.
 * @returns An array of trimmed, non-empty segments.
 */
export function splitDelimitedValues(value: string, delimiter = ";"): string[] {
  if (delimiter === "") {
    throw new Error("Delimiter cannot be empty.");
  }
  return value
    .split(delimiter)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

async function collectTitleInputs(values: string[], delimiter: string): Promise<string[]> {
  const stdinText = values.length === 0 && !process.stdin.isTTY
    ? await readStdinText()
    : values.includes("-")
      ? await readStdinText()
      : undefined;

  const resolvedValues = values.length === 0 && stdinText !== undefined
    ? [stdinText]
    : values.map((value) => (value === "-" && stdinText !== undefined ? stdinText : value));

  return resolvedValues.flatMap((value) => splitDelimitedValues(value, delimiter));
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

interface SearchExecutionOptions {
  config?: string;
  limit?: number;
  sourcePriority?: string;
  weights?: string;
  parallel?: boolean;
  timeout?: number;
}

interface SearchCommandOptions extends SearchExecutionOptions {
  pages: number;
}

interface SelectCommandOptions extends SearchCommandOptions {
  selectIndex?: number;
  format: "bibtex" | "json";
}

interface UpdateBibtexCommandOptions extends SearchExecutionOptions {
  output?: string;
  inPlace?: boolean;
}

interface TitleSearchCommandOptions extends SearchExecutionOptions {
  delimiter: string;
  download?: boolean;
  downloadDir?: string;
}

/**
 * A search response paired with the original title string that produced it.
 */
export interface TitleSearchResponseEntry {
  title: string;
  response: SearchResponse;
}

export type TitleSearchRunner = (title: string, index: number) => Promise<SearchResponse>;
export type TitleSelectionRunner = (
  results: SearchResult[],
  options: { sourceErrors?: SearchSourceError[] }
) => Promise<SearchResult | undefined>;

export async function collectTitleSearchResponses(
  titleInputs: string[],
  search: TitleSearchRunner
): Promise<TitleSearchResponseEntry[]> {
  const responses: TitleSearchResponseEntry[] = [];
  for (const [index, title] of titleInputs.entries()) {
    const response = await search(title, index);
    throwIfTitleSearchFailed(title, response);
    responses.push({ title, response });
  }
  return responses;
}

export async function collectInteractiveTitleSelections(
  titleInputs: string[],
  search: TitleSearchRunner,
  select: TitleSelectionRunner = runInteractiveSelection
): Promise<SearchResult[] | undefined> {
  const selectedResults: SearchResult[] = [];
  for (const [index, title] of titleInputs.entries()) {
    const response = await search(title, index);
    throwIfTitleSearchFailed(title, response);
    const selected = await select(response.results, { sourceErrors: response.sourceErrors });
    if (!selected) {
      return undefined;
    }
    selectedResults.push(selected);
  }
  return selectedResults;
}

export function formatSelectedTitleSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "";
  }
  return `${results.map((result) => formatSelectedResult(result, "bibtex").trimEnd()).join("\n\n")}\n`;
}

async function downloadSelectedResults(
  results: SearchResult[],
  downloadDir?: string
): Promise<void> {
  const outputDir = downloadDir ?? resolveDefaultDownloadDir();
  for (const result of results) {
    try {
      const savedPath = await downloadPdfForResult(result, outputDir);
      process.stderr.write(`Downloaded: ${savedPath}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Download failed for "${result.title}": ${message}\n`);
    }
  }
}

function buildSearchPreferences(options: SearchExecutionOptions, config: ResolvedAppConfig): SearchPreferences {
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

function throwIfTitleSearchFailed(title: string, response: SearchResponse): void {
  if (response.results.length === 0 && response.sourceErrors.length > 0) {
    throw new Error(`Search returned no results for title ${title}. Source errors: ${JSON.stringify(response.sourceErrors)}`);
  }
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

interface BibtexUpdateProgressReporter {
  report: (event: BibtexRefinementProgressEvent) => void;
  finish: () => void;
}

function createBibtexUpdateProgressReporter(): BibtexUpdateProgressReporter {
  if (!process.stderr.isTTY) {
    return {
      report: () => {},
      finish: () => {}
    };
  }

  let rendered = false;

  return {
    report(event) {
      const line = renderBibtexUpdateProgress(event, process.stderr.columns);
      process.stderr.write(`\r\x1b[2K${line}`);
      rendered = true;
    },
    finish() {
      if (!rendered) {
        return;
      }
      process.stderr.write("\r\x1b[2K\n");
      rendered = false;
    }
  };
}

export function buildKeepCurrentSelectionResult(
  context: BibtexRefinementSelectionContext
): SearchResult {
  return {
    source: KEEP_CURRENT_SELECTION_SOURCE,
    title: "Keep current format",
    authors: context.currentEntry.authors,
    year: context.currentEntry.year,
    doi: context.currentEntry.doi,
    arxivId: context.currentEntry.arxivId,
    venue: context.currentEntry.fields.journal ?? context.currentEntry.fields.booktitle,
    url: context.currentEntry.fields.url,
    matchedQuery: context.response.queries[0]?.kind ?? "title",
    score: 0,
    scoreBreakdown: {
      title: 0,
      author: 0,
      year: 0,
      identifier: 0,
      source: 0
    },
    bibtex: formatBibtexText(context.currentEntry.raw)
  };
}

function renderBibtexUpdateProgress(
  event: BibtexRefinementProgressEvent,
  columns?: number
): string {
  const bar = renderProgressBar(computeBibtexUpdateProgressRatio(event), 20);
  const counts = `${event.completed}/${Math.max(0, event.total)}`;
  const detail = renderBibtexUpdateProgressDetail(event);
  const base = `update ${bar} ${counts}`;

  if (!detail) {
    return base;
  }

  const available = typeof columns === "number" && columns > 0
    ? Math.max(0, columns - base.length - 1)
    : detail.length;
  const fittedDetail = truncateText(detail, available);
  return fittedDetail ? `${base} ${fittedDetail}` : base;
}

function computeBibtexUpdateProgressRatio(event: BibtexRefinementProgressEvent): number {
  if (event.total <= 0) {
    return 1;
  }

  if (event.current?.status === "searching" && event.searchProgress !== undefined) {
    const fraction = event.searchProgress.total > 0
      ? event.searchProgress.completed / event.searchProgress.total
      : 1;
    return Math.min(1, (event.completed + fraction) / event.total);
  }

  return Math.min(1, event.completed / event.total);
}

function renderBibtexUpdateProgressDetail(event: BibtexRefinementProgressEvent): string {
  if (!event.current) {
    return event.total <= 0 ? "done" : "starting";
  }

  const status = event.current.status === "awaiting-confirmation"
    ? "confirming"
    : event.current.status;
  const parts = [
    status,
    `#${event.current.index + 1}`,
    `"${event.current.title}"`
  ];

  if (event.current.status === "searching" && event.searchProgress !== undefined) {
    parts.push(`(${event.searchProgress.completed}/${event.searchProgress.total} sources)`);
  }

  return parts.join(" ");
}

function renderProgressBar(ratio: number, width: number): string {
  if (width <= 0) {
    return "[]";
  }

  const clamped = Math.min(1, Math.max(0, ratio));
  const filled = Math.floor(clamped * width);

  if (filled <= 0) {
    return `[>${" ".repeat(Math.max(0, width - 1))}]`;
  }

  if (filled >= width) {
    return `[${"=".repeat(width)}]`;
  }

  return `[${"=".repeat(filled)}>${" ".repeat(width - filled - 1)}]`;
}

function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }

  if (text.length <= maxLength) {
    return text.slice(0, maxLength);
  }

  if (maxLength === 1) {
    return "…";
  }
  return `${text.slice(0, maxLength - 1)}…`;
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
