# Architecture

`search-bibtex` is a standalone pnpm/TypeScript CLI. Runtime code does not depend on Paperlib packages, components, hooks, plugin lifecycle, or internal data structures; Paperlib repositories are only reference material. Grok search is not part of the CLI or library runtime boundary.

## Data Flow

```text
PDF path / title / BibTeX entry
  |
  v
pdf.ts / metadata.ts / bibtex-file.ts
  extract text, title, authors, DOI, arXiv ID, year
  |
  v
search.ts
  query DBLP / arXiv / Crossref / OpenAlex / DOI / Semantic Scholar / custom sources
  normalize source records
  |
  v
ranking.ts
  score and sort candidates
  |
  v
bibtex.ts
  fetch source BibTeX or generate explicit BibTeX
  |
  v
selection.ts / cli.ts
  interactive selection or indexed selection
  |
  v
stdout BibTeX / JSON, stderr progress and source errors
```

## Module Responsibilities

| Module | Responsibility |
|---|---|
| `types.ts` | Cross-module data structures, including `PdfMetadataCandidate`, `SearchQueryCandidate`, `SearchResult`, `SearchPreferences`, and `SearchSourceError`. |
| `config.ts` | TOML parsing, default merging, source-priority validation, and custom source validation. |
| `pdf.ts` | PDF file reading and text snapshot extraction from the leading pages. |
| `metadata.ts` | Metadata candidate and search query generation from PDF text or title input. |
| `http.ts` | JSON/text fetch helpers and HTTP errors that preserve status and message. |
| `source.ts` | Unified interface for built-in and custom sources. |
| `custom-source.ts` | Declarative HTTP JSON sources, response path reading, and custom BibTeX strategies. |
| `search.ts` | Multi-source orchestration, normalization, ranking, and BibTeX retrieval. |
| `ranking.ts` | Title, author, year, identifier, and source-priority scoring. |
| `bibtex.ts` | DBLP/DOI BibTeX fetching or generated BibTeX from records. |
| `bibtex-file.ts` | Existing `.bib` parsing, title extraction, fuzzy search, and citation-key-preserving rewrites. |
| `selection.ts` | Testable selector state machine and real TTY interaction. |
| `cli.ts` | Commander commands, option parsing, progress output, and output formatting. |
| `index.ts` | Public library exports for scripts and future integrations. |

## Sources

Built-in sources are:

```text
dblp
arxiv
crossref
openalex
doi
semantic-scholar
```

The default source priority follows the same order. Each source search function should express the real request and real parsing logic. External service errors are caught by `searchBibtex()` and surfaced in `sourceErrors`. If no candidates are returned and source errors exist, the CLI exits as a failure.

Adding a built-in source requires updating:

1. The source list in `types.ts`.
2. Default priority or validation in `config.ts`.
3. Search, normalization, and source registration in `search.ts`.
4. Source-specific BibTeX retrieval in `bibtex.ts`, if needed.
5. `tests/search.test.ts` or related tests.
6. Source documentation in `README.md`, configuration docs, architecture docs, and `SKILL.md`.

Custom sources do not require source changes; they are declared through `[[sources]]` in `config.toml`.

## Ranking

The ranking entry point is `rankBibliographicCandidates(metadata, candidates, preferences)`. Scores are written to `SearchResult.score` and `SearchResult.scoreBreakdown` so JSON output and the interactive UI can explain why a candidate ranked where it did.

`SearchPreferences.sourcePriority` controls the source score. Earlier sources get higher source scores; the source score only affects ranking and does not skip lower-priority sources. Field weights are controlled by `SearchPreferences.weights` and are not normalized automatically.

## CLI Boundary

Progress and interactive UI output go to stderr. Machine-readable JSON or BibTeX goes to stdout. `search` opens the selector in a TTY and prints a full `SearchResponse` JSON outside a TTY. `select` is the explicit selection command; without `--select-index` it uses interactive selection, and with `--select-index` it prints `bibtex` or `json`.

`update` reads existing `.bib` files and preserves citation keys. In a TTY it confirms each entry. Outside a TTY it uses the top-ranked candidate. Unmatched entries keep their original content.

## Binary Build

`scripts/build-binaries.ts` first bundles `src/main.ts` into one CommonJS file with `esbuild`, then uses `pkg` to produce platform binaries. Packaging uses `--public --no-bytecode` to avoid cross-architecture V8 bytecode differences.

Current targets:

```text
node20-linux-x64
node20-linux-arm64
node20-macos-x64
node20-macos-arm64
node20-win-x64
node20-win-arm64
```

Output directories:

```text
dist-bin/linux-x64/search-bibtex
dist-bin/linux-arm64/search-bibtex
dist-bin/macos-x64/search-bibtex
dist-bin/macos-arm64/search-bibtex
dist-bin/win-x64/search-bibtex.exe
dist-bin/win-arm64/search-bibtex.exe
```
