import { XMLParser } from "fast-xml-parser";

import { fetchBibtexForRecord } from "./bibtex.js";
import { defaultSearchPreferences } from "./config.js";
import type { FetchLike } from "./http.js";
import { fetchJson, fetchText, toSourceError } from "./http.js";
import { buildMetadataCandidate, generateSearchQueries, normalizeWhitespace, stripArxivVersion } from "./metadata.js";
import { extractPdfDocumentSnapshot } from "./pdf.js";
import { type BibliographicCandidate, rankBibliographicCandidates } from "./ranking.js";
import type {
  PaperSource,
  PdfMetadataCandidate,
  SearchPreferences,
  SearchQueryCandidate,
  SearchResponse,
  SearchResult,
  SearchSourceError,
  SortWeights
} from "./types.js";

export interface BibliographySearchOptions {
  fetcher?: FetchLike;
  preferences?: SearchPreferenceInput;
  pages?: number;
  onProgress?: (event: SearchProgressEvent) => void;
}

export interface SearchProgressEvent {
  completed: number;
  total: number;
  completedSources: PaperSource[];
  failedSources: PaperSource[];
}

export interface SearchPreferenceInput {
  sourcePriority?: PaperSource[];
  weights?: Partial<SortWeights>;
  limit?: number;
}

interface SourceSearchContext {
  metadata: PdfMetadataCandidate;
  queries: SearchQueryCandidate[];
  fetcher: FetchLike;
  limit: number;
}

const xmlParser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  removeNSPrefix: true
});

export async function searchBibtexFromPdf(filePath: string, options: BibliographySearchOptions = {}): Promise<SearchResponse> {
  const snapshot = await extractPdfDocumentSnapshot(filePath, { pages: options.pages });
  const metadata = buildMetadataCandidate(snapshot);
  return searchBibtex(metadata, options);
}

export async function searchBibtex(
  metadata: PdfMetadataCandidate,
  options: BibliographySearchOptions = {}
): Promise<SearchResponse> {
  const preferences = mergeSearchPreferences(options.preferences);
  const queries = generateSearchQueries(metadata);
  const fetcher = options.fetcher ?? fetch;
  const onProgress = options.onProgress;
  const sourceErrors: SearchSourceError[] = [];
  const candidates: BibliographicCandidate[] = [];
  const completedSources: PaperSource[] = [];
  const failedSources: PaperSource[] = [];

  onProgress?.({
    completed: 0,
    total: preferences.sourcePriority.length,
    completedSources: [],
    failedSources: []
  });

  for (const source of preferences.sourcePriority) {
    try {
      candidates.push(...await searchSource(source, { metadata, queries, fetcher, limit: preferences.limit }));
      completedSources.push(source);
    } catch (error) {
      failedSources.push(source);
      sourceErrors.push(toSourceError(source, queries[0]?.value ?? metadata.title ?? metadata.filePath, error));
    }
    onProgress?.({
      completed: completedSources.length + failedSources.length,
      total: preferences.sourcePriority.length,
      completedSources: [...completedSources],
      failedSources: [...failedSources]
    });
  }

  const ranked = rankBibliographicCandidates(metadata, candidates, preferences).slice(0, preferences.limit * 2);
  const results: SearchResult[] = [];

  for (const candidate of ranked) {
    try {
      const bibtex = await fetchBibtexForRecord(candidate, fetcher);
      results.push({ ...candidate, bibtex });
      if (results.length >= preferences.limit) {
        break;
      }
    } catch (error) {
      sourceErrors.push(toSourceError(candidate.source, candidate.title, error));
    }
  }

  return {
    metadata,
    queries,
    results,
    sourceErrors
  };
}

export function mergeSearchPreferences(
  preferences: SearchPreferenceInput = {}
): SearchPreferences {
  return {
    sourcePriority: preferences.sourcePriority ?? defaultSearchPreferences.sourcePriority,
    limit: preferences.limit ?? defaultSearchPreferences.limit,
    weights: {
      ...defaultSearchPreferences.weights,
      ...preferences.weights
    }
  };
}

async function searchSource(source: PaperSource, context: SourceSearchContext): Promise<BibliographicCandidate[]> {
  switch (source) {
    case "arxiv":
      return searchArxiv(context);
    case "crossref":
      return searchCrossref(context);
    case "semantic-scholar":
      return searchSemanticScholar(context);
    case "openalex":
      return searchOpenAlex(context);
    case "dblp":
      return searchDblp(context);
    case "doi":
      return searchDoi(context.metadata);
  }
}

async function searchDblp(context: SourceSearchContext): Promise<BibliographicCandidate[]> {
  const query = context.metadata.doi ? `doi:${context.metadata.doi}` : context.metadata.title ?? context.queries[0].value;
  const url = new URL("https://dblp.org/search/publ/api");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("h", String(context.limit));

  const response = await fetchJson<DblpSearchResponse>(context.fetcher, url.toString());
  return normalizeDblpHits(response);
}

export function normalizeDblpHits(response: DblpSearchResponse): BibliographicCandidate[] {
  return toArray(response.result?.hits?.hit).map((hit) => {
    const info = hit.info;
    return {
      source: "dblp" as const,
      sourceId: info.key,
      title: cleanResultTitle(info.title),
      authors: normalizeDblpAuthors(info.authors?.author),
      year: parseYear(info.year),
      doi: optionalString(info.doi),
      venue: optionalString(info.venue),
      url: optionalString(info.url)
    };
  }).filter(hasTitle);
}

async function searchArxiv(context: SourceSearchContext): Promise<BibliographicCandidate[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  const arxivId = context.metadata.arxivId ? stripArxivVersion(context.metadata.arxivId) : undefined;

  if (arxivId) {
    url.searchParams.set("id_list", arxivId);
  } else if (context.metadata.title) {
    url.searchParams.set("search_query", `ti:"${context.metadata.title}"`);
    url.searchParams.set("max_results", String(context.limit));
  } else {
    return [];
  }

  const xml = await fetchText(context.fetcher, url.toString(), "application/atom+xml");
  return normalizeArxivFeed(xml);
}

export function normalizeArxivFeed(xml: string): BibliographicCandidate[] {
  const parsed = xmlParser.parse(xml) as ArxivFeedResponse;
  return toArray(parsed.feed?.entry).map((entry) => {
    const arxivId = arxivIdFromUrl(entry.id);
    const publishedYear = typeof entry.published === "string" ? Number.parseInt(entry.published.slice(0, 4), 10) : undefined;
    return {
      source: "arxiv" as const,
      sourceId: arxivId,
      title: cleanResultTitle(stringValue(entry.title)),
      authors: toArray(entry.author).map((author) => stringValue(author.name)).filter(Boolean),
      year: Number.isFinite(publishedYear) ? publishedYear : undefined,
      doi: optionalString(entry.doi),
      arxivId,
      venue: "arXiv",
      url: typeof entry.id === "string" ? entry.id.replace("http://", "https://") : undefined
    };
  }).filter(hasTitle);
}

async function searchCrossref(context: SourceSearchContext): Promise<BibliographicCandidate[]> {
  if (context.metadata.doi) {
    const url = `https://api.crossref.org/works/${encodeURIComponent(context.metadata.doi)}`;
    const response = await fetchJson<CrossrefSingleResponse>(context.fetcher, url);
    return [normalizeCrossrefItem(response.message)].filter(hasTitle);
  }

  if (!context.metadata.title) {
    return [];
  }

  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.title", context.metadata.title);
  url.searchParams.set("rows", String(context.limit));
  const response = await fetchJson<CrossrefSearchResponse>(context.fetcher, url.toString());
  return toArray(response.message?.items).map(normalizeCrossrefItem).filter(hasTitle);
}

function normalizeCrossrefItem(item: CrossrefItem): BibliographicCandidate {
  return {
    source: "crossref",
    sourceId: item.DOI,
    title: cleanResultTitle(stringValue(item.title?.[0])),
    authors: toArray(item.author).map((author) => normalizeWhitespace(`${author.given ?? ""} ${author.family ?? ""}`)).filter(Boolean),
    year: parseYear(item.issued?.["date-parts"]?.[0]?.[0]),
    doi: optionalString(item.DOI),
    venue: optionalString(item["container-title"]?.[0]),
    url: optionalString(item.URL)
  };
}

async function searchOpenAlex(context: SourceSearchContext): Promise<BibliographicCandidate[]> {
  const url = new URL("https://api.openalex.org/works");
  if (context.metadata.doi) {
    url.searchParams.set("filter", `doi:${context.metadata.doi}`);
  } else if (context.metadata.title) {
    url.searchParams.set("search", context.metadata.title);
  } else {
    return [];
  }
  url.searchParams.set("per-page", String(context.limit));

  const response = await fetchJson<OpenAlexSearchResponse>(context.fetcher, url.toString());
  return toArray(response.results).map((item) => ({
    source: "openalex" as const,
    sourceId: item.id,
    title: cleanResultTitle(item.title),
    authors: toArray(item.authorships).map((authorship) => stringValue(authorship.author?.display_name)).filter(Boolean),
    year: parseYear(item.publication_year),
    doi: optionalString(item.doi),
    venue: optionalString(item.primary_location?.source?.display_name),
    url: optionalString(item.id)
  })).filter(hasTitle);
}

async function searchSemanticScholar(context: SourceSearchContext): Promise<BibliographicCandidate[]> {
  if (context.metadata.doi || context.metadata.arxivId) {
    const id = context.metadata.doi ? `DOI:${context.metadata.doi}` : `ARXIV:${stripArxivVersion(context.metadata.arxivId!)}`;
    const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}`);
    url.searchParams.set("fields", "title,authors,year,venue,externalIds,url");
    const item = await fetchJson<SemanticScholarItem>(context.fetcher, url.toString());
    return [normalizeSemanticScholarItem(item)].filter(hasTitle);
  }

  if (!context.metadata.title) {
    return [];
  }

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", context.metadata.title);
  url.searchParams.set("limit", String(context.limit));
  url.searchParams.set("fields", "title,authors,year,venue,externalIds,url");
  const response = await fetchJson<SemanticScholarSearchResponse>(context.fetcher, url.toString());
  return toArray(response.data).map(normalizeSemanticScholarItem).filter(hasTitle);
}

function normalizeSemanticScholarItem(item: SemanticScholarItem): BibliographicCandidate {
  return {
    source: "semantic-scholar" as const,
    sourceId: item.paperId,
    title: cleanResultTitle(item.title),
    authors: toArray(item.authors).map((author) => stringValue(author.name)).filter(Boolean),
    year: parseYear(item.year),
    doi: optionalString(item.externalIds?.DOI),
    arxivId: optionalString(item.externalIds?.ArXiv),
    venue: optionalString(item.venue),
    url: optionalString(item.url)
  };
}

function searchDoi(metadata: PdfMetadataCandidate): BibliographicCandidate[] {
  if (!metadata.doi) {
    return [];
  }

  return [{
    source: "doi",
    sourceId: metadata.doi,
    title: metadata.title ?? metadata.doi,
    authors: metadata.authors,
    year: metadata.year,
    doi: metadata.doi,
    arxivId: metadata.arxivId,
    url: `https://doi.org/${metadata.doi}`
  }];
}

function cleanResultTitle(value: string | undefined): string {
  return normalizeWhitespace((value ?? "").replace(/<[^>]+>/g, " ")).replace(/[.]+$/, "");
}

function hasTitle(candidate: BibliographicCandidate): candidate is BibliographicCandidate {
  return Boolean(candidate.title);
}

function arxivIdFromUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.match(/\/abs\/([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)/i)?.[1];
}

function normalizeDblpAuthors(value: DblpAuthor[] | DblpAuthor | string | undefined): string[] {
  return toArray(value).map((author) => typeof author === "string" ? author : author.text).filter(Boolean);
}

function parseYear(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? normalizeWhitespace(value) : "";
}

function toArray<T>(value: T[] | T | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

interface DblpSearchResponse {
  result?: {
    hits?: {
      hit?: DblpHit[] | DblpHit;
    };
  };
}

interface DblpHit {
  info: {
    title?: string;
    authors?: {
      author?: DblpAuthor[] | DblpAuthor | string;
    };
    venue?: string;
    year?: string;
    url?: string;
    key?: string;
    doi?: string;
  };
}

interface DblpAuthor {
  text: string;
}

interface ArxivFeedResponse {
  feed?: {
    entry?: ArxivEntry[] | ArxivEntry;
  };
}

interface ArxivEntry {
  id?: string;
  title?: string;
  published?: string;
  doi?: string;
  author?: { name?: string }[] | { name?: string };
}

interface CrossrefSearchResponse {
  message?: {
    items?: CrossrefItem[];
  };
}

interface CrossrefSingleResponse {
  message: CrossrefItem;
}

interface CrossrefItem {
  title?: string[];
  DOI?: string;
  URL?: string;
  issued?: {
    "date-parts"?: number[][];
  };
  "container-title"?: string[];
  author?: {
    given?: string;
    family?: string;
  }[];
}

interface OpenAlexSearchResponse {
  results?: OpenAlexItem[];
}

interface OpenAlexItem {
  id?: string;
  title?: string;
  doi?: string;
  publication_year?: number;
  primary_location?: {
    source?: {
      display_name?: string;
    };
  };
  authorships?: {
    author?: {
      display_name?: string;
    };
  }[];
}

interface SemanticScholarSearchResponse {
  data?: SemanticScholarItem[];
}

interface SemanticScholarItem {
  paperId?: string;
  title?: string;
  authors?: {
    name?: string;
  }[];
  year?: number;
  venue?: string;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
  };
  url?: string;
}
