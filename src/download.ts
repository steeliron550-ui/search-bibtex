import os from "node:os";
import nodePath from "node:path";

import { fetchJson, type FetchLike } from "./http.js";
import type { SearchResult } from "./types.js";

/**
 * Returns the default download directory for PDF files.
 */
export function resolveDefaultDownloadDir(): string {
  return nodePath.join(os.homedir(), "Downloads", "search-bibtex");
}

/**
 * Removes characters that are invalid in filenames across platforms.
 */
export function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Builds a PDF filename from a search result, e.g. "Paper Title (2024).pdf".
 */
export function buildPdfFilename(result: SearchResult): string {
  const title = sanitizeFilename(result.title);
  const year = result.year ? ` (${result.year})` : "";
  return `${title}${year}.pdf`;
}
