---
name: search-bibtex
description: Use when the user provides one or more academic PDF files and wants an agent to extract paper metadata, fuzzy-search bibliographic sources, fetch BibTeX, rank candidates with configurable source priority, and present an interactive Vim-key selection UI. Handles computer science preprints, conference papers, and journal papers through an independent CLI; does not depend on Paperlib.
---

# Search BibTeX

Use this skill for academic PDF to BibTeX workflows. The bundled CLI is independent of Paperlib and must be run from this skill directory with pnpm.

## Workflow

1. Ensure dependencies are installed:

   ```bash
   pnpm --dir <skill-dir> install
   ```

2. Inspect PDF metadata and generated search queries:

   ```bash
   pnpm --dir <skill-dir> dev metadata <pdf-path>
   ```

3. Search and rank candidates as JSON:

   ```bash
   pnpm --dir <skill-dir> dev search <pdf-path> --limit 10 --source-priority dblp,arxiv,crossref,openalex,doi
   ```

4. Let the user choose a BibTeX entry:

   ```bash
   pnpm --dir <skill-dir> dev select <pdf-path> --limit 10 --source-priority dblp,arxiv,crossref,openalex,doi
   ```

5. For non-interactive use, select by ranked index:

   ```bash
   pnpm --dir <skill-dir> dev select <pdf-path> --select-index 0 --format bibtex
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

## Interaction

The interactive selector supports:

- `j` / `k` or arrow keys to move.
- `g` / `G` to jump to first or last visible candidate.
- `/` to filter candidates.
- `Enter` to select.
- `q`, `Esc`, or `Ctrl-C` to cancel.

Render UI goes to stderr and the selected BibTeX or JSON goes to stdout.

## Failure Handling

Do not hide source failures. The `search` command returns explicit `sourceErrors`; the `select` command prints source errors to stderr before selection. If no candidates are returned, surface the CLI error to the user instead of fabricating a BibTeX entry.

Grok search may be used by the agent while improving or debugging this project, but it is not part of the skill workflow and must not be wired into the CLI runtime.
