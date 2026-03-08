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
