# 架构

`search-bibtex` 是独立的 pnpm/TypeScript CLI。运行时代码不依赖 Paperlib 包、组件、hook、插件生命周期或内部数据结构；Paperlib 相关仓库只能作为参考材料。Grok search 不属于 CLI 或库 API 的运行时边界。

## 数据流

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

## 模块职责

| Module | 职责 |
|---|---|
| `types.ts` | 定义跨模块数据结构，包括 `PdfMetadataCandidate`、`SearchQueryCandidate`、`SearchResult`、`SearchPreferences` 和 `SearchSourceError`。 |
| `config.ts` | 解析 TOML 配置、合并默认值、校验来源优先级和自定义来源定义。 |
| `pdf.ts` | 读取 PDF 文件并提取前若干页文本快照。 |
| `metadata.ts` | 从 PDF 文本或标题输入生成元数据候选和搜索查询。 |
| `http.ts` | 封装 JSON/text fetch 和 HTTP 错误，保留状态码和消息。 |
| `source.ts` | 定义内置和自定义来源统一接口。 |
| `custom-source.ts` | 实现声明式 HTTP JSON 来源、响应路径读取和自定义 BibTeX 策略。 |
| `search.ts` | 编排多源检索、归一化、排序和 BibTeX 获取。 |
| `ranking.ts` | 计算标题、作者、年份、标识符和来源优先级分数。 |
| `bibtex.ts` | 抓取 DBLP/DOI BibTeX，或根据记录生成 BibTeX。 |
| `bibtex-file.ts` | 解析现有 `.bib` 文件、提取标题、模糊搜索并保留 citation key 重写条目。 |
| `selection.ts` | 提供可测试的选择器状态机和真实 TTY 交互。 |
| `cli.ts` | 用 Commander 暴露命令、参数解析、进度输出和输出格式。 |
| `index.ts` | 导出公共库 API，供脚本和未来集成使用。 |

## 搜索来源

内置来源是：

```text
dblp
arxiv
crossref
openalex
doi
semantic-scholar
```

默认来源优先级同上。每个来源的搜索函数只表达真实请求和真实解析逻辑；外部服务错误由 `searchBibtex()` 捕获并写入 `sourceErrors`。没有候选且存在源错误时，CLI 以失败状态退出。

新增内置来源需要同时修改：

1. `types.ts` 中的来源列表。
2. `config.ts` 中的默认优先级或校验逻辑。
3. `search.ts` 中的搜索、归一化和来源注册逻辑。
4. `bibtex.ts` 中的专用 BibTeX 获取逻辑，若该来源需要。
5. `tests/search.test.ts` 或相关测试。
6. `README.md`、`README.en.md`、配置文档、架构文档和 `SKILL.md` 中的来源说明。

自定义来源不修改源码，通过 `config.toml` 的 `[[sources]]` 声明加入。

## 排序

排序入口是 `rankBibliographicCandidates(metadata, candidates, preferences)`。结果写入 `SearchResult.score` 和 `SearchResult.scoreBreakdown`，供 JSON 输出和交互界面解释排序来源。

`SearchPreferences.sourcePriority` 控制来源分。来源越靠前，`source` 分越高；来源分只参与排序，不会跳过低优先级来源。字段权重由 `SearchPreferences.weights` 控制，权重不自动归一化。

## CLI 边界

进度信息和交互 UI 写入 stderr，机器可读 JSON 或 BibTeX 写入 stdout。`search` 在 TTY 中会进入选择器，非 TTY 输出完整 `SearchResponse` JSON。`select` 用于显式选择；没有 `--select-index` 时走交互选择，有 `--select-index` 时输出 `bibtex` 或 `json`。

`update` 读取现有 `.bib` 文件并保留 citation key。TTY 环境中逐条确认；非 TTY 环境中使用排序第一的候选。无匹配条目保留原内容。

## 构建产物

`scripts/build-binaries.ts` 先用 `esbuild` 把 `src/main.ts` 打成单文件 CommonJS bundle，再用 `pkg` 为多个平台输出可执行文件。打包使用 `--public --no-bytecode`，避免跨架构 V8 bytecode 差异。

当前目标：

```text
node20-linux-x64
node20-linux-arm64
node20-macos-x64
node20-macos-arm64
node20-win-x64
node20-win-arm64
```

输出目录：

```text
dist-bin/linux-x64/search-bibtex
dist-bin/linux-arm64/search-bibtex
dist-bin/macos-x64/search-bibtex
dist-bin/macos-arm64/search-bibtex
dist-bin/win-x64/search-bibtex.exe
dist-bin/win-arm64/search-bibtex.exe
```
