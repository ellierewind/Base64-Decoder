// contentScript.js

// =======================
// 1) Single-selection flow (called from context menu via background.js)
// =======================
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "b64-decode") return;

  try {
    const selectionText = msg.text ?? "";
    if (!selectionText.trim()) {
      sendResponse({ error: "No text selected." });
      return;
    }

    // Decode and decide whether to linkify
    const decoded = decodeBase64Auto(selectionText);
    const urlInfo = detectUrl(decoded);

    if (urlInfo) {
      // If selection is inside an input/textarea, we can't insert <a>; fall back to text
      const wasReplaced = replaceSelectionWithText(decoded);
      if (!wasReplaced) {
        const linked = replaceSelectionWithLink(urlInfo.href, urlInfo.display);
        if (!linked) {
          // Fallback to plain text if we couldn't create a link (rare)
          replaceSelectionWithText(decoded);
        }
      }
      sendResponse({ ok: true, kind: "url", value: decoded });
      return;
    }

    // Not a URL → just replace the selection with decoded text
    replaceSelectionWithText(decoded);
    sendResponse({ ok: true, kind: "text", value: decoded });
  } catch (e) {
    sendResponse({ error: (e && e.message) || "Failed to decode base64." });
  }
});

// =======================
// 2) Bulk "convert all aHR*" flow (triggered from popup.js)
// =======================
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "b64-decode-all") return;

  try {
    const prefix = (msg.prefix || "aHR");
    const res = convertAllB64OnPage(prefix);
    sendResponse(res);
  } catch (e) {
    sendResponse({ error: (e && e.message) || "Bulk conversion error." });
  }
});

// =======================
// Helpers
// =======================

/** Decode a Base64 string (handles URL-safe, missing padding). Returns UTF-8 string. */
function decodeBase64Auto(input) {
  if (typeof input !== "string") throw new Error("Invalid input.");
  let s = input.trim();

  // Strip non-base64 leading/trailing junk (common if user selects punctuation around it)
  // Keep common base64/url-safe characters, equals padding, and whitespace
  s = s.replace(/^[^A-Za-z0-9+/_=-]+|[^A-Za-z0-9+/_=-]+$/g, "");

  if (!s) throw new Error("Empty selection.");

  // URL-safe -> standard
  s = s.replace(/-/g, "+").replace(/_/g, "/");

  // Fix padding
  const pad = s.length % 4;
  if (pad === 2) s += "==";
  else if (pad === 3) s += "=";
  else if (pad === 1) throw new Error("Invalid Base64 length.");

  // Basic character check
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    throw new Error("Selection is not valid Base64.");
  }

  // Decode to bytes
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  // UTF-8 decode (non-text data may appear as odd characters)
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Detect if a string is a (whole) URL.
 * Returns { href, display } if so, else null.
 * Accepts:
 *  - http(s)://
 *  - mailto:
 *  - www.* or bare domain.tld (we'll assume https://)
 */
function detectUrl(str) {
  const s = String(str).trim();

  // Explicit protocols we support
  if (/^(https?:\/\/|mailto:)/i.test(s)) {
    // Display: trim long ones for aesthetic insertion
    return { href: s, display: s };
  }

  // Bare domains or www.* (no scheme) → assume https://
  // Very light heuristic; avoid matching sentences with dots by requiring a TLD-ish suffix
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+){1,}([:/?#].*)?$/i.test(s)) {
    return { href: `https://${s}`, display: s };
  }

  return null;
}

/** Replace selection with plain text in either an input/textarea OR normal DOM/contenteditable. */
function replaceSelectionWithText(newText) {
  // 1) Inputs / Textareas
  const active = document.activeElement;
  if (active && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && isTextualInput(active)))) {
    const el = active;
    const { selectionStart, selectionEnd, value } = el;

    // If there's no selection inside the input, we bail; this function is called from a selection path
    if (selectionStart != null && selectionEnd != null && selectionStart !== selectionEnd) {
      const start = Math.min(selectionStart, selectionEnd);
      const end = Math.max(selectionStart, selectionEnd);
      const before = value.slice(0, start);
      const after = value.slice(end);
      el.value = before + newText + after;

      const caret = start + newText.length;
      el.setSelectionRange(caret, caret);
      el.dispatchEvent(new Event("input", { bubbles: true })); // notify frameworks/reactivity
      return true;
    }
    return false;
  }

  // 2) ContentEditable / normal page selection
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.toString() === "") return false;

  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(newText);
  range.insertNode(node);

  // Move caret after inserted node
  range.setStartAfter(node);
  range.setEndAfter(node);
  sel.removeAllRanges();
  sel.addRange(range);

  return true;
}

/**
 * Replace selection with a clickable <a> when possible.
 * - In contenteditable/normal DOM: inserts <a href="...">display</a> target=_blank rel=noopener.
 * - If the selection is inside an existing <a>, updates that link's href and replaces the selected text.
 * - In inputs/textareas: returns false (caller should fall back to text).
 */
function replaceSelectionWithLink(href, display) {
  const active = document.activeElement;
  if (active && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && isTextualInput(active)))) {
    // Can't inject an <a> inside inputs; caller should use text
    return false;
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.toString() === "") return false;
  const range = sel.getRangeAt(0);

  // If selection is inside an existing <a>, update it
  const anchor = findAncestorAnchor(range.commonAncestorContainer);
  if (anchor) {
    anchor.href = href;
    anchor.textContent = display;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    return true;
  }

  // Otherwise create a new link node
  const a = document.createElement("a");
  a.href = href;
  a.textContent = display;
  a.target = "_blank";
  a.rel = "noopener noreferrer";

  range.deleteContents();
  range.insertNode(a);

  // Move caret after the link
  range.setStartAfter(a);
  range.setEndAfter(a);
  sel.removeAllRanges();
  sel.addRange(range);

  return true;
}

function findAncestorAnchor(node) {
  let n = node;
  while (n && n !== document) {
    if (n.nodeType === Node.ELEMENT_NODE && n.tagName === "A") return n;
    n = n.parentNode;
  }
  return null;
}

function isTextualInput(inputEl) {
  const t = (inputEl.getAttribute("type") || "text").toLowerCase();
  const nonText = new Set([
    "button","checkbox","color","date","datetime-local","file","hidden",
    "image","month","number","password","radio","range","reset","submit",
    "time","week"
  ]);
  return !nonText.has(t);
}

// =======================
// 3) Bulk conversion implementation
// =======================

/**
 * Walks the DOM and replaces any Base64 substrings that:
 *  - start with the given prefix (default "aHR")
 *  - decode to a string; if it starts with http(s) we create a clickable <a>,
 *    otherwise we replace the substring with the decoded text.
 * Skips SCRIPT/STYLE/TEXTAREA/INPUT/NOSCRIPT and SVG.
 * Returns a stats object for UI display.
 */
function convertAllB64OnPage(prefix = "aHR") {
  const BASE64_CHARS = /[A-Za-z0-9+/_-]/;
  const b64Re = new RegExp(prefix + "[A-Za-z0-9+/_-]{6,}={0,2}", "g"); // minimally long to be plausible
  const maxTokenLen = 8192; // safety cap

  let nodesScanned = 0;
  let matchesFound = 0;
  let decodedOk = 0;
  let linksCreated = 0;
  let textReplaced = 0;
  let skipped = 0;

  const root = document.body || document.documentElement;
  if (!root) return { ok: false, error: "No document root." };

  const tw = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.indexOf(prefix) === -1) return NodeFilter.FILTER_REJECT;
        if (isInForbiddenContainer(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const candidates = [];
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    nodesScanned++;
    candidates.push(n);
  }

  for (const textNode of candidates) {
    const text = textNode.nodeValue;
    b64Re.lastIndex = 0;
    let m, last = 0;
    let changed = false;
    const frag = document.createDocumentFragment();

    while ((m = b64Re.exec(text))) {
      const start = m.index;
      const end = b64Re.lastIndex;
      const token = m[0];

      // Boundary check: avoid slicing parts of a longer token
      const pre = start > 0 ? text[start - 1] : "";
      const post = end < text.length ? text[end] : "";
      const preOk = !BASE64_CHARS.test(pre);
      const postOk = !BASE64_CHARS.test(post);
      if (!preOk || !postOk) continue;

      matchesFound++;

      // Length safety
      if (token.length > maxTokenLen) { skipped++; continue; }

      // Attempt decode
      let decoded;
      try {
        decoded = decodeBase64Auto(token);
      } catch {
        skipped++;
        continue;
      }

      // Append untouched text before the match
      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));

      const trimmed = (decoded || "").trim();
      if (/^https?:\/\//i.test(trimmed)) {
        const a = document.createElement("a");
        a.href = trimmed;
        a.textContent = trimmed;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        frag.appendChild(a);
        decodedOk++; linksCreated++; changed = true;
      } else {
        frag.appendChild(document.createTextNode(decoded));
        decodedOk++; textReplaced++; changed = true;
      }

      last = end;
    }

    if (changed) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      // Replace the original text node
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(frag, textNode);
      }
    }
  }

  return { ok: true, nodesScanned, matchesFound, decodedOk, linksCreated, textReplaced, skipped };
}

function isInForbiddenContainer(node) {
  // Skip if inside any of these tag names
  const forbidden = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT", "INPUT"]);
  let n = node.parentNode;
  while (n && n !== document) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      if (forbidden.has(n.tagName)) return true;
      // Skip SVG subtrees (text rendering differs; safer not to mutate)
      if (n.namespaceURI && n.namespaceURI.includes("svg")) return true;
      // Skip content that is aria-hidden or display:none? (optional) — keeping simple for now
    }
    n = n.parentNode;
  }
  return false;
}
