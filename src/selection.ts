/**
 * Interactive terminal selection UI for search-bibtex.
 *
 * Provides a vim-inspired browse and filter interface for navigating
 * search results, previewing BibTeX entries in compact or expanded mode,
 * and copying formatted citations to the system clipboard.
 *
 * @module selection
 */

import { spawnSync } from "node:child_process";
import readline from "node:readline";

import { formatBibtexText } from "./bibtex.js";
import type { SearchResult, SearchSourceError } from "./types.js";

/** The current interaction mode of the selection UI. */
export type SelectionMode = "browse" | "filter";
/** The BibTeX preview display density: compact shows key fields only, expanded shows all lines. */
export type PreviewMode = "compact" | "expanded";

/**
 * Immutable snapshot of the interactive selection UI state.
 *
 * Tracks cursor position, filter text, interaction mode, preview density,
 * and whether a result has been selected or the interaction cancelled.
 */
export interface SelectionState {
  cursor: number;
  filter: string;
  mode: SelectionMode;
  previewMode: PreviewMode;
  selectedIndex?: number;
  cancelled: boolean;
}

/** A discriminated union of all user actions the selection UI can respond to. */
export type SelectionEvent =
  | { type: "up" }
  | { type: "down" }
  | { type: "home" }
  | { type: "end" }
  | { type: "filter" }
  | { type: "enter" }
  | { type: "escape" }
  | { type: "cancel" }
  | { type: "backspace" }
  | { type: "toggle-preview" }
  | { type: "char"; value: string };

/** Options for {@link runInteractiveSelection}: I/O streams and source error reporting. */
export interface InteractiveSelectionOptions {
  sourceErrors?: SearchSourceError[];
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

/** Options controlling the visual output of {@link renderSelection}. */
export interface RenderSelectionOptions {
  color?: boolean;
}

interface KeypressKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
}

interface ClipboardResult {
  copied: boolean;
  message: string;
}

// Weakly-keyed caches to avoid recomputing normalized search-text and per-filter visible indexes.
const searchIndexCache = new WeakMap<SearchResult, string>();
const visibleIndexCache = new WeakMap<readonly SearchResult[], Map<string, number[]>>();

/** Creates a fresh {@link SelectionState} with default values (cursor at top, browse mode, compact preview). */
export function createSelectionState(): SelectionState {
  return {
    cursor: 0,
    filter: "",
    mode: "browse",
    previewMode: "compact",
    cancelled: false
  };
}

/**
 * Pure reducer that produces the next {@link SelectionState} from the current
 * state, a user event, and the list of search results.
 *
 * Handles mode transitions (browse/filter), cursor movement, filter text
 * updates, preview toggling, cancellation, and result selection.
 */
export function updateSelectionState(
  state: SelectionState,
  event: SelectionEvent,
  results: SearchResult[]
): SelectionState {
  const next: SelectionState = { ...state };

  if (event.type === "cancel") {
    return { ...next, cancelled: true };
  }

  if (event.type === "escape") {
    if (next.mode === "filter") {
      next.mode = "browse";
      next.filter = "";
      next.cursor = clampCursor(next.cursor, visibleIndexes(results, next.filter).length);
      return next;
    }
    return { ...next, cancelled: true };
  }

  if (event.type === "toggle-preview") {
    return {
      ...next,
      previewMode: next.previewMode === "compact" ? "expanded" : "compact"
    };
  }

  if (next.mode === "filter") {
    if (event.type === "char") {
      next.filter += event.value;
    } else if (event.type === "backspace") {
      next.filter = next.filter.slice(0, -1);
    } else if (event.type === "enter") {
      next.mode = "browse";
    }
    next.cursor = clampCursor(next.cursor, visibleIndexes(results, next.filter).length);
    return next;
  }

  if (event.type === "filter") {
    return { ...next, mode: "filter", filter: "", cursor: 0 };
  }

  const visible = visibleIndexes(results, next.filter);

  if (event.type === "up") {
    next.cursor = Math.max(0, next.cursor - 1);
  } else if (event.type === "down") {
    next.cursor = Math.min(Math.max(0, visible.length - 1), next.cursor + 1);
  } else if (event.type === "home") {
    next.cursor = 0;
  } else if (event.type === "end") {
    next.cursor = Math.max(0, visible.length - 1);
  } else if (event.type === "enter" && visible[next.cursor] !== undefined) {
    next.selectedIndex = visible[next.cursor];
  }

  return next;
}

/**
 * Returns the indices of search results whose concatenated searchable text
 * contains the normalized filter string. Uses a cached index keyed by the
 * results array identity to avoid repeated computation.
 */
export function visibleIndexes(results: SearchResult[], filter: string): number[] {
  const normalizedFilter = normalizeFilter(filter);
  let resultCache = visibleIndexCache.get(results);
  if (resultCache === undefined) {
    resultCache = new Map<string, number[]>();
    visibleIndexCache.set(results, resultCache);
  }

  const cached = resultCache.get(normalizedFilter);
  if (cached !== undefined) {
    return cached;
  }

  let visible: number[];
  if (!normalizedFilter) {
    visible = new Array<number>(results.length);
    for (let index = 0; index < results.length; index += 1) {
      visible[index] = index;
    }
  } else {
    visible = [];
    for (let index = 0; index < results.length; index += 1) {
      if (searchIndexForResult(results[index]).includes(normalizedFilter)) {
        visible.push(index);
      }
    }
  }
  resultCache.set(normalizedFilter, visible);
  return visible;
}

/**
 * Renders the interactive selection screen as an ANSI string.
 *
 * Displays the result list (up to 12 rows), the currently highlighted entry's
 * detail panel, a BibTeX preview (compact or expanded), the filter bar, and
 * source-issue banners when `sourceErrors` are provided.
 */
export function renderSelection(
  results: SearchResult[],
  state: SelectionState,
  sourceErrors: SearchSourceError[] = [],
  options: RenderSelectionOptions = {}
): string {
  const useColor = options.color ?? false;
  const visible = visibleIndexes(results, state.filter);
  const selectedVisibleIndex = visible[state.cursor];
  const selected = selectedVisibleIndex === undefined ? undefined : results[selectedVisibleIndex];
  const rows = visible.slice(0, 12).map((resultIndex, visibleIndex) => {
    const result = results[resultIndex];
    const marker = visibleIndex === state.cursor ? paint(">", "1;32", useColor) : " ";
    const title = truncate(result.title, 74);
    const row = `${marker} [${resultIndex}] ${paint(result.source.padEnd(16), "36", useColor)} ${paint(result.score.toFixed(3), "1;32", useColor)} ${title}`;
    return visibleIndex === state.cursor ? paint(row, "1", useColor) : row;
  });
  const issues = formatSourceIssueBanner(sourceErrors, useColor);
  const detail = selected ? [
    "",
    `${styleLabel("Title:", useColor)} ${selected.title}`,
    `${styleLabel("Authors:", useColor)} ${formatAuthorPreview(selected.authors)}`,
    `${styleLabel("Year:", useColor)} ${selected.year ?? ""}  ${styleLabel("Venue:", useColor)} ${selected.venue ?? ""}`,
    `${styleLabel("IDs:", useColor)} ${[
      selected.doi ? `${styleLabel("DOI", useColor)} ${selected.doi}` : "",
      selected.arxivId ? `${styleLabel("arXiv", useColor)} ${selected.arxivId}` : ""
    ].filter(Boolean).join("  ")}`,
    "",
    `${styleLabel("BibTeX preview:", useColor)} ${paint(state.previewMode, "36;1", useColor)}`,
    ...formatBibtexPreview(selected, state.previewMode, useColor)
  ] : ["", "No candidates match the current filter."];

  return [
    paint("search-bibtex candidate selection", "1", useColor),
    ...issues,
    `${styleLabel("Filter:", useColor)} ${state.mode === "filter" ? "/" : ""}${paint(state.filter, "36", useColor)}`,
    paint("Keys: j/k move, g/G jump, / filter, Ctrl+O preview, Enter select, q cancel", "2", useColor),
    "",
    ...rows,
    ...detail,
  ].join("\n");
}

export async function runInteractiveSelection(
  results: SearchResult[],
  options: InteractiveSelectionOptions = {}
): Promise<SearchResult | undefined> {
  if (results.length === 0) {
    throw new Error("No search results to select from.");
  }

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stderr;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Interactive selection requires a TTY. Use --select-index for non-interactive selection.");
  }

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  let state = createSelectionState();

  return await new Promise<SearchResult | undefined>((resolve) => {
    const render = () => {
      output.write("\x1b[2J\x1b[H");
      output.write(renderSelection(results, state, options.sourceErrors, { color: true }));
    };
    const cleanup = (clearScreen = true) => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      input.pause();
      if (clearScreen) {
        output.write("\x1b[2J\x1b[H");
      }
    };
    const onKeypress = (inputText: string, key: KeypressKey) => {
      const event = keypressToSelectionEvent(inputText, key);
      if (!event) {
        return;
      }
      state = updateSelectionState(state, event, results);

      if (state.cancelled) {
        cleanup();
        resolve(undefined);
        return;
      }

      if (state.selectedIndex !== undefined) {
        const selected = results[state.selectedIndex];
        const formattedBibtex = formatBibtexText(selected.bibtex);
        const clipboard = copyTextToClipboard(formattedBibtex);
        output.write("\x1b[2J\x1b[H");
        output.write(renderSelectionConfirmation(selected, formattedBibtex, clipboard, true));
        cleanup(false);
        resolve(selected);
        return;
      }

      render();
    };

    input.on("keypress", onKeypress);
    render();
  });
}

export function keypressToSelectionEvent(input: string, key: KeypressKey): SelectionEvent | undefined {
  if (key.ctrl && input === "c") {
    return { type: "cancel" };
  }
  if (key.name === "up" || input === "k") {
    return { type: "up" };
  }
  if (key.name === "down" || input === "j") {
    return { type: "down" };
  }
  if (input === "g") {
    return { type: "home" };
  }
  if (input === "G") {
    return { type: "end" };
  }
  if (input === "/") {
    return { type: "filter" };
  }
  if (key.ctrl && (key.name === "o" || input === "\u000f")) {
    return { type: "toggle-preview" };
  }
  if (key.name === "return") {
    return { type: "enter" };
  }
  if (key.name === "escape") {
    return { type: "escape" };
  }
  if (input === "q") {
    return { type: "cancel" };
  }
  if (key.name === "backspace") {
    return { type: "backspace" };
  }
  if (input && input.length === 1 && !key.ctrl && !key.meta) {
    return { type: "char", value: input };
  }
  return undefined;
}

export function selectedResultByIndex(results: SearchResult[], index: number): SearchResult {
  const selected = results[index];
  if (!selected) {
    throw new Error(`Selection index ${index} is out of range. Received ${results.length} result(s).`);
  }
  return selected;
}

export function formatSelectedResult(result: SearchResult, format: "bibtex" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  return `${formatBibtexText(result.bibtex)}\n`;
}

function clampCursor(cursor: number, visibleCount: number): number {
  return Math.min(Math.max(0, cursor), Math.max(0, visibleCount - 1));
}

function normalizeFilter(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function searchIndexForResult(result: SearchResult): string {
  const cached = searchIndexCache.get(result);
  if (cached !== undefined) {
    return cached;
  }

  const normalized = normalizeFilter([
    result.title,
    result.authors.join(" "),
    result.venue ?? "",
    result.source,
    result.doi ?? "",
    result.arxivId ?? ""
  ].join(" "));
  searchIndexCache.set(result, normalized);
  return normalized;
}

function formatBibtexPreview(result: SearchResult, mode: PreviewMode, color = false): string[] {
  if (mode === "expanded") {
    return wrapPreviewLines(result.bibtex.trim().split(/\r?\n/), 92).slice(0, 24).map((line) => highlightBibtexLine(line, color));
  }

  const entryType = result.bibtex.trim().match(/^@([^\s{]+)/)?.[1] ?? "misc";
  const venueField = entryType === "article" ? "journal" : entryType === "inproceedings" ? "booktitle" : "venue";
  const lines = [
    result.bibtex.trim().split(/\r?\n/, 1)[0] ?? `@${entryType}{preview,`,
    `  title = {${truncate(result.title, 88)}}`,
    `  author = {${formatAuthorPreview(result.authors, 4)}}`
  ];

  if (result.year) {
    lines.push(`  year = {${result.year}}`);
  }
  if (result.venue) {
    lines.push(`  ${venueField} = {${truncate(result.venue, 88)}}`);
  }
  if (result.doi) {
    lines.push(`  doi = {${truncate(result.doi, 88)}}`);
  }
  if (result.arxivId) {
    lines.push(`  eprint = {${truncate(result.arxivId, 88)}}`);
  }
  if (result.url) {
    lines.push(`  url = {${truncate(result.url, 88)}}`);
  }

  lines.push("}");
  return lines.map((line) => highlightBibtexLine(line, color));
}

function renderSelectionConfirmation(
  result: SearchResult,
  formattedBibtex: string,
  clipboard: ClipboardResult,
  color: boolean
): string {
  const clipboardLabel = clipboard.copied
    ? paint(`Clipboard: ${clipboard.message}`, "1;32", color)
    : paint(`Clipboard: ${clipboard.message}`, "1;33", color);
  return [
    paint("search-bibtex selection confirmed", "1", color),
    `${styleLabel("Title:", color)} ${result.title}`,
    `${styleLabel("Source:", color)} ${result.source}  ${styleLabel("Score:", color)} ${result.score.toFixed(3)}`,
    clipboardLabel,
    "",
    ...formattedBibtex.split(/\r?\n/).map((line) => highlightBibtexLine(line, color))
  ].join("\n");
}

function formatAuthorPreview(authors: string[], limit = 3): string {
  if (authors.length === 0) {
    return "";
  }
  if (authors.length <= limit) {
    return authors.join(" and ");
  }

  return `${authors.slice(0, limit).join(" and ")} and ... (+${authors.length - limit} more)`;
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 3))}...`;
}

function formatSourceIssueBanner(sourceErrors: SearchSourceError[], color: boolean): string[] {
  if (sourceErrors.length === 0) {
    return [];
  }

  const summary = sourceErrors
    .map((error) => `${error.source}${error.status ? ` ${error.status}` : ""}${error.message ? ` ${truncate(error.message, 48)}` : ""}`)
    .join(", ");
  return [
    paint("Source issues:", "1;33", color),
    ...wrapPreviewLines([summary], 88).map((line) => paint(`  ${line}`, "33", color))
  ];
}

function highlightBibtexLine(line: string, color: boolean): string {
  if (!color) {
    return line;
  }

  const entryHeader = line.match(/^(@[^\s{]+)(.*)$/);
  if (entryHeader) {
    return `${paint(entryHeader[1], "1;36", color)}${entryHeader[2]}`;
  }

  const field = line.match(/^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=\s*)(.*)$/);
  if (field) {
    return `${field[1]}${paint(field[2], "36;1", color)}${field[3]}${field[4]}`;
  }

  return line;
}

function styleLabel(value: string, color: boolean): string {
  return paint(value, "1", color);
}

function paint(value: string, code: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function copyTextToClipboard(text: string): ClipboardResult {
  const attempts = clipboardCommands();
  for (const attempt of attempts) {
    const result = spawnSync(attempt.command, attempt.args, {
      input: text,
      encoding: "utf8",
      windowsHide: true
    });
    if (!result.error && result.status === 0) {
      return {
        copied: true,
        message: `copied via ${attempt.command}`
      };
    }
  }

  return {
    copied: false,
    message: "clipboard unavailable"
  };
}

function clipboardCommands(): Array<{ command: string; args: string[] }> {
  if (process.platform === "darwin") {
    return [{ command: "pbcopy", args: [] }];
  }

  if (process.platform === "win32") {
    return [{ command: "clip", args: [] }];
  }

  return [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] }
  ];
}

function wrapPreviewLines(lines: string[], width: number): string[] {
  return lines.flatMap((line) => {
    if (line.length <= width) {
      return [line];
    }

    const wrapped: string[] = [];
    let remaining = line.trimEnd();
    while (remaining.length > width) {
      const breakPoint = remaining.lastIndexOf(" ", width);
      const slicePoint = breakPoint > 0 ? breakPoint : width;
      wrapped.push(remaining.slice(0, slicePoint).trimEnd());
      remaining = remaining.slice(slicePoint).trimStart();
    }
    if (remaining.length > 0) {
      wrapped.push(remaining);
    }
    return wrapped;
  });
}
