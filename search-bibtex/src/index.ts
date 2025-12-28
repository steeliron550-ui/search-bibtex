export { defaultSearchPreferences } from "./config.js";
export {
  fetchBibtexForRecord,
  fetchDblpBibtex,
  fetchDoiBibtex,
  generateBibtex,
  normalizeDoi,
  normalizeBibtex
} from "./bibtex.js";
export {
  buildMetadataCandidate,
  extractArxivId,
  extractDoi,
  generateSearchQueries,
  stripArxivVersion
} from "./metadata.js";
export { extractPdfDocumentSnapshot } from "./pdf.js";
export { rankBibliographicCandidates, scoreCandidate, textSimilarity } from "./ranking.js";
export {
  createSelectionState,
  formatSelectedResult,
  keypressToSelectionEvent,
  renderSelection,
  runInteractiveSelection,
  selectedResultByIndex,
  updateSelectionState,
  visibleIndexes
} from "./selection.js";
export {
  mergeSearchPreferences,
  normalizeArxivFeed,
  normalizeDblpHits,
  searchBibtex,
  searchBibtexFromPdf
} from "./search.js";
export type {
  PaperSource,
  PdfDocumentSnapshot,
  PdfMetadataCandidate,
  ScoreBreakdown,
  SearchPreferences,
  SearchQueryCandidate,
  SearchQueryKind,
  SearchResponse,
  SearchResult,
  SearchSourceError,
  SortWeights
} from "./types.js";
export type { SelectionEvent, SelectionState, SelectionMode } from "./selection.js";
