/**
 * sources.js – Individual source searchers for the Search BibTeX plugin.
 *
 * Each function accepts a search query object `{ query, type }` and an
 * options hash, queries one external API, and returns a Promise that
 * resolves to an array of normalised result objects.  Errors are thrown
 * so the caller (searchAllSources) can catch and record them.
 *
 * Result shape:
 *   { title, authors: string[], year, doi, journal, booktitle, volume,
 *     pages, url, abstract, entryType, rawBibtex, _source }
 */

if (!Zotero_SearchBibTeX) {
  var Zotero_SearchBibTeX = {};
}

Zotero_SearchBibTeX.Sources = {};

/**
 * doi(searchQuery, options)
 *
 * Uses the DOI content-negotiation endpoint (https://doi.org/…) to fetch
 * a BibTeX-formatted record.  This source is the most authoritative when
 * the query type is 'doi'.
 *
 * @param {Object} searchQuery - { query, type }
 * @param {Object} [options] - e.g. { maxResults: 10 }
 * @returns {Promise<Array>} Array of normalised result objects.
 */
Zotero_SearchBibTeX.Sources.doi = async function (searchQuery, options) {
  if (!searchQuery || searchQuery.type !== "doi" || !searchQuery.query) {
    return [];
  }

  const doi = searchQuery.query.trim();
  const url = "https://doi.org/" + encodeURIComponent(doi);

  try {
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/x-bibtex; charset=utf-8",
      },
      responseType: "text",
      timeout: (options && options.timeout) || 15000,
    });

    if (!resp || !resp.response || resp.status < 200 || resp.status >= 300) {
      return [];
    }

    const parsed = Zotero_SearchBibTeX.Core.parseBibtexEntry(resp.response);
    if (!parsed) {
      return [];
    }

    parsed._source = "doi";
    return [parsed];
  } catch (e) {
    throw new Error("DOI source failed: " + e);
  }
};

/**
 * crossref(searchQuery, options)
 *
 * Queries the Crossref REST API (https://api.crossref.org/works).  Works
 * with DOI, title, and author-year queries.  The API returns JSON; this
 * function maps the relevant fields to the normalised result format.
 *
 * @param {Object} searchQuery - { query, type }
 * @param {Object} [options] - e.g. { maxResults: 10 }
 * @returns {Promise<Array>} Array of normalised result objects.
 */
Zotero_SearchBibTeX.Sources.crossref = async function (searchQuery, options) {
  if (!searchQuery || !searchQuery.query) {
    return [];
  }

  var maxResults = (options && options.maxResults) || 10;
  var params = "rows=" + maxResults;

  if (searchQuery.type === "doi") {
    params += "&filter=doi:" + encodeURIComponent(searchQuery.query);
  } else if (searchQuery.type === "title") {
    params +=
      "&query.bibliographic=" + encodeURIComponent(searchQuery.query);
  } else {
    params += "&query=" + encodeURIComponent(searchQuery.query);
  }

  var url = "https://api.crossref.org/works?" + params;

  try {
    var resp = await Zotero.HTTP.request("GET", url, {
      headers: { Accept: "application/json" },
      responseType: "json",
      timeout: (options && options.timeout) || 15000,
    });

    if (
      !resp ||
      !resp.response ||
      resp.status < 200 ||
      resp.status >= 300
    ) {
      return [];
    }

    var items =
      resp.response.message && resp.response.message.items
        ? resp.response.message.items
        : [];

    return items.slice(0, maxResults).map(function (item) {
      var result = {
        title: null,
        authors: [],
        year: null,
        doi: item.DOI || null,
        journal: null,
        booktitle: null,
        volume: item.volume || null,
        pages: item.page || null,
        url: item.URL || null,
        abstract: item.abstract || null,
        entryType: item.type || null,
        _source: "crossref",
      };

      // Title.  Crossref returns an array of strings.
      if (Array.isArray(item.title)) {
        result.title = item.title[0] || null;
      } else if (typeof item.title === "string") {
        result.title = item.title;
      }

      // Authors.
      if (Array.isArray(item.author)) {
        result.authors = item.author.map(function (a) {
          return (a.given || "") + " " + (a.family || "");
        });
      }

      // Year.
      if (item.created && item.created["date-parts"]) {
        var dp = item.created["date-parts"];
        if (Array.isArray(dp) && dp.length > 0 && Array.isArray(dp[0])) {
          result.year = dp[0][0] || null;
        }
      }

      // Container (journal or book title).
      if (Array.isArray(item["container-title"])) {
        result.journal = item["container-title"][0] || null;
      }

      return result;
    });
  } catch (e) {
    throw new Error("Crossref source failed: " + e);
  }
};
