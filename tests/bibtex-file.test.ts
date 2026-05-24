import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseBibtexDocument, refineBibtexDocument } from "../src/bibtex-file.js";

describe("BibTeX parsing", () => {
  it("extracts titles and citation keys from the sample BibTeX format", async () => {
    const text = await readFile(new URL("./bibtex/acl_test.bib", import.meta.url), "utf8");
    const entries = parseBibtexDocument(text).flatMap((segment) => (segment.kind === "entry" && segment.entry ? [segment.entry] : []));

    expect(entries[0]).toMatchObject({
      citationKey: "du2023dp",
      title: "Dp-forward: Fine-tuning and inference on language models with differential privacy in forward pass"
    });
  });
});

describe("BibTeX refinement", () => {
  it("refreshes matching fields while preserving the citation key", async () => {
    const input = `# CR: Not used\n@article{achiam2023gpt,\n  author = {Achiam, Josh and Adler, Steven},\n  title = {Gpt-4 technical report},\n  journal = {arXiv preprint arXiv:2303.08774},\n  year = {2023}\n}\n`;
    const result = await refineBibtexDocument(input, {
      fetcher: fakeFetch,
      preferences: {
        sourcePriority: ["dblp"],
        limit: 1
      }
    });

    expect(result.sourceErrors).toEqual([]);
    expect(result.entries[0]).toMatchObject({
      citationKey: "achiam2023gpt",
      title: "Gpt-4 technical report",
      selectedSource: "dblp"
    });
    expect(result.text).toContain("# CR: Not used");
    expect(result.text).toContain("@article{achiam2023gpt,");
    expect(result.text).toContain("GPT-4 Technical Report");
    expect(result.text).not.toContain("@article{DBLP:conf");
  });
});

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);

  if (url.startsWith("https://dblp.org/search/publ/api")) {
    return jsonResponse({
      result: {
        hits: {
          hit: [{
            info: {
              title: "Gpt-4 technical report",
              authors: { author: [{ text: "Josh Achiam" }, { text: "Steven Adler" }] },
              venue: "arXiv",
              year: "2023",
              key: "journals/corr/abs-2303-08774",
              doi: "10.48550/arxiv.2303.08774"
            }
          }]
        }
      }
    });
  }

  if (url === "https://dblp.org/rec/journals/corr/abs-2303-08774.bib") {
    return new Response(`@article{DBLP:journals/corr/abs-2303-08774,\n  title = {GPT-4 Technical Report},\n  author = {Achiam, Josh and Adler, Steven},\n  year = {2023},\n  journal = {arXiv preprint arXiv:2303.08774},\n  doi = {10.48550/arxiv.2303.08774}\n}`, {
      status: 200,
      headers: { "content-type": "application/x-bibtex" }
    });
  }

  throw new Error(`Unexpected URL ${url}`);
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
