import type { SearchPreferences } from "./types.js";

export const defaultSearchPreferences: SearchPreferences = {
  sourcePriority: ["arxiv", "crossref", "semantic-scholar", "openalex", "dblp", "doi"],
  weights: {
    title: 0.45,
    author: 0.2,
    year: 0.1,
    identifier: 0.2,
    source: 0.05
  },
  limit: 10
};
