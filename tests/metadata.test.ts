import { describe, expect, it } from "vitest";

import {
  buildMetadataCandidate,
  extractArxivId,
  extractDoi,
  generateSearchQueries,
  stripArxivVersion
} from "../src/metadata.js";
import type { PdfDocumentSnapshot } from "../src/types.js";

describe("metadata extraction", () => {
  it("extracts DOI values without trailing punctuation", () => {
    expect(extractDoi("Latest updates: https://dl.acm.org/doi/10.1145/3676642.3736114 .")).toBe(
      "10.1145/3676642.3736114"
    );
  });

  it("extracts arXiv IDs and strips versions for search", () => {
    expect(extractArxivId("2511.22333v2.pdf")).toBe("2511.22333v2");
    expect(stripArxivVersion("2511.22333v2")).toBe("2511.22333");
  });

  it("detects ACL-style title and authors after conference front matter", () => {
    const metadata = buildMetadataCandidate(snapshotFromLines("2023.acl-long.754.pdf", [
      "Proceedings of the 61st Annual Meeting of the Association for Computational Linguistics",
      "Volume 1: Long Papers, pages 13484-13508",
      "July 9-14, 2023",
      "SELF-INSTRUCT: Aligning Language Models",
      "with Self-Generated Instructions",
      "Yizhong Wang♣ Yeganeh Kordi♢ Swaroop Mishra♡ Alisa Liu♣",
      "Noah A. Smith♣+ Daniel Khashabi♠ Hannaneh Hajishirzi♣+",
      "Abstract"
    ]));

    expect(metadata.title).toBe("SELF-INSTRUCT: Aligning Language Models with Self-Generated Instructions");
    expect(metadata.authors.slice(0, 3)).toEqual(["Yizhong Wang", "Yeganeh Kordi", "Swaroop Mishra"]);
    expect(metadata.year).toBe(2023);
  });

  it("detects arXiv-style title and year from the arXiv identifier", () => {
    const metadata = buildMetadataCandidate(snapshotFromLines("2602.06036v1.pdf", [
      "DFlash: Block Diffusion for Flash Speculative Decoding",
      "Jian Chen 1 Yesheng Liang 1 Zhijian Liu 1",
      "https://z-lab.ai/projects/dflash",
      "Abstract"
    ]));

    expect(metadata.title).toBe("DFlash: Block Diffusion for Flash Speculative Decoding");
    expect(metadata.authors).toEqual(["Jian Chen", "Yesheng Liang", "Zhijian Liu"]);
    expect(metadata.arxivId).toBe("2602.06036v1");
    expect(metadata.year).toBe(2026);
  });

  it("generates identifier queries before fuzzy title queries", () => {
    const metadata = buildMetadataCandidate(snapshotFromLines("3676642.3736114.pdf", [
      "Latest updates: https://dl.acm.org/doi/10.1145/3676642.3736114 .",
      "RESEARCH-ARTICLE",
      "Neuralink: Fast on-Device LLM Inference with Neuron Co-Activation",
      "Linking",
      "TUOWEI WANG, Tsinghua University, Beijing, China .",
      "Abstract"
    ]));
    const queries = generateSearchQueries(metadata);

    expect(metadata.title).toBe("Neuralink: Fast on-Device LLM Inference with Neuron Co-Activation Linking");
    expect(metadata.doi).toBe("10.1145/3676642.3736114");
    expect(queries.map((query) => query.kind)).toEqual(["doi", "title", "title-author"]);
  });
});

function snapshotFromLines(filePath: string, lines: string[]): PdfDocumentSnapshot {
  return {
    filePath,
    pageCount: 1,
    info: {},
    text: lines.join("\n"),
    lines
  };
}
