# 配置

`search-bibtex` 从配置文件和命令行参数读取搜索设置。优先级是：

1. 命令行参数，例如 `--limit`、`--timeout`、`--source-priority`、`--weights`、`--parallel`、`--no-parallel`。
2. TOML 配置文件。
3. 内置默认值。

默认配置文件路径是 `~/.config/search-bibtex/config.toml`。默认路径文件不存在时会跳过配置文件；显式传入 `--config <path>` 且文件不存在时会失败。

## 生成样板

```bash
search-bibtex config-template > ~/.config/search-bibtex/config.toml
```

样板内容等价于内置默认值：

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

## 搜索设置

| TOML key | CLI override | 默认值 | 说明 |
|---|---|---|---|
| `search.limit` | `--limit <count>` | `10` | 返回的最大排序候选数。 |
| `search.timeout_seconds` | `--timeout <seconds>` | `30` | 搜索阶段超时秒数。并行模式下按请求计算，串行模式下按总搜索阶段计算。 |
| `search.parallel` | `--parallel` / `--no-parallel` | `true` | 是否并行查询来源。 |
| `search.source_priority` | `--source-priority <sources>` | `["dblp", "arxiv", "crossref", "openalex", "doi", "semantic-scholar"]` | 来源查询和来源分排序顺序。 |

内置来源：

```text
dblp
arxiv
crossref
openalex
doi
semantic-scholar
```

`source_priority` 可以引用启用的自定义来源名称。未知来源会触发配置错误，不会被静默忽略。

## 排序权重

```toml
[search.weights]
title = 0.45
author = 0.20
year = 0.10
identifier = 0.20
source = 0.05
```

| Weight | 说明 |
|---|---|
| `title` | PDF 或标题输入与候选标题的相似度。 |
| `author` | 作者重合度。 |
| `year` | 年份匹配。 |
| `identifier` | DOI 或 arXiv ID 匹配。 |
| `source` | 来源优先级得分。 |

权重必须是非负数字。工具不会自动归一化权重；数值越大，该字段对最终排序影响越高。

命令行覆盖示例：

```bash
search-bibtex search paper.pdf \
  --weights title=0.5,author=0.2,year=0.1,identifier=0.15,source=0.05
```

## 自定义 HTTP JSON 来源

自定义来源使用 `[[sources]]` 数组定义。当前支持的 `kind` 是 `http-json`。自定义来源名称必须由字母、数字、点、下划线或短横线组成，不能复用内置来源名。

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

### 搜索 URL 模板变量

| Variable | 来源 |
|---|---|
| `{title}` | 当前元数据标题。 |
| `{doi}` | 当前元数据 DOI。 |
| `{arxiv}` | 当前元数据 arXiv ID。 |
| `{year}` | 当前元数据年份。 |
| `{limit}` | 当前搜索结果数量限制。 |
| `{query}` | 生成查询列表中的第一个查询值。 |

模板变量会被 URL 编码。变量缺失时命令会报错。

### 响应字段

`items_path` 使用点分路径读取响应中的数组。数组字段可以直接展开；数字路径段用于数组下标。`"."` 或 `"$"` 表示响应根对象。

`sources.response.fields.title` 是必填字段。其他字段可选：

```text
source_id
authors
year
doi
arxiv_id
venue
url
```

没有标题的响应项会被跳过。路径错误、响应项不是对象、`items_path` 未解析为数组等问题会作为真实错误暴露。

### BibTeX 策略

| Strategy | 配置 | 行为 |
|---|---|---|
| `doi` | `strategy = "doi"` | 使用候选 DOI 通过 DOI 内容协商获取 BibTeX。 |
| `url` | `strategy = "url"`、`url_template`、可选 `accept` | 按记录字段渲染 URL 并抓取 BibTeX。 |
| `generate` | `strategy = "generate"` | 根据候选记录生成 BibTeX。 |

`url_template` 支持 `{sourceId}`、`{title}`、`{doi}`、`{arxiv}`、`{year}`、`{venue}` 和 `{url}`。缺失变量会报错。

## 命令行为

`metadata` 只读取 PDF，不读取配置文件。`search`、`select`、`search-title` 和 `update` 会读取配置文件，并允许命令行参数覆盖配置。`update` 在非交互环境下自动使用排序第一的候选；交互环境下逐条确认，未匹配条目保持原样。
