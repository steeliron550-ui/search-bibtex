/**
 * ranking.ts — Bibliographic candidate scoring and ranking.
 *
 * Computes per-field similarity scores (title, author, year, identifier,
 * source priority) for each search candidate and produces a ranked list
 * ordered by weighted total score.
 */

import { normalizeDoi } from "./bibtex.js";
import { stripArxivVersion } from "./metadata.js";
import type {
  PaperSource,
  PdfMetadataCandidate,
  ScoreBreakdown,
  SearchPreferences,
  SearchQueryKind
} from "./types.js";

/** A raw bibliographic candidate returned by a search source, before scoring. */
export interface BibliographicCandidate {
  source: PaperSource;
  sourceId?: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  venue?: string;
  url?: string;
}

/** A BibliographicCandidate with scoring metadata attached after ranking. */
export interface RankedBibliographicCandidate extends BibliographicCandidate {
  matchedQuery: SearchQueryKind;
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

/** Ranks and scores bibliographic candidates by weighted field similarity, sorted highest-first. */
export function rankBibliographicCandidates(
  metadata: PdfMetadataCandidate,
  candidates: BibliographicCandidate[],
  preferences: SearchPreferences
): RankedBibliographicCandidate[] {
  return candidates
    .map((candidate) => {
      const scoreBreakdown = scoreCandidate(metadata, candidate, preferences);
      const score = weightedScore(scoreBreakdown, preferences);
      return {
        ...candidate,
        matchedQuery: bestMatchedQuery(metadata, candidate),
        score,
        scoreBreakdown
      };
    })
    .sort((left, right) => right.score - left.score);
}

/** Scores a single candidate against the extracted metadata across all weighted dimensions. */
export function scoreCandidate(
  metadata: PdfMetadataCandidate,
  candidate: BibliographicCandidate,
  preferences: SearchPreferences
): ScoreBreakdown {
  return {
    title: textSimilarity(metadata.title ?? "", candidate.title),
    author: authorSimilarity(metadata.authors, candidate.authors),
    year: yearSimilarity(metadata.year, candidate.year),
    identifier: identifierSimilarity(metadata, candidate),
    source: sourceSimilarity(candidate.source, preferences.sourcePriority)
  };
}

/** Computes title similarity via Jaccard token overlap (0.7 weight) and normalised edit distance (0.3 weight). */
export function textSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = intersection / union;
  const edit = 1 - levenshteinDistance(normalizeForCompare(left), normalizeForCompare(right)) / Math.max(1, normalizeForCompare(left).length, normalizeForCompare(right).length);
  return clamp((jaccard * 0.7) + (edit * 0.3));
}

export function authorSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftNames = new Set(left.map(normalizeForCompare));
  const rightNames = new Set(right.map(normalizeForCompare));
  const direct = [...leftNames].filter((author) => rightNames.has(author)).length;
  const surnameDirect = surnameOverlap(left, right);
  return clamp(Math.max(direct / Math.max(leftNames.size, 1), surnameDirect));
}

export function yearSimilarity(left: number | undefined, right: number | undefined): number {
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  return Math.abs(left - right) === 1 ? 0.5 : 0;
}

export function identifierSimilarity(metadata: PdfMetadataCandidate, candidate: BibliographicCandidate): number {
  if (metadata.doi && candidate.doi && normalizeDoi(metadata.doi) === normalizeDoi(candidate.doi)) {
    return 1;
  }
  if (
    metadata.arxivId &&
    candidate.arxivId &&
    stripArxivVersion(metadata.arxivId).toLowerCase() === stripArxivVersion(candidate.arxivId).toLowerCase()
  ) {
    return 1;
  }
  return 0;
}

function weightedScore(scoreBreakdown: ScoreBreakdown, preferences: SearchPreferences): number {
  return Number(
    (
      scoreBreakdown.title * preferences.weights.title +
      scoreBreakdown.author * preferences.weights.author +
      scoreBreakdown.year * preferences.weights.year +
      scoreBreakdown.identifier * preferences.weights.identifier +
      scoreBreakdown.source * preferences.weights.source
    ).toFixed(6)
  );
}

function bestMatchedQuery(metadata: PdfMetadataCandidate, candidate: BibliographicCandidate): SearchQueryKind {
  if (metadata.doi && candidate.doi && normalizeDoi(metadata.doi) === normalizeDoi(candidate.doi)) {
    return "doi";
  }
  if (
    metadata.arxivId &&
    candidate.arxivId &&
    stripArxivVersion(metadata.arxivId).toLowerCase() === stripArxivVersion(candidate.arxivId).toLowerCase()
  ) {
    return "arxiv";
  }
  return candidate.authors.length > 0 ? "title-author" : "title";
}

function sourceSimilarity(source: PaperSource, priority: PaperSource[]): number {
  const index = priority.indexOf(source);
  if (index === -1) {
    return 0;
  }
  if (priority.length === 1) {
    return 1;
  }
  return 1 - index / (priority.length - 1);
}

function surnameOverlap(left: string[], right: string[]): number {
  const leftSurnames = new Set(left.map(surname).filter(Boolean));
  const rightSurnames = new Set(right.map(surname).filter(Boolean));
  if (leftSurnames.size === 0 || rightSurnames.size === 0) {
    return 0;
  }
  return [...leftSurnames].filter((name) => rightSurnames.has(name)).length / leftSurnames.size;
}

function surname(value: string): string {
  return normalizeForCompare(value).split(" ").at(-1) ?? "";
}

function tokenize(value: string): string[] {
  return normalizeForCompare(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function normalizeForCompare(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const distances = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    distances[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    distances[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      distances[row][col] = Math.min(
        distances[row - 1][col] + 1,
        distances[row][col - 1] + 1,
        distances[row - 1][col - 1] + cost
      );
    }
  }

  return distances[left.length][right.length];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
