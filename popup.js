document.getElementById("convertAll").addEventListener("click", async () => {
  const out = document.getElementById("out");
  out.textContent = "Scanning…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      out.textContent = "No active tab.";
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "b64-decode-all", prefix: "aHR" }, (resp) => {
      if (chrome.runtime.lastError) {
        out.textContent = "Couldn't reach the page (no content script here).";
        return;
      }
      if (!resp) {
        out.textContent = "No response from page.";
        return;
      }
      if (resp.error) {
        out.textContent = "Error: " + resp.error;
        return;
      }
      const { nodesScanned, matchesFound, decodedOk, linksCreated, textReplaced, skipped } = resp;
      out.innerHTML = `
        Scanned ${nodesScanned} nodes<br/>
        Found ${matchesFound} candidate(s)<br/>
        Converted ${decodedOk}: ${linksCreated} link(s), ${textReplaced} text replacement(s)${skipped ? `<br/>Skipped ${skipped} (invalid/too long)` : ""}.
      `;
    });
  } catch (e) {
    out.textContent = "Error: " + (e && e.message || String(e));
  }
});
