import type { SearchPreferences } from "./types.js";

export const defaultSearchPreferences: SearchPreferences = {
  sourcePriority: ["dblp", "arxiv", "crossref", "openalex", "doi", "semantic-scholar"],
  weights: {
    title: 0.45,
    author: 0.2,
    year: 0.1,
    identifier: 0.2,
    source: 0.05
  },
  limit: 10
};
