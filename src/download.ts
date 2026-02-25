import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import { fetchJson, type FetchLike } from "./http.js";
import type { SearchResult } from "./types.js";

const USER_AGENT = "search-bibtex/0.1 (mailto:codex@local)";

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

/**
 * Resolves a PDF download URL for a search result.
 *
 * Strategy (in priority order):
 * 1. arXiv direct PDF if arxivId is present
 * 2. Semantic Scholar open-access PDF via API
 * 3. Direct URL if it ends with .pdf
 */
export async function resolvePdfUrl(
  result: SearchResult,
  fetcher: FetchLike = fetch
): Promise<string | undefined> {
  if (result.arxivId) {
    return `https://arxiv.org/pdf/${result.arxivId}.pdf`;
  }

  try {
    const ssUrl = result.doi
      ? `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(result.doi)}?fields=openAccessPdf`
      : result.sourceId
        ? `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(result.sourceId)}?fields=openAccessPdf`
        : undefined;

    if (ssUrl) {
      const data = await fetchJson<{ openAccessPdf?: { url?: string } }>(fetcher, ssUrl);
      if (data.openAccessPdf?.url) {
        return data.openAccessPdf.url;
      }
    }
  } catch {
    // Semantic Scholar lookup is best-effort; fall through on failure
  }

  if (result.url?.endsWith(".pdf")) {
    return result.url;
  }

  return undefined;
}

/**
 * Downloads a file from a URL and writes it to the given destination path.
 */
export async function downloadFile(
  url: string,
  destPath: string,
  fetcher: FetchLike = fetch
): Promise<void> {
  const response = await fetcher(url, {
    headers: {
      "User-Agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destPath, buffer);
}

/**
 * Downloads the PDF for a search result to the given output directory.
 *
 * Resolves a PDF URL, ensures the output directory exists, downloads the file,
 * and returns the path to the saved file.
 */
export async function downloadPdfForResult(
  result: SearchResult,
  outputDir: string,
  fetcher: FetchLike = fetch
): Promise<string> {
  const pdfUrl = await resolvePdfUrl(result, fetcher);
  if (!pdfUrl) {
    throw new Error(`No PDF URL found for "${result.title}"`);
  }

  await ensureDir(outputDir);
  const filename = buildPdfFilename(result);
  const destPath = nodePath.join(outputDir, filename);
  await downloadFile(pdfUrl, destPath, fetcher);
  return destPath;
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}
