# search-bibtex

**English** | [**中文**](README.md)

`search-bibtex` is a standalone CLI that turns academic paper PDFs into BibTeX candidates. It extracts DOI, arXiv ID, title, authors, and year from local PDFs, searches DBLP, arXiv, Crossref, OpenAlex, DOI content negotiation, Semantic Scholar, and optional custom HTTP JSON sources, then ranks candidates by configured source priority and field weights. Users can choose a result interactively in the terminal or select a 0-based result index for scripts.

The project is distributed as multi-platform binaries, not as an npm package. Runtime code does not depend on Paperlib and does not integrate Grok search; Grok search may only be used as a development-time research aid.

## Features

- Extract searchable metadata from the first pages of paper PDFs.
- Search from PDFs, title strings, stdin title input, or existing `.bib` files.
- Query built-in sources: DBLP, arXiv, Crossref, OpenAlex, DOI, and Semantic Scholar.
- Configure source order, ranking weights, result limits, parallel search, and custom HTTP JSON sources through `config.toml`.
- Use a Vim-style interactive selector with filtering, or choose a result by index for automation.
- Refresh `.bib` entries while preserving original citation keys.
- Surface network failures, parse failures, empty results, and invalid config as explicit errors or `sourceErrors`.

## Install

Binaries are grouped by platform and architecture under `dist-bin/`:

```text
dist-bin/<platform-arch>/search-bibtex
dist-bin/<platform-arch>/search-bibtex.exe
```

Add the matching directory to `PATH`, or run the binary by absolute path. Running the binary does not require Node.js on the target machine.

## Quick Start

Inspect help and defaults:

```bash
search-bibtex --help
search-bibtex config-defaults
search-bibtex config-template
```

Extract PDF metadata:

```bash
search-bibtex metadata paper.pdf
```

Search a PDF and choose in a TTY; redirected or piped output is JSON:

```bash
search-bibtex search paper.pdf \
  --source-priority dblp,arxiv,crossref,openalex,doi \
  --limit 5 \
  --timeout 30
```

Print the first ranked candidate as BibTeX:

```bash
search-bibtex select paper.pdf --select-index 0 --format bibtex
```

Search from title strings. Multiple titles are split by semicolon by default:

```bash
search-bibtex search-title "Self-Instruct: Aligning Language Models with Self-Generated Instructions; DFlash: Block Diffusion for Flash Speculative Decoding"
printf 'Self-Instruct: Aligning Language Models with Self-Generated Instructions; DFlash: Block Diffusion for Flash Speculative Decoding' | search-bibtex search-title
```

Refresh an existing BibTeX file while keeping citation keys:

```bash
search-bibtex update references.bib --in-place
search-bibtex update references.bib --output updated.bib
```

## Configuration

The default config path is `~/.config/search-bibtex/config.toml`. A missing default-path config file is skipped and built-in defaults are used; an explicitly provided missing `--config <path>` fails. CLI flags override config file values.

Minimal config:

```toml
[search]
limit = 10
timeout_seconds = 30
parallel = true
source_priority = ["dblp", "arxiv", "crossref", "openalex", "doi", "semantic-scholar"]

[search.weights]
title = 0.45
author = 0.20
year = 0.10
identifier = 0.20
source = 0.05
```

Full reference: [Configuration](docs/CONFIGURATION.md) and [中文配置文档](docs/CONFIGURATION.zh-CN.md).

## CLI Commands

| Command | Purpose |
|---|---|
| `config-defaults` | Print default search and ranking preferences as JSON. |
| `config-template` | Print a TOML configuration template. |
| `metadata <pdf>` | Extract PDF metadata and generated search queries. |
| `search <pdf>` | Search and rank candidates; opens the selector in a TTY, prints JSON outside a TTY. |
| `select <pdf>` | Search and choose interactively, or print one candidate with `--select-index`. |
| `search-title [titles...]` | Search from title strings or stdin. |
| `update <bibtex>` | Refresh existing `.bib` entries while preserving citation keys. |

Interactive selector keys:

```text
j / Down     Move down
k / Up       Move up
g            Jump to first item
G            Jump to last item
/            Enter filter mode
Enter        Confirm filter or choose current candidate
Esc          Exit filter or cancel selection
q            Cancel selection
Ctrl-C       Cancel selection
```

## Build from Source

```bash
pnpm install
pnpm build
pnpm build:binary
```

Makefile entry points are also available:

```bash
make install
make build
make binary
make build-binaries
```

`make binary` builds the current-platform binary. `make build-binaries` builds every configured platform target.

## Development Docs

- [Configuration](docs/CONFIGURATION.md) / [配置](docs/CONFIGURATION.zh-CN.md)
- [Architecture](docs/ARCHITECTURE.md) / [架构](docs/ARCHITECTURE.zh-CN.md)
- [Testing](docs/TESTING.md) / [测试](docs/TESTING.zh-CN.md)
- [Contributing](CONTRIBUTING.md) / [贡献](CONTRIBUTING.zh-CN.md)
- [Releasing](RELEASING.md) / [发布](RELEASING.zh-CN.md)
- [Changelog](CHANGELOG.md) / [变更记录](CHANGELOG.zh-CN.md)

## Limits

PDF extraction depends on embedded text quality; scanned PDFs need OCR first. Anonymous Semantic Scholar requests may be rate-limited and will appear as source errors. External bibliography sources use different BibTeX styles; this tool preserves source BibTeX and only normalizes surrounding whitespace.

## License

MIT, see [LICENSE](LICENSE).
