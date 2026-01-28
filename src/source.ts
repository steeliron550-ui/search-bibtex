import type { BibtexRecord } from "./bibtex.js";
import type { FetchLike, FetchRequestOptions } from "./http.js";
import type { BibliographicCandidate } from "./ranking.js";
import type { PaperSource, PdfMetadataCandidate, SearchQueryCandidate } from "./types.js";

export interface SourceSearchContext {
  metadata: PdfMetadataCandidate;
  queries: SearchQueryCandidate[];
  fetcher: FetchLike;
  signal?: AbortSignal;
  limit: number;
}

export interface SourceBibtexContext extends FetchRequestOptions {
  fetcher: FetchLike;
}

export interface SearchSource {
  name: PaperSource;
  search: (context: SourceSearchContext) => Promise<BibliographicCandidate[]>;
  fetchBibtex?: (record: BibtexRecord, context: SourceBibtexContext) => Promise<string>;
}

export type SearchSourceRegistry = Map<PaperSource, SearchSource>;
