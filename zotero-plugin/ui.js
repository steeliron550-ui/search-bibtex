/**
 * ui.js – User-interface integration for the Search BibTeX Zotero plugin.
 *
 * This module registers right-click menu items on Zotero items and
 * collections, handles the "Search BibTeX from PDF" action, and displays
 * search-result dialogs so the user can pick which entry to import.
 */

if (!Zotero_SearchBibTeX) {
  var Zotero_SearchBibTeX = {};
}

Zotero_SearchBibTeX.UI = {};

/**
 * registerItemMenu()
 *
 * Adds a "Search BibTeX from PDF" menu item to the right-click context
 * menu of Zotero items.  The menu entry is visible on attachment items
 * whose file is a PDF, and also on regular items (books, articles, etc.)
 * where the user can enter a title manually.
 *
 * This function must be called during `startup()` so the menu is
 * available as soon as Zotero loads the plugin.
 */
Zotero_SearchBibTeX.UI.registerItemMenu = function () {
  // Register on the item pane context menu (right-click on an item).
  Zotero.Menus.register(
    "item",
    "search-bibtex-from-pdf",
    {
      label: "Search BibTeX",
      onCommand: Zotero_SearchBibTeX.UI.onSearchFromPDF,
      onShow: function (target) {
        // Show the menu item for any non-collection item.
        return target && target.getItemsAsync
          ? true
          : false;
      },
      icon: "chrome://search-bibtex/skin/search.svg",
    }
  );

  Zotero.log("search-bibtex: registerItemMenu – context menu registered.");
};

/**
 * unregisterItemMenu()
 *
 * Removes the "Search BibTeX" context-menu entry.  Must be called during
 * `shutdown()` so the menu does not persist after the plugin is disabled
 * or unloaded.
 */
Zotero_SearchBibTeX.UI.unregisterItemMenu = function () {
  Zotero.Menus.unregister("item", "search-bibtex-from-pdf");
  Zotero.log("search-bibtex: unregisterItemMenu – context menu removed.");
};
