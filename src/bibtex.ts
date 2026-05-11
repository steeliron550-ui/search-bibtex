/**
 * BibTeX fetching, generation, normalization, and formatting utilities.
 *
 * Supports resolving BibTeX records from DOI, DBLP, and local generation
 * when no external source is available. Also provides format-pretty-printing
 * of raw BibTeX text with syntax-aware parsing.
 *
 * @module bibtex
 */

import type { FetchLike, FetchRequestOptions } from "./http.js";
import { fetchText } from "./http.js";
import { normalizeWhitespace, stripArxivVersion } from "./metadata.js";
import type { SearchResult } from "./types.js";

/**
 * A structured bibliographic record that can be used to fetch or generate
 * a BibTeX entry.
 */
export interface BibtexRecord {
  source: SearchResult["source"];
  sourceId?: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  venue?: string;
  url?: string;
}

/**
 * Resolves a BibTeX string for the given record using the best available
 * strategy: DBLP fetch (when `source === "dblp"`), DOI content negotiation,
 * or local generation as a fallback.
 */
export async function fetchBibtexForRecord(
  record: BibtexRecord,
  fetcher: FetchLike,
  options: FetchRequestOptions = {}
): Promise<string> {
  if (record.source === "dblp" && record.sourceId) {
    return fetchDblpBibtex(record.sourceId, fetcher, options);
  }

  if (record.doi) {
    return fetchDoiBibtex(record.doi, fetcher, options);
  }

  return generateBibtex(record);
}

/**
 * Fetches a BibTeX entry from doi.org via HTTP content negotiation
 * (`Accept: application/x-bibtex`) and returns the normalized result.
 */
export async function fetchDoiBibtex(
  doi: string,
  fetcher: FetchLike,
  options: FetchRequestOptions = {}
): Promise<string> {
  const normalizedDoi = normalizeDoi(doi);
  return normalizeBibtex(
    await fetchText(fetcher, `https://doi.org/${encodeURIComponent(normalizedDoi)}`, "application/x-bibtex", options)
  );
}

/**
 * Fetches a BibTeX entry from DBLP's `/rec/{key}.bib` endpoint using the
 * given DBLP source identifier (URL or plain key).
 */
export async function fetchDblpBibtex(
  sourceId: string,
  fetcher: FetchLike,
  options: FetchRequestOptions = {}
): Promise<string> {
  const key = sourceId.replace(/^https:\/\/dblp\.org\/rec\//, "").replace(/\.bib$/i, "");
  return normalizeBibtex(
    await fetchText(fetcher, `https://dblp.org/rec/${key}.bib`, "application/x-bibtex", options)
  );
}

/**
 * Generates a BibTeX entry string from a {@link BibtexRecord} in the
 * local/default format. Uses `@article` when an arXiv ID is present,
 * otherwise `@misc`.
 */
export function generateBibtex(record: BibtexRecord): string {
  const fields: string[] = [
    `  title = {${escapeBibtexValue(record.title)}}`,
    `  author = {${record.authors.map(escapeBibtexValue).join(" and ")}}`
  ];

  if (record.year) {
    fields.push(`  year = {${record.year}}`);
  }
  if (record.venue) {
    fields.push(`  journal = {${escapeBibtexValue(record.venue)}}`);
  }
  if (record.doi) {
    fields.push(`  doi = {${normalizeDoi(record.doi)}}`);
  }
  if (record.arxivId) {
    fields.push(`  eprint = {${stripArxivVersion(record.arxivId)}}`);
    fields.push("  archivePrefix = {arXiv}");
  }
  if (record.url) {
    fields.push(`  url = {${record.url}}`);
  }

  return `@${record.arxivId ? "article" : "misc"}{${citationKey(record)},\n${fields.join(",\n")}\n}`;
}

/**
 * Normalizes a DOI string by stripping URL prefixes (`https://doi.org/`,
 * `dx.doi.org/`) and the `doi:` scheme, then lowercasing the result.
 */
export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase();
}

/** Normalizes a raw BibTeX string: trims whitespace and converts CRLF to LF. */
export function normalizeBibtex(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

export function formatBibtexText(value: string): string {
  const normalized = normalizeBibtex(value);
  const parsed = parseBibtexLikeText(normalized);
  if (!parsed || !parsed.citationKey || parsed.fields.length === 0) {
    return normalized;
  }

  const lines = [`@${parsed.entryType}{${parsed.citationKey},`];
  for (const [name, fieldValue] of parsed.fields) {
    lines.push(`  ${name} = ${fieldValue},`);
  }
  lines.push("}");
  return lines.join("\n");
}

function citationKey(record: BibtexRecord): string {
  const firstAuthor = record.authors[0]?.split(/\s+/).at(-1) ?? "paper";
  const firstTitleWord = record.title.match(/[A-Za-z0-9]+/)?.[0] ?? "work";
  const year = record.year ? String(record.year) : "nd";
  return `${firstAuthor}${year}${firstTitleWord}`.replace(/[^A-Za-z0-9:_-]/g, "");
}

function escapeBibtexValue(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " ")).replace(/[{}]/g, "");
}

function parseBibtexLikeText(value: string): { entryType: string; citationKey?: string; fields: Array<[string, string]> } | undefined {
  const header = value.match(/^@([A-Za-z][A-Za-z0-9_-]*)\s*([({])/s);
  if (!header) {
    return undefined;
  }

  const entryType = header[1];
  const body = value.slice(header[0].length, value.length - 1);
  const separatorIndex = findTopLevelComma(body);
  const head = separatorIndex === -1 ? body.trim() : body.slice(0, separatorIndex).trim();
  const citationKey = head || undefined;
  const fieldText = separatorIndex === -1 ? "" : body.slice(separatorIndex + 1);
  return {
    entryType,
    citationKey,
    fields: parseBibtexFieldPairs(fieldText)
  };
}

function parseBibtexFieldPairs(text: string): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  for (const segment of splitTopLevelSegments(text)) {
    const equalsIndex = findTopLevelEquals(segment);
    if (equalsIndex === -1) {
      continue;
    }

    const name = segment.slice(0, equalsIndex).trim().toLowerCase();
    const value = segment.slice(equalsIndex + 1).trim();
    if (!name || !value) {
      continue;
    }

    fields.push([name, value]);
  }
  return fields;
}

function splitTopLevelSegments(text: string): string[] {
  const segments: string[] = [];
  let current = "";
  let braceDepth = 0;
  let parenDepth = 0;
  let inQuote = false;
  let escaped = false;

  for (const char of text) {
    if (inQuote) {
      current += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inQuote = false;
      }
      continue;
    }

    if (char === "\"") {
      inQuote = true;
      current += char;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      current += char;
      continue;
    }

    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      current += char;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      current += char;
      continue;
    }

    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }

    if (char === "," && braceDepth === 0 && parenDepth === 0) {
      if (current.trim()) {
        segments.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments;
}

function findTopLevelComma(text: string): number {
  let braceDepth = 0;
  let parenDepth = 0;
  let inQuote = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inQuote = false;
      }
      continue;
    }

    if (char === "\"") {
      inQuote = true;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "," && braceDepth === 0 && parenDepth === 0) {
      return index;
    }
  }

  return -1;
}

function findTopLevelEquals(text: string): number {
  let braceDepth = 0;
  let parenDepth = 0;
  let inQuote = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inQuote = false;
      }
      continue;
    }

    if (char === "\"") {
      inQuote = true;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "=" && braceDepth === 0 && parenDepth === 0) {
      return index;
    }
  }

  return -1;
}
