const statsList = document.getElementById("stats");
const newKeywordsBox = document.getElementById("newKeywords");
const addBtn = document.getElementById("add");
const status = document.getElementById("status");
const hideAdsToggle = document.getElementById("hideAdsToggle");
const adsCountEl = document.getElementById("adsCount");
const realHideToggle = document.getElementById("realHideToggle");

function flash(msg) {
  status.textContent = msg;
  setTimeout(() => (status.textContent = ""), 1500);
}

function render() {
  chrome.storage.sync.get({ keywords: [], hideAds: true, useRealHide: true }, ({ keywords, hideAds, useRealHide }) => {
    hideAdsToggle.checked = hideAds;
    realHideToggle.checked = useRealHide;

    chrome.storage.local.get({ counts: {} }, ({ counts }) => {
      adsCountEl.textContent = `${counts.__ads__ || 0} ocultados`;

      statsList.innerHTML = "";
      if (!keywords.length) {
        statsList.innerHTML = '<li class="empty">Todavía no agregaste keywords.</li>';
        return;
      }
      keywords.forEach((kw) => {
        const li = document.createElement("li");

        const label = document.createElement("span");
        label.className = "kw";
        label.textContent = kw;
        label.title = kw;

        const count = document.createElement("span");
        count.className = "count";
        count.textContent = counts[kw.toLowerCase()] || 0;

        const del = document.createElement("button");
        del.className = "del";
        del.textContent = "✕";
        del.title = "Eliminar keyword";
        del.addEventListener("click", () => removeKeyword(kw));

        li.appendChild(label);
        li.appendChild(count);
        li.appendChild(del);
        statsList.appendChild(li);
      });
    });
  });
}

function removeKeyword(kw) {
  chrome.storage.sync.get({ keywords: [] }, ({ keywords }) => {
    const filtered = keywords.filter((k) => k !== kw);
    chrome.storage.sync.set({ keywords: filtered }, () => {
      chrome.storage.local.get({ counts: {} }, ({ counts }) => {
        delete counts[kw.toLowerCase()];
        chrome.storage.local.set({ counts }, () => {
          flash("Eliminada ✓");
          render();
        });
      });
    });
  });
}

addBtn.addEventListener("click", () => {
  const toAdd = newKeywordsBox.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!toAdd.length) return;

  chrome.storage.sync.get({ keywords: [] }, ({ keywords }) => {
    const existingLower = new Set(keywords.map((k) => k.toLowerCase()));
    const merged = [...keywords];
    toAdd.forEach((kw) => {
      if (!existingLower.has(kw.toLowerCase())) {
        merged.push(kw);
        existingLower.add(kw.toLowerCase());
      }
    });
    chrome.storage.sync.set({ keywords: merged }, () => {
      newKeywordsBox.value = "";
      flash("Guardado ✓");
      render();
    });
  });
});

hideAdsToggle.addEventListener("change", () => {
  chrome.storage.sync.set({ hideAds: hideAdsToggle.checked }, () => {
    flash(hideAdsToggle.checked ? "Ads: ON" : "Ads: OFF");
  });
});

realHideToggle.addEventListener("change", () => {
  chrome.storage.sync.set({ useRealHide: realHideToggle.checked }, () => {
    flash(realHideToggle.checked ? "Acción real: ON" : "Acción real: OFF");
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    (area === "local" && changes.counts) ||
    (area === "sync" && (changes.keywords || changes.hideAds || changes.useRealHide))
  ) {
    render();
  }
});

render();
