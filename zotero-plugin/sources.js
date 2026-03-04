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
