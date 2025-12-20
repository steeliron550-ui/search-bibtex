import type { PdfMetadataCandidate, SearchQueryCandidate } from "./types.js";

const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const ARXIV_PATTERN = /\b(?:arxiv\s*:\s*)?([0-9]{4}\.[0-9]{4,5})(v[0-9]+)?\b/i;

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

export function extractArxivId(value: string): string | undefined {
  const match = value.match(ARXIV_PATTERN);
  if (!match) {
    return undefined;
  }
  return `${match[1]}${match[2] ?? ""}`;
}

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
