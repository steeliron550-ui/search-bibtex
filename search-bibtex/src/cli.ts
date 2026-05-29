#!/usr/bin/env node
import { Command } from "commander";

import { defaultSearchPreferences } from "./config.js";
import { buildMetadataCandidate, generateSearchQueries } from "./metadata.js";
import { extractPdfDocumentSnapshot } from "./pdf.js";
import { searchBibtexFromPdf } from "./search.js";
import {
  formatSelectedResult,
  runInteractiveSelection,
  selectedResultByIndex
} from "./selection.js";
import type { PaperSource, SortWeights } from "./types.js";

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
    .description("Extract local PDF metadata, search bibliographic sources, rank candidates, and fetch BibTeX.")
    .argument("<pdf>", "Path to a local PDF file.")
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
    .action(async (pdf: string, options: SearchCommandOptions) => {
      const response = await searchBibtexFromPdf(pdf, {
        pages: options.pages,
        preferences: {
          limit: options.limit,
          sourcePriority: options.sourcePriority ? parseSourcePriority(options.sourcePriority) : undefined,
          weights: options.weights ? parseWeights(options.weights) : undefined
        }
      });

      if (response.results.length === 0 && response.sourceErrors.length > 0) {
        throw new Error(`Search returned no results. Source errors: ${JSON.stringify(response.sourceErrors)}`);
      }

      process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    });

  program
    .command("select")
    .description("Search a local PDF and choose one BibTeX candidate interactively or by index.")
    .argument("<pdf>", "Path to a local PDF file.")
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
    .action(async (pdf: string, options: SelectCommandOptions) => {
      const response = await searchBibtexFromPdf(pdf, {
        pages: options.pages,
        preferences: {
          limit: options.limit,
          sourcePriority: options.sourcePriority ? parseSourcePriority(options.sourcePriority) : undefined,
          weights: options.weights ? parseWeights(options.weights) : undefined
        }
      });

      if (response.sourceErrors.length > 0) {
        process.stderr.write(`${JSON.stringify({ sourceErrors: response.sourceErrors }, null, 2)}\n`);
      }

      const selected = options.selectIndex !== undefined
        ? selectedResultByIndex(response.results, options.selectIndex)
        : await runInteractiveSelection(response.results, { sourceErrors: response.sourceErrors });

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
  pages: number;
  limit?: number;
  sourcePriority?: string;
  weights?: string;
}

interface SelectCommandOptions extends SearchCommandOptions {
  selectIndex?: number;
  format: "bibtex" | "json";
}

function parseSourcePriority(value: string): PaperSource[] {
  const sources = value.split(",").map((source) => source.trim()).filter(Boolean);
  const knownSources = new Set(defaultSearchPreferences.sourcePriority);
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

export async function main(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
