# search-bibtex

[**English**](README.en.md) | **中文**

`search-bibtex` 是一个独立的论文 PDF 到 BibTeX 命令行工具。它从本地论文 PDF 中提取 DOI、arXiv ID、标题、作者和年份，查询 DBLP、arXiv、Crossref、OpenAlex、DOI 内容协商、Semantic Scholar 以及可选的自定义 HTTP JSON 来源，然后按配置的来源优先级和字段权重排序候选结果。用户可以在终端中交互选择 BibTeX，也可以用 `--select-index` 做非交互选择。

项目以多平台二进制分发，不走 npm 发布。运行时代码不依赖 Paperlib，也不接入 Grok search；Grok search 只可作为开发期资料检索辅助工具。

## 功能

- 从论文 PDF 前若干页提取可搜索元数据。
- 支持 PDF、论文标题字符串、stdin 标题输入和现有 `.bib` 文件更新。
- 检索内置书目信息源：DBLP、arXiv、Crossref、OpenAlex、DOI、Semantic Scholar。
- 支持声明式 `config.toml`，可配置来源顺序、排序权重、结果数量、并行搜索和自定义 HTTP JSON 来源。
- 交互选择器支持 Vim 风格键位和过滤；脚本场景可直接选择 0-based index。
- 更新 `.bib` 文件时保留原 citation key，只替换条目内容。
- 网络失败、解析失败、无候选和无效配置会显式报错或写入 `sourceErrors`。

## 安装

二进制按平台和架构放在 `dist-bin/`：

```text
dist-bin/<platform-arch>/search-bibtex
dist-bin/<platform-arch>/search-bibtex.exe
```

把对应平台目录加入 `PATH`，或直接用绝对路径运行。运行二进制不需要本机安装 Node.js。

## 快速开始

查看帮助和默认配置：

```bash
search-bibtex --help
search-bibtex config-defaults
search-bibtex config-template
```

从 PDF 提取元数据：

```bash
search-bibtex metadata paper.pdf
```

搜索 PDF 并在 TTY 中选择候选；重定向或管道环境会输出 JSON：

```bash
search-bibtex search paper.pdf \
  --source-priority dblp,arxiv,crossref,openalex,doi \
  --limit 5 \
  --timeout 30
```

直接输出第 0 个候选的 BibTeX：

```bash
search-bibtex select paper.pdf --select-index 0 --format bibtex
```

从标题字符串搜索，多个标题默认用英文分号分隔：

```bash
search-bibtex search-title "Self-Instruct: Aligning Language Models with Self-Generated Instructions; DFlash: Block Diffusion for Flash Speculative Decoding"
printf 'Self-Instruct: Aligning Language Models with Self-Generated Instructions; DFlash: Block Diffusion for Flash Speculative Decoding' | search-bibtex search-title
```

更新现有 BibTeX 文件并保留引用名：

```bash
search-bibtex update references.bib --in-place
search-bibtex update references.bib --output updated.bib
```

## 配置

默认配置文件路径是 `~/.config/search-bibtex/config.toml`。缺省路径文件不存在时会直接使用内置默认值；显式传入 `--config <path>` 且文件不存在时会报错。命令行参数优先于配置文件。

最小配置：

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

完整配置说明见 [中文配置文档](docs/CONFIGURATION.zh-CN.md) 和 [English configuration docs](docs/CONFIGURATION.md)。

## CLI 命令

| Command | 用途 |
|---|---|
| `config-defaults` | 输出默认搜索和排序配置 JSON。 |
| `config-template` | 输出可修改的 TOML 配置样板。 |
| `metadata <pdf>` | 从 PDF 提取元数据和查询候选。 |
| `search <pdf>` | 搜索并排序候选；TTY 中进入交互选择器，非 TTY 输出 JSON。 |
| `select <pdf>` | 搜索后交互选择，或用 `--select-index` 输出指定候选。 |
| `search-title [titles...]` | 从标题字符串或 stdin 搜索候选。 |
| `update <bibtex>` | 刷新现有 `.bib` 文件条目并保留 citation key。 |

交互选择器键位：

```text
j / Down     向下移动
k / Up       向上移动
g            跳到第一项
G            跳到最后一项
/            进入过滤模式
Enter        确认过滤或选择当前候选
Esc          退出过滤或取消选择
q            取消选择
Ctrl-C       取消选择
```

### 从源码构建

```bash
pnpm install
pnpm build
pnpm build:binary
```

也可以使用 Makefile：

```bash
make install
make build
make binary
make build-binaries
```

`make binary` 生成当前平台二进制，`make build-binaries` 生成全部平台目标。

### 开发文档

- [配置](docs/CONFIGURATION.zh-CN.md) / [Configuration](docs/CONFIGURATION.md)
- [架构](docs/ARCHITECTURE.zh-CN.md) / [Architecture](docs/ARCHITECTURE.md)
- [测试](docs/TESTING.zh-CN.md) / [Testing](docs/TESTING.md)
- [贡献](CONTRIBUTING.zh-CN.md) / [Contributing](CONTRIBUTING.md)
- [发布](RELEASING.zh-CN.md) / [Releasing](RELEASING.md)
- [变更记录](CHANGELOG.zh-CN.md) / [Changelog](CHANGELOG.md)

### 限制

PDF 文本抽取依赖文件本身的可抽取文本质量；扫描版 PDF 需要先做 OCR。Semantic Scholar 匿名访问可能触发限流，限流会显示为源错误。外部书目信息源的 BibTeX 风格不完全一致，本工具保留源返回的 BibTeX，只做必要的首尾空白规范化。

### 许可证

MIT，见 [LICENSE](LICENSE)。

## English

`search-bibtex` is a standalone CLI that turns academic paper PDFs into BibTeX candidates. It extracts DOI, arXiv ID, title, authors, and year from local PDFs, searches DBLP, arXiv, Crossref, OpenAlex, DOI content negotiation, Semantic Scholar, and optional custom HTTP JSON sources, then ranks candidates by configured source priority and field weights. Users can choose a result interactively in the terminal or select a 0-based result index for scripts.

The project is distributed as multi-platform binaries, not as an npm package. Runtime code does not depend on Paperlib and does not integrate Grok search; Grok search may only be used as a development-time research aid.

### Features

- Extract searchable metadata from the first pages of paper PDFs.
- Search from PDFs, title strings, stdin title input, or existing `.bib` files.
- Query built-in sources: DBLP, arXiv, Crossref, OpenAlex, DOI, and Semantic Scholar.
- Configure source order, ranking weights, result limits, parallel search, and custom HTTP JSON sources through `config.toml`.
- Use a Vim-style interactive selector with filtering, or choose a result by index for automation.
- Refresh `.bib` entries while preserving original citation keys.
- Surface network failures, parse failures, empty results, and invalid config as explicit errors or `sourceErrors`.

### Install

Binaries are grouped by platform and architecture under `dist-bin/`:

```text
dist-bin/<platform-arch>/search-bibtex
dist-bin/<platform-arch>/search-bibtex.exe
```

Add the matching directory to `PATH`, or run the binary by absolute path. Running the binary does not require Node.js on the target machine.

### Quick Start

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

### Configuration

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

### CLI Commands

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

### Build from Source

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

### Development Docs

- [Configuration](docs/CONFIGURATION.md) / [配置](docs/CONFIGURATION.zh-CN.md)
- [Architecture](docs/ARCHITECTURE.md) / [架构](docs/ARCHITECTURE.zh-CN.md)
- [Testing](docs/TESTING.md) / [测试](docs/TESTING.zh-CN.md)
- [Contributing](CONTRIBUTING.md) / [贡献](CONTRIBUTING.zh-CN.md)
- [Releasing](RELEASING.md) / [发布](RELEASING.zh-CN.md)
- [Changelog](CHANGELOG.md) / [变更记录](CHANGELOG.zh-CN.md)

### Limits

PDF extraction depends on embedded text quality; scanned PDFs need OCR first. Anonymous Semantic Scholar requests may be rate-limited and will appear as source errors. External bibliography sources use different BibTeX styles; this tool preserves source BibTeX and only normalizes surrounding whitespace.

### License

MIT, see [LICENSE](LICENSE).
