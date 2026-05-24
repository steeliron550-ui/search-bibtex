# search-bibtex

`search-bibtex` 是一个独立的论文 PDF 到 BibTeX 工具。它从本地 PDF 中提取计算机科学论文元数据，生成 DOI、arXiv、标题和标题作者查询，检索多个公开书目信息源，按用户配置的优先级和权重排序候选结果，并让用户在终端中交互选择最终 BibTeX。

项目同时提供 CLI 和 Codex skill。`refs/` 中的 Paperlib 仓库只用于参考设计，本项目不依赖 Paperlib 的组件、运行时、插件接口或数据模型。Grok search 只在项目构建阶段用于资料检索，没有接入 CLI 或 skill。

## 功能范围

- 识别论文 PDF 前若干页中的 DOI、arXiv ID、标题、作者和年份。
- 覆盖计算机科学常见预印本、会议和期刊论文。
- 检索 DBLP、arXiv、Crossref、OpenAlex、DOI 内容协商和 Semantic Scholar。
- DBLP 是一等信息源，支持 publication search API 和单条记录 `.bib` 抓取。
- 支持来源优先级、字段打分权重和返回数量配置。
- 交互式候选选择支持类 Vim 键位，也支持非交互脚本化选择。
- 失败会显式报错或出现在 `sourceErrors` 中，不提供模拟成功结果。

## 环境要求

- Node.js 20 或更新版本。
- pnpm。
- 可访问 DBLP、arXiv、Crossref、OpenAlex、doi.org 和 Semantic Scholar 等外部服务的网络环境。

## 安装

从仓库根目录安装依赖：

```bash
pnpm --dir search-bibtex install
```

构建 CLI：

```bash
pnpm --dir search-bibtex build
```

开发期也可以直接用 `tsx` 运行源码：

```bash
pnpm --dir search-bibtex dev -- --help
```

构建后可执行文件位于：

```text
search-bibtex/dist/cli.js
```

## CLI 用法

查看默认排序配置：

```bash
pnpm --dir search-bibtex dev -- config-defaults
```

提取 PDF 元数据和查询候选：

```bash
pnpm --dir search-bibtex dev -- metadata ../pdfs/2023.acl-long.754.pdf
```

搜索并返回 JSON 候选：

```bash
pnpm --dir search-bibtex dev -- search ../pdfs/2023.acl-long.754.pdf \
  --source-priority dblp,arxiv,crossref,openalex,doi \
  --limit 5
```

交互选择 BibTeX：

```bash
pnpm --dir search-bibtex dev -- select ../pdfs/2023.acl-long.754.pdf
```

非交互选择第 0 个候选，适合脚本和测试：

```bash
pnpm --dir search-bibtex dev -- select ../pdfs/2023.acl-long.754.pdf \
  --select-index 0 \
  --format bibtex
```

输出完整 JSON：

```bash
pnpm --dir search-bibtex dev -- select ../pdfs/2023.acl-long.754.pdf \
  --select-index 0 \
  --format json
```

## 排序配置

默认来源优先级：

```text
dblp,arxiv,crossref,openalex,doi,semantic-scholar
```

可用来源：

```text
dblp
arxiv
crossref
openalex
doi
semantic-scholar
```

字段权重通过 `--weights` 设置：

```bash
pnpm --dir search-bibtex dev -- search ../pdfs/2023.acl-long.754.pdf \
  --weights title=0.5,author=0.2,year=0.1,identifier=0.15,source=0.05
```

可用权重字段：

```text
title       标题相似度
author      作者重合度
year        年份匹配
identifier  DOI 或 arXiv ID 匹配
source      来源优先级
```

权重值必须是非负数字。工具不会自动归一化权重；数值越大，该字段对排序影响越高。

## 交互键位

交互选择界面默认写入 stderr，最终 BibTeX 或 JSON 写入 stdout。

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

过滤内容会匹配标题、作者、venue、来源、DOI 和 arXiv ID。

## 输出结构

`search` 命令返回：

```json
{
  "metadata": {},
  "queries": [],
  "results": [],
  "sourceErrors": []
}
```

`results` 中每个候选包含来源、标题、作者、年份、venue、DOI、arXiv ID、匹配分数、分数字段明细和 BibTeX。外部服务失败不会被静默忽略，会记录到 `sourceErrors`；如果没有候选且存在源错误，CLI 会以失败状态退出。

## Codex Skill

Skill 文件位于：

```text
search-bibtex/SKILL.md
search-bibtex/agents/openai.yaml
```

在 Codex 中触发 `$search-bibtex` 后，agent 会优先使用本项目 CLI：

```bash
pnpm --dir search-bibtex dev -- select <pdf>
```

无 TTY 环境下使用：

```bash
pnpm --dir search-bibtex dev -- select <pdf> --select-index 0 --format bibtex
```

## 测试

单元测试：

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

端到端 PDF 测试使用根目录 `pdfs/` 下的样本，并访问真实网络服务：

```bash
pnpm --dir search-bibtex test:e2e
```

`test:e2e` 会完成 PDF 识别、搜索、排序、非交互选择和 BibTeX 输出校验。`pdfs/` 不纳入版本管理。

## 限制

- PDF 文本抽取依赖文件本身的可抽取文本质量；扫描版 PDF 需要先做 OCR。
- Semantic Scholar 匿名访问可能触发限流，限流会显示为源错误。
- 外部书目信息源的 BibTeX 风格不完全一致，本工具保留源返回的 BibTeX，只做必要的首尾空白规范化。
- 当前目标是本地 CLI 和 Codex skill，不提供长期后台服务或图形界面。
