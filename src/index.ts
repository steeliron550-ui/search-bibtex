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
