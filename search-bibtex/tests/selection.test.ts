import { describe, expect, it } from "vitest";

import {
  createSelectionState,
  formatSelectedResult,
  keypressToSelectionEvent,
  renderSelection,
  selectedResultByIndex,
  updateSelectionState,
  visibleIndexes
} from "../src/selection.js";
import type { SearchResult } from "../src/types.js";

const results: SearchResult[] = [
  makeResult("dblp", "Self-Instruct: Aligning Language Models with Self-Generated Instructions", 0.91),
  makeResult("crossref", "Neuralink: Fast on-Device LLM Inference with Neuron Co-Activation Linking", 0.88),
  makeResult("openalex", "DFlash: Block Diffusion for Flash Speculative Decoding", 0.75)
];

describe("selection state", () => {
  it("supports Vim-style movement and selection", () => {
    let state = createSelectionState();
    state = updateSelectionState(state, { type: "down" }, results);
    state = updateSelectionState(state, { type: "down" }, results);
    expect(state.cursor).toBe(2);

    state = updateSelectionState(state, { type: "up" }, results);
    expect(state.cursor).toBe(1);

    state = updateSelectionState(state, { type: "home" }, results);
    expect(state.cursor).toBe(0);

    state = updateSelectionState(state, { type: "end" }, results);
    expect(state.cursor).toBe(2);

    state = updateSelectionState(state, { type: "enter" }, results);
    expect(state.selectedIndex).toBe(2);
  });

  it("marks cancellation without forcing an error path", () => {
    const state = updateSelectionState(createSelectionState(), { type: "cancel" }, results);
    expect(state.cancelled).toBe(true);
  });

  it("filters candidates and maps Enter to visible result indexes", () => {
    let state = createSelectionState();
    state = updateSelectionState(state, { type: "filter" }, results);
    state = updateSelectionState(state, { type: "char", value: "n" }, results);
    state = updateSelectionState(state, { type: "char", value: "e" }, results);
    state = updateSelectionState(state, { type: "char", value: "u" }, results);

    expect(visibleIndexes(results, state.filter)).toEqual([1]);

    state = updateSelectionState(state, { type: "enter" }, results);
    state = updateSelectionState(state, { type: "enter" }, results);
    expect(state.selectedIndex).toBe(1);
  });

  it("toggles preview mode even while filtering", () => {
    let state = createSelectionState();
    state = updateSelectionState(state, { type: "filter" }, results);
    state = updateSelectionState(state, { type: "char", value: "n" }, results);
    state = updateSelectionState(state, { type: "toggle-preview" }, results);

    expect(state.mode).toBe("filter");
    expect(state.filter).toBe("n");
    expect(state.previewMode).toBe("expanded");
  });

  it("maps keypresses to selection events", () => {
    expect(keypressToSelectionEvent("j", {})).toEqual({ type: "down" });
    expect(keypressToSelectionEvent("k", {})).toEqual({ type: "up" });
    expect(keypressToSelectionEvent("G", {})).toEqual({ type: "end" });
    expect(keypressToSelectionEvent("/", {})).toEqual({ type: "filter" });
    expect(keypressToSelectionEvent("\u000f", { name: "o", ctrl: true })).toEqual({ type: "toggle-preview" });
    expect(keypressToSelectionEvent("", { name: "return" })).toEqual({ type: "enter" });
  });

  it("renders details and formats selected output", () => {
    const rendered = renderSelection(results, createSelectionState(), []);
    expect(rendered).toContain("search-bibtex candidate selection");
    expect(rendered).toContain("Self-Instruct");
    expect(rendered).toContain("BibTeX preview: compact");

    expect(selectedResultByIndex(results, 0).source).toBe("dblp");
    expect(formatSelectedResult(results[0], "bibtex")).toBe("@article{sample}\n");
    expect(formatSelectedResult(results[0], "json")).toContain("\"source\": \"dblp\"");
  });

  it("truncates long author lists in the preview", () => {
    const rendered = renderSelection([
      makeResult("dblp", "Large Author List Paper", 0.9, [
        "Alice Example",
        "Bob Example",
        "Carol Example",
        "Dan Example",
        "Eve Example",
        "Frank Example"
      ])
    ], createSelectionState(), []);

    expect(rendered).toContain("and ... (+3 more)");
  });

  it("keeps source issues at the top of the preview", () => {
    const rendered = renderSelection(results, createSelectionState(), [
      { source: "semantic-scholar", query: "title", message: "Too Many Requests", status: 429 }
    ]);
    const lines = rendered.split("\n");
    const bannerIndex = lines.findIndex((line) => line.includes("Source issues:"));
    const rowsIndex = lines.findIndex((line) => line.includes("> [0]"));

    expect(bannerIndex).toBeGreaterThanOrEqual(0);
    expect(rowsIndex).toBeGreaterThanOrEqual(0);
    expect(bannerIndex).toBeLessThan(rowsIndex);
    expect(rendered).toContain("semantic-scholar 429");
  });
});

function makeResult(
  source: SearchResult["source"],
  title: string,
  score: number,
  authors: string[] = ["Yizhong Wang"]
): SearchResult {
  return {
    source,
    title,
    authors,
    year: 2023,
    venue: "ACL",
    matchedQuery: "title-author",
    score,
    scoreBreakdown: {
      title: 1,
      author: 1,
      year: 1,
      identifier: 0,
      source: 1
    },
    bibtex: "@article{sample}"
  };
}
