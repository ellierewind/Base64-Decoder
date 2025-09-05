// background.js (service worker)

// Utilities to manage the context menu based on a stored setting
const MENU_ID = "b64-decode";

function createMenu(callback) {
  chrome.contextMenus.create(
    {
      id: MENU_ID,
      title: "Decode Base64 (replace selection / linkify)",
      contexts: ["selection"],
    },
    () => {
      // Ignore duplicate-id and other benign errors
      void chrome.runtime.lastError;
      if (callback) callback();
    }
  );
}

function removeMenu(callback) {
  chrome.contextMenus.remove(MENU_ID, () => {
    // Ignore if it didn't exist
    void chrome.runtime.lastError;
    if (callback) callback();
  });
}

function applyMenuFrom(enabled) {
  // Normalize by removing first, then re-create if enabled
  removeMenu(() => {
    if (enabled) createMenu();
  });
}

function ensureMenuFromStoredSetting() {
  chrome.storage.sync.get({ contextMenuEnabled: false }, (items) => {
    applyMenuFrom(Boolean(items.contextMenuEnabled));
  });
}

// On install/update: ensure default and apply state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get("contextMenuEnabled", (items) => {
    if (items.contextMenuEnabled === undefined) {
      chrome.storage.sync.set({ contextMenuEnabled: false }, ensureMenuFromStoredSetting);
    } else {
      ensureMenuFromStoredSetting();
    }
  });
});

// On startup, re-apply state (menus are usually persisted, but be safe)
chrome.runtime.onStartup?.addListener(() => {
  ensureMenuFromStoredSetting();
});

// React to setting changes from popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.contextMenuEnabled) return;
  applyMenuFrom(Boolean(changes.contextMenuEnabled.newValue));
});

// Handle one-click menu action
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId !== MENU_ID) return;

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
