// Service worker: makes Seven Channels installable and usable offline.
// - Pages, scripts and data/*.json: network first (so a new deploy shows up right away), falling back to the
//   last copy saved here when you're offline or the network takes more than 5 seconds.
// - Google Fonts: cached after the first load.
// - Everything else (ESPN, Wikipedia and other live APIs, images on other sites) goes straight to the network.
// - Notification clicks open the app at the alert's page.
// scripts/build_site.py fills in VERSION and PRECACHE for the published site.
const VERSION = "dev";
const PRECACHE = ["./", "index.html", "manifest.webmanifest", "assets/app/icon-192.png"];
const SITE_CACHE = `seven-channels-site-${VERSION}`;
const FONT_CACHE = "seven-channels-fonts-v1";
const NETWORK_TIMEOUT = 5000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SITE_CACHE).then((cache) => cache.addAll(PRECACHE)).catch((error) => console.warn("Precache incomplete.", error)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("seven-channels-site-") && key !== SITE_CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(SITE_CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === "basic") cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    const cached = await cache.match(request, { ignoreSearch: true }) || (fallbackUrl && await cache.match(fallbackUrl));
    return cached || await network;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true }) || (fallbackUrl && await cache.match(fallbackUrl));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") cache.put(request, response.clone()).catch(() => {});
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, new URL("index.html", self.registration.scope).href));
    return;
  }
  event.respondWith(networkFirst(request));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href || "";
  const target = new URL(href.startsWith("#") ? `./${href}` : "./", self.registration.scope).href;
  event.waitUntil((async () => {
    if (href && !href.startsWith("#")) return self.clients.openWindow(href);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus();
      if (href) open.postMessage({ type: "open", href });
      return undefined;
    }
    return self.clients.openWindow(target);
  })());
});
