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

  it("keeps unmatched entries unchanged and reports entry progress", async () => {
    const input = [
      "@article{achiam2023gpt,",
      "  author = {Achiam, Josh and Adler, Steven},",
      "  title = {Gpt-4 technical report},",
      "  journal = {arXiv preprint arXiv:2303.08774},",
      "  year = {2023}",
      "}",
      "",
      "@article{unmatched2024,",
      "  author = {Doe, Jane},",
      "  title = {No Match Paper},",
      "  year = {2024}",
      "}",
      ""
    ].join("\n");
    const events: Array<{ completed: number; total: number; status?: string }> = [];

    const result = await refineBibtexDocument(input, {
      fetcher: fakeFetch,
      preferences: {
        sourcePriority: ["dblp"],
        limit: 1
      },
      onProgress: (event) => {
        events.push({
          completed: event.completed,
          total: event.total,
          status: event.current?.status
        });
      }
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      citationKey: "achiam2023gpt",
      updated: true,
      selectedSource: "dblp"
    });
    expect(result.entries[1]).toMatchObject({
      citationKey: "unmatched2024",
      updated: false
    });
    expect(result.text).toContain("@article{achiam2023gpt,");
    expect(result.text).toContain("GPT-4 Technical Report");
    expect(result.text).toContain("@article{unmatched2024,");
    expect(result.text).toContain("No Match Paper");
    expect(result.sourceErrors).toEqual([]);
    expect(events[0]).toMatchObject({ completed: 0, total: 2 });
    expect(events.some((event) => event.completed === 1 && event.status === "updated")).toBe(true);
    expect(events.some((event) => event.completed === 2 && event.status === "unchanged")).toBe(true);
  });

  it("requires interactive confirmation for every matched entry", async () => {
    const input = [
      "@article{first2024,",
      "  author = {Example, Alice},",
      "  title = {First Paper},",
      "  year = {2024}",
      "}",
      "",
      "@article{second2024,",
      "  author = {Example, Bob},",
      "  title = {Second Paper},",
      "  year = {2024}",
      "}",
      ""
    ].join("\n");
    const confirmed: string[] = [];

    const result = await refineBibtexDocument(input, {
      fetcher: fakeFetch,
      preferences: {
        sourcePriority: ["dblp"],
        limit: 1
      },
      selectResult: async (context) => {
        confirmed.push(context.citationKey);
        return context.response.results[0];
      }
    });

    expect(confirmed).toEqual(["first2024", "second2024"]);
    expect(result.entries.every((entry) => entry.updated)).toBe(true);
    expect(result.text).toContain("First Paper Updated");
    expect(result.text).toContain("Second Paper Updated");
  });

  it("aborts the update when interactive selection is cancelled", async () => {
    const input = [
      "@article{first2024,",
      "  author = {Example, Alice},",
      "  title = {First Paper},",
      "  year = {2024}",
      "}",
      ""
    ].join("\n");
    const confirmed: string[] = [];

    await expect(refineBibtexDocument(input, {
      fetcher: fakeFetch,
      preferences: {
        sourcePriority: ["dblp"],
        limit: 1
      },
      selectResult: async (context) => {
        confirmed.push(context.citationKey);
        return undefined;
      }
    })).rejects.toThrow("BibTeX update cancelled for first2024.");

    expect(confirmed).toEqual(["first2024"]);
  });
});

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);

  if (url.startsWith("https://dblp.org/search/publ/api")) {
    const query = new URL(url).searchParams.get("q")?.toLowerCase() ?? "";

    if (query.includes("gpt-4 technical report")) {
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

    if (query.includes("first paper")) {
      return jsonResponse({
        result: {
          hits: {
            hit: [{
              info: {
                title: "First Paper",
                authors: { author: [{ text: "Alice Example" }] },
                venue: "ACL",
                year: "2024",
                key: "conf/acl/FirstPaper2024",
                doi: "10.0000/first2024"
              }
            }]
          }
        }
      });
    }

    if (query.includes("second paper")) {
      return jsonResponse({
        result: {
          hits: {
            hit: [{
              info: {
                title: "Second Paper",
                authors: { author: [{ text: "Bob Example" }] },
                venue: "ACL",
                year: "2024",
                key: "conf/acl/SecondPaper2024",
                doi: "10.0000/second2024"
              }
            }]
          }
        }
      });
    }

    if (query.includes("no match paper")) {
      return jsonResponse({
        result: {
          hits: {
            hit: []
          }
        }
      });
    }

    return jsonResponse({
      result: {
        hits: {
          hit: []
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

  if (url === "https://dblp.org/rec/conf/acl/FirstPaper2024.bib") {
    return new Response(`@article{DBLP:conf/acl/FirstPaper2024,\n  title = {First Paper Updated},\n  author = {Example, Alice},\n  year = {2024},\n  journal = {ACL},\n  doi = {10.0000/first2024}\n}`, {
      status: 200,
      headers: { "content-type": "application/x-bibtex" }
    });
  }

  if (url === "https://dblp.org/rec/conf/acl/SecondPaper2024.bib") {
    return new Response(`@article{DBLP:conf/acl/SecondPaper2024,\n  title = {Second Paper Updated},\n  author = {Example, Bob},\n  year = {2024},\n  journal = {ACL},\n  doi = {10.0000/second2024}\n}`, {
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
