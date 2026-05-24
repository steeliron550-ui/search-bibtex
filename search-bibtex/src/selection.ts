import readline from "node:readline";

import type { SearchResult, SearchSourceError } from "./types.js";

export type SelectionMode = "browse" | "filter";

export interface SelectionState {
  cursor: number;
  filter: string;
  mode: SelectionMode;
  selectedIndex?: number;
  cancelled: boolean;
}

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
  | { type: "char"; value: string };

export interface InteractiveSelectionOptions {
  sourceErrors?: SearchSourceError[];
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

interface KeypressKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
}

export function createSelectionState(): SelectionState {
  return {
    cursor: 0,
    filter: "",
    mode: "browse",
    cancelled: false
  };
}

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

export function visibleIndexes(results: SearchResult[], filter: string): number[] {
  const normalizedFilter = normalizeFilter(filter);
  return results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => {
      if (!normalizedFilter) {
        return true;
      }
      return normalizeFilter([
        result.title,
        result.authors.join(" "),
        result.venue ?? "",
        result.source,
        result.doi ?? "",
        result.arxivId ?? ""
      ].join(" ")).includes(normalizedFilter);
    })
    .map(({ index }) => index);
}

export function renderSelection(
  results: SearchResult[],
  state: SelectionState,
  sourceErrors: SearchSourceError[] = []
): string {
  const visible = visibleIndexes(results, state.filter);
  const selectedVisibleIndex = visible[state.cursor];
  const selected = selectedVisibleIndex === undefined ? undefined : results[selectedVisibleIndex];
  const rows = visible.slice(0, 12).map((resultIndex, visibleIndex) => {
    const result = results[resultIndex];
    const marker = visibleIndex === state.cursor ? ">" : " ";
    const title = truncate(result.title, 74);
    return `${marker} [${resultIndex}] ${result.source.padEnd(16)} ${result.score.toFixed(3)} ${title}`;
  });
  const detail = selected ? [
    "",
    `Title: ${selected.title}`,
    `Authors: ${selected.authors.slice(0, 8).join(", ")}`,
    `Year: ${selected.year ?? ""}  Venue: ${selected.venue ?? ""}`,
    `IDs: ${[selected.doi ? `DOI ${selected.doi}` : "", selected.arxivId ? `arXiv ${selected.arxivId}` : ""].filter(Boolean).join("  ")}`,
    "",
    "BibTeX:",
    ...selected.bibtex.split(/\r?\n/).slice(0, 10)
  ] : ["", "No candidates match the current filter."];
  const errors = sourceErrors.length > 0 ? [
    "",
    `Source errors: ${sourceErrors.map((error) => `${error.source}${error.status ? ` ${error.status}` : ""}`).join(", ")}`
  ] : [];

  return [
    "search-bibtex candidate selection",
    `Filter: ${state.mode === "filter" ? "/" : ""}${state.filter}`,
    "Keys: j/k move, g/G jump, / filter, Enter select, q cancel",
    "",
    ...rows,
    ...detail,
    ...errors
  ].join("\n");
}

export async function runInteractiveSelection(
  results: SearchResult[],
  options: InteractiveSelectionOptions = {}
): Promise<SearchResult> {
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

  return await new Promise<SearchResult>((resolve, reject) => {
    const render = () => {
      output.write("\x1b[2J\x1b[H");
      output.write(renderSelection(results, state, options.sourceErrors));
    };
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      output.write("\x1b[2J\x1b[H");
    };
    const onKeypress = (inputText: string, key: KeypressKey) => {
      const event = keypressToSelectionEvent(inputText, key);
      if (!event) {
        return;
      }
      state = updateSelectionState(state, event, results);

      if (state.cancelled) {
        cleanup();
        reject(new Error("Selection cancelled."));
        return;
      }

      if (state.selectedIndex !== undefined) {
        const selected = results[state.selectedIndex];
        cleanup();
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
  return `${result.bibtex.trim()}\n`;
}

function clampCursor(cursor: number, visibleCount: number): number {
  return Math.min(Math.max(0, cursor), Math.max(0, visibleCount - 1));
}

function normalizeFilter(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 3))}...`;
}
