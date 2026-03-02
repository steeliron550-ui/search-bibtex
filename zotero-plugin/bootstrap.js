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

/**
 * startup()
 *
 * Called every time Zotero starts with the plugin enabled, and also right
 * after `install()` during a fresh installation.  This is where the plugin
 * should initialise its runtime components: create the top-level object,
 * register menu items / keyboard shortcuts, hook into Zotero's notifier,
 * and load any UI panes.
 *
 * @param {Object} data - Contains `id`, `version`, `resourceURI`, `rootURI`.
 * @param {number} reason - Same reason codes as install().
 */
function startup(data, reason) {
  Zotero.log("search-bibtex: startup called (reason=" + reason + ").");

  // Initialise the plugin namespace if it hasn't been created yet.
  if (!Zotero_SearchBibTeX) {
    Zotero_SearchBibTeX = {};
  }

  // Store references that other modules may need at runtime.
  Zotero_SearchBibTeX.pluginID = data.id;
  Zotero_SearchBibTeX.version = data.version;
  Zotero_SearchBibTeX.rootURI = data.rootURI;
  Zotero_SearchBibTeX.resourceURI = data.resourceURI;

  // Register the right-click menu on Zotero items.
  if (Zotero_SearchBibTeX.UI) {
    Zotero_SearchBibTeX.UI.registerItemMenu();
  }

  Zotero.log("search-bibtex: startup complete.");
}

/**
 * shutdown()
 *
 * Called when Zotero is closing OR when the user disables / removes the
 * plugin.  All runtime state must be cleaned up here: remove menu items,
 * unregister notifier callbacks, close any open windows, and tear down UI
 * panes so that nothing leaks into the next session.
 *
 * @param {Object} data - Same metadata object as startup().
 * @param {number} reason - ADDON_DISABLE(5) or ADDON_UNINSTALL(6) typically.
 */
function shutdown(data, reason) {
  Zotero.log("search-bibtex: shutdown called (reason=" + reason + ").");

  // Remove the right-click menu item if it was registered.
  if (Zotero_SearchBibTeX && Zotero_SearchBibTeX.UI) {
    Zotero_SearchBibTeX.UI.unregisterItemMenu();
  }

  // Null out the namespace so GC can collect everything.
  Zotero_SearchBibTeX = undefined;
  Zotero.log("search-bibtex: shutdown complete.");
}

/**
 * uninstall()
 *
 * Called once when the plugin is permanently removed by the user.  Use this
 * hook to remove any data that was persisted specifically for the plugin
 * (e.g. preference branches, cached files, or database entries).  If the
 * plugin might be re-installed later, consider keeping the prefs so the user
 * doesn't lose their configuration.
 *
 * @param {Object} data - Same metadata object.
 * @param {number} reason - Should always be ADDON_UNINSTALL(6).
 */
function uninstall(data, reason) {
  Zotero.log("search-bibtex: uninstall called (reason=" + reason + ").");

  if (reason === ADDON_REASON.UNINSTALL) {
    // Clear plugin-specific preferences so no stale keys remain.
    if (Zotero.Prefs) {
      try {
        Zotero.Prefs.clearBranch("extensions.search-bibtex");
      } catch (e) {
        Zotero.log("search-bibtex: could not clear preference branch – " + e);
      }
    }

    Zotero.log("search-bibtex: uninstall cleanup complete.");
  }
}
