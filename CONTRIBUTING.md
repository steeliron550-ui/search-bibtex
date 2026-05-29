# Contributing

This repository stays a small, auditable TypeScript CLI. Changes should keep behavior explicit, failures visible, tests focused, and documentation current.

## Development Setup

Use Node.js 20 or newer with pnpm.

```bash
pnpm install
pnpm build
pnpm test
```

Makefile entry points:

```bash
make install
make build
make test
make typecheck
```

## Change Guidelines

- Do not depend on Paperlib internal packages, plugin lifecycle, components, or hooks in runtime code, build scripts, skills, or CLI behavior.
- Do not wire Grok search into the CLI or library API; it is only a development-time research aid.
- Do not add silent fallbacks, simulated success paths, swallowed errors, or temporary boundary caps to hide failures.
- When command options, config fields, output shapes, or source behavior change, update tests and bilingual docs in the same change.
- Do not commit API keys, tokens, cookies, private PDF samples, or logs containing secrets.
- Custom and built-in sources must expose real errors as exceptions or `sourceErrors`.

## Verification Checklist

Before committing code changes, run:

```bash
make test
make typecheck
make build
```

For binary or packaging changes, run:

```bash
make binary
make build-binaries
```

For real PDF search flow changes, run:

```bash
make test-e2e
```

For documentation-only changes, at minimum run:

```bash
git diff --check
```

## Documentation

The README is for quick start and navigation. Detailed docs live under `docs/`:

```text
docs/CONFIGURATION.md
docs/CONFIGURATION.zh-CN.md
docs/ARCHITECTURE.md
docs/ARCHITECTURE.zh-CN.md
docs/TESTING.md
docs/TESTING.zh-CN.md
```

Any user-visible behavior change must update both English and Chinese versions.
