# Base64 Decoder (Chrome Extension)

#### A lightweight Chrome extension to decode Base64 where you need it. It can:
- Decode selected Base64 via a context menu action (and linkify URLs).
- Scan the current page for Base64 that decodes to links and convert them in place.
- Let you enable/disable the context menu from the popup (default: off).

## Install (Developer Mode)
- Open `chrome://extensions` and enable Developer mode.
- Click `Load unpacked` and select this folder.

## Usage
- Context menu: Select Base64 text, right‑click → “Decode Base64 (replace selection / linkify)”.
- Popup action: Click the extension icon → “Decode Base64 links” to scan visible text on the page.
  - It only focuses on Base64 that decode to links (often starting with `aHR`).
- Toggle: In the popup, use “Show context menu action” to enable/disable the right‑click menu.
