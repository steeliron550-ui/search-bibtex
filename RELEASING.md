# Releasing

This project is not published to npm. The external deliverables are multi-platform binaries under `dist-bin/<platform-arch>/`.

## Pre-Release Verification

```bash
make test
make typecheck
make build
make build-binaries
make test-e2e
git diff --check
```

Inspect the change scope:

```bash
git diff
git status --short --branch
```

If a commit is needed, inspect recent commit style first:

```bash
git log -n 5 --oneline
```

## Build

```bash
make clean
make install
make build-binaries
```

Output directories:

```text
dist-bin/linux-x64/search-bibtex
dist-bin/linux-arm64/search-bibtex
dist-bin/macos-x64/search-bibtex
dist-bin/macos-arm64/search-bibtex
dist-bin/win-x64/search-bibtex.exe
dist-bin/win-arm64/search-bibtex.exe
```

## Artifact Checks

At minimum, run the current-platform binary:

```bash
./dist-bin/linux-x64/search-bibtex --help
./dist-bin/linux-x64/search-bibtex config-defaults
```

Replace the directory with the actual platform. On Windows:

```powershell
dist-bin\win-x64\search-bibtex.exe --help
```

macOS targets cross-built on Linux are unsigned. Sign them on macOS before distribution:

```bash
codesign --sign - dist-bin/macos-x64/search-bibtex
codesign --sign - dist-bin/macos-arm64/search-bibtex
```

## Documentation

Before release, update:

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

When the version changes, update `package.json` and the changelog.
