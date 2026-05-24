/**
 * Barrel module that re-exports the public API of search-bibtex.
 *
 * Aggregates configuration, BibTeX parsing/refinement, download, metadata extraction,
 * PDF snapshot, ranking/scoring, search, and interactive selection utilities so consumers
 * can import everything from a single entry point.
 *
 * @module index
 */
export {
  ConfigError,
  defaultConfigToml,
  defaultSearchParallel,
  defaultSearchPreferences,
  defaultSearchTimeoutMs,
  defaultSearchTimeoutSeconds,
  loadConfig,
  loadResolvedAppConfig,
  resolveAppConfig,
  resolveConfigPath,
  validateSourcePriority
} from "./config.js";
export {
  buildPdfFilename,
  downloadFile,
  downloadPdfForResult,
  resolveDefaultDownloadDir,
  resolvePdfUrl,
  sanitizeFilename
} from "./download.js";
export {
  fetchBibtexForRecord,
  fetchDblpBibtex,
  fetchDoiBibtex,
  generateBibtex,
  normalizeDoi,
  normalizeBibtex
} from "./bibtex.js";
export {
  parseBibtexDocument,
  parseBibtexEntry,
  refineBibtexDocument,
  refineBibtexFile
} from "./bibtex-file.js";
export type {
  BibtexRefinementEntryReport,
  BibtexRefinementProgressEntry,
  BibtexRefinementProgressEvent,
  BibtexRefinementSelectionContext,
  BibtexRefinementSelectionRunner,
  BibtexRefinementResult
} from "./bibtex-file.js";
export {
  buildMetadataCandidate,
  buildTitleMetadataCandidate,
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
  createSearchSourceRegistry,
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
export type {
  AppConfig,
  CustomSourceBibtexConfig,
  CustomSourceConfig,
  CustomSourceFieldMap,
  CustomSourceResponseConfig,
  CustomSourceSearchConfig,
  LoadConfigOptions,
  LoadedAppConfig,
  ResolvedAppConfig,
  ResolvedSearchConfig
} from "./config.js";
export type { SearchSource, SearchSourceRegistry, SourceBibtexContext, SourceSearchContext } from "./source.js";
export type { SelectionEvent, SelectionState, SelectionMode } from "./selection.js";
