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

/**
 * onSearchFromPDF()
 *
 * Callback invoked when the user clicks the "Search BibTeX" menu item.
 * It determines which items are selected, locates a PDF attachment (or
 * uses the selected item's metadata), extracts information, searches all
 * configured sources, and displays the results in a dialog for the user
 * to choose from.
 *
 * @param {Object} target - The Zotero menu target object.
 */
Zotero_SearchBibTeX.UI.onSearchFromPDF = async function (target) {
  Zotero.log("search-bibtex: onSearchFromPDF triggered.");

  var items = target.getItemsAsync
    ? await target.getItemsAsync()
    : Zotero.getActiveZoteroPane().getSelectedItems();

  if (!items || !items.length) {
    Zotero.alert(
      null,
      "Search BibTeX",
      "Please select an item or PDF attachment first."
    );
    return;
  }

  // Determine the file path of a PDF attachment to process.
  var pdfPath = null;
  var titleHint = null;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];

    // If it's an attachment with a PDF, use its file path.
    if (
      item.isAttachment &&
      item.attachmentContentType === "application/pdf"
    ) {
      pdfPath = await item.getFilePathAsync();
      if (pdfPath) {
        break;
      }
    }

    // Also capture a title from a parent item as a fallback.
    if (!titleHint && item.getField) {
      titleHint = item.getField("title");
    }
  }

  // If no PDF found, try to search by title.
  if (!pdfPath && titleHint) {
    Zotero_SearchBibTeX.UI.showSearchResultsDialog(
      null,
      { title: titleHint },
      titleHint
    );
    return;
  }

  if (!pdfPath) {
    Zotero.alert(
      null,
      "Search BibTeX",
      "No PDF attachment found on the selected item(s)."
    );
    return;
  }

  // --- Extract metadata and search --------------------------------------
  var progress = new Zotero.ProgressWindow();
  progress.changeHeadline("Search BibTeX – Extracting metadata…");
  progress.show();

  try {
    var metadata =
      Zotero_SearchBibTeX.Core.extractMetadataFromPDF(pdfPath);
    var searchQuery =
      Zotero_SearchBibTeX.Core.buildSearchQuery(metadata);

    if (!searchQuery || !searchQuery.query) {
      progress.close();
      Zotero.alert(
        null,
        "Search BibTeX",
        "Could not extract usable metadata from the PDF.  " +
          "Try searching by title manually."
      );
      return;
    }

    progress.changeHeadline(
      "Search BibTeX – Searching " +
        searchQuery.type +
        ': "' +
        searchQuery.query.substring(0, 40) +
        '…"'
    );

    var sourceResult = await Zotero_SearchBibTeX.Core.searchAllSources(
      searchQuery,
      {}
    );

    var ranked = Zotero_SearchBibTeX.Core.mergeAndRankResults(
      sourceResult.results,
      searchQuery.type
    );

    progress.close();

    if (!ranked.length) {
      Zotero.alert(
        null,
        "Search BibTeX",
        "No results found for the extracted metadata."
      );
      return;
    }

    // Show the result-picker dialog.
    Zotero_SearchBibTeX.UI.showSearchResultsDialog(
      null,
      metadata,
      ranked
    );
  } catch (e) {
    progress.close();
    Zotero.log("search-bibtex: onSearchFromPDF error – " + e);
    Zotero.alert(
      null,
      "Search BibTeX Error",
      "An error occurred: " + e
    );
  }
};

/**
 * showSearchResultsDialog(parentWindow, metadata, results)
 *
 * Opens a modal dialog that lists the search results and lets the user
 * pick one to import into their Zotero library.  Each row shows the
 * title, source, year, and a button to import.
 *
 * The dialog also provides a text field at the top for manual title
 * search, so the user can refine the query without returning to the
 * Zotero main window.
 *
 * @param {ChromeWindow|null} parentWindow - Parent window (null = main).
 * @param {Object|null} metadata - Extracted metadata for display.
 * @param {Array|string} resultsOrTitle - Ranked results array, or a title
 *   string for manual search.
 */
Zotero_SearchBibTeX.UI.showSearchResultsDialog = function (
  parentWindow,
  metadata,
  resultsOrTitle
) {
  var win = parentWindow || Zotero.getMainWindow();

  // Determine whether we have results or just a title string.
  var results = Array.isArray(resultsOrTitle) ? resultsOrTitle : null;
  var manualTitle =
    typeof resultsOrTitle === "string" ? resultsOrTitle : null;

  // Build the dialog content dynamically.
  var dialog = win.openDialog(
    "chrome://search-bibtex/content/search-results.xhtml",
    "search-bibtex-results",
    "chrome,modal,resizable,centerscreen",
    {
      metadata: metadata,
      results: results,
      manualTitle: manualTitle,
    }
  );

  if (!dialog) {
    Zotero.log(
      "search-bibtex: showSearchResultsDialog – dialog open failed."
    );
    return;
  }

  // When the dialog closes, check which entry (if any) the user selected.
  dialog.addEventListener("close", function (event) {
    var selected = dialog.returnValue;
    if (!selected) {
      return; // User cancelled.
    }

    // Import the selected entry.
    var progress = new Zotero.ProgressWindow();
    progress.changeHeadline("Search BibTeX – Importing…");
    progress.show();

    Zotero_SearchBibTeX.Core.importToZoteroCollection(selected, null)
      .then(function (itemID) {
        progress.close();
        if (itemID) {
          Zotero.alert(
            null,
            "Search BibTeX",
            'Successfully imported "' +
              (selected.title || "Untitled").substring(
                0,
                60
              ) +
              '".'
          );
          // Select the newly imported item in the Zotero pane.
          var zp = Zotero.getActiveZoteroPane();
          if (zp) {
            zp.selectItem(itemID);
          }
        } else {
          Zotero.alert(
            null,
            "Search BibTeX",
            "Import failed.  Check the Error Console for details."
          );
        }
      })
      .catch(function (e) {
        progress.close();
        Zotero.log(
          "search-bibtex: import error – " + e
        );
        Zotero.alert(
          null,
          "Search BibTeX Error",
          "Import failed: " + e
        );
      });
  });
};
