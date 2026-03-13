#!/usr/bin/env node
/**
 * main.ts — Entry point for the search-bibtex CLI.
 *
 * Delegates everything to `main()` in cli.ts and converts unhandled
 * rejections into exit-code-1 errors on stderr.
 */
import { main } from "./cli.js";

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
