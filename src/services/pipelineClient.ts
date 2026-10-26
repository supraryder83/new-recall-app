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
 * Fetch VAPID public key from backend
 */
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/vapid-public-key');
    if (res.ok) {
      const data = await res.json();
      return data.publicKey || null;
    }
  } catch (err) {
    console.warn('[PipelineClient] Failed to fetch VAPID key:', err);
  }
  return null;
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
    if (!vapidKey) {
      return { success: false, error: 'Could not obtain VAPID public key from server.' };
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as any
      });
    }

    const subJson = subscription.toJSON();
    if (!subJson.endpoint || !subJson.keys) {
      return { success: false, error: 'PushSubscription keys missing.' };
    }

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
    } else {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err.error || 'Failed to register subscription on server.' };
    }
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
    const data = await res.json();
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
      const data = await res.json();
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
      const data = await res.json();
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
      const data = await res.json();
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
      const data = await res.json();
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
      return await res.json();
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
    const data = await res.json();
    if (res.ok) {
      return { success: true, summary: data.summary };
    }
    return { success: false, error: data.error };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
