# search-bibtex 实施计划

## 目标

在 `search-bibtex/` 中实现一个独立的 pnpm/TypeScript 项目，提供可直接运行的 CLI 和一个 Codex agent skill。它读取本地论文 PDF，识别计算机科学论文元数据，按可配置优先级进行模糊搜索和 BibTeX 抓取，并通过交互式界面把候选结果交给用户选择。

`refs/` 目录中的 Paperlib 相关仓库只作为参考实现，用于理解 PDF 元数据抽取、BibTeX 处理和论文源覆盖思路。项目不得依赖 Paperlib 的任何运行时、API、模型、hook、插件管理器或扩展组件。

## 约束

- 使用 pnpm 管理依赖和脚本。
- 使用 TypeScript 实现核心逻辑和 CLI。
- 不引入 Paperlib 组件依赖。
- 不增加静默 fallback、模拟成功路径或吞错逻辑；失败必须显式暴露。
- 主要覆盖计算机科学领域的预印本、会议和期刊论文。
- 搜索结果排序必须允许用户配置来源优先级和打分权重。
- 选择界面必须是交互式设计，支持类 Vim 键位。
- 使用 `pdfs/` 下的论文作为本地测试输入，但不把 PDF 样本纳入项目提交。
- 每个阶段通过对应测试后提交一次 Git commit。

## 参考范围

- `refs/paperlib-entry-scrape-extension/`：参考 PDF 元数据抽取、BibTeX 解析、元数据抓取入口组织方式。
- `refs/paperlib-format-pubname-extension/`：参考计算机科学会议和期刊名称归一化数据。
- `refs/paperlib-citation-count-extension/`：参考 DOI、arXiv、标题等检索键的处理方式。

这些参考只能转化为独立实现中的设计思路或少量领域数据，不能形成运行时依赖。

## 阶段 0：项目管理基线

产物：

- 根目录 `PLAN.md`。
- 根目录 `.gitignore`，忽略 `refs/`、`pdfs/`、依赖目录和构建产物。
- 初始化 Git 仓库。

验证：

- `git status --short --branch` 只显示计划纳入版本管理的项目文件。

提交：

- `docs: add implementation plan`

## 阶段 1：独立项目骨架

产物：

- `search-bibtex/package.json`
- `search-bibtex/pnpm-lock.yaml`
- `search-bibtex/tsconfig.json`
- `search-bibtex/src/cli.ts`
- `search-bibtex/src/index.ts`
- `search-bibtex/src/types.ts`
- 基础测试框架和最小 CLI 命令。

验证：

- `pnpm install`
- `pnpm --dir search-bibtex typecheck`
- `pnpm --dir search-bibtex test`
- `pnpm --dir search-bibtex build`

提交：

- `chore: scaffold search-bibtex cli`

## 阶段 2：PDF 元数据识别

产物：

- 本地 PDF 解析模块，提取 PDF info metadata、第一页或前几页文本、DOI、arXiv ID、标题候选、作者候选和年份。
- 查询候选生成模块，输出结构化 `MetadataCandidate` 和搜索查询列表。
- 单元测试覆盖 DOI、arXiv、标题清洗和查询生成。

验证：

- 使用 `pdfs/` 中至少 3 篇论文跑本地 CLI 元数据识别。
- 单元测试、类型检查和构建全部通过。

提交：

- `feat: extract pdf metadata candidates`

## 阶段 3：模糊搜索和 BibTeX 抓取

产物：

- 多源搜索模块，优先覆盖 arXiv、Crossref、Semantic Scholar、OpenAlex，必要时用 DBLP 或 DOI 内容协商补充 BibTeX。
- DBLP 是一等 BibTeX 信息源，必须支持 DBLP publication search API 和单条记录 BibTeX 抓取。
- Grok search 只能作为本次项目构建时的资料检索辅助，不得接入 CLI、skill 或运行时代码。
- 结果归一化为统一 `SearchResult`。
- 模糊匹配和排序模块，支持用户配置来源优先级、字段权重和结果数量。
- BibTeX 获取与规范化模块。
- 网络集成测试采用显式命令运行，不在普通单元测试中隐藏网络失败。

验证：

- 单元测试覆盖排序和归一化。
- 用 `pdfs/` 中至少 3 篇论文执行真实搜索并返回候选 BibTeX。
- 类型检查和构建全部通过。

提交：

- `feat: search and rank bibtex candidates`

## 阶段 4：交互式选择界面

产物：

- 终端交互选择器，支持 `j/k` 或方向键移动、`g/G` 跳转、`/` 搜索过滤、`Enter` 选择、`q` 退出。
- 候选详情预览，包括标题、作者、年份、来源、DOI、arXiv、匹配分数和 BibTeX 预览。
- 非交互模式，用于测试和脚本化选择。

验证：

- 单元测试覆盖选择器状态机。
- CLI 非交互模式可在测试中稳定选择指定候选。
- 手动运行交互命令确认键位可用。
- 类型检查和构建全部通过。

提交：

- `feat: add interactive bibtex selection`

## 阶段 5：agent skill 插件

产物：

- `search-bibtex/SKILL.md`，描述何时触发该 skill、如何运行 CLI、如何配置排序优先级、如何处理交互结果。
- `search-bibtex/agents/openai.yaml`，提供 agent UI 元数据。
- CLI 帮助信息与 skill 文档一致。

验证：

- 检查 skill 文件结构符合 Codex skill 规范。
- `pnpm --dir search-bibtex test`
- `pnpm --dir search-bibtex typecheck`
- `pnpm --dir search-bibtex build`

提交：

- `docs: add search-bibtex skill`

## 阶段 6：端到端测试与收尾

产物：

- 端到端测试脚本，使用 `pdfs/` 中样本完成 PDF 识别、搜索、排序、选择和 BibTeX 输出。
- 更新必要文档，移除临时调试输出。

验证：

- `pnpm --dir search-bibtex test`
- `pnpm --dir search-bibtex typecheck`
- `pnpm --dir search-bibtex build`
- 对至少 3 个 `pdfs/` 样本执行端到端命令并记录结果。
- `git diff --check`
- `git status --short --branch`

提交：

- `test: add pdf bibtex end-to-end coverage`
