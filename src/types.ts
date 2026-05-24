export type PaperSource =
  | "arxiv"
  | "crossref"
  | "semantic-scholar"
  | "openalex"
  | "dblp"
  | "doi";

export interface SortWeights {
  title: number;
  author: number;
  year: number;
  identifier: number;
  source: number;
}

export interface SearchPreferences {
  sourcePriority: PaperSource[];
  weights: SortWeights;
  limit: number;
}

export interface ScoreBreakdown {
  title: number;
  author: number;
  year: number;
  identifier: number;
  source: number;
}

export interface PdfMetadataCandidate {
  filePath: string;
  pageCount: number;
  title?: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  textSample: string;
}

export interface PdfDocumentSnapshot {
  filePath: string;
  pageCount: number;
  info: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
  };
  text: string;
  lines: string[];
}

export type SearchQueryKind = "doi" | "arxiv" | "title" | "title-author";

export interface SearchQueryCandidate {
  kind: SearchQueryKind;
  value: string;
  confidence: number;
}

export interface SearchResult {
  source: PaperSource;
  sourceId?: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  venue?: string;
  url?: string;
  matchedQuery: SearchQueryKind;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  bibtex: string;
}

export interface SearchSourceError {
  source: PaperSource;
  query: string;
  message: string;
  status?: number;
}

export interface SearchResponse {
  metadata: PdfMetadataCandidate;
  queries: SearchQueryCandidate[];
  results: SearchResult[];
  sourceErrors: SearchSourceError[];
}
