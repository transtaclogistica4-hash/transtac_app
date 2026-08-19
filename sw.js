/* Service Worker — Controle de Manutenção TRANSTAC */
var CACHE = 'transtac-portal-prod-v1';
var SHELL = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo-transtac.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return; /* Apps Script e afins sempre pela rede */
  /* telas e funções da Logística sempre pela rede (dados dinâmicos) */
  if (/(logistica|menu|motorista|placa|finalizar|comercial|autorizacoes|programacao|dashboard|dashboard-diario|devolucoes[a-z\-]*|wow[a-z\-]*)\.html/.test(url.pathname)) return;
  /* modulos com dados dinamicos sempre pela rede */
  if (/(inventario-icara|multas[a-z\-]*|rh)\.html/.test(url.pathname)) return;
  if (url.pathname.indexOf('/.netlify/') === 0) return;
  e.respondWith(
    fetch(e.request).then(function (resp) {
      var copia = resp.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copia); });
      return resp;
    }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); })
  );
});
