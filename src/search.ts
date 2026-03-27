/**
 * Searches for bibliographic records (BibTeX) across multiple academic sources
 * given PDF metadata or a file path to a PDF.
 *
 * The module orchestrates the search pipeline:
 * 1. Extracts metadata from a PDF (title, authors, DOI, arXiv ID, year).
 * 2. Queries built-in sources (arXiv, Crossref, Semantic Scholar, OpenAlex,
 *    DBLP, DOI resolver) and any custom sources in parallel or sequentially.
 * 3. Ranks candidate bibliographic records against the input metadata.
 * 4. Fetches BibTeX for the top-ranked candidates.
 *
 * @module search
 */

import { XMLParser } from "fast-xml-parser";

import { fetchBibtexForRecord } from "./bibtex.js";
import { defaultSearchPreferences, defaultSearchTimeoutMs, type CustomSourceConfig } from "./config.js";
import { createCustomSearchSource } from "./custom-source.js";
import type { FetchLike } from "./http.js";
import { fetchJson, fetchText, toSourceError } from "./http.js";
import { buildMetadataCandidate, generateSearchQueries, normalizeWhitespace, stripArxivVersion } from "./metadata.js";
import { extractPdfDocumentSnapshot } from "./pdf.js";
import { type BibliographicCandidate, rankBibliographicCandidates } from "./ranking.js";
import type { SearchSource, SearchSourceRegistry, SourceSearchContext } from "./source.js";
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

/**
 * Options that control the behaviour of a bibliography search.
 *
 * All properties are optional — sensible defaults are provided for each.
 */
export interface BibliographySearchOptions {
  fetcher?: FetchLike;
  preferences?: SearchPreferenceInput;
  customSources?: CustomSourceConfig[];
  sourceRegistry?: SearchSourceRegistry;
  pages?: number;
  onProgress?: (event: SearchProgressEvent) => void;
  parallel?: boolean;
  timeoutMs?: number;
}

/**
 * Progress event emitted during a search operation.
 *
 * Fired after each source completes (whether it succeeds or fails) so
 * consumers can report progress to the user.
 */
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
  const sourceRegistry = options.sourceRegistry ?? createSearchSourceRegistry(options.customSources);
  const preferences = mergeSearchPreferences(options.preferences);
  assertRegisteredSources(preferences.sourcePriority, sourceRegistry);
  const parallel = options.parallel ?? true;
  const timeoutMs = options.timeoutMs ?? defaultSearchTimeoutMs;
  if (parallel) {
    return await searchBibtexParallel(
      metadata,
      preferences,
      generateSearchQueries(metadata),
      options.fetcher ?? fetch,
      options.onProgress,
      timeoutMs,
      sourceRegistry
    );
  }

  const queries = generateSearchQueries(metadata);
  const timeout = createSearchTimeoutController(timeoutMs);
  const fetcher = options.fetcher ?? fetch;
  const onProgress = options.onProgress;
  const sourceErrors: SearchSourceError[] = [];
  const candidates: BibliographicCandidate[] = [];
  const completedSources: PaperSource[] = [];
  const failedSources: PaperSource[] = [];
  let timedOut = false;

  try {
    onProgress?.({
      completed: 0,
      total: preferences.sourcePriority.length,
      completedSources: [],
      failedSources: []
    });

    for (const source of preferences.sourcePriority) {
      try {
        candidates.push(...await searchSource(source, sourceRegistry, { metadata, queries, fetcher, signal: timeout.signal, limit: preferences.limit }));
        completedSources.push(source);
      } catch (error) {
        failedSources.push(source);
        sourceErrors.push(toSourceError(source, queries[0]?.value ?? metadata.title ?? metadata.filePath, error));
        if (isSearchTimeoutError(error)) {
          timedOut = true;
        }
      }
      onProgress?.({
        completed: completedSources.length + failedSources.length,
        total: preferences.sourcePriority.length,
        completedSources: orderedSourceList(preferences.sourcePriority, completedSources),
        failedSources: orderedSourceList(preferences.sourcePriority, failedSources)
      });
      if (timedOut) {
        break;
      }
    }

    const ranked = rankBibliographicCandidates(metadata, candidates, preferences).slice(0, preferences.limit * 2);
    const results: SearchResult[] = [];

    if (!timedOut) {
      for (const candidate of ranked) {
        try {
          const bibtex = await fetchBibtexForCandidate(candidate, sourceRegistry, fetcher, { signal: timeout.signal });
          results.push({ ...candidate, bibtex });
          if (results.length >= preferences.limit) {
            break;
          }
        } catch (error) {
          sourceErrors.push(toSourceError(candidate.source, candidate.title, error));
          if (isSearchTimeoutError(error)) {
            timedOut = true;
            break;
          }
        }
      }
    }

    return {
      metadata,
      queries,
      results,
      sourceErrors
    };
  } finally {
    timeout.cleanup();
  }
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

export function createSearchSourceRegistry(customSources: CustomSourceConfig[] = []): SearchSourceRegistry {
  const registry: SearchSourceRegistry = new Map();

  for (const source of builtinSearchSources) {
    registry.set(source.name, source);
  }

  for (const customSource of customSources) {
    if (!customSource.enabled) {
      continue;
    }
    if (registry.has(customSource.name)) {
      throw new Error(`Duplicate search source: ${customSource.name}`);
    }
    registry.set(customSource.name, createCustomSearchSource(customSource));
  }

  return registry;
}

async function searchBibtexParallel(
  metadata: PdfMetadataCandidate,
  preferences: SearchPreferences,
  queries: SearchQueryCandidate[],
  fetcher: FetchLike,
  onProgress: BibliographySearchOptions["onProgress"],
  timeoutMs: number,
  sourceRegistry: SearchSourceRegistry
): Promise<SearchResponse> {
  const candidatesBySource: Array<BibliographicCandidate[] | undefined> = new Array(preferences.sourcePriority.length);
  const sourceErrorsBySource: Array<SearchSourceError | undefined> = new Array(preferences.sourcePriority.length);
  const completedSources: PaperSource[] = [];
  const failedSources: PaperSource[] = [];

  onProgress?.({
    completed: 0,
    total: preferences.sourcePriority.length,
    completedSources: [],
    failedSources: []
  });

  await Promise.all(preferences.sourcePriority.map(async (source, index) => {
    const timeout = createSearchTimeoutController(timeoutMs);
    try {
      candidatesBySource[index] = await searchSource(source, sourceRegistry, {
        metadata,
        queries,
        fetcher,
        signal: timeout.signal,
        limit: preferences.limit
      });
      completedSources.push(source);
    } catch (error) {
      failedSources.push(source);
      sourceErrorsBySource[index] = toSourceError(
        source,
        queries[0]?.value ?? metadata.title ?? metadata.filePath,
        error
      );
    } finally {
      timeout.cleanup();
      onProgress?.({
        completed: completedSources.length + failedSources.length,
        total: preferences.sourcePriority.length,
        completedSources: orderedSourceList(preferences.sourcePriority, completedSources),
        failedSources: orderedSourceList(preferences.sourcePriority, failedSources)
      });
    }
  }));

  const candidates = candidatesBySource.flatMap((value) => value ?? []);
  const ranked = rankBibliographicCandidates(metadata, candidates, preferences).slice(0, preferences.limit * 2);
  const resultsByIndex: Array<SearchResult | undefined> = new Array(ranked.length);
  const bibtexErrorsByIndex: Array<SearchSourceError | undefined> = new Array(ranked.length);

  await Promise.all(ranked.map(async (candidate, index) => {
    const timeout = createSearchTimeoutController(timeoutMs);
    try {
      const bibtex = await fetchBibtexForCandidate(candidate, sourceRegistry, fetcher, { signal: timeout.signal });
      resultsByIndex[index] = { ...candidate, bibtex };
    } catch (error) {
      bibtexErrorsByIndex[index] = toSourceError(candidate.source, candidate.title, error);
    } finally {
      timeout.cleanup();
    }
  }));

  return {
    metadata,
    queries,
    results: resultsByIndex.filter((result): result is SearchResult => result !== undefined).slice(0, preferences.limit),
    sourceErrors: [
      ...sourceErrorsBySource.filter((error): error is SearchSourceError => error !== undefined),
      ...bibtexErrorsByIndex.filter((error): error is SearchSourceError => error !== undefined)
    ]
  };
}

function createSearchTimeoutController(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const graceMs = Math.min(1000, Math.max(100, Math.floor(timeoutMs * 0.01)));
  const timer = setTimeout(() => {
    controller.abort(new SearchTimeoutError(timeoutMs));
  }, timeoutMs + graceMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer)
  };
}

function isSearchTimeoutError(error: unknown): error is SearchTimeoutError {
  return error instanceof SearchTimeoutError
    || (error instanceof Error && error.message.startsWith("Search timed out after"));
}

function orderedSourceList(order: PaperSource[], sources: PaperSource[]): PaperSource[] {
  return order.filter((source) => sources.includes(source));
}

async function searchSource(
  source: PaperSource,
  sourceRegistry: SearchSourceRegistry,
  context: SourceSearchContext
): Promise<BibliographicCandidate[]> {
  const registeredSource = sourceRegistry.get(source);
  if (!registeredSource) {
    throw new Error(`Unknown search source: ${source}`);
  }
  return registeredSource.search(context);
}

async function fetchBibtexForCandidate(
  candidate: BibliographicCandidate,
  sourceRegistry: SearchSourceRegistry,
  fetcher: FetchLike,
  options: { signal?: AbortSignal }
): Promise<string> {
  const registeredSource = sourceRegistry.get(candidate.source);
  if (registeredSource?.fetchBibtex) {
    return registeredSource.fetchBibtex(candidate, { fetcher, signal: options.signal });
  }
  return fetchBibtexForRecord(candidate, fetcher, options);
}

function assertRegisteredSources(sourcePriority: PaperSource[], sourceRegistry: SearchSourceRegistry): void {
  const unknown = sourcePriority.filter((source) => !sourceRegistry.has(source));
  if (unknown.length > 0) {
    throw new Error(`Unknown source(s): ${unknown.join(", ")}`);
  }
}

const builtinSearchSources: SearchSource[] = [
  { name: "arxiv", search: searchArxiv },
  { name: "crossref", search: searchCrossref },
  { name: "semantic-scholar", search: searchSemanticScholar },
  { name: "openalex", search: searchOpenAlex },
  { name: "dblp", search: searchDblp },
  { name: "doi", search: async (context) => searchDoi(context.metadata) }
];

async function searchDblp(context: SourceSearchContext): Promise<BibliographicCandidate[]> {
  const query = context.metadata.doi ? `doi:${context.metadata.doi}` : context.metadata.title ?? context.queries[0].value;
  const url = new URL("https://dblp.org/search/publ/api");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("h", String(context.limit));

  const response = await fetchJson<DblpSearchResponse>(context.fetcher, url.toString(), { signal: context.signal });
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

  const xml = await fetchText(context.fetcher, url.toString(), "application/atom+xml", { signal: context.signal });
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
    const response = await fetchJson<CrossrefSingleResponse>(context.fetcher, url, { signal: context.signal });
    return [normalizeCrossrefItem(response.message)].filter(hasTitle);
  }

  if (!context.metadata.title) {
    return [];
  }

  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.title", context.metadata.title);
  url.searchParams.set("rows", String(context.limit));
  const response = await fetchJson<CrossrefSearchResponse>(context.fetcher, url.toString(), { signal: context.signal });
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

  const response = await fetchJson<OpenAlexSearchResponse>(context.fetcher, url.toString(), { signal: context.signal });
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
    const item = await fetchJson<SemanticScholarItem>(context.fetcher, url.toString(), { signal: context.signal });
    return [normalizeSemanticScholarItem(item)].filter(hasTitle);
  }

  if (!context.metadata.title) {
    return [];
  }

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", context.metadata.title);
  url.searchParams.set("limit", String(context.limit));
  url.searchParams.set("fields", "title,authors,year,venue,externalIds,url");
  const response = await fetchJson<SemanticScholarSearchResponse>(context.fetcher, url.toString(), { signal: context.signal });
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

class SearchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Search timed out after ${Math.round(timeoutMs / 1000)}s.`);
    this.name = "SearchTimeoutError";
  }
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
