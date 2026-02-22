# search-bibtex / 论文引用元数据检索工具

[**English**](README.en.md) | **中文**

## 需求分析

在学术写作过程中，参考文献质量直接影响论文可信度、审稿结果和学术诚信。当前痛点主要包括：

1. 幻觉引用风险严重

   使用大模型、搜索引擎或人工记忆整理参考文献时，可能出现不存在的论文、错误标题、错误作者、错误 DOI、错误年份等“幻觉引用”。
   这类问题可能导致：

   - 审稿人无法检索到引用来源；
   - 论文被质疑可靠性；
   - 轻则返修、拒稿，重则涉及学术道德问题。

2. 单一数据源不可靠

   DBLP、Crossref、OpenAlex、arXiv、Semantic Scholar、DOI 内容协商等数据源各有优势和缺陷。
   例如：

   - DBLP 在计算机领域质量较高，但覆盖面有限；
   - Crossref DOI 信息权威，但有时字段不完整；
   - arXiv 适合预印本，但不一定对应最终发表版本；
   - Semantic Scholar 覆盖广，但可能存在限流或元数据差异。

   因此需要多数据源交叉验证、优先级排序和冲突处理。

3. 手工整理 BibTeX 成本高

   高质量学术论文通常引用几十甚至上百篇文献。人工逐条搜索、复制 BibTeX、修正格式非常耗时，并且容易出现：

   - BibTeX 类型不一致；
   - citation key 风格混乱；
   - 作者名格式不统一；
   - 会议/期刊名称不统一；
   - DOI、URL、arXiv ID 缺失或错误；
   - 重复条目难以发现。

## 工具介绍

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
- 多数据源交叉验证。
- 支持批量处理。

## 安装

### 下载二进制

二进制按平台和架构放在 `dist-bin/`：

```text
dist-bin/<platform-arch>/search-bibtex
dist-bin/<platform-arch>/search-bibtex.exe
```

把对应平台目录加入 `PATH`，或直接用绝对路径运行。运行二进制不需要本机安装 Node.js。

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

## 典型使用场景
  
  场景 A：论文作者整理参考文献

  用户已经有若干 PDF，希望快速生成 BibTeX。

  流程：

  1. 输入论文 PDF；
  2. 工具提取标题、作者、年份、DOI；
  3. 查询多个数据源；
  4. 返回候选 BibTeX；
  5. 用户选择最可信条目；
  6. 输出 BibTeX。

  价值：

  - 减少手动搜索；
  - 降低复制错误；
  - 优先获取权威 BibTeX。

  ---
  场景 B：校验 AI 生成的参考文献
  
  用户有一批 LLM 生成的参考文献标题，担心存在幻觉引用。

  流程：

  1. 用户输入标题列表；
  2. 工具逐条检索；
  3. 能找到可靠来源的条目生成 BibTeX；
  4. 找不到的条目标记为高风险；
  5. 用户人工复核高风险项。

  价值：

  - 发现不存在或错误引用；
  - 避免将幻觉引用写入论文；
  - 降低学术诚信风险。

  ---
  场景 C：刷新已有 BibTeX 文件
  
  用户已有 .bib 文件，但条目格式混乱或字段缺失。

  流程：

  1. 输入 references.bib；
  2. 工具解析每个条目标题；
  3. 检索多个来源；
  4. 替换条目内容；
  5. 保留原 citation key；
  6. 输出更新后的 .bib。

  价值：

  - 统一引用元数据；
  - 保留正文中的引用键；
  - 降低大规模手动修正成本。

  ---
  场景 D：团队或 CI 检查引用质量
  
  团队希望在提交论文前检查 .bib 文件是否包含可疑条目。

  流程：

  1. CI 运行工具；
  2. 对 .bib 中每个条目检索验证；
  3. 对找不到可靠来源的条目给出错误或警告；
  4. 阻止明显可疑引用进入最终版本。

  价值：

  - 提前发现问题；
  - 建立论文引用质量门禁；
  - 适合团队协作。

## 测试 / 例子

配置bibtex源

```bash
> ./search-bibtex config-defaults
{
  "sourcePriority": [
    "dblp",
    "arxiv",
    "crossref",
    "openalex",
    "doi",
    "semantic-scholar"
  ],
  "weights": {
    "title": 0.45,
    "author": 0.2,
    "year": 0.1,
    "identifier": 0.2,
    "source": 0.05
  },
  "limit": 10
}
```

指定单个论文标题进行搜索。

```bash
> ./search-bibtex search-title "Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling"
search-title: searching 6 source channels...
search-title: 1/6 source channels completed [doi]
search-title: 2/6 source channels completed [doi] failed [semantic-scholar]
search-title: 3/6 source channels completed [doi] failed [arxiv, semantic-scholar]
search-title: 4/6 source channels completed [crossref, doi] failed [arxiv, semantic-scholar]
search-title: 5/6 source channels completed [crossref, openalex, doi] failed [arxiv, semantic-scholar]
search-title: 6/6 source channels completed [crossref, openalex, doi] failed [dblp, arxiv, semantic-scholar]
search-bibtex candidate selection
Source issues:
  dblp 500 HTTP 500 from https://dblp.org/search/publ/ap..., arxiv 429 HTTP 429 from
  https://export.arxiv.org/api/qu..., semantic-scholar 429 HTTP 429 from
  https://api.semanticscholar.org...
Filter: 
Keys: j/k move, g/G jump, / filter, Ctrl+O preview, Enter select, q cancel

> [0] crossref         0.480 Tackling System and Statistical Heterogeneity for Federated Learning wi...
  [1] openalex         0.470 Tackling System and Statistical Heterogeneity for Federated Learning wi...
  [2] openalex         0.470 Tackling System and Statistical Heterogeneity for Federated Learning wi...
  [3] crossref         0.210 FedCSGA: Evolutionary client selection with joint statistical and syste...
  [4] crossref         0.207 FedDiverse: Tackling Data Heterogeneity in Federated Learning with Dive...
  [5] crossref         0.202 Adaptive Heterogeneous Client Sampling for Federated Learning Over Wire...
  [6] openalex         0.192 Adaptive Heterogeneous Client Sampling for Federated Learning Over Wire...
  [7] crossref         0.182 Tackling Privacy Heterogeneity in Federated Learning
  [8] crossref         0.180 FedClust: Tackling Data Heterogeneity in Federated Learning through Wei...
  [9] crossref         0.178 RingSFL: An Adaptive Split Federated Learning Towards Taming Client Het...

Title: Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling
Authors: Bing Luo and Wenli Xiao and Shiqiang Wang and ... (+2 more)
Year: 2022  Venue: IEEE INFOCOM 2022 - IEEE Conference on Computer Communications
IDs: DOI 10.1109/infocom48880.2022.9796935

BibTeX preview: compact
@inproceedings{Luo_2022, title={Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling}, url={http://dx.doi.org/10.1109/infocom48880.2022.9796935}, DOI={10.1109/infocom48880.2022.9796935}, booktitle={IEEE INFOCOM 2022 - IEEE Conference on Computer Communications}, publisher={IEEE}, author={Luo, Bing and Xiao, Wenli and Wang, Shiqiang and Huang, Jianwei and Tassiulas, Leandros}, year={2022}, month=May, pages={1739–1748} }
  title = {Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Cl...}
  author = {Bing Luo and Wenli Xiao and Shiqiang Wang and Jianwei Huang and ... (+1 more)}
  year = {2022}
  booktitle = {IEEE INFOCOM 2022 - IEEE Conference on Computer Communications}
  doi = {10.1109/infocom48880.2022.9796935}
  url = {https://doi.org/10.1109/infocom48880.2022.9796935}
}
search-bibtex selection confirmed
Title: Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling
Source: crossref  Score: 0.480
Clipboard: clipboard unavailable

@inproceedings{Luo_2022,
  title = {Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling},
  url = {http://dx.doi.org/10.1109/infocom48880.2022.9796935},
  doi = {10.1109/infocom48880.2022.9796935},
  booktitle = {IEEE INFOCOM 2022 - IEEE Conference on Computer Communications},
  publisher = {IEEE},
  author = {Luo, Bing and Xiao, Wenli and Wang, Shiqiang and Huang, Jianwei and Tassiulas, Leandros},
  year = {2022},
  month = May,
  pages = {1739–1748},
}
```

指定多个论文标题进行搜索。

```bash
> ./search-bibtex search-title "Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling" "Dp-forward: Fine-tuning and inference on language models with differential privacy in forward pass"
search-title[1]: searching 6 source channels...
search-title[1]: 1/6 source channels completed [doi]
search-title[1]: 2/6 source channels completed [doi] failed [dblp]
search-title[1]: 3/6 source channels completed [doi] failed [dblp, arxiv]
search-title[1]: 4/6 source channels completed [doi] failed [dblp, arxiv, crossref]
search-title[1]: 5/6 source channels completed [doi] failed [dblp, arxiv, crossref, semantic-scholar]
search-title[1]: 6/6 source channels completed [openalex, doi] failed [dblp, arxiv, crossref, semantic-scholar]
search-bibtex candidate selection
Source issues:
  dblp fetch failed, arxiv fetch failed, crossref fetch failed, semantic-scholar 429 HTTP
  429 from https://api.semanticscholar.org...
Filter: 
Keys: j/k move, g/G jump, / filter, Ctrl+O preview, Enter select, q cancel

> [0] openalex         0.470 Tackling System and Statistical Heterogeneity for Federated Learning wi...
  [1] openalex         0.470 Tackling System and Statistical Heterogeneity for Federated Learning wi...
  [2] openalex         0.192 Adaptive Heterogeneous Client Sampling for Federated Learning Over Wire...
  [3] openalex         0.133 FedPARL: Client Activity and Resource-Oriented Lightweight Federated Le...
  [4] openalex         0.123 Advances and Open Problems in Federated Learning
  [5] openalex         0.103 Federated Learning: A Survey on Enabling Technologies, Protocols, and A...
  [6] openalex         0.102 Towards Personalized Federated Learning
  [7] openalex         0.093 FedProto: Federated Prototype Learning across Heterogeneous Clients
  [8] openalex         0.093 Edge Artificial Intelligence for 6G: Vision, Enabling Technologies, and...
  [9] openalex         0.072 Pushing AI to wireless network edge: an overview on integrated sensing,...

Title: Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling
Authors: Bing Luo and Wenli Xiao and Shiqiang Wang and ... (+2 more)
Year: 2022  Venue: IEEE INFOCOM 2022 - IEEE Conference on Computer Communications
IDs: DOI https://doi.org/10.1109/infocom48880.2022.9796935

BibTeX preview: compact
@inproceedings{Luo_2022, title={Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling}, url={http://dx.doi.org/10.1109/infocom48880.2022.9796935}, DOI={10.1109/infocom48880.2022.9796935}, booktitle={IEEE INFOCOM 2022 - IEEE Conference on Computer Communications}, publisher={IEEE}, author={Luo, Bing and Xiao, Wenli and Wang, Shiqiang and Huang, Jianwei and Tassiulas, Leandros}, year={2022}, month=May, pages={1739–1748} }
  title = {Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Cl...}
  author = {Bing Luo and Wenli Xiao and Shiqiang Wang and Jianwei Huang and ... (+1 more)}
  year = {2022}
  booktitle = {IEEE INFOCOM 2022 - IEEE Conference on Computer Communications}
  doi = {https://doi.org/10.1109/infocom48880.2022.9796935}
  url = {https://openalex.org/W4226183928}
}
search-bibtex selection confirmed
Title: Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling
Source: openalex  Score: 0.470
Clipboard: clipboard unavailable

@inproceedings{Luo_2022,
  title = {Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling},
  url = {http://dx.doi.org/10.1109/infocom48880.2022.9796935},
  doi = {10.1109/infocom48880.2022.9796935},
  booktitle = {IEEE INFOCOM 2022 - IEEE Conference on Computer Communications},
  publisher = {IEEE},
  author = {Luo, Bing and Xiao, Wenli and Wang, Shiqiang and Huang, Jianwei and Tassiulas, Leandros},
  year = {2022},
  month = May,
  pages = {1739–1748},
}search-title[2]: searching 6 source channels...
search-title[2]: 1/6 source channels completed [doi]
search-title[2]: 2/6 source channels completed [doi] failed [arxiv]
search-title[2]: 3/6 source channels completed [doi] failed [arxiv, semantic-scholar]
search-title[2]: 4/6 source channels completed [doi] failed [dblp, arxiv, semantic-scholar]
search-title[2]: 5/6 source channels completed [crossref, doi] failed [dblp, arxiv, semantic-scholar]
search-title[2]: 6/6 source channels completed [crossref, openalex, doi] failed [dblp, arxiv, semantic-scholar]
search-bibtex candidate selection
Source issues:
  dblp 500 HTTP 500 from https://dblp.org/search/publ/ap..., arxiv 429 HTTP 429 from
  https://export.arxiv.org/api/qu..., semantic-scholar 429 HTTP 429 from
  https://api.semanticscholar.org...
Filter: 
Keys: j/k move, g/G jump, / filter, Ctrl+O preview, Enter select, q cancel

> [0] crossref         0.480 DP-Forward: Fine-tuning and Inference on Language Models with Different...
  [1] openalex         0.470 DP-Forward: Fine-tuning and Inference on Language Models with Different...
  [2] crossref         0.211 Fine-Tuning Language Models with Just Forward Passes
  [3] crossref         0.210 Fine-Tuning Language Models with Differential Privacy through Adaptive ...
  [4] crossref         0.207 Towards Fine-tuning Pre-trained Language Models with Integer Forward an...
  [5] crossref         0.197 EW-Tune: A Framework for Privately Fine-Tuning Large Language Models wi...
  [6] crossref         0.175 DP-FedLoRA: Privacy-Enhanced Federated Fine-Tuning for On-Device Large ...
  [7] crossref         0.158 Privacy-Aware Federated Fine-Tuning of Large Pretrained Models With Jus...
  [8] crossref         0.150 Is Differential Privacy-Enhanced Parameter-Efficient Fine-Tuning Effect...
  [9] crossref         0.145 Extractive Fact Decomposition for Interpretable Natural Language Infere...

Title: DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in Forward Pass
Authors: Minxin Du and Xiang Yue and Sherman S. M. Chow and ... (+3 more)
Year: 2023  Venue: Proceedings of the 2023 ACM SIGSAC Conference on Computer and Communications Security
IDs: DOI 10.1145/3576915.3616592

BibTeX preview: compact
@inproceedings{Du_2023, series={CCS ’23}, title={DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in Forward Pass}, url={http://dx.doi.org/10.1145/3576915.3616592}, DOI={10.1145/3576915.3616592}, booktitle={Proceedings of the 2023 ACM SIGSAC Conference on Computer and Communications Security}, publisher={ACM}, author={Du, Minxin and Yue, Xiang and Chow, Sherman S. M. and Wang, Tianhao and Huang, Chenyu and Sun, Huan}, year={2023}, month=Nov, pages={2665–2679}, collection={CCS ’23} }
  title = {DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in...}
  author = {Minxin Du and Xiang Yue and Sherman S. M. Chow and Tianhao Wang and ... (+2 more)}
  year = {2023}
  booktitle = {Proceedings of the 2023 ACM SIGSAC Conference on Computer and Communications Security}
  doi = {10.1145/3576915.3616592}
  url = {https://doi.org/10.1145/3576915.3616592}
}
search-bibtex selection confirmed
Title: DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in Forward Pass
Source: crossref  Score: 0.480
Clipboard: clipboard unavailable

@inproceedings{Du_2023,
  series = {CCS ’23},
  title = {DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in Forward Pass},
  url = {http://dx.doi.org/10.1145/3576915.3616592},
  doi = {10.1145/3576915.3616592},
  booktitle = {Proceedings of the 2023 ACM SIGSAC Conference on Computer and Communications Security},
  publisher = {ACM},
  author = {Du, Minxin and Yue, Xiang and Chow, Sherman S. M. and Wang, Tianhao and Huang, Chenyu and Sun, Huan},
  year = {2023},
  month = Nov,
  pages = {2665–2679},
  collection = {CCS ’23},
}@inproceedings{Luo_2022,
  title = {Tackling System and Statistical Heterogeneity for Federated Learning with Adaptive Client Sampling},
  url = {http://dx.doi.org/10.1109/infocom48880.2022.9796935},
  doi = {10.1109/infocom48880.2022.9796935},
  booktitle = {IEEE INFOCOM 2022 - IEEE Conference on Computer Communications},
  publisher = {IEEE},
  author = {Luo, Bing and Xiao, Wenli and Wang, Shiqiang and Huang, Jianwei and Tassiulas, Leandros},
  year = {2022},
  month = May,
  pages = {1739–1748},
}

@inproceedings{Du_2023,
  series = {CCS ’23},
  title = {DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in Forward Pass},
  url = {http://dx.doi.org/10.1145/3576915.3616592},
  doi = {10.1145/3576915.3616592},
  booktitle = {Proceedings of the 2023 ACM SIGSAC Conference on Computer and Communications Security},
  publisher = {ACM},
  author = {Du, Minxin and Yue, Xiang and Chow, Sherman S. M. and Wang, Tianhao and Huang, Chenyu and Sun, Huan},
  year = {2023},
  month = Nov,
  pages = {2665–2679},
  collection = {CCS ’23},
}
```

提取论文元数据

```bash
> ./search-bibtex metadata ../../tests/pdf/"RollPacker Taming Long-Tail Rollouts for RL Post-Training with Tail Batching.pdf"        
{
  "metadata": {
    "filePath": "/home/whr/projects/search-bibtex/tests/pdf/RollPacker Taming Long-Tail Rollouts for RL Post-Training with Tail Batching.pdf",
    "pageCount": 18,
    "title": "RollPacker: Taming Long-Tail Rollouts for RL Post-Training with Tail Batching Wei Gao",
    "authors": [
      "Yuheng Zhao",
      "Dakai An",
      "Tianyuan Wu",
      "Lunxi Cao",
      "Shaopan Xiong",
      "Ju Huang",
      "Weixun Wang",
      "Siran Yang",
      "Wenbo Su",
      "Jiamang Wang",
      "Lin Qu",
      "Bo Zheng"
    ],
    "textSample": "RollPacker: Taming Long-Tail Rollouts for RL Post-Training with Tail Batching Wei Gao †∗ , Yuheng Zhao †∗ , Dakai An † , Tianyuan Wu † , Lunxi Cao † , Shaopan Xiong ‡ , Ju Huang ‡ , Weixun Wang ‡ , Siran Yang ‡ , Wenbo Su ‡ , Jiamang Wang ‡ , Lin Qu ‡ , Bo Zheng ‡ , Wei Wang † † HKUST ‡ Alibaba Group Abstract Reinforcement Learning (RL) is a pivotal post-training technique for enhancing the reasoning capabilities of Large Language Models (LLMs). However, synchronous RL post-training frequently suffers from significant GPU underutilization—often referred to as pipeline “bubbles”— caused by imbalanced response lengths within rollout steps. Many RL systems attempt to alleviate this problem by relax- ing synchronization, but this can compromise training accu- racy. In this paper, we introduce tail batching, a novel roll- out scheduling strategy for synchronous RL. Tail batching systematically consolidates prompts leading to long-tail re- sponses into a few designated “long rounds”, ensuring that the majority of rollout steps (“short rounds”) contain only balanced, short responses. By strategically reordering exe- cution, this approach dramatically reduces GPU idle time and accelerates "
  },
  "queries": [
    {
      "kind": "title",
      "value": "RollPacker: Taming Long-Tail Rollouts for RL Post-Training with Tail Batching Wei Gao",
      "confidence": 0.78
    },
    {
      "kind": "title-author",
      "value": "RollPacker: Taming Long-Tail Rollouts for RL Post-Training with Tail Batching Wei Gao Yuheng Zhao",
      "confidence": 0.72
    }
  ]
}
```

检索指定pdf论文的bibtex

```bash
> ./search-bibtex search ../../tests/pdf/"DP-Forward Fine-tuning and Inference on Language Models with.pdf"
search: searching 6 source channels...
search: 1/6 source channels completed [doi]
search: 2/6 source channels completed [arxiv, doi]
search: 3/6 source channels completed [arxiv, doi, semantic-scholar]
search: 4/6 source channels completed [dblp, arxiv, doi, semantic-scholar]
search: 5/6 source channels completed [dblp, arxiv, crossref, doi, semantic-scholar]
search: 6/6 source channels completed [dblp, arxiv, crossref, openalex, doi, semantic-scholar]
search-bibtex candidate selection
Filter: 
Keys: j/k move, g/G jump, / filter, Ctrl+O preview, Enter select, q cancel

> [0] arxiv            0.990 DP-Forward: Fine-tuning and Inference on Language Models with Different...
  [1] crossref         0.980 DP-Forward: Fine-tuning and Inference on Language Models with Different...
  [2] openalex         0.970 DP-Forward: Fine-tuning and Inference on Language Models with Different...
  [3] doi              0.960 DP-Forward: Fine-tuning and Inference on Language Models with Different...
  [4] semantic-scholar 0.950 DP-Forward: Fine-tuning and Inference on Language Models with Different...

Title: DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in Forward Pass
Authors: Minxin Du and Xiang Yue and Sherman S. M. Chow and ... (+3 more)
Year: 2023  Venue: arXiv
IDs: DOI 10.1145/3576915.3616592  arXiv 2309.06746v2

BibTeX preview: compact
@inproceedings{Du_2023, series={CCS ’23}, title={DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in Forward Pass}, url={http://dx.doi.org/10.1145/3576915.3616592}, DOI={10.1145/3576915.3616592}, booktitle={Proceedings of the 2023 ACM SIGSAC Conference on Computer and Communications Security}, publisher={ACM}, author={Du, Minxin and Yue, Xiang and Chow, Sherman S. M. and Wang, Tianhao and Huang, Chenyu and Sun, Huan}, year={2023}, month=Nov, pages={2665–2679}, collection={CCS ’23} }
  title = {DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in...}
  author = {Minxin Du and Xiang Yue and Sherman S. M. Chow and Tianhao Wang and ... (+2 more)}
  year = {2023}
  booktitle = {arXiv}
  doi = {10.1145/3576915.3616592}
  eprint = {2309.06746v2}
  url = {https://arxiv.org/abs/2309.06746v2}
}
search-bibtex selection confirmed
Title: DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in Forward Pass
Source: arxiv  Score: 0.990
Clipboard: clipboard unavailable

@inproceedings{Du_2023,
  series = {CCS ’23},
  title = {DP-Forward: Fine-tuning and Inference on Language Models with Differential Privacy in Forward Pass},
  url = {http://dx.doi.org/10.1145/3576915.3616592},
  doi = {10.1145/3576915.3616592},
  booktitle = {Proceedings of the 2023 ACM SIGSAC Conference on Computer and Communications Security},
  publisher = {ACM},
  author = {Du, Minxin and Yue, Xiang and Chow, Sherman S. M. and Wang, Tianhao and Huang, Chenyu and Sun, Huan},
  year = {2023},
  month = Nov,
  pages = {2665–2679},
  collection = {CCS ’23},
}
```

## 开发文档

- [配置](docs/CONFIGURATION.zh-CN.md) / [Configuration](docs/CONFIGURATION.md)
- [架构](docs/ARCHITECTURE.zh-CN.md) / [Architecture](docs/ARCHITECTURE.md)
- [测试](docs/TESTING.zh-CN.md) / [Testing](docs/TESTING.md)
- [贡献](CONTRIBUTING.zh-CN.md) / [Contributing](CONTRIBUTING.md)
- [发布](RELEASING.zh-CN.md) / [Releasing](RELEASING.md)
- [变更记录](CHANGELOG.zh-CN.md) / [Changelog](CHANGELOG.md)

## 限制

PDF 文本抽取依赖文件本身的可抽取文本质量；扫描版 PDF 需要先做 OCR。Semantic Scholar 匿名访问可能触发限流，限流会显示为源错误。外部书目信息源的 BibTeX 风格不完全一致，本工具保留源返回的 BibTeX，只做必要的首尾空白规范化。

## 许可证

MIT，见 [LICENSE](LICENSE)。
