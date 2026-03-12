/**
 * source.ts — Search source interface and registry types.
 *
 * Defines the contract that every bibliographic source (built-in or custom)
 * must fulfil, and the shared context objects passed to source functions at
 * search time and BibTeX-fetch time.
 */

import type { BibtexRecord } from "./bibtex.js";
import type { FetchLike, FetchRequestOptions } from "./http.js";
import type { BibliographicCandidate } from "./ranking.js";
import type { PaperSource, PdfMetadataCandidate, SearchQueryCandidate } from "./types.js";

/**
 * Context passed to a source's `search()` function.
 * Contains everything the source needs to execute a search: metadata,
 * pre-generated query candidates, an HTTP fetcher, an optional abort signal,
 * and a result limit.
 */
export interface SourceSearchContext {
  metadata: PdfMetadataCandidate;
  queries: SearchQueryCandidate[];
  fetcher: FetchLike;
  signal?: AbortSignal;
  limit: number;
}

/**
 * Context passed to a source's optional `fetchBibtex()` function.
 * Extends the base fetch request options with the fetcher to use.
 */
export interface SourceBibtexContext extends FetchRequestOptions {
  fetcher: FetchLike;
}

/**
 * A registered search source.  The `search()` function performs a search
 * against the source's API; the optional `fetchBibtex()` function retrieves
 * formatted BibTeX for a specific record if the source provides one
 * directly (e.g. DBLP or DOI content negotiation).
 */
export interface SearchSource {
  name: PaperSource;
  search: (context: SourceSearchContext) => Promise<BibliographicCandidate[]>;
  fetchBibtex?: (record: BibtexRecord, context: SourceBibtexContext) => Promise<string>;
}

/** Maps source names to their SearchSource implementations. */
export type SearchSourceRegistry = Map<PaperSource, SearchSource>;
