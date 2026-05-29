# Testing

## Local Verification

Before committing code changes, run:

```bash
make test
make typecheck
make build
```

Equivalent pnpm commands:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Test Coverage

| Area | File |
|---|---|
| Config parsing and validation | `tests/config.test.ts` |
| PDF metadata and query generation | `tests/metadata.test.ts` |
| Multi-source search, normalization, and error exposure | `tests/search.test.ts` |
| Interactive selector state machine | `tests/selection.test.ts` |
| CLI options and command behavior | `tests/cli.test.ts` |
| BibTeX fetching, generation, and normalization | `tests/bibtex.test.ts` |
| Existing `.bib` parsing and update behavior | `tests/bibtex-file.test.ts` |

Unit tests use fake fetchers at network boundaries. Tests should not hide real failures through simulated success paths.

## PDF End-to-End Tests

The end-to-end suite reads local PDF samples from `tests/pdfs/` and accesses real external bibliography sources:

```bash
make test-e2e
```

`scripts/e2e-pdfs.ts` covers PDF parsing, search, ranking, `--select-index 0` selection, and BibTeX first-line checks. The suite is skipped when `tests/pdfs/` is empty; source network errors fail the test.

## Binary Checks

Build the current-platform binary:

```bash
make binary
```

Check Linux x64 output:

```bash
./dist-bin/linux-x64/search-bibtex --help
./dist-bin/linux-x64/search-bibtex config-defaults
```

Windows equivalents:

```powershell
dist-bin\win-x64\search-bibtex.exe --help
dist-bin\win-arm64\search-bibtex.exe --help
```

Build every platform target:

```bash
make build-binaries
```

When macOS targets are cross-built on Linux, the generated files are unsigned. Sign them on macOS before distribution:

```bash
codesign --sign - dist-bin/macos-x64/search-bibtex
codesign --sign - dist-bin/macos-arm64/search-bibtex
```

## Documentation Checks

For documentation-only changes, at minimum check:

```bash
git diff --check
rg -n "develop\\.md|CONFIGURATION|ARCHITECTURE|TESTING|RELEASING|CONTRIBUTING|CHANGELOG" README*.md docs CONTRIBUTING*.md RELEASING*.md CHANGELOG*.md SKILL.md
```

If command names, options, config fields, or default source order change, update the bilingual README, configuration docs, architecture docs, and `SKILL.md`.
