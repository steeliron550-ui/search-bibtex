import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FetchLike } from "./http.js";
import { extractArxivId, extractDoi, normalizeWhitespace } from "./metadata.js";
import { searchBibtex, type SearchPreferenceInput } from "./search.js";
import type { PdfMetadataCandidate, SearchResult, SearchSourceError } from "./types.js";

export interface BibtexDocumentSegment {
  kind: "text" | "entry";
  text: string;
  entry?: ParsedBibtexEntry;
}

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

export interface BibtexRefinementOptions {
  fetcher?: FetchLike;
  preferences?: SearchPreferenceInput;
  filePath?: string;
}

export interface BibtexRefinementEntryReport {
  index: number;
  citationKey: string;
  title: string;
  selectedSource: SearchResult["source"];
  selectedTitle: string;
  selectedScore: number;
  matchedQuery: SearchResult["matchedQuery"];
}

export interface BibtexRefinementResult {
  text: string;
  entries: BibtexRefinementEntryReport[];
  sourceErrors: SearchSourceError[];
}

const SPECIAL_ENTRY_TYPES = new Set(["comment", "preamble", "string"]);

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
  let entryIndex = 0;

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
    const response = await searchBibtex(metadata, {
      fetcher: options.fetcher,
      preferences: options.preferences
    });

    sourceErrors.push(...response.sourceErrors);

    if (response.results.length === 0) {
      throw new Error(
        `No BibTeX match found for ${citationKey} (${title}). Source errors: ${JSON.stringify(response.sourceErrors)}`
      );
    }

    const selected = response.results[0];
    const selectedBibtex = rewriteBibtexCitationKey(selected.bibtex, citationKey);
    updatedParts.push(selectedBibtex);
    entries.push({
      index: entryIndex,
      citationKey,
      title,
      selectedSource: selected.source,
      selectedTitle: selected.title,
      selectedScore: selected.score,
      matchedQuery: selected.matchedQuery
    });
    entryIndex += 1;
  }

  return {
    text: updatedParts.join(""),
    entries,
    sourceErrors
  };
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
