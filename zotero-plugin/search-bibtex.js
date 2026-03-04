/**
 * search-bibtex.js – Core module for the Search BibTeX Zotero plugin.
 *
 * This module provides the functions that bridge Zotero's internal APIs
 * (attachments, items, collections) with the multi-source BibTeX search
 * logic.  It is loaded at startup and attached to the `Zotero_SearchBibTeX`
 * namespace so the UI and preferences modules can call it.
 */

if (!Zotero_SearchBibTeX) {
  var Zotero_SearchBibTeX = {};
}

Zotero_SearchBibTeX.Core = {};

/**
 * extractMetadataFromPDF(filePath)
 *
 * Reads a PDF file from disk (typically a Zotero stored attachment) and
 * attempts to extract actionable metadata: DOI, arXiv ID, title text,
 * author names, and publication year.  The function uses Zotero's
 * built-in full-text indexing to retrieve the first few pages of text
 * and then applies regex-based heuristics to pull out identifiers.
 *
 * @param {string} filePath - Absolute path to the PDF file on disk.
 * @returns {Object} An object with optional keys: doi, arxiv, title,
 *   authors (string[]), year (number|null), rawPages (string[]).
 */
Zotero_SearchBibTeX.Core.extractMetadataFromPDF = function (filePath) {
  Zotero.log("search-bibtex: extractMetadataFromPDF – " + filePath);

  const meta = {
    doi: null,
    arxiv: null,
    title: null,
    authors: [],
    year: null,
    rawPages: [],
  };

  try {
    // Use Zotero's Fulltext utility to read the PDF text content.
    const fulltext = Zotero.Fulltext.getFileFulltext(filePath);
    if (!fulltext || !fulltext.pages || !fulltext.pages.length) {
      Zotero.log("search-bibtex: no fulltext available for " + filePath);
      return meta;
    }

    // Keep the first 3 pages (enough for metadata without too much noise).
    const pages = fulltext.pages.slice(0, 3);
    meta.rawPages = pages;

    const combinedText = pages.join("\n");

    // --- DOI extraction -------------------------------------------------
    const doiMatch = combinedText.match(
      /\b(10\.\d{4,}(?:\.\d+)*\/[^\s"'<>]+)\b/i
    );
    if (doiMatch) {
      meta.doi = doiMatch[1].replace(/[;,.]+$/, "");
    }

    // --- arXiv ID extraction --------------------------------------------
    const arxivMatch = combinedText.match(
      /(?:arXiv\s*[:#]?\s*|arxiv\.org\/abs\/)(\d{4}\.\d{4,}(?:v\d+)?)/i
    );
    if (arxivMatch) {
      meta.arxiv = arxivMatch[1];
    }

    // --- Title heuristic ------------------------------------------------
    // The first substantial line that looks like a title is usually on
    // the first page and has at least 5 words.
    for (const page of pages) {
      const lines = page.split(/\n+/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 15 && trimmed.split(/\s+/).length >= 5) {
          meta.title = trimmed;
          break;
        }
      }
      if (meta.title) break;
    }

    // --- Year extraction -------------------------------------------------
    const yearMatch = combinedText.match(
      /\b((?:19|20)\d{2})\b/
    );
    if (yearMatch) {
      const y = parseInt(yearMatch[1], 10);
      if (y >= 1900 && y <= new Date().getFullYear() + 2) {
        meta.year = y;
      }
    }

    Zotero.log(
      "search-bibtex: extracted doi=" +
        meta.doi +
        " arxiv=" +
        meta.arxiv +
        " title=" +
        (meta.title ? meta.title.substring(0, 60) + "..." : null)
    );
  } catch (e) {
    Zotero.log("search-bibtex: extractMetadataFromPDF error – " + e);
  }

  return meta;
};

/**
 * buildSearchQuery(metadata)
 *
 * Builds a search query string from the extracted metadata.  The function
 * prioritises DOI (most specific), then arXiv ID, then a cleaned title.
 * When none of those are available it falls back to a combination of
 * first-author surname and year.
 *
 * @param {Object} metadata - The object returned by extractMetadataFromPDF().
 * @returns {Object} { query: string, type: 'doi'|'arxiv'|'title'|'author-year'|null }
 */
Zotero_SearchBibTeX.Core.buildSearchQuery = function (metadata) {
  if (!metadata) {
    return { query: null, type: null };
  }

  // Best: exact DOI lookup.
  if (metadata.doi) {
    return {
      query: metadata.doi.trim(),
      type: "doi",
    };
  }

  // Second: arXiv ID lookup.
  if (metadata.arxiv) {
    return {
      query: metadata.arxiv.trim(),
      type: "arxiv",
    };
  }

  // Third: cleaned title (strip line-breaks, collapse whitespace).
  if (metadata.title) {
    const cleanTitle = metadata.title
      .replace(/[\r\n]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (cleanTitle.length > 10) {
      return {
        query: cleanTitle,
        type: "title",
      };
    }
  }

  // Fallback: first-author surname + year (least precise).
  if (
    metadata.authors &&
    metadata.authors.length > 0 &&
    metadata.year
  ) {
    const surname = metadata.authors[0].split(/\s+/).pop();
    return {
      query: surname + " " + metadata.year,
      type: "author-year",
    };
  }

  return { query: null, type: null };
};

/**
 * searchAllSources(searchQuery, options)
 *
 * Dispatches a query to every configured source in parallel, collects the
 * results, and attaches per-source error information so the caller can
 * decide how to handle partial failures.
 *
 * Sources are called through the Zotero_SearchBibTeX.Sources module.  If a
 * source function throws or returns an error the failure is recorded in
 * `sourceErrors` rather than aborting the whole search.
 *
 * @param {Object} searchQuery - { query, type } from buildSearchQuery().
 * @param {Object} [options] - Optional overrides (e.g. maxResults, timeout).
 * @returns {Promise<Object>} { results: Array, sourceErrors: Object }
 */
Zotero_SearchBibTeX.Core.searchAllSources = async function (
  searchQuery,
  options
) {
  if (!searchQuery || !searchQuery.query) {
    return { results: [], sourceErrors: { _empty: "No query to search." } };
  }

  const sourceErrors = {};
  const results = [];

  const maxResults = (options && options.maxResults) || 10;

  // List of sources to try.  Order matters – earlier sources get
  // higher priority during the merge/rank step.
  const sourceNames = [
    "doi",
    "crossref",
    "dblp",
    "arxiv",
    "semanticScholar",
    "openAlex",
  ];

  // Fire all source searches concurrently.
  const promises = sourceNames.map(async function (name) {
    try {
      let sourceFn = null;
      if (
        Zotero_SearchBibTeX.Sources &&
        typeof Zotero_SearchBibTeX.Sources[name] === "function"
      ) {
        sourceFn = Zotero_SearchBibTeX.Sources[name];
      }

      if (!sourceFn) {
        sourceErrors[name] = "Source not available.";
        return [];
      }

      const raw = await sourceFn(searchQuery, { maxResults });
      if (Array.isArray(raw)) {
        // Tag each result with its source for later ranking.
        raw.forEach(function (r) {
          r._source = name;
        });
        return raw;
      }
      return [];
    } catch (e) {
      sourceErrors[name] = String(e);
      Zotero.log("search-bibtex: source " + name + " error – " + e);
      return [];
    }
  });

  const sourceResults = await Promise.all(promises);
  for (let i = 0; i < sourceResults.length; i++) {
    const chunk = sourceResults[i];
    for (let j = 0; j < chunk.length; j++) {
      results.push(chunk[j]);
    }
  }

  Zotero.log(
    "search-bibtex: searchAllSources – " +
      results.length +
      " total results from " +
      sourceNames.length +
      " sources."
  );

  return { results: results, sourceErrors: sourceErrors };
};

/**
 * mergeAndRankResults(results, queryType)
 *
 * Deduplicates results by DOI (preferred) or title similarity, then sorts
 * them according to source priority and field completeness so the most
 * reliable entry appears first.
 *
 * Source priority (higher = preferred): doi > crossref > dblp > arxiv >
 * semanticScholar > openAlex.
 *
 * @param {Array} results - Flat array of result objects from all sources.
 * @param {string} queryType - The `type` field from buildSearchQuery().
 * @returns {Array} Deduplicated, ranked result array.
 */
Zotero_SearchBibTeX.Core.mergeAndRankResults = function (results, queryType) {
  if (!results || !results.length) {
    return [];
  }

  // --- Source priority lookup -------------------------------------------
  var sourceOrder = {
    doi: 6,
    crossref: 5,
    dblp: 4,
    arxiv: 3,
    semanticScholar: 2,
    openAlex: 1,
  };

  // --- Deduplicate by DOI -----------------------------------------------
  var seenDoi = {};
  var deduped = [];

  for (var i = 0; i < results.length; i++) {
    var r = results[i];

    if (r.doi) {
      var key = r.doi.toLowerCase().trim();
      if (seenDoi[key]) {
        // Keep the entry from the higher-priority source.
        var existing = seenDoi[key];
        var existingSrc = sourceOrder[existing._source] || 0;
        var currentSrc = sourceOrder[r._source] || 0;
        if (currentSrc > existingSrc) {
          // Replace.
          var idx = deduped.indexOf(existing);
          if (idx >= 0) {
            deduped[idx] = r;
          }
          seenDoi[key] = r;
        }
        continue;
      }
      seenDoi[key] = r;
    }

    deduped.push(r);
  }

  // --- Compute completeness score ---------------------------------------
  // Each field contributes to the score: title(3), authors(2), year(1),
  // doi(3), journal/booktitle(2), volume+pages(1).
  deduped.forEach(function (entry) {
    var score = 0;
    if (entry.title) score += 3;
    if (entry.author || entry.authors) score += 2;
    if (entry.year || entry.date) score += 1;
    if (entry.doi) score += 3;
    if (entry.journal || entry.booktitle || entry.publicationTitle)
      score += 2;
    if (entry.volume || entry.pages) score += 1;

    entry._completeness = score;
  });

  // --- Sort: source priority first, then completeness -------------------
  deduped.sort(function (a, b) {
    var srcA = sourceOrder[a._source] || 0;
    var srcB = sourceOrder[b._source] || 0;
    if (srcB !== srcA) {
      return srcB - srcA; // higher priority first
    }
    var compA = a._completeness || 0;
    var compB = b._completeness || 0;
    return compB - compA;
  });

  Zotero.log(
    "search-bibtex: mergeAndRankResults – " +
      deduped.length +
      " unique results after dedup (had " +
      results.length +
      " raw)."
  );

  return deduped;
};

/**
 * parseBibtexEntry(rawText)
 *
 * Parses a raw BibTeX string into a structured object suitable for
 * creating or updating a Zotero item via the API.
 *
 * Recognised fields are mapped to Zotero's CSL-style keys so they can be
 * passed directly to `Zotero.Items.set(item, fields)` or a translator.
 *
 * @param {string} rawText - A single BibTeX entry as a string.
 * @returns {Object} Parsed entry with keys: entryType, citationKey, title,
 *   authors (string[]), year, doi, journal, booktitle, volume, pages, url,
 *   abstract, and a `raw` copy of the input.
 */
Zotero_SearchBibTeX.Core.parseBibtexEntry = function (rawText) {
  if (!rawText) {
    return null;
  }

  var entry = {
    entryType: null,
    citationKey: null,
    title: null,
    authors: [],
    year: null,
    doi: null,
    journal: null,
    booktitle: null,
    volume: null,
    pages: null,
    url: null,
    abstract: null,
    raw: rawText,
  };

  try {
    // --- Entry type and citation key ------------------------------------
    var typeMatch = rawText.match(
      /@(\w+)\s*\{\s*([^,\s]+)/
    );
    if (typeMatch) {
      entry.entryType = typeMatch[1].toLowerCase();
      entry.citationKey = typeMatch[2];
    }

    // --- Field extraction helper ----------------------------------------
    function getField(name) {
      // BibTeX fields are case-insensitive; match "field = {value}" or
      // "field = "value"".
      var re = new RegExp(
        name +
          '\\s*=\\s*[{"]([^}"]*)[}"]',
        "i"
      );
      var m = rawText.match(re);
      return m ? m[1].trim() : null;
    }

    entry.title = getField("title");
    entry.doi = getField("doi");
    entry.journal = getField("journal");
    entry.booktitle = getField("booktitle");
    entry.volume = getField("volume");
    entry.pages = getField("pages");
    entry.url = getField("url");
    entry.abstract = getField("abstract");

    // Year can appear as `year` or `date`.
    var yearStr = getField("year") || getField("date");
    if (yearStr) {
      var yearNum = parseInt(yearStr.match(/\d{4}/), 10);
      if (!isNaN(yearNum)) {
        entry.year = yearNum;
      }
    }

    // Authors: split on " and " (standard BibTeX convention).
    var authorStr = getField("author");
    if (authorStr) {
      entry.authors = authorStr
        .split(/\s+and\s+/)
        .map(function (a) {
          return a.replace(/[{}]/g, "").trim();
        })
        .filter(Boolean);
    }
  } catch (e) {
    Zotero.log("search-bibtex: parseBibtexEntry error – " + e);
  }

  return entry;
};
