/*
 * Service worker: makes the app installable and usable offline.
 *
 * It caches ONLY the application's own code and assets (same origin, GET).
 * User files are read locally via the File API and are never requested over
 * the network, so they can never end up in this cache.
 *
 * __BUILD__ is replaced with the commit hash by the GitHub Pages workflow, so
 * every deploy gets a fresh cache and old ones are removed.
 */
const VERSION = "__BUILD__";
const CACHE = "est-" + VERSION;
const SHELL = [
  "./", "index.html", "styles.css", "config.js", "app.js", "core.js", "importers.js",
  "consent.js", "paywall.js", "pdfparse.js", "carryforward.js", "barcode.js",
  "vendor/pdf.min.js", "vendor/pdf.worker.min.js", "vendor/pdf-lib.min.js",
  "agb.html", "datenschutz.html", "haftungsausschluss.html", "impressum.html", "lizenzen.html",
  "paid.html", "paid.js", "manifest.webmanifest", "favicon.ico",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("est-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Large, versioned third-party runtime (Pyodide, pdf417gen): cache-first —
// cached on first barcode use, then available offline.
const IMMUTABLE = /\/vendor\/(pyodide|pdf417gen)\//;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // App code: network first (always the newest version when online),
  // cache as fallback (offline).
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })
      .then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
