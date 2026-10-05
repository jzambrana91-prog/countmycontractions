const CACHE = "cmc-v1";

const PAGES = [
  "/",
  "/printable-contraction-log",
  "/how-to-time-contractions",
  "/5-1-1-rule",
  "/braxton-hicks-vs-real-contractions",
  "/when-to-go-to-the-hospital",
  "/partner-guide",
  "/about",
  "/privacy",
  "/terms",
  "/medical-disclaimer",
  "/contact",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/og.png",
  "/downloads/contraction-log.pdf",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

async function cacheUrl(cache, url) {
  try {
    const response = await fetch(url, { cache: "reload" });
    if (!response.ok) return null;
    await cache.put(url, response.clone());
    return response;
  } catch {
    return null;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const assetUrls = new Set();
      for (const url of PAGES) {
        const response = await cacheUrl(cache, url);
        if (!response) continue;
        const type = response.headers.get("content-type") || "";
        if (!type.includes("text/html")) continue;
        const html = await response.clone().text();
        for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
          assetUrls.add(match[1].split("#")[0]);
        }
      }
      await Promise.all([...assetUrls].map((url) => cacheUrl(cache, url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          await cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return (await caches.match(request)) || (await caches.match("/"));
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, fresh.clone());
      }
      return fresh;
    })(),
  );
});
