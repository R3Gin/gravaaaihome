// Gravaai service worker — app shell cache with versioned bump.
// Troque a versão quando mudar a estratégia de cache: o activate apaga os caches antigos.
const CACHE = "gravaai-v2";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Network-first for navigations, cache-first for shell assets
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/"))),
    );
    return;
  }
  // Arquivos com hash no nome (/assets/…) nunca mudam: cache-first.
  // O resto (manifest, ícones, favicon…) é network-first, para quem volta ao
  // site receber a versão nova; o cache só serve quando está offline.
  const isHashedAsset = url.pathname.startsWith("/assets/");
  const store = (res) => {
    // 206 (Range) e respostas opacas não podem ir para o cache.
    if (res.status === 200 && res.type === "basic") {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  };
  if (isHashedAsset) {
    event.respondWith(caches.match(req).then((cached) => cached || fetch(req).then(store)));
    return;
  }
  event.respondWith(
    fetch(req)
      .then(store)
      .catch(() => caches.match(req).then((r) => r || Response.error())),
  );
});
