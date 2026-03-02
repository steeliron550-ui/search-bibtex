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
