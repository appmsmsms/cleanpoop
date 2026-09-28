// Oculta posts del feed que contengan alguna keyword configurada,
// y opcionalmente oculta los posts patrocinados (ads).
// Lleva contadores de cuántos posts se ocultaron por cada keyword y por ads.
//
// Los posts NO siempre tienen role="article" (los posts con video, por ejemplo,
// no lo tienen). Por eso el post se ubica a partir de su botón "···" (que sí
// existe siempre, con aria-label="Actions for this post by ..."), subiendo por
// los ancestros hasta encontrar el contenedor que pertenece únicamente a ese
// post (el primer ancestro que ya contiene el botón "···" de OTRO post se
// descarta, quedándonos con el nivel anterior).

const ACTIONS_SEL = '[aria-label^="Actions for this post"]';
const MAX_CLIMB = 30;

const AD_LABELS = [
  "ad", "sponsored", "patrocinado", "publicidad", "anuncio",
  "gesponsert", "sponsorise", "sponsorisee", "sponsorizzato",
  "anzeige", "reklama",
];

const HIDE_LABELS = [
  "not interested", "hide post", "hide this post", "see fewer posts like this", "see fewer",
  "no me interesa", "ocultar publicación", "ocultar esta publicación", "ver menos publicaciones como esta", "ver menos",
];

let keywords = [];
let hideAds = true;
let useRealHide = true;
const actionQueue = [];
let processingQueue = false;
const rootCache = new WeakMap(); // botón "···" -> contenedor del post

function loadSettings(cb) {
  chrome.storage.sync.get({ keywords: [], hideAds: true, useRealHide: true }, (data) => {
    keywords = (data.keywords || []).map((k) => k.toLowerCase()).filter(Boolean);
    hideAds = data.hideAds !== false;
    useRealHide = data.useRealHide !== false;
    if (cb) cb();
  });
}

// Saca tildes/diacríticos: "García" -> "garcia".
function foldAccents(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Quita espacios, puntos, guiones, etc. Sirve para que una keyword como
// "karina garcia" o "kris.r" también matchee hashtags/menciones sin esos
// separadores, como "#karinagarcia" o "#krisr".
function normalize(s) {
  return foldAccents((s || "").toLowerCase()).replace(/[^a-z0-9]/g, "");
}

// Devuelve la keyword (en minúsculas) que matchea el texto, o null.
function findMatch(text) {
  if (!keywords.length) return null;
  const lower = foldAccents(text.toLowerCase());
  const normalizedText = normalize(text);
  return (
    keywords.find((k) => lower.includes(foldAccents(k)) || normalizedText.includes(normalize(k))) || null
  );
}

function ownText(el) {
  let t = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) t += node.textContent;
  }
  return t.replace(/\s+/g, " ").trim();
}

// Busca la etiqueta "Ad"/"Sponsored"/"Patrocinado" como texto propio (no de hijos)
// de algún elemento del post, para evitar falsos positivos con posts que
// mencionan la palabra en el cuerpo del texto.
function isAd(post) {
  const all = post.querySelectorAll("*");
  for (const el of all) {
    const text = ownText(el).toLowerCase();
    if (!text) continue;
    const m = text.match(/^([a-z]+)/i);
    if (!m) continue;
    const word = m[1];
    if (AD_LABELS.includes(word) && text.length - word.length <= 4) return true;
  }
  return false;
}

// Junta textContent (incluye texto truncado por "See more", que innerText
// se salta porque respeta lo visible) + todos los aria-label del subárbol.
// Muchos elementos de FB (thumbnails de Reels, links reposteados) tienen el
// nombre del autor solo en aria-label, no como texto visible.
function collectSearchableText(el) {
  let text = el.textContent || el.innerText || "";
  el.querySelectorAll("[aria-label]").forEach((n) => {
    text += " " + n.getAttribute("aria-label");
  });
  if (el.getAttribute && el.getAttribute("aria-label")) {
    text += " " + el.getAttribute("aria-label");
  }
  return text;
}

function bumpCount(key) {
  chrome.storage.local.get({ counts: {} }, (data) => {
    const counts = data.counts || {};
    counts[key] = (counts[key] || 0) + 1;
    chrome.storage.local.set({ counts });
  });
}

function hidePost(post) {
  post.style.display = "none";
}

function showPost(post) {
  post.style.display = "";
}

// A partir del botón "···" de un post, sube por los ancestros hasta el nivel
// justo antes de que aparezca el "···" de OTRO post (eso marca el borde del
// contenedor del feed, no del post individual).
function findPostRoot(btn) {
  if (rootCache.has(btn)) return rootCache.get(btn);
  let p = btn.parentElement;
  let last = btn.parentElement || btn;
  for (let i = 0; i < MAX_CLIMB && p; i++) {
    const count = p.querySelectorAll(ACTIONS_SEL).length;
    if (count > 1) break;
    last = p;
    p = p.parentElement;
  }
  rootCache.set(btn, last);
  return last;
}

function findAllPosts() {
  return [...document.querySelectorAll(ACTIONS_SEL)].map((btn) => ({ btn, root: findPostRoot(btn) }));
}

// Hace click en "···" del post y, cuando aparece el menú, clickea la opción
// "Not interested"/"No me interesa" (el equivalente actual de "Ocultar/Ver menos").
// Los ítems del menú son div[role="button"] dentro de un [role="menu"], no
// [role="menuitem"]. Si no encuentra nada, no rompe nada: el post ya quedó
// oculto por CSS de todos modos.
//
// Algunos posts ya muestran inline la pregunta "Are you interested in this
// post?" con botones "Interested"/"Not interested" directos (sin necesidad de
// abrir el menú "···"). Si está presente, es más directo y confiable: se usa
// primero. Si no, se abre el menú "···" y se busca la opción equivalente.
function findInlineNotInterested(root) {
  const buttons = root.querySelectorAll('div[role="button"], span[role="button"]');
  for (const b of buttons) {
    const t = ownText(b).toLowerCase();
    if (t === "not interested" || t === "no me interesa") return b;
  }
  return null;
}

function hideViaFacebookUI(root, btn) {
  const inline = findInlineNotInterested(root);
  if (inline) {
    inline.click();
    return;
  }

  btn.click();

  const deadline = Date.now() + 1500;
  const tryFindMenu = () => {
    const menu = document.querySelector('[role="menu"]');
    if (menu) {
      const items = menu.querySelectorAll('div[role="button"]');
      let target = null;
      for (const it of items) {
        const t = (it.textContent || "").toLowerCase().trim();
        if (HIDE_LABELS.some((l) => t.includes(l))) {
          target = it;
          break;
        }
      }
      if (target) {
        target.click();
      } else {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
      return;
    }
    if (Date.now() < deadline) setTimeout(tryFindMenu, 120);
  };
  setTimeout(tryFindMenu, 150);
}

// Cola simple para no disparar varias acciones de FB al mismo tiempo.
function queueRealHide(root, btn) {
  actionQueue.push({ root, btn });
  if (processingQueue) return;
  processingQueue = true;
  const step = () => {
    const next = actionQueue.shift();
    if (!next) {
      processingQueue = false;
      return;
    }
    hideViaFacebookUI(next.root, next.btn);
    setTimeout(step, 500 + Math.random() * 400);
  };
  step();
}

function processPost({ btn, root }) {
  // FB carga el contenido del post de forma diferida (skeleton vacío primero).
  // Si todavía no hay texto, no marcamos como "revisado": lo reintentamos en
  // la próxima mutación, cuando el contenido real ya esté en el DOM.
  if ((root.textContent || "").trim().length < 5) return;

  // --- Ads ---
  if (hideAds && root.dataset.fbkfAdChecked !== "1") {
    if (isAd(root)) {
      hidePost(root);
      root.dataset.fbkfAd = "1";
      if (root.dataset.fbkfAdCounted !== "1") {
        bumpCount("__ads__");
        root.dataset.fbkfAdCounted = "1";
      }
    }
    root.dataset.fbkfAdChecked = "1";
  }
  if (root.dataset.fbkfAd === "1") return; // ya oculto por ad, no evaluar keywords

  // --- Keywords ---
  if (root.dataset.fbkfKwChecked === "1") return;
  const text = collectSearchableText(root);
  const match = findMatch(text);
  if (match) {
    hidePost(root); // oculto al instante, visualmente
    root.dataset.fbkfKeyword = match;
    bumpCount(match);
    if (useRealHide) queueRealHide(root, btn); // y en paralelo, la acción real de FB
  }
  root.dataset.fbkfKwChecked = "1";
}

// --- Reels tray (widget aparte, tampoco tiene botón "Actions for this post") ---
function findReelsContainers() {
  const containers = new Set();
  document.querySelectorAll("span, div, h2, a").forEach((h) => {
    if (ownText(h).toLowerCase() !== "reels") return;
    let el = h;
    for (let i = 0; i < 6 && el; i++) {
      el = el.parentElement;
      if (el && el.querySelectorAll('a[role="link"]').length >= 2) {
        containers.add(el);
        break;
      }
    }
  });
  return [...containers];
}

function processReelLink(link) {
  if (link.dataset.fbkfChecked === "1") return;
  const text = collectSearchableText(link);
  const match = findMatch(text);
  if (match) {
    const item = link.parentElement || link;
    hidePost(item);
    bumpCount(match);
  }
  link.dataset.fbkfChecked = "1";
}

function scanReels() {
  if (!keywords.length) return;
  findReelsContainers().forEach((container) => {
    container.querySelectorAll('a[role="link"]').forEach(processReelLink);
  });
}

function scan() {
  findAllPosts().forEach(processPost);
  scanReels();
}

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.addedNodes.length) {
      scan();
      break;
    }
  }
});

function start() {
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
  // Red de seguridad: por si el contenido lazy-load de un post termina de
  // llegar sin disparar una mutación que el observer detecte.
  setInterval(scan, 2000);
}

loadSettings(() => {
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;

  if (changes.keywords) {
    keywords = (changes.keywords.newValue || []).map((k) => k.toLowerCase()).filter(Boolean);
    findAllPosts().forEach(({ root }) => {
      if (root.dataset.fbkfAd === "1") return; // los ads no se reevalúan acá
      delete root.dataset.fbkfKwChecked;
      const stillMatches = findMatch(collectSearchableText(root));
      if (!stillMatches && root.dataset.fbkfKeyword) {
        showPost(root);
        delete root.dataset.fbkfKeyword;
      }
    });
    scan();
  }

  if (changes.hideAds) {
    hideAds = changes.hideAds.newValue !== false;
    findAllPosts().forEach((p) => {
      if (hideAds) {
        delete p.root.dataset.fbkfAdChecked; // fuerza re-chequeo
        processPost(p);
      } else if (p.root.dataset.fbkfAd === "1") {
        showPost(p.root);
        delete p.root.dataset.fbkfAd;
        delete p.root.dataset.fbkfAdChecked;
        delete p.root.dataset.fbkfKwChecked;
        processPost(p);
      }
    });
  }
});
