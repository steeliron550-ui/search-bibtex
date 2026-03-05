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

/**
 * dblp(searchQuery, options)
 *
 * Queries the DBLP Search API (https://dblp.org/search/publ/api).  DBLP
 * returns XML and is most useful for computer-science papers.  This
 * function parses the XML response and normalises the hits.
 *
 * @param {Object} searchQuery - { query, type }
 * @param {Object} [options] - e.g. { maxResults: 10 }
 * @returns {Promise<Array>} Array of normalised result objects.
 */
Zotero_SearchBibTeX.Sources.dblp = async function (searchQuery, options) {
  if (!searchQuery || !searchQuery.query) {
    return [];
  }

  var maxResults = (options && options.maxResults) || 10;
  var q = encodeURIComponent(searchQuery.query);

  var url =
    "https://dblp.org/search/publ/api?q=" +
    q +
    "&format=xml&h=" +
    maxResults;

  try {
    var resp = await Zotero.HTTP.request("GET", url, {
      headers: { Accept: "application/xml" },
      responseType: "text",
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

    // Simple XML parsing using regex (DBLP's XML is straightforward enough).
    var xml = resp.response;
    var hitRegex =
      /<hit[^>]*>([\s\S]*?)<\/hit>/g;
    var results = [];
    var match;

    while ((match = hitRegex.exec(xml)) !== null) {
      if (results.length >= maxResults) break;
      var hitXml = match[1];

      var result = {
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
        entryType: null,
        _source: "dblp",
      };

      // Title
      var tMatch = hitXml.match(/<title>([\s\S]*?)<\/title>/);
      if (tMatch) {
        result.title = tMatch[1]
          .replace(/<[^>]+>/g, "")
          .trim();
      }

      // Authors
      var aRegex = /<author>([\s\S]*?)<\/author>/g;
      var aMatch;
      while ((aMatch = aRegex.exec(hitXml)) !== null) {
        result.authors.push(
          aMatch[1].replace(/<[^>]+>/g, "").trim()
        );
      }

      // Year
      var yMatch = hitXml.match(/<year>(\d{4})<\/year>/);
      if (yMatch) {
        result.year = parseInt(yMatch[1], 10);
      }

      // DOI
      var dMatch = hitXml.match(/<doi>([\s\S]*?)<\/doi>/);
      if (dMatch) {
        result.doi = dMatch[1].trim();
      }

      // Venue (journal or booktitle depending on the hit type)
      var vMatch = hitXml.match(/<venue>([\s\S]*?)<\/venue>/);
      if (vMatch) {
        result.journal = vMatch[1]
          .replace(/<[^>]+>/g, "")
          .trim();
      }

      // URL
      var uMatch = hitXml.match(/<url>([\s\S]*?)<\/url>/);
      if (uMatch) {
        result.url = uMatch[1].trim();
      }

      results.push(result);
    }

    return results;
  } catch (e) {
    throw new Error("DBLP source failed: " + e);
  }
};

/**
 * arxiv(searchQuery, options)
 *
 * Queries the arXiv API (https://export.arxiv.org/api/query).  This source
 * is best for pre-prints; it returns Atom XML which this function parses
 * into the normalised result format.
 *
 * @param {Object} searchQuery - { query, type }
 * @param {Object} [options] - e.g. { maxResults: 10 }
 * @returns {Promise<Array>} Array of normalised result objects.
 */
Zotero_SearchBibTeX.Sources.arxiv = async function (searchQuery, options) {
  if (!searchQuery || !searchQuery.query) {
    return [];
  }

  var maxResults = (options && options.maxResults) || 10;
  var q = encodeURIComponent(searchQuery.query);

  var url =
    "https://export.arxiv.org/api/query?search_query=all:" +
    q +
    "&start=0&max_results=" +
    maxResults;

  try {
    var resp = await Zotero.HTTP.request("GET", url, {
      headers: { Accept: "application/atom+xml" },
      responseType: "text",
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

    var xml = resp.response;

    // Split by <entry> – each is one paper.
    var entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    var results = [];
    var match;

    while ((match = entryRegex.exec(xml)) !== null) {
      if (results.length >= maxResults) break;
      var entryXml = match[1];

      var result = {
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
        entryType: "article",
        _source: "arxiv",
      };

      // Title
      var tMatch = entryXml.match(
        /<title[^>]*>([\s\S]*?)<\/title>/
      );
      if (tMatch) {
        result.title = tMatch[1]
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      // Authors
      var aRegex = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
      var aMatch;
      while ((aMatch = aRegex.exec(entryXml)) !== null) {
        result.authors.push(aMatch[1].trim());
      }

      // Summary / abstract
      var sMatch = entryXml.match(
        /<summary[^>]*>([\s\S]*?)<\/summary>/
      );
      if (sMatch) {
        result.abstract = sMatch[1]
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      // Published date → year
      var dMatch = entryXml.match(
        /<published[^>]*>(\d{4})/
      );
      if (dMatch) {
        result.year = parseInt(dMatch[1], 10);
      }

      // DOI (optional in arXiv)
      var doiMatch = entryXml.match(
        /<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/
      );
      if (doiMatch) {
        result.doi = doiMatch[1].trim();
      }

      // URL / ID
      var idMatch = entryXml.match(
        /<id[^>]*>([\s\S]*?)<\/id>/
      );
      if (idMatch) {
        result.url = idMatch[1].trim();
      }

      results.push(result);
    }

    return results;
  } catch (e) {
    throw new Error("arXiv source failed: " + e);
  }
};

/**
 * semanticScholar(searchQuery, options)
 *
 * Queries the Semantic Scholar Academic Graph API
 * (https://api.semanticscholar.org/graph/v1/paper/search).  This source
 * covers a wide range of disciplines and provides good title/abstract
 * matching even with partial queries.
 *
 * @param {Object} searchQuery - { query, type }
 * @param {Object} [options] - e.g. { maxResults: 10 }
 * @returns {Promise<Array>} Array of normalised result objects.
 */
Zotero_SearchBibTeX.Sources.semanticScholar = async function (
  searchQuery,
  options
) {
  if (!searchQuery || !searchQuery.query) {
    return [];
  }

  var maxResults = (options && options.maxResults) || 10;
  var q = encodeURIComponent(searchQuery.query);

  var url =
    "https://api.semanticscholar.org/graph/v1/paper/search?query=" +
    q +
    "&limit=" +
    maxResults +
    "&fields=title,authors,year,externalIds,journal,venue,url,abstract,publicationTypes";

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

    var papers = resp.response.data || [];

    return papers.slice(0, maxResults).map(function (paper) {
      var result = {
        title: paper.title || null,
        authors: [],
        year: paper.year || null,
        doi: null,
        journal: null,
        booktitle: null,
        volume: null,
        pages: null,
        url: paper.url || null,
        abstract: paper.abstract || null,
        entryType: null,
        _source: "semanticScholar",
      };

      // Authors.
      if (Array.isArray(paper.authors)) {
        result.authors = paper.authors.map(function (a) {
          return a.name || "";
        });
      }

      // DOI from externalIds.
      if (paper.externalIds && paper.externalIds.DOI) {
        result.doi = paper.externalIds.DOI;
      }

      // Venue / journal.
      if (paper.journal && paper.journal.name) {
        result.journal = paper.journal.name;
      }
      if (
        paper.venue &&
        paper.venue.name &&
        !result.journal
      ) {
        result.journal = paper.venue.name;
      }

      // Publication type → entryType.
      if (
        Array.isArray(paper.publicationTypes) &&
        paper.publicationTypes.length > 0
      ) {
        result.entryType = paper.publicationTypes[0];
      }

      return result;
    });
  } catch (e) {
    throw new Error("Semantic Scholar source failed: " + e);
  }
};

/**
 * openAlex(searchQuery, options)
 *
 * Queries the OpenAlex REST API (https://api.openalex.org/works).  OpenAlex
 * provides a large open-access index of scholarly works with DOI, title,
 * and keyword search capabilities.  This source is especially useful as a
 * fallback for papers outside the computer-science domain.
 *
 * @param {Object} searchQuery - { query, type }
 * @param {Object} [options] - e.g. { maxResults: 10 }
 * @returns {Promise<Array>} Array of normalised result objects.
 */
Zotero_SearchBibTeX.Sources.openAlex = async function (searchQuery, options) {
  if (!searchQuery || !searchQuery.query) {
    return [];
  }

  var maxResults = (options && options.maxResults) || 10;
  var q = encodeURIComponent(searchQuery.query);

  var filterParam = "";
  if (searchQuery.type === "doi") {
    filterParam = "&filter=doi:" + encodeURIComponent(searchQuery.query);
  } else if (searchQuery.type === "title") {
    filterParam =
      "&filter=title.search:" + encodeURIComponent(searchQuery.query);
  } else {
    filterParam =
      "&search=" + encodeURIComponent(searchQuery.query);
  }

  var url =
    "https://api.openalex.org/works?per_page=" +
    maxResults +
    filterParam;

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

    var works = resp.response.results || resp.response.data || [];

    return works.slice(0, maxResults).map(function (work) {
      var result = {
        title: work.title || work.display_name || null,
        authors: [],
        year: work.publication_year || null,
        doi: work.doi
          ? work.doi.replace("https://doi.org/", "")
          : null,
        journal: null,
        booktitle: null,
        volume: null,
        pages: null,
        url: work.doi
          ? "https://doi.org/" + work.doi.replace("https://doi.org/", "")
          : null,
        abstract: null,
        entryType: work.type || null,
        _source: "openAlex",
      };

      // Authorships.
      if (Array.isArray(work.authorships)) {
        result.authors = work.authorships.map(function (auth) {
          return (
            (auth.author && auth.author.display_name) || ""
          );
        });
      }

      // Primary location → source (journal).
      if (
        work.primary_location &&
        work.primary_location.source &&
        work.primary_location.source.display_name
      ) {
        result.journal =
          work.primary_location.source.display_name;
      }

      // Abstract from inverted index (reconstruct if present).
      if (
        work.abstract_inverted_index &&
        typeof work.abstract_inverted_index === "object"
      ) {
        try {
          var idx = work.abstract_inverted_index;
          var words = [];
          var keys = Object.keys(idx);
          for (var i = 0; i < keys.length; i++) {
            var positions = idx[keys[i]];
            if (Array.isArray(positions)) {
              for (var p = 0; p < positions.length; p++) {
                words[positions[p]] = keys[i];
              }
            }
          }
          result.abstract = words.join(" ");
        } catch (_) {
          // Leave abstract null if reconstruction fails.
        }
      }

      return result;
    });
  } catch (e) {
    throw new Error("OpenAlex source failed: " + e);
  }
};
