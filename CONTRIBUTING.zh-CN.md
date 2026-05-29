# 贡献

本仓库保持为小型、可审计的 TypeScript CLI。改动应优先保持行为明确、错误可见、测试覆盖与文档一致。

## 开发环境

需要 Node.js 20 或更高版本，以及 pnpm。

```bash
pnpm install
pnpm build
pnpm test
```

Makefile 入口：

```bash
make install
make build
make test
make typecheck
```

## 改动原则

- 不在运行时代码、构建脚本、skill 或 CLI 中依赖 Paperlib 内部包或插件生命周期。
- 不把 Grok search 接入 CLI 或库 API；它只能作为开发期资料检索工具。
- 不新增静默 fallback、模拟成功路径、吞错逻辑或临时边界限制来掩盖问题。
- 改动命令参数、配置字段、输出结构或来源行为时，同步更新测试和中英文文档。
- 不提交 API key、token、cookie、PDF 私有样本或包含秘密的日志。
- 自定义来源和内置来源都必须把真实错误暴露为异常或 `sourceErrors`。

## 校验清单

代码变更提交前运行：

```bash
make test
make typecheck
make build
```

涉及二进制或打包逻辑时运行：

```bash
make binary
make build-binaries
```

涉及真实 PDF 搜索流程时运行：

```bash
make test-e2e
```

文档变更至少运行：

```bash
git diff --check
```

## 文档

README 负责快速上手和入口链接。细节文档放在 `docs/`：

```text
docs/CONFIGURATION.md
docs/CONFIGURATION.zh-CN.md
docs/ARCHITECTURE.md
docs/ARCHITECTURE.zh-CN.md
docs/TESTING.md
docs/TESTING.zh-CN.md
```

新增或改动用户可见行为时，中英文版本必须一起更新。
