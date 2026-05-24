#!/usr/bin/env node
import { Command } from "commander";

import { defaultSearchPreferences } from "./config.js";
import { buildMetadataCandidate, generateSearchQueries } from "./metadata.js";
import { extractPdfDocumentSnapshot } from "./pdf.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("search-bibtex")
    .description("Extract paper PDF metadata, search bibliographic sources, and choose a BibTeX entry.")
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

  return program;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}

export async function main(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
