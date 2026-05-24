---
name: search-bibtex
description: Use when the user provides one or more academic PDF files or an existing BibTeX file and wants the search-bibtex binary to extract metadata, fuzzy-search bibliographic sources, refresh BibTeX, rank candidates with configurable source priority, load defaults from config.toml, and present an interactive Vim-key selection UI. Handles computer science preprints, conference papers, and journal papers through an independent CLI; does not depend on Paperlib.
---

# Search BibTeX

Use this skill for the `search-bibtex` binary. The binary is independent of Paperlib.

## Workflow

1. Confirm the binary is available:

   ```bash
   search-bibtex --help
   ```

2. Inspect PDF metadata and generated search queries:

   ```bash
   search-bibtex metadata <pdf-path>
   ```

3. Search and rank candidates. In a TTY, it opens the selector; when piped, it prints JSON:

   ```bash
   search-bibtex search <pdf-path> --limit 10 --timeout 30 --source-priority dblp,arxiv,crossref,openalex,doi
   ```

   Parallel source search is on by default; use `--no-parallel` only if the user wants serial lookup.
   If the user has a config file, pass `--config <path>` and let CLI flags override it.

   For title strings instead of PDFs, use `search-bibtex search-title`. Multiple titles in one input are split by `;` by default, and stdin is accepted when no title argument is provided.

4. Let the user choose a BibTeX entry:

   ```bash
   search-bibtex select <pdf-path> --limit 10 --timeout 30 --source-priority dblp,arxiv,crossref,openalex,doi
   ```

   The selector keeps the default parallel lookup behavior and still shows source progress in the terminal.

5. If the user already has a `.bib` file and wants refreshed fields without changing citation keys:

   ```bash
   search-bibtex update <bibtex-path> --in-place
   ```

   The `update` command also honors `--config <path>` and custom source definitions. In a TTY it shows a progress bar; interactive runs confirm each entry manually, and unmatched entries stay unchanged.

6. For non-interactive use, select by ranked index:

   ```bash
   search-bibtex select <pdf-path> --select-index 0 --format bibtex
   ```

## Source Priority

Use `--source-priority` to control search and ranking order. Good defaults for computer science papers are:

```bash
--source-priority dblp,arxiv,crossref,openalex,doi
```

Include `semantic-scholar` only when the user wants it or when the local environment can tolerate anonymous API rate limits:

```bash
--source-priority dblp,arxiv,crossref,openalex,semantic-scholar,doi
```

Use `--weights` when the user wants ranking behavior changed:

```bash
--weights title=0.5,author=0.2,year=0.1,identifier=0.15,source=0.05
```

`search-bibtex config-template` prints a TOML starter file. Config files can add custom HTTP sources and include their names in `source_priority`.

## Interaction

The interactive selector supports:

- `j` / `k` or arrow keys to move.
- `g` / `G` to jump to first or last visible candidate.
- `/` to filter candidates.
- `Enter` to select.
- `q`, `Esc`, or `Ctrl-C` to cancel.

Render UI goes to stderr and the selected BibTeX or JSON goes to stdout. When the user presses `Enter`, the screen shows the formatted BibTeX and the tool attempts to copy it to the clipboard if a local clipboard command is available.

## Failure Handling

Do not hide source failures. The `search` command returns explicit `sourceErrors`; the `select` command prints source errors to stderr before selection. If no candidates are returned, surface the CLI error to the user instead of fabricating a BibTeX entry.

Grok search may be used by the agent while improving or debugging this project, but it is not part of the skill workflow and must not be wired into the CLI runtime.
