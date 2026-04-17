/**
 * BibTeX file parsing and refinement.
 *
 * Parses .bib files into structured document segments, extracts metadata from each entry,
 * searches bibliographic sources for improved BibTeX records, and rewrites entries while
 * preserving citation keys. Supports both fully-automatic refinement and interactive
 * selection of search results.
 *
 * @module bibtex-file
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FetchLike } from "./http.js";
import type { CustomSourceConfig } from "./config.js";
import { formatBibtexText } from "./bibtex.js";
import { extractArxivId, extractDoi, normalizeWhitespace } from "./metadata.js";
import { searchBibtex, type SearchPreferenceInput, type SearchProgressEvent } from "./search.js";
import type {
  PdfMetadataCandidate,
  SearchResponse,
  SearchResult,
  SearchSourceError
} from "./types.js";

/**
 * A segment of a parsed BibTeX document, either a free-form text block or a recognized entry.
 */
export interface BibtexDocumentSegment {
  kind: "text" | "entry";
  text: string;
  entry?: ParsedBibtexEntry;
}

/**
 * A parsed BibTeX entry with extracted metadata fields.
 *
 * Contains the raw entry text, the parsed field key-value pairs, and convenience
 * derived properties such as title, authors, year, DOI, and arXiv identifier.
 */
export interface ParsedBibtexEntry {
  entryType: string;
  citationKey?: string;
  fields: Record<string, string>;
  title?: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  raw: string;
  parsed: boolean;
}

/**
 * Progress information for a single entry during a batch BibTeX refinement.
 */
export interface BibtexRefinementProgressEntry {
  index: number;
  citationKey: string;
  title: string;
  status: "searching" | "awaiting-confirmation" | "updating" | "updated" | "unchanged";
}

/**
 * A progress event emitted during batch BibTeX refinement.
 */
export interface BibtexRefinementProgressEvent {
  completed: number;
  total: number;
  current?: BibtexRefinementProgressEntry;
  searchProgress?: SearchProgressEvent;
}

/**
 * Context passed to a selection runner so it can choose among search results for a given entry.
 */
export interface BibtexRefinementSelectionContext {
  index: number;
  total: number;
  citationKey: string;
  title: string;
  currentEntry: ParsedBibtexEntry;
  response: SearchResponse;
}

/**
 * A function that selects a search result (or `undefined` to abort) for a BibTeX entry being refined.
 */
export type BibtexRefinementSelectionRunner = (
  context: BibtexRefinementSelectionContext
) => Promise<SearchResult | undefined>;

/**
 * Options that control BibTeX file or document refinement behavior.
 */
export interface BibtexRefinementOptions {
  fetcher?: FetchLike;
  preferences?: SearchPreferenceInput;
  customSources?: CustomSourceConfig[];
  filePath?: string;
  parallel?: boolean;
  timeoutMs?: number;
  selectResult?: BibtexRefinementSelectionRunner;
  onProgress?: (event: BibtexRefinementProgressEvent) => void;
}

export interface BibtexRefinementEntryReport {
  index: number;
  citationKey: string;
  title: string;
  updated: boolean;
  selectedSource?: SearchResult["source"];
  selectedTitle?: string;
  selectedScore?: number;
  matchedQuery?: SearchResult["matchedQuery"];
}

export interface BibtexRefinementResult {
  text: string;
  entries: BibtexRefinementEntryReport[];
  sourceErrors: SearchSourceError[];
}

const SPECIAL_ENTRY_TYPES = new Set(["comment", "preamble", "string"]);
export const KEEP_CURRENT_SELECTION_SOURCE = "__keep-current__";

export async function refineBibtexFile(
  filePath: string,
  options: BibtexRefinementOptions = {}
): Promise<BibtexRefinementResult> {
  const text = await readFile(filePath, "utf8");
  return refineBibtexDocument(text, { ...options, filePath });
}

export async function refineBibtexDocument(
  text: string,
  options: BibtexRefinementOptions = {}
): Promise<BibtexRefinementResult> {
  const segments = parseBibtexDocument(text);
  const updatedParts: string[] = [];
  const entries: BibtexRefinementEntryReport[] = [];
  const sourceErrors: SearchSourceError[] = [];
  const basePath = options.filePath ? path.resolve(options.filePath) : "bibtex.bib";
  const totalEntries = segments.reduce((count, segment) => {
    if (segment.kind !== "entry" || !segment.entry || !segment.entry.parsed) {
      return count;
    }
    if (SPECIAL_ENTRY_TYPES.has(segment.entry.entryType.toLowerCase())) {
      return count;
    }
    return count + 1;
  }, 0);
  let entryIndex = 0;
  let processedEntries = 0;
  const selectResult = options.selectResult ?? selectFirstSearchResult;

  options.onProgress?.({
    completed: 0,
    total: totalEntries
  });

  for (const segment of segments) {
    if (segment.kind === "text" || !segment.entry || !segment.entry.parsed) {
      updatedParts.push(segment.text);
      continue;
    }

    if (SPECIAL_ENTRY_TYPES.has(segment.entry.entryType.toLowerCase())) {
      updatedParts.push(segment.text);
      continue;
    }

    const citationKey = segment.entry.citationKey?.trim();
    if (!citationKey) {
      throw new Error(`BibTeX entry ${entryIndex + 1} is missing a citation key.`);
    }

    const metadata = buildBibtexMetadataCandidate(segment.entry, `${basePath}#${citationKey}`, entryIndex);
    const title = metadata.title;
    if (!title) {
      throw new Error(`BibTeX entry ${citationKey} is missing a title.`);
    }
    options.onProgress?.({
      completed: processedEntries,
      total: totalEntries,
      current: {
        index: entryIndex,
        citationKey,
        title,
        status: "searching"
      }
    });
    const response = await searchBibtex(metadata, {
      fetcher: options.fetcher,
      preferences: options.preferences,
      customSources: options.customSources,
      parallel: options.parallel,
      timeoutMs: options.timeoutMs,
      onProgress: (searchProgress) => {
        options.onProgress?.({
          completed: processedEntries,
          total: totalEntries,
          current: {
            index: entryIndex,
            citationKey,
            title,
            status: "searching"
          },
          searchProgress
        });
      }
    });

    sourceErrors.push(...response.sourceErrors);

    if (response.results.length === 0) {
      updatedParts.push(formatBibtexText(segment.text));
      entries.push({
        index: entryIndex,
        citationKey,
        title,
        updated: false
      });
      processedEntries += 1;
      options.onProgress?.({
        completed: processedEntries,
        total: totalEntries,
        current: {
          index: entryIndex,
          citationKey,
          title,
          status: "unchanged"
        }
      });
      entryIndex += 1;
      continue;
    }

    options.onProgress?.({
      completed: processedEntries,
      total: totalEntries,
      current: {
        index: entryIndex,
        citationKey,
        title,
        status: options.selectResult ? "awaiting-confirmation" : "updating"
      }
    });

    const selected = await selectResult({
      index: entryIndex,
      total: totalEntries,
      citationKey,
      title,
      currentEntry: segment.entry,
      response
    });

    if (!selected) {
      throw new Error(`BibTeX update cancelled for ${citationKey}.`);
    }

    const selectedBibtex = selected.source === KEEP_CURRENT_SELECTION_SOURCE
      ? segment.text
      : formatBibtexText(rewriteBibtexCitationKey(selected.bibtex, citationKey));
    updatedParts.push(selectedBibtex);
    entries.push({
      index: entryIndex,
      citationKey,
      title,
      updated: true,
      selectedSource: selected.source,
      selectedTitle: selected.title,
      selectedScore: selected.score,
      matchedQuery: selected.matchedQuery
    });
    processedEntries += 1;
    options.onProgress?.({
      completed: processedEntries,
      total: totalEntries,
      current: {
        index: entryIndex,
        citationKey,
        title,
        status: "updated"
      }
    });
    entryIndex += 1;
  }

  return {
    text: updatedParts.join(""),
    entries,
    sourceErrors
  };
}

async function selectFirstSearchResult(context: BibtexRefinementSelectionContext): Promise<SearchResult | undefined> {
  return context.response.results[0];
}

export function parseBibtexDocument(text: string): BibtexDocumentSegment[] {
  const segments: BibtexDocumentSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const startIndex = findNextEntryStart(text, cursor);
    if (startIndex === -1) {
      if (cursor < text.length) {
        segments.push({ kind: "text", text: text.slice(cursor) });
      }
      break;
    }

    if (startIndex > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, startIndex) });
    }

    const endIndex = findEntryEnd(text, startIndex);
    if (endIndex === -1) {
      segments.push({ kind: "text", text: text.slice(startIndex) });
      break;
    }

    const raw = text.slice(startIndex, endIndex + 1);
    segments.push({ kind: "entry", text: raw, entry: parseBibtexEntry(raw) });
    cursor = endIndex + 1;
  }

  return segments;
}

export function parseBibtexEntry(raw: string): ParsedBibtexEntry | undefined {
  const header = raw.match(/^@([A-Za-z][A-Za-z0-9_-]*)\s*([({])/s);
  if (!header) {
    return undefined;
  }

  const entryType = header[1];
  const delimiter = header[2];
  const closeDelimiter = delimiter === "{" ? "}" : ")";
  const bodyStart = header[0].length;
  const body = raw.slice(bodyStart, raw.length - 1);
  const separatorIndex = findTopLevelComma(body);
  const head = separatorIndex === -1 ? body.trim() : body.slice(0, separatorIndex).trim();
  const fieldText = separatorIndex === -1 ? "" : body.slice(separatorIndex + 1);
  const citationKey = head || undefined;
  const fields = parseBibtexFields(fieldText);
  const title = extractFieldValue(fields.title);
  const authors = parseAuthorField(fields.author);
  const year = parseYearField(fields.year);
  const combinedText = [title, fields.author, fields.journal, fields.booktitle, fields.note, raw].filter(Boolean).join(" ");

  return {
    entryType,
    citationKey,
    fields,
    title,
    authors,
    year,
    doi: extractDoi(fields.doi ?? combinedText),
    arxivId: extractArxivId(fields.eprint ?? fields.journal ?? combinedText),
    raw,
    parsed: raw.endsWith(closeDelimiter)
  };
}

function buildBibtexMetadataCandidate(
  entry: ParsedBibtexEntry,
  filePath: string,
  entryIndex: number
): PdfMetadataCandidate {
  if (!entry.title) {
    throw new Error(`BibTeX entry ${entry.citationKey ?? entryIndex + 1} is missing a title.`);
  }

  const textSample = normalizeWhitespace(
    [
      entry.title,
      entry.authors.join(" "),
      entry.fields.journal,
      entry.fields.booktitle,
      entry.fields.note,
      entry.raw
    ].filter(Boolean).join(" ")
  ).slice(0, 1200);

  return {
    filePath,
    pageCount: 0,
    title: entry.title,
    authors: entry.authors,
    year: entry.year,
    doi: entry.doi,
    arxivId: entry.arxivId,
    textSample
  };
}

function parseBibtexFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
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

    fields[name] = value;
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
      } else if (char === '"') {
        inQuote = false;
      }
      continue;
    }

    if (char === '"') {
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
      const trimmed = current.trim();
      if (trimmed) {
        segments.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) {
    segments.push(trimmed);
  }

  return segments;
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
      if (char === '"') {
        inQuote = false;
      }
      continue;
    }

    if (char === '"') {
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
      if (char === '"') {
        inQuote = false;
      }
      continue;
    }

    if (char === '"') {
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

function findNextEntryStart(text: string, fromIndex: number): number {
  for (let index = fromIndex; index < text.length; index += 1) {
    if (text[index] !== "@") {
      continue;
    }
    const header = text.slice(index).match(/^@([A-Za-z][A-Za-z0-9_-]*)\s*([({])/s);
    if (header) {
      return index;
    }
  }
  return -1;
}

function findEntryEnd(text: string, startIndex: number): number {
  const header = text.slice(startIndex).match(/^@([A-Za-z][A-Za-z0-9_-]*)\s*([({])/s);
  if (!header) {
    return -1;
  }

  const openDelimiter = header[2];
  const closeDelimiter = openDelimiter === "{" ? "}" : ")";
  let depth = 1;
  let inQuote = false;
  let escaped = false;

  for (let index = startIndex + header[0].length; index < text.length; index += 1) {
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
      if (char === '"') {
        inQuote = false;
      }
      continue;
    }

    if (char === '"') {
      inQuote = true;
      continue;
    }
    if (char === openDelimiter) {
      depth += 1;
      continue;
    }
    if (char === closeDelimiter) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractFieldValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return normalizeWhitespace(trimmed.slice(1, -1));
  }
  return normalizeWhitespace(trimmed);
}

function parseAuthorField(value: string | undefined): string[] {
  const authorText = extractFieldValue(value);
  if (!authorText) {
    return [];
  }
  return authorText
    .split(/\s+and\s+/i)
    .map((author) => normalizeWhitespace(author.replace(/[{}]/g, "")))
    .filter(Boolean);
}

function parseYearField(value: string | undefined): number | undefined {
  const yearText = extractFieldValue(value);
  if (!yearText) {
    return undefined;
  }
  const parsed = Number.parseInt(yearText, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function rewriteBibtexCitationKey(bibtex: string, citationKey: string): string {
  const normalized = bibtex.trim();
  const updated = normalized.replace(
    /^(@[A-Za-z][A-Za-z0-9_-]*\s*[\{\(]\s*)([^,]+)(\s*,)/s,
    (_match, prefix: string, _existingKey: string, suffix: string) => `${prefix}${citationKey}${suffix}`
  );

  if (updated === normalized) {
    throw new Error(`Unable to rewrite BibTeX citation key for ${citationKey}.`);
  }

  return updated;
}
