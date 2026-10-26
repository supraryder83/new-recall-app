// Canadian Health Recall Alert - Service Worker Web Push Listener
// Handles incoming Web Push notifications and deep-links to /recalls/:id

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Product Recall Alert',
    body: 'A safety recall alert has been issued in Canada.',
    data: { url: '/' }
  };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const title = payload.title || 'Product Recall Alert';
  const options = {
    body: payload.body || 'A safety notice has been matched against your watchlist.',
    icon: payload.icon || '/icons/icon-192x192.png',
    badge: payload.badge || '/icons/icon-192x192.png',
    tag: payload.tag || `recall-alert-${Date.now()}`,
    data: payload.data || { url: '/' },
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If a window is already open, focus it and navigate to the deep link
        for (const client of clientList) {
          if (client.url && 'focus' in client) {
            client.focus();
            if ('navigate' in client) {
              return client.navigate(targetUrl);
            }
            return;
          }
        }
        // Otherwise, open a new window at the deep link URL
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
