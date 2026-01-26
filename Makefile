PNPM ?= pnpm
APP_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: install build build-binary build-binaries test typecheck test-e2e help

install:
	$(PNPM) --dir $(APP_DIR) install

build:
	$(PNPM) --dir $(APP_DIR) build

build-binary:
	$(PNPM) --dir $(APP_DIR) build:binary

build-binaries:
	$(PNPM) --dir $(APP_DIR) build:binaries

test:
	$(PNPM) --dir $(APP_DIR) test

typecheck:
	$(PNPM) --dir $(APP_DIR) typecheck

test-e2e:
	$(PNPM) --dir $(APP_DIR) test:e2e

help:
	@printf '%s\n' \
		'install       Install pnpm dependencies' \
		'build         Compile TypeScript sources' \
		'build-binary  Build the current platform binary' \
		'build-binaries Build all platform binaries' \
		'test          Run unit tests' \
		'typecheck     Run TypeScript type checking' \
		'test-e2e      Run the PDF end-to-end test'
