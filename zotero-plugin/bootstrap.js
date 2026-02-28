/**
 * Search BibTeX Zotero Plugin - bootstrap (lifecycle entry point).
 *
 * This file defines the lifecycle hooks that Zotero calls when the plugin is
 * installed, started, shut down, or uninstalled.  It also holds the top-level
 * plugin object so that other modules can register UI elements, preferences,
 * and event listeners during startup.
 */

var Zotero_SearchBibTeX;

/**
 * install()
 *
 * Called once when the plugin is first installed (or when the user re-installs
 * it after removing it).  Use this hook to register default preferences, create
 * any required directories, or set up one-time configuration that should
 * survive across Zotero restarts.
 *
 * @param {Object} data - Metadata object provided by Zotero.
 * @param {number} reason - ADDON_INSTALL(1), ADDON_UPGRADE(2), ADDON_DOWNGRADE(3),
 *   ADDON_ENABLE(4), ADDON_DISABLE(5), ADDON_UNINSTALL(6).
 */
const ADDON_REASON = { INSTALL: 1, UPGRADE: 2, DOWNGRADE: 3, ENABLE: 4, DISABLE: 5, UNINSTALL: 6 };

function install(data, reason) {
  Zotero.log("search-bibtex: install called (reason=" + reason + ").");

  if (reason === ADDON_REASON.INSTALL || reason === ADDON_REASON.UPGRADE) {
    if (Zotero_SearchBibTeX && Zotero_SearchBibTeX.Prefs) {
      Zotero_SearchBibTeX.Prefs.registerDefaults();
    }
  }
}
