const CACHE_NAME = 'kerosolar-crm-v5'
const urlsToCache = [
  '/',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache).catch(() => {
        console.log('Some assets could not be cached')
      })
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone()
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, clone)
        })
        return response
      })
      .catch(() => {
        return caches.match(request)
      })
  )
})

// 🔔 Recebe a notificação push e EXIBE com som + vibração.
// Sem este handler, o push chega ao aparelho mas nada aparece.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const attention = !!data.attention
  const title = data.title || 'KeroSolar'
  const options = {
    body: data.body || 'Nova mensagem',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Vibração: padrão mais longo/insistente quando precisa de atenção.
    vibrate: attention ? [300, 120, 300, 120, 300] : [200, 100, 200],
    // Mantém a notificação na tela até o operador tocar (só para as urgentes).
    requireInteraction: attention,
    renotify: true,
    // tag por conversa: novas mensagens da MESMA conversa se agrupam em vez de empilhar.
    tag: data.tag || 'kerosolar',
    data: { url: data.url || '/inbox' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Ao tocar na notificação: foca uma aba já aberta ou abre a URL da conversa.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/inbox'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) { client.focus(); if ('navigate' in client) client.navigate(url); return }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
