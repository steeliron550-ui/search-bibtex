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
- 失败会显式报错或出现在 `sourceErrors` 中，不提供模拟成功结果。

## 环境要求

- 构建二进制时需要 Node.js 20 或更新版本。
- 构建二进制时需要 pnpm。
- 运行二进制时不需要本机安装 Node.js。
- 可访问 DBLP、arXiv、Crossref、OpenAlex、doi.org 和 Semantic Scholar 等外部服务的网络环境。

## 获取二进制

在仓库内构建所有平台产物：

```bash
pnpm --dir search-bibtex install
pnpm --dir search-bibtex build:binaries
```

只构建当前平台：

```bash
pnpm --dir search-bibtex build:binary
```

构建结果位于：

```text
search-bibtex/dist-bin/
```

当前会生成这些目标：

```text
search-bibtex-linux-x64
search-bibtex-linux-arm64
search-bibtex-macos-x64
search-bibtex-macos-arm64
search-bibtex-win-x64.exe
search-bibtex-win-arm64.exe
```

在 Linux 上交叉构建 macOS 产物时，生成文件未签名。分发给 macOS 用户前需要在 macOS 上执行：

```bash
codesign --sign - dist-bin/search-bibtex-macos-x64
codesign --sign - dist-bin/search-bibtex-macos-arm64
```

## CLI 用法

查看默认排序配置：

```bash
./dist-bin/search-bibtex-linux-x64 config-defaults
```

查看帮助：

```bash
./dist-bin/search-bibtex-linux-x64 --help
./dist-bin/search-bibtex-linux-x64 -h
./dist-bin/search-bibtex-linux-x64 select --help
```

Windows 对应：

```powershell
.\dist-bin\search-bibtex-win-x64.exe config-defaults
```

提取 PDF 元数据和查询候选：

```bash
./dist-bin/search-bibtex-linux-x64 metadata paper.pdf
```

搜索并返回 JSON 候选：

```bash
./dist-bin/search-bibtex-linux-x64 search paper.pdf \
  --source-priority dblp,arxiv,crossref,openalex,doi \
  --limit 5
```

交互选择 BibTeX：

```bash
./dist-bin/search-bibtex-linux-x64 select paper.pdf
```

非交互选择第 0 个候选，适合脚本：

```bash
./dist-bin/search-bibtex-linux-x64 select paper.pdf \
  --select-index 0 \
  --format bibtex
```

输出完整 JSON：

```bash
./dist-bin/search-bibtex-linux-x64 select paper.pdf \
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
./dist-bin/search-bibtex-linux-x64 search paper.pdf \
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
