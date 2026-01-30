import { describe, expect, it } from "vitest";

import { generateBibtex } from "../src/bibtex.js";
import { defaultSearchPreferences, type CustomSourceConfig } from "../src/config.js";
import { rankBibliographicCandidates } from "../src/ranking.js";
import { normalizeArxivFeed, normalizeDblpHits, searchBibtex } from "../src/search.js";
import type { PdfMetadataCandidate } from "../src/types.js";

const metadata: PdfMetadataCandidate = {
  filePath: "paper.pdf",
  pageCount: 12,
  title: "Self-Instruct: Aligning Language Models with Self-Generated Instructions",
  authors: ["Yizhong Wang", "Yeganeh Kordi"],
  year: 2023,
  doi: "10.18653/v1/2023.acl-long.754",
  textSample: ""
};

describe("bibliographic source normalization", () => {
  it("normalizes DBLP search hits", () => {
    const records = normalizeDblpHits({
      result: {
        hits: {
          hit: {
            info: {
              title: "Self-Instruct: Aligning Language Models with Self-Generated Instructions.",
              authors: { author: [{ text: "Yizhong Wang" }, { text: "Yeganeh Kordi" }] },
              venue: "ACL",
              year: "2023",
              key: "conf/acl/WangKMLSKH23",
              doi: "10.18653/V1/2023.ACL-LONG.754"
            }
          }
        }
      }
    });

    expect(records[0]).toMatchObject({
      source: "dblp",
      sourceId: "conf/acl/WangKMLSKH23",
      title: "Self-Instruct: Aligning Language Models with Self-Generated Instructions",
      authors: ["Yizhong Wang", "Yeganeh Kordi"],
      year: 2023
    });
  });

  it("normalizes arXiv Atom entries", () => {
    const records = normalizeArxivFeed(`<?xml version="1.0"?><feed><entry><id>http://arxiv.org/abs/2602.06036v1</id><title>DFlash: Block Diffusion for Flash Speculative Decoding</title><published>2026-02-05T18:59:30Z</published><author><name>Jian Chen</name></author></entry></feed>`);

    expect(records[0]).toMatchObject({
      source: "arxiv",
      sourceId: "2602.06036v1",
      arxivId: "2602.06036v1",
      year: 2026,
      authors: ["Jian Chen"]
    });
  });
});

describe("ranking and BibTeX", () => {
  it("ranks a matching DBLP record above a weaker OpenAlex record when DBLP is prioritized", () => {
    const ranked = rankBibliographicCandidates(metadata, [
      {
        source: "openalex",
        title: "Self-Instruct: Aligning Language Models with Self-Generated Instructions",
        authors: ["Yizhong Wang", "Yeganeh Kordi"],
        year: 2022,
        doi: "10.48550/arxiv.2212.10560"
      },
      {
        source: "dblp",
        title: "Self-Instruct: Aligning Language Models with Self-Generated Instructions",
        authors: ["Yizhong Wang", "Yeganeh Kordi"],
        year: 2023,
        doi: "10.18653/v1/2023.acl-long.754"
      }
    ], defaultSearchPreferences);

    expect(ranked[0].source).toBe("dblp");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("generates BibTeX for arXiv records without pretending it came from a DOI endpoint", () => {
    const bibtex = generateBibtex({
      source: "arxiv",
      title: "DFlash: Block Diffusion for Flash Speculative Decoding",
      authors: ["Jian Chen", "Yesheng Liang"],
      year: 2026,
      arxivId: "2602.06036v1",
      url: "https://arxiv.org/abs/2602.06036v1"
    });

    expect(bibtex).toContain("archivePrefix = {arXiv}");
    expect(bibtex).toContain("eprint = {2602.06036}");
  });
});

describe("search aggregation", () => {
  it("returns ranked BibTeX candidates and explicit source errors", async () => {
    const response = await searchBibtex(metadata, {
      fetcher: fakeFetch,
      preferences: {
        sourcePriority: ["dblp", "crossref", "semantic-scholar"],
        limit: 3
      }
    });

    expect(response.results[0]).toMatchObject({
      source: "dblp",
      bibtex: "@inproceedings{WangKMLSKH23}"
    });
    expect(response.sourceErrors).toEqual([
      expect.objectContaining({
        source: "semantic-scholar",
        status: 429
      })
    ]);
  });

  it("searches sources in parallel by default", async () => {
    maxParallelFetches = 0;
    parallelFetches = 0;

    await searchBibtex(metadata, {
      fetcher: parallelFetchProbe,
      preferences: {
        sourcePriority: ["dblp", "crossref"],
        limit: 1
      },
      timeoutMs: 1000
    });

    expect(maxParallelFetches).toBeGreaterThan(1);
  });

  it("reports source search progress as each channel completes in serial mode", async () => {
    const events: Array<{ completed: number; total: number; completedSources: string[]; failedSources: string[] }> = [];

    await searchBibtex(metadata, {
      fetcher: fakeFetch,
      preferences: {
        sourcePriority: ["dblp", "crossref", "semantic-scholar"],
        limit: 3
      },
      parallel: false,
      onProgress: (event) => {
        events.push({
          completed: event.completed,
          total: event.total,
          completedSources: [...event.completedSources],
          failedSources: [...event.failedSources]
        });
      }
    });

    expect(events).toEqual([
      { completed: 0, total: 3, completedSources: [], failedSources: [] },
      { completed: 1, total: 3, completedSources: ["dblp"], failedSources: [] },
      { completed: 2, total: 3, completedSources: ["dblp", "crossref"], failedSources: [] },
      { completed: 3, total: 3, completedSources: ["dblp", "crossref"], failedSources: ["semantic-scholar"] }
    ]);
  });

  it("stops serial search when the timeout budget is exhausted", async () => {
    const response = await searchBibtex(metadata, {
      fetcher: slowTimeoutFetch,
      preferences: {
        sourcePriority: ["dblp", "crossref"],
        limit: 3
      },
      parallel: false,
      timeoutMs: 10
    });

    expect(response.results).toEqual([]);
    expect(response.sourceErrors).toHaveLength(1);
    expect(response.sourceErrors[0]).toEqual(expect.objectContaining({
      source: "dblp"
    }));
    expect(response.sourceErrors[0].message).toContain("Search timed out after");
  });

  it("searches a custom HTTP source and fetches BibTeX from a template URL", async () => {
    const customSource: CustomSourceConfig = {
      name: "acm-custom",
      kind: "http-json",
      enabled: true,
      search: {
        url: "https://example.test/search?query={title}&limit={limit}"
      },
      response: {
        itemsPath: "items",
        fields: {
          sourceId: "id",
          title: "title",
          authors: "authors",
          year: "year",
          doi: "doi",
          arxivId: "arxiv",
          venue: "venue",
          url: "url"
        }
      },
      bibtex: {
        strategy: "url",
        urlTemplate: "https://example.test/bibtex/{sourceId}",
        accept: "application/x-bibtex"
      }
    };

    const response = await searchBibtex({
      ...metadata,
      title: "Custom Source Paper"
    }, {
      fetcher: customSourceFetch,
      preferences: {
        sourcePriority: ["acm-custom"],
        limit: 1
      },
      customSources: [customSource]
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      source: "acm-custom",
      sourceId: "acm-123",
      title: "Custom Source Paper"
    });
    expect(response.results[0].bibtex).toBe("@article{CustomSourcePaper2024Custom}");
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
              title: metadata.title,
              authors: { author: [{ text: "Yizhong Wang" }, { text: "Yeganeh Kordi" }] },
              venue: "ACL",
              year: "2023",
              key: "conf/acl/WangKMLSKH23",
              doi: metadata.doi
            }
          }]
        }
      }
    });
  }

  if (url === "https://dblp.org/rec/conf/acl/WangKMLSKH23.bib") {
    return new Response("@inproceedings{WangKMLSKH23}", {
      status: 200,
      headers: { "content-type": "application/x-bibtex" }
    });
  }

  if (url.startsWith("https://api.crossref.org/works")) {
    return jsonResponse({
      message: {
        items: [{
          title: [metadata.title],
          DOI: metadata.doi,
          issued: { "date-parts": [[2023]] },
          "container-title": ["ACL"],
          author: [{ given: "Yizhong", family: "Wang" }]
        }]
      }
    });
  }

  if (url.startsWith("https://doi.org/")) {
    return new Response("@inproceedings{CrossrefBib}", {
      status: 200,
      headers: { "content-type": "application/x-bibtex" }
    });
  }

  if (url.startsWith("https://api.semanticscholar.org/")) {
    return new Response("rate limited", { status: 429 });
  }

  throw new Error(`Unexpected URL ${url}`);
}

async function slowTimeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal;
  return await new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(jsonResponse({
        result: {
          hits: {
            hit: []
          }
        }
      }));
    }, 250);

    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    }, { once: true });
  });
}

async function customSourceFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  void init;
  const url = String(input);

  if (url === "https://example.test/search?query=Custom%20Source%20Paper&limit=1") {
    return jsonResponse({
      items: [{
        id: "acm-123",
        title: "Custom Source Paper",
        authors: ["A. Author", "B. Author"],
        year: 2024,
        doi: "10.1145/example",
        venue: "ACM Test",
        url: "https://example.test/paper/acm-123"
      }]
    });
  }

  if (url === "https://example.test/bibtex/acm-123") {
    return new Response("@article{CustomSourcePaper2024Custom}", {
      status: 200,
      headers: { "content-type": "application/x-bibtex" }
    });
  }

  throw new Error(`Unexpected URL ${url}`);
}

let parallelFetches = 0;
let maxParallelFetches = 0;

async function parallelFetchProbe(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url.startsWith("https://dblp.org/search/publ/api")) {
    return await delayedResponse({
      result: {
        hits: {
          hit: {
            info: {
              title: metadata.title,
              authors: { author: [{ text: "Yizhong Wang" }, { text: "Yeganeh Kordi" }] },
              venue: "ACL",
              year: "2023",
              key: "conf/acl/WangKMLSKH23",
              doi: metadata.doi
            }
          }
        }
      }
    }, init);
  }

  if (url.startsWith("https://api.crossref.org/works")) {
    return await delayedResponse({
      message: {
        items: [{
          title: [metadata.title],
          DOI: metadata.doi,
          issued: { "date-parts": [[2023]] },
          "container-title": ["ACL"],
          author: [{ given: "Yizhong", family: "Wang" }]
        }]
      }
    }, init);
  }

  if (url === "https://dblp.org/rec/conf/acl/WangKMLSKH23.bib") {
    return new Response("@inproceedings{WangKMLSKH23}", {
      status: 200,
      headers: { "content-type": "application/x-bibtex" }
    });
  }

  if (url.startsWith("https://doi.org/")) {
    return new Response("@inproceedings{CrossrefBib}", {
      status: 200,
      headers: { "content-type": "application/x-bibtex" }
    });
  }

  throw new Error(`Unexpected URL ${url}`);
}

async function delayedResponse(value: unknown, init?: RequestInit): Promise<Response> {
  const signal = init?.signal;
  parallelFetches += 1;
  maxParallelFetches = Math.max(maxParallelFetches, parallelFetches);

  try {
    return await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(jsonResponse(value));
      }, 50);

      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      }, { once: true });
    });
  } finally {
    parallelFetches -= 1;
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
