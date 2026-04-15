/**
 * metadata.ts — PDF metadata extraction and search-query generation.
 *
 * Reads a PdfDocumentSnapshot, heuristically detects the paper title,
 * author list, DOI, arXiv ID, and year, then generates a prioritised
 * list of SearchQueryCandidates for the bibliographic search phase.
 */

import path from "node:path";

import type {
  PdfDocumentSnapshot,
  PdfMetadataCandidate,
  SearchQueryCandidate
} from "./types.js";

/** Matches DOIs like 10.1145/3597500 or 10.1007/978-3-031-... */
const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
/** Matches arXiv IDs like 2301.12345 or 2301.12345v2 (with optional version suffix). */
const ARXIV_PATTERN = /\b(?:arxiv\s*:\s*)?([0-9]{4}\.[0-9]{4,5})(v[0-9]+)?\b/i;
/** Matches 4-digit years between 1970 and 2099. */
const YEAR_PATTERN = /\b(19[7-9][0-9]|20[0-9]{2})\b/g;

/** Patterns that indicate a line is front matter (not title text). */
const FRONT_MATTER_PATTERNS = [
  /^proceedings of /i,
  /^volume \d+/i,
  /^pages? /i,
  /^july |^august |^september |^october |^november |^december |^january |^february |^march |^april |^may |^june /i,
  /^copyright /i,
  /^latest updates:/i,
  /^research-article$/i,
  /^open access support/i,
  /^view all$/i,
  /^\.+$/,
  /^industry track paper$/i
];

/** Patterns that indicate a line contains affiliation info (not part of the title). */
const AFFILIATION_PATTERNS = [
  /@/,
  /^https?:\/\//i,
  /\b(university|institute|school|department|laboratory|lab|college|academy|huawei|deepseek|microsoft|google|meta|amazon|china|usa|canada|uk|germany|france|japan)\b/i
];

/** Collapses all whitespace runs to single spaces and trims. */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeLine(value: string): string {
  return normalizeWhitespace(value.replace(/\u0000/g, "").replace(/[^\S\r\n]+/g, " "));
}

export function stripArxivVersion(arxivId: string): string {
  return arxivId.replace(/v[0-9]+$/i, "");
}

export function extractDoi(value: string): string | undefined {
  const match = value.match(DOI_PATTERN);
  return match?.[0].replace(/[).,;:]+$/, "");
}

/** Extracts an arXiv ID (with optional version suffix) from text. */
export function extractArxivId(value: string): string | undefined {
  const match = value.match(ARXIV_PATTERN);
  if (!match) {
    return undefined;
  }
  return `${match[1]}${match[2] ?? ""}`;
}

/** Generates a prioritised list of search queries (DOI → arXiv → title → title-author) from metadata. */
export function generateSearchQueries(candidate: PdfMetadataCandidate): SearchQueryCandidate[] {
  const queries: SearchQueryCandidate[] = [];

  if (candidate.doi) {
    queries.push({ kind: "doi", value: candidate.doi, confidence: 1 });
  }

  if (candidate.arxivId) {
    queries.push({
      kind: "arxiv",
      value: stripArxivVersion(candidate.arxivId),
      confidence: 0.98
    });
  }

  if (candidate.title) {
    queries.push({ kind: "title", value: candidate.title, confidence: 0.78 });

    const firstAuthor = candidate.authors[0];
    if (firstAuthor) {
      queries.push({
        kind: "title-author",
        value: `${candidate.title} ${firstAuthor}`,
        confidence: 0.72
      });
    }
  }

  if (queries.length === 0) {
    throw new Error(`No usable metadata query could be generated for ${candidate.filePath}`);
  }

  return queries;
}

/** Builds a PdfMetadataCandidate from a PDF snapshot by detecting title, authors, DOI, arXiv ID, and year. */
export function buildMetadataCandidate(snapshot: PdfDocumentSnapshot): PdfMetadataCandidate {
  const filename = path.basename(snapshot.filePath);
  const filenameText = filename.replace(/\.pdf$/i, "");
  const combinedText = `${filenameText}\n${snapshot.info.title ?? ""}\n${snapshot.info.author ?? ""}\n${snapshot.text}`;
  const titleMatch = detectTitle(snapshot);
  const title = cleanTitle(snapshot.info.title) ?? titleMatch.title ?? titleFromFilename(filenameText);
  const authors = parseAuthors(snapshot, titleMatch.endLineIndex);
  const doi = extractDoi(combinedText);
  const arxivId = extractArxivId(combinedText);
  const year = detectYear(filenameText, snapshot.text, arxivId);

  return {
    filePath: snapshot.filePath,
    pageCount: snapshot.pageCount,
    title,
    authors,
    year,
    doi,
    arxivId,
    textSample: normalizeWhitespace(snapshot.text).slice(0, 1200)
  };
}

/** Builds a PdfMetadataCandidate directly from a title string (for stdin/title search). */
export function buildTitleMetadataCandidate(title: string, filePath = "stdin:title"): PdfMetadataCandidate {
  const normalizedTitle = normalizeWhitespace(title);
  return {
    filePath,
    pageCount: 0,
    title: normalizedTitle || undefined,
    authors: [],
    textSample: normalizedTitle
  };
}

interface TitleMatch {
  title?: string;
  endLineIndex: number;
}

/**
 * Heuristically detects the paper title from the first few pages of a PDF.
 * Walks through lines, finds the first plausible title-start line, then
 * accumulates continuation lines until hitting an author/affiliation/abstract break.
 */
function detectTitle(snapshot: PdfDocumentSnapshot): TitleMatch {
  const lines = snapshot.lines.map(normalizeLine).filter(Boolean);
  const abstractIndex = lines.findIndex((line) => /^abstract$/i.test(line));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isTitleStart(line)) {
      continue;
    }

    const parts = [cleanTitlePart(line)];
    let endLineIndex = index;

    for (let next = index + 1; next < lines.length; next += 1) {
      const nextLine = lines[next];
      if (abstractIndex !== -1 && next >= abstractIndex) {
        break;
      }
      if (!isTitleContinuation(nextLine)) {
        break;
      }
      parts.push(cleanTitlePart(nextLine));
      endLineIndex = next;
    }

    const title = cleanTitle(parts.join(" "));
    if (title) {
      return { title, endLineIndex };
    }
  }

  return { endLineIndex: -1 };
}

/** Cleans a candidate title string, rejecting values that are too short or look like filenames. */
function cleanTitle(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeWhitespace(value.replace(/\s+-\s+/g, "-"));
  if (normalized.length < 8 || /\.pdf$/i.test(normalized)) {
    return undefined;
  }
  return normalized.replace(/[.,;:]+$/, "");
}

function cleanTitlePart(value: string): string {
  return normalizeWhitespace(value.replace(/[*.†‡♣♢♡♠+]+/g, ""));
}

function isTitleStart(line: string): boolean {
  if (isFrontMatter(line) || isAffiliation(line)) {
    return false;
  }
  if (line.length < 8 || line.length > 180) {
    return false;
  }
  if (/^abstract$/i.test(line)) {
    return false;
  }
  return /[A-Za-z]/.test(line);
}

function isTitleContinuation(line: string): boolean {
  if (isFrontMatter(line) || isAffiliation(line)) {
    return false;
  }
  if (/^abstract$/i.test(line)) {
    return false;
  }
  if (looksLikeAuthorLine(line)) {
    return false;
  }
  if (line.length < 4 || line.length > 160) {
    return false;
  }
  return /[A-Za-z]/.test(line);
}

function isFrontMatter(line: string): boolean {
  return FRONT_MATTER_PATTERNS.some((pattern) => pattern.test(line));
}

function isAffiliation(line: string): boolean {
  return AFFILIATION_PATTERNS.some((pattern) => pattern.test(line));
}

function looksLikeAuthorLine(line: string): boolean {
  if (/[♣♢♡♠†‡∗*]/.test(line)) {
    return true;
  }
  if (/\b[A-Z][a-z]+ [A-Z][a-z]+(?:\s+[0-9,]+)?\s+[A-Z][a-z]+ [A-Z][a-z]+/.test(line)) {
    return true;
  }
  if (/^[A-Z][A-Z-]+ [A-Z][A-Z-]+,/.test(line)) {
    return true;
  }
  return false;
}

/**
 * Extracts author names from the PDF.  First tries the PDF info dictionary;
 * falls back to scanning lines after the detected title until hitting the
 * abstract section or an affiliation line.
 */
function parseAuthors(snapshot: PdfDocumentSnapshot, titleEndLineIndex: number): string[] {
  if (snapshot.info.author) {
    const infoAuthors = splitAuthorText(snapshot.info.author);
    if (infoAuthors.length > 0) {
      return infoAuthors;
    }
  }

  if (titleEndLineIndex < 0) {
    return [];
  }

  const lines = snapshot.lines.map(normalizeLine).filter(Boolean);
  const abstractIndex = lines.findIndex((line) => /^abstract$/i.test(line));
  const end = abstractIndex === -1 ? Math.min(lines.length, titleEndLineIndex + 18) : abstractIndex;
  const authorLines = lines.slice(titleEndLineIndex + 1, end);
  const authors: string[] = [];

  for (const line of authorLines) {
    if (isFrontMatter(line)) {
      continue;
    }
    authors.push(...splitAuthorText(line));
    if (authors.length >= 12) {
      break;
    }
  }

  return uniqueValues(authors).slice(0, 12);
}

function splitAuthorText(value: string): string[] {
  const cleaned = normalizeWhitespace(
    value
      .replace(/[♣♢♡♠†‡∗*+]/g, " ")
      .replace(/\b[0-9]+(?:,[0-9]+)*\b/g, " ")
      .replace(
        /\s*,\s*.*\b(University|Institute|School|Department|Huawei|DeepSeek|Microsoft|Google|Meta|Amazon)\b.*$/i,
        ""
      )
      .replace(/\s+/g, " ")
  );

  if (!cleaned || isAffiliation(cleaned)) {
    return [];
  }

  const matches = cleaned.match(/\b[A-Z][A-Za-z'.-]+(?:\s+[A-Z]\.)?\s+[A-Z][A-Za-z'.-]+\b/g) ?? [];
  return matches.map((author) => titleCaseAllCaps(author)).filter((author) => author.length >= 5);
}

function titleCaseAllCaps(value: string): string {
  if (!/^[A-Z .'-]+$/.test(value)) {
    return value;
  }
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map(normalizeWhitespace).filter(Boolean))];
}

function titleFromFilename(filenameText: string): string | undefined {
  if (ARXIV_PATTERN.test(filenameText) || DOI_PATTERN.test(filenameText)) {
    return undefined;
  }

  return cleanTitle(
    filenameText
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\bIndustry Track Paper\b/i, "")
  );
}

function detectYear(filenameText: string, text: string, arxivId: string | undefined): number | undefined {
  if (arxivId) {
    const year = 2000 + Number.parseInt(arxivId.slice(0, 2), 10);
    if (Number.isFinite(year)) {
      return year;
    }
  }

  const filenameYear = filenameText.match(YEAR_PATTERN)?.[0];
  if (filenameYear) {
    return Number.parseInt(filenameYear, 10);
  }

  const textYear = text.match(YEAR_PATTERN)?.[0];
  return textYear ? Number.parseInt(textYear, 10) : undefined;
}
