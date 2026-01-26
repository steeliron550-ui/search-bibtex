# search-bibtex

`search-bibtex` 是一个独立的论文 PDF 到 BibTeX 工具。它从本地 PDF 中提取计算机科学论文元数据，生成 DOI、arXiv、标题和标题作者查询，检索多个公开书目信息源，按用户配置的优先级和权重排序候选结果，并让用户在终端中交互选择最终 BibTeX。

项目以多平台二进制形式分发，不走 npm 发布。运行时代码不依赖 Paperlib，也不接入 Grok search。

## 功能范围

- 识别论文 PDF 前若干页中的 DOI、arXiv ID、标题、作者和年份。
- 覆盖计算机科学常见预印本、会议和期刊论文。
- 检索 DBLP、arXiv、Crossref、OpenAlex、DOI 内容协商和 Semantic Scholar。
- DBLP 是一等信息源，支持 publication search API 和单条记录 `.bib` 抓取。
- 支持来源优先级、字段打分权重和返回数量配置。
- 交互式候选选择支持类 Vim 键位，也支持非交互脚本化选择。
- 支持从现有 `.bib` 文件提取标题并更新条目，同时保留原始 citation key。
- 失败会显式报错或出现在 `sourceErrors` 中，不提供模拟成功结果。

## 环境要求

- 运行二进制时不需要本机安装 Node.js。
- 可访问 DBLP、arXiv、Crossref、OpenAlex、doi.org 和 Semantic Scholar 等外部服务的网络环境。

## 获取二进制

二进制文件按平台和架构分目录放置：

```text
dist-bin/<platform-arch>/search-bibtex
dist-bin/<platform-arch>/search-bibtex.exe
```

不同平台的可执行文件保持同名，Windows 只是在文件扩展名上不同。

## 构建产物

在仓库根目录使用 Makefile 生成二进制产物：

```bash
make build-binary
make build-binaries
```

`make build-binary` 生成当前平台产物，`make build-binaries` 生成全部平台产物。

## Agent Skill

本项目提供的 skill 文件位于：

```text
SKILL.md
agents/openai.yaml
```

根据实际使用的 agent，把 `SKILL.md` 和需要的 agent 元数据放到对应的 skill 目录。Claude Code、OpenAI Codex、OpenCode 等工具的 skill 目录和加载方式不同，应按各自工具的文档或本地配置放置。

使用 skill 前，确认 agent 的命令执行环境可以直接调用对应平台的 `search-bibtex` 二进制文件。

## CLI 用法

查看默认排序配置：

```bash
search-bibtex config-defaults
```

查看帮助：

```bash
search-bibtex --help
search-bibtex -h
search-bibtex select --help
```

Windows 对应：

```powershell
search-bibtex.exe config-defaults
```

提取 PDF 元数据和查询候选：

```bash
search-bibtex metadata paper.pdf
```

搜索并在终端进入选择器；重定向时返回 JSON：

```bash
search-bibtex search paper.pdf \
  --source-priority dblp,arxiv,crossref,openalex,doi \
  --limit 5 \
  --timeout 30
```

终端里会先显示源搜索进度提示，然后再进入选择器。默认并行搜索；如需串行，可加 `--no-parallel`。确认后会在屏幕上显示格式化 BibTeX，并尝试复制到剪贴板。

交互选择 BibTeX：

```bash
search-bibtex select paper.pdf
```

交互确认会留在屏幕上，显示格式化后的 BibTeX，并尝试复制到剪贴板；不会再重复把同一份 BibTeX 打到 stdout。需要机器读取时用 `--select-index`。

非交互选择第 0 个候选，适合脚本：

```bash
search-bibtex select paper.pdf \
  --select-index 0 \
  --format bibtex
```

输出完整 JSON：

```bash
search-bibtex select paper.pdf \
  --select-index 0 \
  --format json
```

更新现有 BibTeX 文件并保留引用名：

```bash
search-bibtex update pdfs/test.bib --in-place
```

写到新文件：

```bash
search-bibtex update pdfs/test.bib --output updated.bib
```

搜索阶段默认超时 30 秒，可用 `--timeout` 调整。

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
search-bibtex search paper.pdf \
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

## 限制

- PDF 文本抽取依赖文件本身的可抽取文本质量；扫描版 PDF 需要先做 OCR。
- Semantic Scholar 匿名访问可能触发限流，限流会显示为源错误。
- 外部书目信息源的 BibTeX 风格不完全一致，本工具保留源返回的 BibTeX，只做必要的首尾空白规范化。
- 当前目标是本地 CLI 和二进制分发，不提供长期后台服务或图形界面。

## 许可证

MIT
