# 发布

本项目不走 npm 发布。对外交付物是 `dist-bin/<platform-arch>/` 下的多平台二进制。

## 发布前校验

```bash
make test
make typecheck
make build
make build-binaries
make test-e2e
git diff --check
```

检查变更范围：

```bash
git diff
git status --short --branch
```

如果需要提交，先查看最近提交风格：

```bash
git log -n 5 --oneline
```

## 构建

```bash
make clean
make install
make build-binaries
```

产物目录：

```text
dist-bin/linux-x64/search-bibtex
dist-bin/linux-arm64/search-bibtex
dist-bin/macos-x64/search-bibtex
dist-bin/macos-arm64/search-bibtex
dist-bin/win-x64/search-bibtex.exe
dist-bin/win-arm64/search-bibtex.exe
```

## 产物检查

当前平台至少运行：

```bash
./dist-bin/linux-x64/search-bibtex --help
./dist-bin/linux-x64/search-bibtex config-defaults
```

按实际平台替换目录名。Windows 上运行：

```powershell
dist-bin\win-x64\search-bibtex.exe --help
```

macOS 目标在 Linux 上交叉构建时未签名。分发前在 macOS 上执行：

```bash
codesign --sign - dist-bin/macos-x64/search-bibtex
codesign --sign - dist-bin/macos-arm64/search-bibtex
```

## 文档

发布前同步：

```text
README.md
README.en.md
CHANGELOG.md
CHANGELOG.zh-CN.md
docs/CONFIGURATION.md
docs/CONFIGURATION.zh-CN.md
docs/ARCHITECTURE.md
docs/ARCHITECTURE.zh-CN.md
docs/TESTING.md
docs/TESTING.zh-CN.md
SKILL.md
```

版本号变化时同步 `package.json` 和变更记录。
