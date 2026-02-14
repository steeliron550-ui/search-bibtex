# 测试

## 本地校验

提交代码前运行：

```bash
make test
make typecheck
make build
```

对应 pnpm 命令：

```bash
pnpm test
pnpm typecheck
pnpm build
```

## 测试范围

| Area | 文件 |
|---|---|
| 配置解析和校验 | `tests/config.test.ts` |
| PDF 元数据和查询生成 | `tests/metadata.test.ts` |
| 多源搜索、归一化和错误暴露 | `tests/search.test.ts` |
| 交互选择状态机 | `tests/selection.test.ts` |
| CLI 参数和命令行为 | `tests/cli.test.ts` |
| BibTeX 获取、生成和规范化 | `tests/bibtex.test.ts` |
| 现有 `.bib` 文件解析和更新 | `tests/bibtex-file.test.ts` |

单元测试使用 fake fetcher 覆盖网络边界。测试不应通过模拟成功路径隐藏真实错误。

## 端到端 PDF 测试

端到端测试会读取 `tests/pdfs/` 下的本地 PDF 样本，并访问真实外部书目信息源：

```bash
make test-e2e
```

`scripts/e2e-pdfs.ts` 覆盖 PDF 解析、搜索、排序、`--select-index 0` 选择和 BibTeX 首行校验。`tests/pdfs/` 为空时会跳过端到端测试；网络源错误会让测试失败。

## 二进制检查

构建当前平台二进制：

```bash
make binary
```

在 Linux x64 上检查：

```bash
./dist-bin/linux-x64/search-bibtex --help
./dist-bin/linux-x64/search-bibtex config-defaults
```

在 Windows 上对应：

```powershell
dist-bin\win-x64\search-bibtex.exe --help
dist-bin\win-arm64\search-bibtex.exe --help
```

全部平台构建：

```bash
make build-binaries
```

Linux 上交叉构建 macOS 目标时会生成未签名文件。分发前必须在 macOS 上签名：

```bash
codesign --sign - dist-bin/macos-x64/search-bibtex
codesign --sign - dist-bin/macos-arm64/search-bibtex
```

## 文档变更校验

文档变更至少检查：

```bash
git diff --check
rg -n "develop\\.md|CONFIGURATION|ARCHITECTURE|TESTING|RELEASING|CONTRIBUTING|CHANGELOG" README*.md docs CONTRIBUTING*.md RELEASING*.md CHANGELOG*.md SKILL.md
```

如果命令名、选项名、配置字段或默认来源顺序发生变化，同步更新中英文 README、配置文档、架构文档和 `SKILL.md`。
