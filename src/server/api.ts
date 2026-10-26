import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipelineStore } from './store.ts';
import { runSyncPipeline } from './pipeline.ts';
import { initVapid } from './pushService.ts';
import webpush from 'web-push';

function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

/**
 * Connect/Express middleware for Vite dev server & production server
 */
export async function handlePipelineApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
): Promise<void> {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (!url.startsWith('/api/')) {
    return next();
  }

  // 1. GET /api/vapid-public-key
  if (url === '/api/vapid-public-key' && method === 'GET') {
    const keys = initVapid();
    return sendJson(res, 200, {
      publicKey: keys.publicKey,
      subject: keys.subject
    });
  }

  // 2. POST /api/push-subscribe
  if (url === '/api/push-subscribe' && method === 'POST') {
    try {
      const body = await parseJsonBody<any>(req);
      if (!body.endpoint || !body.keys) {
        return sendJson(res, 400, { error: 'Invalid PushSubscription: missing endpoint or keys' });
      }

      const userId = body.userId || 'default_user';
      const saved = pipelineStore.savePushSubscription({
        userId,
        endpoint: body.endpoint,
        keys: body.keys,
        expirationTime: body.expirationTime || null,
        active: true,
        userAgent: req.headers['user-agent']
      });

      console.log(`[API] Saved push subscription for user: ${userId}`);
      return sendJson(res, 200, { success: true, subscription: saved });
    } catch (err: any) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 3. DELETE /api/push-subscribe
  if (url === '/api/push-subscribe' && method === 'DELETE') {
    try {
      const body = await parseJsonBody<any>(req);
      if (body.endpoint) {
        pipelineStore.removePushSubscription(body.endpoint);
      }
      return sendJson(res, 200, { success: true });
    } catch (err: any) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 4. POST /api/push-test (Send a test push to the user's registered devices)
  if (url === '/api/push-test' && method === 'POST') {
    try {
      const body = await parseJsonBody<any>(req);
      const userId = body.userId || 'default_user';
      initVapid();

      const subs = pipelineStore.getPushSubscriptionsForUser(userId);
      if (subs.length === 0) {
        return sendJson(res, 400, {
          error: 'No active push subscriptions found for user. Please enable notifications first.'
        });
      }

      const payload = JSON.stringify({
        title: 'Product Recall Alert: Test Notification',
        body: 'Your 6-hour background sync worker and reverse-lookup alert pipeline is active! Deep link test for Canada.ca recall #82848.',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        tag: `recall-test-${Date.now()}`,
        data: {
          url: '/recalls/82848',
          recallId: '82848',
          timestamp: Date.now()
        }
      });

      let sentCount = 0;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            payload,
            { TTL: 60 }
          );
          sentCount++;
        } catch (pushErr: any) {
          if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
            pipelineStore.removePushSubscription(sub.endpoint);
          }
        }
      }

      return sendJson(res, 200, {
        success: true,
        sentCount,
        message: `Dispatched test push notification to ${sentCount} device(s)`
      });
    } catch (err: any) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 5. GET /api/watchlist
  if (url.startsWith('/api/watchlist') && method === 'GET') {
    const parsedUrl = new URL(url, 'http://localhost');
    const userId = parsedUrl.searchParams.get('userId') || 'default_user';
    const list = pipelineStore.getWatchlist(userId);
    return sendJson(res, 200, { watchlist: list });
  }

  // 6. POST /api/watchlist
  if (url === '/api/watchlist' && method === 'POST') {
    try {
      const body = await parseJsonBody<any>(req);
      if (!body.productName && !body.upcBarcode && !body.modelNumber) {
        return sendJson(res, 400, {
          error: 'At least one of productName, upcBarcode, or modelNumber is required.'
        });
      }

      const item = pipelineStore.addToWatchlist({
        userId: body.userId || 'default_user',
        productName: (body.productName || 'Product').trim(),
        brand: (body.brand || '').trim(),
        modelNumber: (body.modelNumber || '').trim() || undefined,
        upcBarcode: (body.upcBarcode || '').trim() || undefined,
        keywords: Array.isArray(body.keywords) ? body.keywords : undefined,
        notes: body.notes
      });

      return sendJson(res, 201, { success: true, item });
    } catch (err: any) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 7. DELETE /api/watchlist/:id
  if (url.startsWith('/api/watchlist/') && method === 'DELETE') {
    const id = url.replace('/api/watchlist/', '').split('?')[0];
    const removed = pipelineStore.removeFromWatchlist(id);
    return sendJson(res, 200, { success: removed });
  }

  // 8. GET /api/notifications
  if (url.startsWith('/api/notifications') && method === 'GET') {
    const parsedUrl = new URL(url, 'http://localhost');
    const userId = parsedUrl.searchParams.get('userId') || 'default_user';
    const notifications = pipelineStore.getNotificationHistory(userId);
    return sendJson(res, 200, { notifications });
  }

  // 9. GET /api/sync/status
  if (url === '/api/sync/status' && method === 'GET') {
    const state = pipelineStore.getWorkerState();
    const processedCount = pipelineStore.getProcessedCount();
    const watchlistCount = pipelineStore.getWatchlist().length;
    const subscriptionsCount = pipelineStore.getAllActivePushSubscriptions().length;

    return sendJson(res, 200, {
      ...state,
      processedRecallsCount: processedCount,
      watchlistCount,
      activePushSubscriptionsCount: subscriptionsCount
    });
  }

  // 10. POST /api/sync/trigger
  if (url === '/api/sync/trigger' && method === 'POST') {
    try {
      const body = await parseJsonBody<any>(req);
      console.log('[API] Manual sync trigger requested...');
      const summary = await runSyncPipeline({
        forceAll: Boolean(body.forceAll),
        windowHours: body.windowHours ? Number(body.windowHours) : undefined,
        bypassDeduplication: Boolean(body.bypassDeduplication)
      });
      return sendJson(res, 200, { success: true, summary });
    } catch (err: any) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // Fallback to next middleware
  return next();
}
