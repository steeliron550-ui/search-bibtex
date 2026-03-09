/**
 * prefs.js – Preference management for the Search BibTeX Zotero plugin.
 *
 * All preferences are stored under the Zotero preference branch
 * `extensions.search-bibtex`.  This module provides getter / setter
 * helpers and registers sensible defaults during plugin installation.
 */

if (!Zotero_SearchBibTeX) {
  var Zotero_SearchBibTeX = {};
}

Zotero_SearchBibTeX.Prefs = {};

var PREFS_BRANCH = "extensions.search-bibtex";

/**
 * registerDefaults()
 *
 * Writes default values for every preference that the plugin recognises.
 * Called from `install()` and `startup()` to ensure no preference key is
 * ever `undefined`.  Existing values (e.g. from a previous install) are
 * NOT overwritten – only missing keys are created.
 */
Zotero_SearchBibTeX.Prefs.registerDefaults = function () {
  var defaults = {
    "sourceOrder": "doi,crossref,dblp,arxiv,semanticScholar,openAlex",
    "maxResults": 10,
    "citationKeyStyle": "author-year",
    "autoImport": false,
    "timeout": 15000,
    "includeAbstract": true,
    "debug": false,
    "uiLanguage": "auto",
  };

  var keys = Object.keys(defaults);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var fullKey = PREFS_BRANCH + "." + key;

    try {
      if (Zotero.Prefs.get(fullKey) === undefined) {
        Zotero.Prefs.set(fullKey, defaults[key]);
      }
    } catch (e) {
      Zotero.log(
        "search-bibtex: registerDefaults error for " + key + " – " + e
      );
    }
  }

  Zotero.log("search-bibtex: registerDefaults – defaults registered.");
};

/**
 * get(key)
 *
 * Reads a single plugin preference.  The `key` is the short name (e.g.
 * "maxResults"), not the full preference-branch path.
 *
 * @param {string} key - Preference short name.
 * @returns {*} The stored value, or `undefined` if not set.
 */
Zotero_SearchBibTeX.Prefs.get = function (key) {
  try {
    return Zotero.Prefs.get(PREFS_BRANCH + "." + key);
  } catch (e) {
    Zotero.log("search-bibtex: Prefs.get error for " + key + " – " + e);
    return undefined;
  }
};

/**
 * set(key, value)
 *
 * Writes a single plugin preference.
 *
 * @param {string} key - Preference short name.
 * @param {*} value - Value to store (string, number, boolean).
 */
Zotero_SearchBibTeX.Prefs.set = function (key, value) {
  try {
    Zotero.Prefs.set(PREFS_BRANCH + "." + key, value);
  } catch (e) {
    Zotero.log("search-bibtex: Prefs.set error for " + key + " – " + e);
  }
};

/**
 * getSourcePriority()
 *
 * Reads the `sourceOrder` preference and returns it as an array of source
 * names.  The order determines which sources are tried first and how much
 * weight each source carries during merge/rank.
 *
 * @returns {string[]} e.g. ["doi","crossref","dblp","arxiv","semanticScholar","openAlex"]
 */
Zotero_SearchBibTeX.Prefs.getSourcePriority = function () {
  var raw = Zotero_SearchBibTeX.Prefs.get("sourceOrder");
  if (!raw || typeof raw !== "string") {
    return ["doi", "crossref", "dblp", "arxiv", "semanticScholar", "openAlex"];
  }

  return raw
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
};
