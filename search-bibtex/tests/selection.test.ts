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

  it("maps keypresses to selection events", () => {
    expect(keypressToSelectionEvent("j", {})).toEqual({ type: "down" });
    expect(keypressToSelectionEvent("k", {})).toEqual({ type: "up" });
    expect(keypressToSelectionEvent("G", {})).toEqual({ type: "end" });
    expect(keypressToSelectionEvent("/", {})).toEqual({ type: "filter" });
    expect(keypressToSelectionEvent("", { name: "return" })).toEqual({ type: "enter" });
  });

  it("renders details and formats selected output", () => {
    const rendered = renderSelection(results, createSelectionState(), []);
    expect(rendered).toContain("search-bibtex candidate selection");
    expect(rendered).toContain("Self-Instruct");

    expect(selectedResultByIndex(results, 0).source).toBe("dblp");
    expect(formatSelectedResult(results[0], "bibtex")).toBe("@article{sample}\n");
    expect(formatSelectedResult(results[0], "json")).toContain("\"source\": \"dblp\"");
  });
});

function makeResult(source: SearchResult["source"], title: string, score: number): SearchResult {
  return {
    source,
    title,
    authors: ["Yizhong Wang"],
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
