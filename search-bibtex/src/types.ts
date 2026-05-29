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

export interface PdfMetadataCandidate {
  filePath: string;
  title?: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  textSample: string;
}

export interface SearchResult {
  source: PaperSource;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  venue?: string;
  url?: string;
  bibtex?: string;
  score: number;
}
