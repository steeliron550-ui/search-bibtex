# develop.md

本文档面向维护者，描述 `search-bibtex` 的开发流程、架构和扩展方式。

## 项目边界

`search-bibtex` 是独立 pnpm/TypeScript 项目。根目录 `refs/` 中的 Paperlib 仓库只作为参考材料，不允许在运行时代码、构建脚本、skill 或 CLI 中依赖 Paperlib 包、组件、hook、插件生命周期或内部数据结构。

Grok search 只允许作为开发期资料检索工具使用，不能作为 CLI、skill 或库 API 的运行时依赖。

项目遵循显式失败策略。网络失败、解析失败、无候选、选择越界和 TTY 不可用都应抛出错误或写入结构化 `sourceErrors`。不要新增静默 fallback、模拟成功路径或吞错逻辑。

## 目录结构

```text
search-bibtex/
  package.json
  pnpm-lock.yaml
  tsconfig.json
  README.md
  develop.md
  SKILL.md
  agents/
    openai.yaml
  scripts/
    e2e-pdfs.ts
  src/
    bibtex.ts
    cli.ts
    config.ts
    http.ts
    index.ts
    metadata.ts
    pdf.ts
    ranking.ts
    search.ts
    selection.ts
    types.ts
  tests/
    config.test.ts
    metadata.test.ts
    search.test.ts
    selection.test.ts
```

## 核心数据流

```text
PDF path
  |
  v
pdf.ts
  extractPdfDocumentSnapshot()
  |
  v
metadata.ts
  buildMetadataCandidate()
  generateSearchQueries()
  |
  v
search.ts
  search DBLP / arXiv / Crossref / OpenAlex / DOI / Semantic Scholar
  normalize source records
  |
  v
ranking.ts
  rankBibliographicCandidates()
  |
  v
bibtex.ts
  fetch source BibTeX or generate explicit arXiv/manual BibTeX
  |
  v
selection.ts
  interactive selection or --select-index
  |
  v
stdout BibTeX / JSON
```

## 模块职责

`types.ts` 定义跨模块数据结构，包括 `PdfMetadataCandidate`、`SearchQueryCandidate`、`SearchResult`、`SearchPreferences` 和 `SearchSourceError`。

`config.ts` 保存默认排序配置。默认来源优先级是 `dblp,arxiv,crossref,openalex,doi,semantic-scholar`。

`pdf.ts` 只负责 PDF 文件读取和文本快照提取。当前实现读取前若干页，返回 PDF info metadata、文本和非空行。

`metadata.ts` 从 PDF 快照提取 DOI、arXiv ID、标题、作者和年份，并生成搜索查询。这里可以添加计算机科学论文常见版式规则，但不要把搜索源逻辑放进该模块。

`http.ts` 封装 `fetchJson`、`fetchText` 和 HTTP 错误。所有网络错误保留状态码和消息，供 `search.ts` 写入 `sourceErrors`。

`search.ts` 编排多源检索、源结果归一化、排序和 BibTeX 获取。每个外部信息源有独立的 search/normalize 函数。

`ranking.ts` 计算候选分数。当前分数字段包括标题、作者、年份、标识符和来源优先级。

`bibtex.ts` 负责 BibTeX 获取和生成。DBLP 记录使用 `https://dblp.org/rec/<key>.bib`；DOI 记录使用 `https://doi.org/<doi>` 的 BibTeX 内容协商；arXiv 或无 DOI 记录生成明确来源的 BibTeX。

`selection.ts` 包含可测试的选择器状态机和真实 TTY 交互。状态机不依赖终端 IO，单元测试应优先覆盖该层。

`cli.ts` 用 Commander 暴露 `config-defaults`、`metadata`、`search` 和 `select` 命令。

`index.ts` 导出库 API，脚本和未来集成都应从这里导入公共能力。

## 添加新的信息源

新增来源需要同时修改以下位置：

1. 在 `types.ts` 的 `PaperSource` 中增加来源名称。
2. 在 `config.ts` 中决定默认优先级位置。
3. 在 `search.ts` 中增加 `searchSource` 分支、搜索函数、响应类型和归一化函数。
4. 如果该来源有专用 BibTeX 获取方式，在 `bibtex.ts` 中增加分支。
5. 在 `tests/search.test.ts` 中添加归一化和聚合测试。
6. 更新 `README.md`、`develop.md` 和 `SKILL.md` 的来源说明。

新增源必须返回统一 `BibliographicCandidate`。搜索函数应只抛出真实错误；由 `searchBibtex()` 捕获并写入 `sourceErrors`。

## 排序规则

排序入口是 `rankBibliographicCandidates(metadata, candidates, preferences)`。打分结果写入 `SearchResult.scoreBreakdown`，方便 CLI JSON 输出和交互界面解释排序来源。

来源优先级通过 `SearchPreferences.sourcePriority` 控制。来源越靠前，`source` 分越高；`source` 权重只影响排序，不会跳过低优先级来源。

字段权重通过 `SearchPreferences.weights` 控制。权重不自动归一化，调用方可以让某个字段占更大比例。

## CLI 开发

开发期运行：

```bash
pnpm --dir search-bibtex dev -- --help
```

构建后运行：

```bash
pnpm --dir search-bibtex build
node search-bibtex/dist/cli.js --help
```

命令参数解析集中在 `cli.ts`。无效来源、无效权重、非法 index 和非 TTY 交互选择都应报错，不要自动改用默认值。

## 测试策略

普通测试不访问真实网络：

```bash
pnpm --dir search-bibtex test
```

类型检查：

```bash
pnpm --dir search-bibtex typecheck
```

构建：

```bash
pnpm --dir search-bibtex build
```

端到端测试访问真实网络和根目录 `pdfs/` 样本：

```bash
pnpm --dir search-bibtex test:e2e
```

`scripts/e2e-pdfs.ts` 使用三个本地 PDF 样本，执行 PDF 解析、搜索、排序、`--select-index 0` 等价选择和 BibTeX 首行校验。该测试会因为网络源错误而失败。

## Skill 开发

Skill 文件：

```text
search-bibtex/SKILL.md
search-bibtex/agents/openai.yaml
```

修改 skill 后运行校验脚本：

```bash
python /home/march/.codex/skills/.system/skill-creator/scripts/quick_validate.py search-bibtex
```

Skill 文档应指向本项目 CLI，不应复制实现逻辑。CLI 参数发生变化时，同步更新 `README.md` 和 `SKILL.md`。

## 发布检查

提交前执行：

```bash
pnpm --dir search-bibtex test
pnpm --dir search-bibtex typecheck
pnpm --dir search-bibtex build
pnpm --dir search-bibtex test:e2e
git diff --check
```

提交前检查变更范围：

```bash
git diff
git status --short --branch
```

根目录 `.gitignore` 已忽略 `refs/`、`pdfs/`、`node_modules/`、`dist/` 和覆盖率产物。`pdfs/` 是本地测试输入，不应提交。
