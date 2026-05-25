# Configuration

`search-bibtex` reads search settings from config files and CLI flags. Precedence is:

1. CLI flags, such as `--limit`, `--timeout`, `--source-priority`, `--weights`, `--parallel`, and `--no-parallel`.
2. TOML config file.
3. Built-in defaults.

The default config path is `~/.config/search-bibtex/config.toml`. A missing file at that default path is skipped. A missing explicit `--config <path>` fails.

## Template

```bash
search-bibtex config-template > ~/.config/search-bibtex/config.toml
```

The template matches the built-in defaults:

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

## Search Settings

| TOML key | CLI override | Default | Description |
|---|---|---|---|
| `search.limit` | `--limit <count>` | `10` | Maximum number of ranked candidates to return. |
| `search.timeout_seconds` | `--timeout <seconds>` | `30` | Search-stage timeout in seconds. In parallel mode it applies per request; in serial mode it applies to the whole search stage. |
| `search.parallel` | `--parallel` / `--no-parallel` | `true` | Whether to query sources in parallel. |
| `search.source_priority` | `--source-priority <sources>` | `["dblp", "arxiv", "crossref", "openalex", "doi", "semantic-scholar"]` | Source query order and source-score order. |

Built-in sources:

```text
dblp
arxiv
crossref
openalex
doi
semantic-scholar
```

`source_priority` may reference enabled custom source names. Unknown sources raise a config error instead of being ignored.

## Ranking Weights

```toml
[search.weights]
title = 0.45
author = 0.20
year = 0.10
identifier = 0.20
source = 0.05
```

| Weight | Description |
|---|---|
| `title` | Similarity between input metadata and candidate title. |
| `author` | Author overlap. |
| `year` | Year match. |
| `identifier` | DOI or arXiv ID match. |
| `source` | Source-priority score. |

Weights must be non-negative numbers. The tool does not normalize them; larger values give a field more influence over the final ranking.

CLI override example:

```bash
search-bibtex search paper.pdf \
  --weights title=0.5,author=0.2,year=0.1,identifier=0.15,source=0.05
```

## Custom HTTP JSON Sources

Custom sources are defined in the `[[sources]]` array. The currently supported `kind` is `http-json`. A custom source name may contain letters, numbers, dots, underscores, and dashes, and cannot reuse a built-in source name.

```toml
[[sources]]
name = "acm"
kind = "http-json"
enabled = true

[sources.search]
url = "https://example.test/search?query={title}&limit={limit}"

[sources.response]
items_path = "items"

[sources.response.fields]
title = "title"
authors = "authors"
year = "year"
doi = "doi"
source_id = "id"
venue = "venue"
url = "url"

[sources.bibtex]
strategy = "url"
url_template = "https://example.test/bibtex/{sourceId}"
accept = "application/x-bibtex"
```

### Search URL Variables

| Variable | Value |
|---|---|
| `{title}` | Current metadata title. |
| `{doi}` | Current metadata DOI. |
| `{arxiv}` | Current metadata arXiv ID. |
| `{year}` | Current metadata year. |
| `{limit}` | Current result limit. |
| `{query}` | The first generated search query value. |

Template values are URL-encoded. Missing variables fail the command.

### Response Fields

`items_path` is a dot path to the response array. Array fields can be flattened; numeric path segments index arrays. `"."` and `"$"` refer to the response root.

`sources.response.fields.title` is required. Other fields are optional:

```text
source_id
authors
year
doi
arxiv_id
venue
url
```

Items without a title are skipped. Bad paths, non-object response items, and an `items_path` that does not resolve to an array are exposed as real errors.

### BibTeX Strategies

| Strategy | Config | Behavior |
|---|---|---|
| `doi` | `strategy = "doi"` | Fetch BibTeX for the candidate DOI through DOI content negotiation. |
| `url` | `strategy = "url"`, `url_template`, optional `accept` | Render a record URL and fetch BibTeX from it. |
| `generate` | `strategy = "generate"` | Generate BibTeX from the normalized candidate record. |

`url_template` supports `{sourceId}`, `{title}`, `{doi}`, `{arxiv}`, `{year}`, `{venue}`, and `{url}`. Missing variables fail the command.

## Command Behavior

`metadata` only reads the PDF and does not load config. `search`, `select`, `search-title`, and `update` load config and allow CLI flags to override it. `update` automatically uses the top-ranked candidate outside an interactive TTY; in an interactive TTY it confirms each entry, and unmatched entries remain unchanged.
