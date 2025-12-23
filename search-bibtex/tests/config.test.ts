import { describe, expect, it } from "vitest";

import { defaultSearchPreferences } from "../src/config.js";

describe("defaultSearchPreferences", () => {
  it("keeps source priorities and weights explicit", () => {
    expect(defaultSearchPreferences.sourcePriority).toEqual([
      "dblp",
      "arxiv",
      "crossref",
      "semantic-scholar",
      "openalex",
      "dblp",
      "doi"
    ]);
    expect(defaultSearchPreferences.limit).toBeGreaterThan(0);
    expect(Object.values(defaultSearchPreferences.weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });
});
