import type { FetchLike } from "./http.js";
import { fetchText } from "./http.js";
import { normalizeWhitespace, stripArxivVersion } from "./metadata.js";
import type { SearchResult } from "./types.js";

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

export async function fetchBibtexForRecord(record: BibtexRecord, fetcher: FetchLike): Promise<string> {
  if (record.source === "dblp" && record.sourceId) {
    return fetchDblpBibtex(record.sourceId, fetcher);
  }

  if (record.doi) {
    return fetchDoiBibtex(record.doi, fetcher);
  }

  return generateBibtex(record);
}

export async function fetchDoiBibtex(doi: string, fetcher: FetchLike): Promise<string> {
  const normalizedDoi = normalizeDoi(doi);
  return normalizeBibtex(await fetchText(fetcher, `https://doi.org/${encodeURIComponent(normalizedDoi)}`, "application/x-bibtex"));
}

export async function fetchDblpBibtex(sourceId: string, fetcher: FetchLike): Promise<string> {
  const key = sourceId.replace(/^https:\/\/dblp\.org\/rec\//, "").replace(/\.bib$/i, "");
  return normalizeBibtex(await fetchText(fetcher, `https://dblp.org/rec/${key}.bib`, "application/x-bibtex"));
}

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

export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase();
}

export function normalizeBibtex(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
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
