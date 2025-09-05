// background.js (service worker)

// Create ONE top-level context menu item on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "b64-decode",
    title: "Decode Base64 (replace selection / linkify)",
    contexts: ["selection"]
  });
});

// Handle one-click menu action
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId !== "b64-decode") return;

  chrome.tabs.sendMessage(
    tab.id,
    { type: "b64-decode", text: info.selectionText || "" },
    (resp) => {
      if (chrome.runtime.lastError) {
        notify("Base64 Decode — Linkify", "Couldn't reach the page's content script.");
        return;
      }
      if (!resp) {
        notify("Base64 Decode — Linkify", "No response from page.");
        return;
      }
      if (resp.error) {
        notify("Base64 Decode — Linkify", resp.error);
      }
      // On success we stay quiet to be unobtrusive.
    }
  );
});

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    title,
    message
    // Optionally add an icon:
    // , iconUrl: "icon48.png"
  });
}
