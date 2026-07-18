/* ============================================================
   Charter Fare — Service Worker
   Strategy:
     • HTML / navigation  → network-first  (always get the latest
       deploy when online; fall back to cache when offline)
     • Static assets       → cache-first    (fast, offline-friendly)
   Bump CACHE on every deploy so old caches are purged on activate.
   ============================================================ */
const CACHE = "charter-fare-v13";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", e => {
  /* addAll() rejects the whole install if ANY single asset 404s, leaving
     the app with no SW at all. Cache items individually so one missing
     icon/manifest can't break offline support. */
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(ASSETS.map(url =>
        c.add(url).catch(err => console.warn("SW: skip caching", url, err))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Is this request for an HTML page (navigation)? */
function isHTMLRequest(req) {
  if (req.mode === "navigate") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  /* Only handle same-origin requests; let the browser deal with the rest. */
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* ---- HTML: network-first ---- */
  if (isHTMLRequest(req)) {
    e.respondWith(
      fetch(req)
        .then(res => {
          /* Cache only good responses — never let a 404/500 page
             (e.g. mid-deploy) overwrite the cached app. */
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          /* Offline: serve the cached page, falling back to index.html
             so deep links / refreshes still work as an SPA.
             ignoreSearch: a navigation like ?utm=... still matches the cached page. */
          caches.match(req, { ignoreSearch: true })
            .then(cached => cached || caches.match("./index.html"))
        )
    );
    return;
  }

  /* ---- Static assets: cache-first, then populate cache ---- */
  e.respondWith(
    caches.match(req).then(cached =>
      cached ||
      fetch(req).then(res => {
        /* Only cache successful, basic (same-origin) responses. */
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => Response.error())
      /* reached only when nothing is cached AND the network failed —
         return a proper network-error Response instead of undefined */
    )
  );
});
