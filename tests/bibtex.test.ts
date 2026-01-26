import { describe, expect, it } from "vitest";

import { formatBibtexText } from "../src/bibtex.js";

describe("BibTeX formatting", () => {
  it("formats entries for confirmation display while preserving field separators", () => {
    expect(formatBibtexText("@article{Example,\n  title = {A Study},\n  author = {Alice and Bob},\n  year = {2024}\n}")).toBe(
      "@article{Example,\n  title = {A Study},\n  author = {Alice and Bob},\n  year = {2024},\n}"
    );
  });
});
