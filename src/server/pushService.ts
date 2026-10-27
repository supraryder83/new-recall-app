import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import './env.ts';
import webpush from 'web-push';
import type { UserMatchGroup } from '../types/pipeline';
import { pipelineStore, type PipelineStore } from './store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env from parent directory (e.g. deploy/.env)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const VAPID_FILE = path.resolve(process.cwd(), 'data/vapid.json');

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Loads or initializes the VAPID keypair
 */
export function getOrGenerateVapidKeys(): VapidKeys {
  // Check environment variables first
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  const envSubject = process.env.VAPID_SUBJECT || 'mailto:alerts@canada-recall.internal';

  if (envPublic && envPrivate) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject: envSubject
    };
  }

  // Check persisted data/vapid.json
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const raw = fs.readFileSync(VAPID_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.publicKey && parsed.privateKey) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[PushService] Error reading vapid.json, generating new keys:', err);
  }

  // Generate fresh keys
  const keys = webpush.generateVAPIDKeys();
  const vapidData: VapidKeys = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: envSubject
  };

  try {
    const dir = path.dirname(VAPID_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidData, null, 2), 'utf8');
    console.log('[PushService] Generated and persisted new VAPID keys to data/vapid.json');
  } catch (err) {
    console.error('[PushService] Could not save vapid.json:', err);
  }

  return vapidData;
}

let isVapidConfigured = false;
export function initVapid(): VapidKeys {
  const keys = getOrGenerateVapidKeys();
  if (!isVapidConfigured) {
    try {
      webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
      isVapidConfigured = true;
      console.log('[PushService] VAPID details configured successfully.');
    } catch (err) {
      console.error('[PushService] Failed to set VAPID details:', err);
    }
  }
  return keys;
}

export interface DispatchUserNotificationsResult {
  userId: string;
  notificationsDispatched: number;
  subscriptionsPruned: number;
  recordsLogged: number;
  errors: string[];
}

/**
 * Dispatches a Web Push notification to a matched user, cleans up expired/invalid
 * subscriptions (HTTP 404/410 Gone), and records the alert in the notification history table.
 */
export async function dispatchNotificationForUser(
  userGroup: UserMatchGroup,
  store: PipelineStore = pipelineStore
): Promise<DispatchUserNotificationsResult> {
  initVapid();

  const { userId, matches } = userGroup;
  const result: DispatchUserNotificationsResult = {
    userId,
    notificationsDispatched: 0,
    subscriptionsPruned: 0,
    recordsLogged: 0,
    errors: []
  };

  if (!matches || matches.length === 0) {
    return result;
  }

  // Look up active Web Push API subscriptions for this user
  const subscriptions = store.getPushSubscriptionsForUser(userId);

  // Generate Title, Body and Deep Link per specification:
  // Title: Product Recall Alert: [Product Name]
  // Body: A brief summary of the recall reason and hazard.
  // Data payload: Deep link URL pointing directly to the recall details view in the PWA (/recalls/:id)
  const firstMatch = matches[0];
  const firstRecall = firstMatch.recall;
  const firstProduct = firstMatch.watchItem.productName || firstRecall.title;
  const deepLink = `/recalls/${firstRecall.recallId}`;

  let title: string;
  let body: string;

  if (matches.length === 1) {
    title = `Product Recall Alert: ${firstProduct}`;
    const hazard = firstRecall.rawItem.Issue ? `Hazard: ${firstRecall.rawItem.Issue}` : 'Check official Canada safety notice';
    body = `${firstRecall.title}. ${hazard}.`;
  } else {
    // Grouped notification for multiple matched items
    title = `Product Recall Alert: ${firstProduct} (+${matches.length - 1} more)`;
    const otherCount = matches.length - 1;
    const hazard = firstRecall.rawItem.Issue ? `Hazard: ${firstRecall.rawItem.Issue}` : 'Check safety notices';
    body = `Safety alerts affect ${firstProduct} and ${otherCount} other item(s) on your watchlist. ${hazard}.`;
  }

  const payload = {
    title,
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: `recall-alert-${firstRecall.recallId}`,
    data: {
      url: deepLink,
      recallId: firstRecall.recallId,
      matchedItemsCount: matches.length,
      timestamp: Date.now()
    }
  };

  const payloadString = JSON.stringify(payload);
  let pushSuccessful = false;

  // Send push notification to all active user device subscriptions
  if (subscriptions.length > 0) {
    for (const sub of subscriptions) {
      try {
        const pushSubscriptionFormat = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth
          }
        };

        await webpush.sendNotification(pushSubscriptionFormat, payloadString, {
          TTL: 86400 // 24 hours TTL
        });

        result.notificationsDispatched++;
        pushSuccessful = true;
        console.log(`[PushService] Dispatched push notification to user ${userId} (${sub.endpoint.slice(0, 45)}...)`);
      } catch (err: any) {
        // Handle subscription expiration: HTTP 404 Not Found or HTTP 410 Gone
        if (err.statusCode === 404 || err.statusCode === 410) {
          console.warn(
            `[PushService] Cleaning up expired push subscription (HTTP ${err.statusCode}) for user ${userId} at ${sub.endpoint.slice(0, 45)}...`
          );
          store.removePushSubscription(sub.endpoint);
          result.subscriptionsPruned++;
        } else {
          const errMsg = `Push delivery failed for user ${userId} (${err.statusCode || err.code || err.message})`;
          console.warn(`[PushService] ${errMsg}`);
          result.errors.push(errMsg);
        }
      }
    }
  } else {
    console.log(`[PushService] No active Web Push subscriptions found for user ${userId}. Logging alert to in-app history.`);
  }

  // Log the match in the user's notification history table and mark the alert as sent
  for (const m of matches) {
    try {
      const alreadyLogged = store.hasUserBeenNotifiedForRecall(userId, m.recall.recallId);
      if (!alreadyLogged) {
        store.recordNotificationHistory({
          userId,
          recallNid: m.recall.recallId,
          productName: m.watchItem.productName,
          title: `Product Recall Alert: ${m.watchItem.productName}`,
          body: `${m.recall.title}. Hazard: ${m.recall.rawItem.Issue || 'Check official Canada safety instructions.'}`,
          deepLink: `/recalls/${m.recall.recallId}`,
          matchType: m.matchType,
          matchScore: m.score,
          status: pushSuccessful || subscriptions.length === 0 ? 'sent' : 'failed'
        });

        // Update last match information on watchItem
        store.updateWatchlistItem(m.watchItem.id, {
          lastCheckedAt: Date.now(),
          lastMatchNid: m.recall.recallId
        });

        result.recordsLogged++;
      }
    } catch (err: any) {
      result.errors.push(`Failed to log notification history: ${err.message}`);
    }
  }

  return result;
}

/**
 * Dispatches notifications for all matched user groups in the sync cycle
 */
export async function dispatchBatchNotifications(
  userGroups: UserMatchGroup[],
  store: PipelineStore = pipelineStore
): Promise<{
  totalDispatched: number;
  totalPruned: number;
  totalLogged: number;
  errors: string[];
}> {
  let totalDispatched = 0;
  let totalPruned = 0;
  let totalLogged = 0;
  const errors: string[] = [];

  for (const group of userGroups) {
    const res = await dispatchNotificationForUser(group, store);
    totalDispatched += res.notificationsDispatched;
    totalPruned += res.subscriptionsPruned;
    totalLogged += res.recordsLogged;
    if (res.errors.length > 0) {
      errors.push(...res.errors);
    }
  }

  return {
    totalDispatched,
    totalPruned,
    totalLogged,
    errors
  };
}
