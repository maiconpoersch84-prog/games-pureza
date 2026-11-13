/* GAMES PRZ — service worker do app instalado (PC e celular).
   - A página sempre vem da internet primeiro (o portal nunca fica preso numa versão velha).
   - Sem internet, abre a última cópia guardada da página.
   - Bibliotecas de CDN com versão fixa (Firebase, ícones, fontes) ficam guardadas — sem elas o portal não abre offline.
   - Não guarda nada do banco (Firestore/Auth): o Firestore já tem o próprio cache.
   - Notificações: clicar abre/foca o portal. */
const CACHE = 'prz-app-v2';
const CDN_CACHE = 'prz-cdn-v1';
const BASE = ['./', './manifest.json', './icons/icon-96.png', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
// só bibliotecas estáticas — nunca APIs (firestore.googleapis.com, identitytoolkit etc.)
const CDN_OK = (u) => (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/'))
    || u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'cdnjs.cloudflare.com'
    || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => Promise.all(BASE.map(u =>
        fetch(u, { cache: 'no-store' }).then(r => r.ok ? c.put(u, r) : null).catch(() => null)
    ))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith('prz-app-') && k !== CACHE) || (k.startsWith('prz-cdn-') && k !== CDN_CACHE)).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

// a página principal (pasta do portal ou index.html) — outras páginas do mesmo site não sobrescrevem a cópia guardada
const ehPortal = (u) => { const sc = new URL(self.registration.scope).pathname; return u.pathname === sc || u.pathname === sc + 'index.html'; };

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) {
        if (!CDN_OK(url)) return;                               // Firebase (banco/login) e o resto: direto da internet
        // CDN: internet primeiro para CSS de fontes (pode mudar); arquivos com versão: guardado primeiro
        const cssFonte = url.hostname === 'fonts.googleapis.com';
        e.respondWith(caches.open(CDN_CACHE).then(c => c.match(req).then(guardado => {
            const rede = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(() => {}); return r; });
            if (cssFonte) return rede.catch(() => guardado || Response.error());
            if (guardado) { rede.catch(() => {}); return guardado; }   // atualiza em segundo plano (sem erro se offline)
            return rede;
        })));
        return;
    }
    if (req.mode === 'navigate') {
        e.respondWith(fetch(req, { cache: 'no-store' }).then(r => {
            if (r && r.ok && ehPortal(url)) { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./', cp)).catch(() => {}); }
            return r;
        }).catch(() => (ehPortal(url) ? caches.match('./', { ignoreSearch: true }) : Promise.resolve(null)).then(r => r || new Response(
            '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#060609;color:#ccc;font-family:sans-serif;text-align:center;padding-top:30vh">Sem conexão. Abra o portal de novo quando a internet voltar.</body>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
        return;
    }
    if (BASE.some(u => u !== './' && url.pathname.endsWith(u.slice(1)))) {
        e.respondWith(caches.match(req, { ignoreSearch: true }).then(c => {
            const rede = fetch(req).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(ca => ca.put(req, cp)); } return r; }).catch(() => c);
            return c || rede;
        }));
    }
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
        const aberto = lista.find(c => new URL(c.url).origin === self.location.origin);
        if (aberto) return aberto.focus();
        return self.clients.openWindow('./');
    }));
});
