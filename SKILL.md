---
name: search-bibtex
description: Use when the user provides one or more academic PDF files or an existing BibTeX file and wants the search-bibtex binary to extract metadata, fuzzy-search bibliographic sources, refresh BibTeX, rank candidates with configurable source priority, load defaults from config.toml, and present an interactive Vim-key selection UI. Handles computer science preprints, conference papers, and journal papers through an independent CLI; does not depend on Paperlib.
---

# Search BibTeX

Use this skill for the `search-bibtex` binary. The binary is independent of Paperlib. Grok search may be used while improving or debugging this project, but it must stay out of the CLI runtime and skill workflow.

## Workflow

1. Confirm the binary is available:

   ```bash
   search-bibtex --help
   ```

2. Inspect PDF metadata and generated search queries:

   ```bash
   search-bibtex metadata <pdf-path>
   ```

3. Search and rank candidates. In a TTY, `search` opens the selector; when piped, it prints JSON:

   ```bash
   search-bibtex search <pdf-path> --limit 10 --timeout 30 --source-priority dblp,arxiv,crossref,openalex,doi
   ```

   Parallel source search is enabled by default. Use `--no-parallel` only when serial lookup is explicitly wanted. If the user has a config file, pass `--config <path>` and let CLI flags override it.

4. For title strings instead of PDFs, use `search-bibtex search-title`. Multiple titles in one input are split by `;` by default, and stdin is accepted when no title argument is provided.

5. Let the user choose a BibTeX entry:

   ```bash
   search-bibtex select <pdf-path> --limit 10 --timeout 30 --source-priority dblp,arxiv,crossref,openalex,doi
   ```

6. If the user already has a `.bib` file and wants refreshed fields without changing citation keys:

   ```bash
   search-bibtex update <bibtex-path> --in-place
   ```

7. For non-interactive use, select by ranked index:

   ```bash
   search-bibtex select <pdf-path> --select-index 0 --format bibtex
   ```

## Source Priority

The built-in default source order is:

```text
dblp,arxiv,crossref,openalex,doi,semantic-scholar
```

For computer science papers, this order avoids Semantic Scholar's anonymous rate limits:

```bash
--source-priority dblp,arxiv,crossref,openalex,doi
```

Include `semantic-scholar` only when the user wants it or the local environment can tolerate anonymous API rate limits:

```bash
--source-priority dblp,arxiv,crossref,openalex,semantic-scholar,doi
```

Use `--weights` when ranking behavior should change:

```bash
--weights title=0.5,author=0.2,year=0.1,identifier=0.15,source=0.05
```

`search-bibtex config-template` prints a TOML starter file. Config files can add custom HTTP sources and include their names in `source_priority`. Full config docs are in `docs/CONFIGURATION.md`.

## Interaction

The interactive selector supports:

- `j` / `k` or arrow keys to move.
- `g` / `G` to jump to first or last visible candidate.
- `/` to filter candidates.
- `Enter` to select.
- `q`, `Esc`, or `Ctrl-C` to cancel.

Render UI goes to stderr and selected BibTeX or JSON goes to stdout. When the user presses `Enter`, the screen shows formatted BibTeX and the tool attempts to copy it to the clipboard if a local clipboard command is available.

## Failure Handling

Do not hide source failures. `search` returns explicit `sourceErrors`; `select` prints source errors to stderr before selection. If no candidates are returned, surface the CLI error instead of fabricating a BibTeX entry.
