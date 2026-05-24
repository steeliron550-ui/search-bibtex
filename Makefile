PNPM ?= pnpm
APP_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
.DEFAULT_GOAL := binary

.PHONY: install build binary build-binary build-binaries clean prepare-test-dirs test typecheck test-e2e help

install:
	$(PNPM) --dir $(APP_DIR) install

build:
	$(PNPM) --dir $(APP_DIR) build

binary:
	$(PNPM) --dir $(APP_DIR) build:binary

build-binary: binary

build-binaries:
	$(PNPM) --dir $(APP_DIR) build:binaries

clean:
	rm -rf "$(APP_DIR)/dist" "$(APP_DIR)/dist-bin" "$(APP_DIR)/dist-pkg" "$(APP_DIR)/coverage"
	find "$(APP_DIR)" -maxdepth 1 -name '*.tsbuildinfo' -delete

prepare-test-dirs:
	@mkdir -p "$(APP_DIR)/refs" "$(APP_DIR)/pdfs"
	@for dir in refs pdfs; do \
		if [ -z "$$(find "$(APP_DIR)/$$dir" -mindepth 1 -print -quit)" ]; then \
			printf '%s\n' "Warning: $$dir/ is empty; place test files there before running tests." >&2; \
		fi; \
	done

test: prepare-test-dirs
	$(PNPM) --dir $(APP_DIR) test

typecheck:
	$(PNPM) --dir $(APP_DIR) typecheck

test-e2e: prepare-test-dirs
	$(PNPM) --dir $(APP_DIR) test:e2e

help:
	@printf '%s\n' \
		'install       Install pnpm dependencies' \
		'build         Compile TypeScript sources' \
		'binary        Build the current platform binary' \
		'build-binaries Build all platform binaries' \
		'clean         Remove build outputs and caches' \
		'test          Run unit tests' \
		'typecheck     Run TypeScript type checking' \
		'test-e2e      Run the PDF end-to-end test'
