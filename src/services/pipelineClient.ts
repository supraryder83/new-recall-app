import type {
  WatchlistItem,
  NotificationHistoryRecord,
  SyncWorkerState,
  PipelineSyncSummary
} from '../types/pipeline';

const DEFAULT_USER_ID = 'default_user';

export interface WorkerStatusResponse extends SyncWorkerState {
  processedRecallsCount: number;
  watchlistCount: number;
  activePushSubscriptionsCount: number;
}

/**
 * Converts a base64 string to a Uint8Array for PushManager subscription
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Safely parses JSON and gives clear, readable error messages if the server returns HTML (e.g. 503 Service Unavailable)
 */
async function safeParseJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status} (${res.statusText || 'Service Unavailable'}). Please ensure the Node.js application is running.`);
    }
    throw new Error('Invalid JSON response from server.');
  }
}

export const DEFAULT_VAPID_PUBLIC_KEY =
  'BEWplbXClOE7-dY339tirCxloT6u_sdJfvBs0uvZQuOz4OM4ZC0uoKomdiOZOXqKEvzmaJIzMBcIxZQHbDzw3ws';

/**
 * Fetch VAPID public key with progressive fallbacks
 */
export async function getVapidPublicKey(): Promise<string> {
  // 1. Build-time environment variable (fastest, zero network hop)
  try {
    const envKey = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY;
    if (envKey && typeof envKey === 'string' && envKey.trim().length > 10) {
      return envKey.trim();
    }
  } catch {
    // Ignore env access errors
  }

  // 2. Fetch from backend API endpoint
  try {
    const res = await fetch('/api/vapid-public-key');
    if (res.ok) {
      const data = await res.json();
      if (data.publicKey && typeof data.publicKey === 'string') {
        return data.publicKey.trim();
      }
    }
  } catch (err) {
    console.warn('[PipelineClient] Failed to fetch VAPID key from backend, using fallback:', err);
  }

  // 3. Fallback to pre-generated RFC 8291/8292 key for support@204webhosting.online
  return DEFAULT_VAPID_PUBLIC_KEY;
}

/**
 * Registers browser with Web Push API and synchronizes PushSubscription to the backend store
 */
export async function registerWebPushSubscription(
  userId: string = DEFAULT_USER_ID
): Promise<{ success: boolean; error?: string }> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { success: false, error: 'Web Push is not supported on this browser.' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: `Notification permission was ${permission}.` };
    }

    const vapidKey = await getVapidPublicKey();
    const appServerKey = urlBase64ToUint8Array(vapidKey);

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    // If subscription already exists, try to subscribe or replace if application key changed
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey as any
      });
    }

    let subJson = subscription?.toJSON();
    if (!subJson?.endpoint || !subJson?.keys) {
      // Re-subscribe if keys missing
      if (subscription) {
        await subscription.unsubscribe().catch(() => {});
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey as any
      });
      subJson = subscription.toJSON();
    }

    if (!subJson.endpoint || !subJson.keys) {
      return { success: false, error: 'PushSubscription keys missing.' };
    }

    try {
      const res = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          expirationTime: subJson.expirationTime
        })
      });

      if (res.ok) {
        return { success: true };
      }
    } catch {
      // Network/backend unavailable
    }

    // Save locally so the browser subscription is retained in static mode
    try {
      localStorage.setItem(
        'recall_push_sub',
        JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys, timestamp: Date.now() })
      );
    } catch {}

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown Web Push registration error.' };
  }
}

/**
 * Checks if device is currently subscribed to Web Push
 */
export async function getWebPushSubscriptionStatus(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
}

/**
 * Unsubscribe current device from Web Push
 */
export async function unsubscribeWebPush(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await fetch('/api/push-subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, endpoint })
      });
      return true;
    }
  } catch (err) {
    console.warn('[PipelineClient] Unsubscribe error:', err);
  }
  return false;
}

/**
 * Send an immediate test Web Push notification to current device
 */
export async function sendTestWebPush(
  userId: string = DEFAULT_USER_ID
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch('/api/push-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    const data = await safeParseJson(res);
    if (res.ok) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data.error };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Watchlist API
 */
export async function fetchWatchlist(userId: string = DEFAULT_USER_ID): Promise<WatchlistItem[]> {
  try {
    const res = await fetch(`/api/watchlist?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await safeParseJson(res);
      return Array.isArray(data.watchlist) ? data.watchlist : [];
    }
  } catch (err) {
    console.warn('[PipelineClient] Error fetching watchlist:', err);
  }
  return [];
}

export async function addWatchlistItem(
  item: {
    productName: string;
    brand: string;
    modelNumber?: string;
    upcBarcode?: string;
    keywords?: string[];
    notes?: string;
    userId?: string;
  }
): Promise<WatchlistItem | null> {
  try {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...item,
        userId: item.userId || DEFAULT_USER_ID
      })
    });
    if (res.ok) {
      const data = await safeParseJson(res);
      return data.item || null;
    }
  } catch (err) {
    console.warn('[PipelineClient] Error adding watchlist item:', err);
  }
  return null;
}

export async function removeWatchlistItem(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      const data = await safeParseJson(res);
      return Boolean(data.success);
    }
  } catch (err) {
    console.warn('[PipelineClient] Error removing watchlist item:', err);
  }
  return false;
}

/**
 * Notification History API
 */
export async function fetchNotificationHistory(
  userId: string = DEFAULT_USER_ID
): Promise<NotificationHistoryRecord[]> {
  try {
    const res = await fetch(`/api/notifications?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await safeParseJson(res);
      return Array.isArray(data.notifications) ? data.notifications : [];
    }
  } catch (err) {
    console.warn('[PipelineClient] Error fetching notifications:', err);
  }
  return [];
}

/**
 * Worker status & manual sync trigger
 */
export async function fetchWorkerStatus(): Promise<WorkerStatusResponse | null> {
  try {
    const res = await fetch('/api/sync/status');
    if (res.ok) {
      return await safeParseJson(res);
    }
  } catch (err) {
    console.warn('[PipelineClient] Error fetching sync status:', err);
  }
  return null;
}

export async function triggerManualSync(options: {
  forceAll?: boolean;
  windowHours?: number;
  bypassDeduplication?: boolean;
} = {}): Promise<{ success: boolean; summary?: PipelineSyncSummary; error?: string }> {
  try {
    const res = await fetch('/api/sync/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    const data = await safeParseJson(res);
    if (res.ok) {
      return { success: true, summary: data.summary };
    }
    return { success: false, error: data.error };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
