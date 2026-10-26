import type { RecallItem, ScanHistoryItem } from '../types/recall';
import { getScanHistory, updateMultipleScansInHistory } from './scanHistory';
import { crossReferenceRecallDataset } from './gemini';

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
const LAST_CHECK_KEY = 'canada_recall_history_last_check_ts';
const NOTIFIED_NIDS_KEY = 'canada_recall_history_notified_nids';

export interface HistoryCheckResult {
  checkedCount: number;
  newlyRecalledCount: number;
  newlyRecalledItems: { historyItem: ScanHistoryItem; recall: RecallItem }[];
  timestamp: number;
}

/**
 * Get timestamp of the last 6-hour history verification check
 */
export function getLastHistoryCheckTime(): number | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return null;
    const ts = parseInt(raw, 10);
    return isNaN(ts) ? null : ts;
  } catch {
    return null;
  }
}

/**
 * Get estimated timestamp of the next scheduled 6-hour check
 */
export function getNextHistoryCheckTime(): number {
  const last = getLastHistoryCheckTime();
  if (!last) return Date.now();
  return last + SIX_HOURS_MS;
}

/**
 * Check if the browser supports notifications and if permission is granted
 */
export function hasNotificationPermission(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  return Notification.permission === 'granted';
}

/**
 * Request notification permission from user
 */
export async function requestRecallNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (err) {
    console.warn('Failed to request notification permission:', err);
    return 'denied';
  }
}

/**
 * Send a Canadian safety recall system notification via ServiceWorker or Web Notification
 */
export async function sendRecallSystemNotification(
  title: string,
  body: string,
  url?: string
): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const options: any = {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: `recall-alert-${Date.now()}`,
    data: { url: url || '/' },
    renotify: true
  };

  // Try service worker notification first (better on mobile PWAs)
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch (err) {
    console.warn('Service worker notification error:', err);
  }

  // Fallback to standard window Notification
  try {
    const notif = new Notification(title, options);
    if (url) {
      notif.onclick = () => {
        window.focus();
        window.open(url, '_blank');
      };
    }
  } catch (err) {
    console.warn('Window notification fallback error:', err);
  }
}

/**
 * Retrieve set of Recall Notice IDs (NIDs) that we have already notified the user about
 */
function getNotifiedNidSet(): Set<string> {
  if (typeof window === 'undefined' || !window.localStorage) return new Set();
  try {
    const raw = localStorage.getItem(NOTIFIED_NIDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveNotifiedNidSet(nids: Set<string>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(NOTIFIED_NIDS_KEY, JSON.stringify(Array.from(nids).slice(-200)));
  } catch {}
}

/**
 * Checks all recorded products in history against the Canadian safety recall database.
 * If any product matches a new recall notice, updates history and sends safety notifications.
 */
export async function checkHistoryAgainstRecalls(
  recallsDataset: RecallItem[],
  force: boolean = false
): Promise<HistoryCheckResult> {
  const lastCheck = getLastHistoryCheckTime();
  const now = Date.now();

  // If not forced and 6 hours have not elapsed yet, return early
  if (!force && lastCheck && now - lastCheck < SIX_HOURS_MS) {
    return {
      checkedCount: 0,
      newlyRecalledCount: 0,
      newlyRecalledItems: [],
      timestamp: lastCheck
    };
  }

  const history = getScanHistory();
  if (!history || history.length === 0 || !recallsDataset || recallsDataset.length === 0) {
    try {
      localStorage.setItem(LAST_CHECK_KEY, String(now));
    } catch {}
    return {
      checkedCount: 0,
      newlyRecalledCount: 0,
      newlyRecalledItems: [],
      timestamp: now
    };
  }

  const notifiedNids = getNotifiedNidSet();
  const updatedHistoryItems: ScanHistoryItem[] = [];
  const newlyRecalledItems: { historyItem: ScanHistoryItem; recall: RecallItem }[] = [];

  for (const item of history) {
    // Construct extraction details for cross-referencing
    const extraction = item.extractedInfo || {
      brand: '',
      productName: item.identifiedTitle,
      category: 'Other',
      searchKeywords: item.searchKeywords || item.identifiedTitle
    };

    const matchResult = crossReferenceRecallDataset(extraction, recallsDataset);
    const hasMatches = matchResult.matchedRecalls.length > 0;
    const wasSafe = item.verdict === 'NO_RECALL_FOUND';

    let isNewRecallForThisItem = false;

    if (hasMatches) {
      for (const recall of matchResult.matchedRecalls) {
        if (!notifiedNids.has(recall.NID)) {
          notifiedNids.add(recall.NID);
          isNewRecallForThisItem = true;
          newlyRecalledItems.push({ historyItem: item, recall });
        }
      }
    }

    const updatedItem: ScanHistoryItem = {
      ...item,
      verdict: matchResult.verdict,
      matchedRecalls: matchResult.matchedRecalls,
      matchedRecallsCount: matchResult.matchedRecalls.length,
      matchReason: matchResult.matchReason,
      lastCheckedAt: now,
      isNewlyRecalled: isNewRecallForThisItem || (wasSafe && hasMatches)
    };

    updatedHistoryItems.push(updatedItem);
  }

  // Persist updated history & notified records
  updateMultipleScansInHistory(updatedHistoryItems);
  saveNotifiedNidSet(notifiedNids);
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(now));
  } catch {}

  // Send system notifications for any newly matched recalls
  if (newlyRecalledItems.length > 0) {
    for (const { historyItem, recall } of newlyRecalledItems) {
      const title = `🚨 Canada Recall Alert: ${historyItem.identifiedTitle}`;
      const body = `${recall.Title}\nHazard: ${recall.Issue || 'Check official instructions immediately'}.`;
      await sendRecallSystemNotification(title, body, recall.URL);
    }

    // Dispatch global in-app event so UI shows banner/toast
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('recall-monitoring-alert', {
          detail: {
            newlyRecalledItems,
            timestamp: now
          }
        })
      );
    }
  }

  // Notify listeners that check finished
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('recall-monitoring-check-completed', {
        detail: {
          timestamp: now,
          checkedCount: history.length,
          newlyRecalledCount: newlyRecalledItems.length
        }
      })
    );
  }

  return {
    checkedCount: history.length,
    newlyRecalledCount: newlyRecalledItems.length,
    newlyRecalledItems,
    timestamp: now
  };
}

/**
 * Initializes the recurring 6-hour background verification monitor.
 * Runs on startup if due, and periodically evaluates every 5 minutes.
 */
export function startPeriodicHistoryMonitor(
  getRecallsDataset: () => RecallItem[]
): () => void {
  // Check immediately if due or never run
  const initialDataset = getRecallsDataset();
  if (initialDataset && initialDataset.length > 0) {
    checkHistoryAgainstRecalls(initialDataset, false).catch((err) =>
      console.warn('Initial 6-hour history check error:', err)
    );
  }

  // Check every 5 minutes whether the 6-hour window has elapsed
  const intervalId = window.setInterval(() => {
    const dataset = getRecallsDataset();
    if (dataset && dataset.length > 0) {
      const lastCheck = getLastHistoryCheckTime();
      if (!lastCheck || Date.now() - lastCheck >= SIX_HOURS_MS) {
        checkHistoryAgainstRecalls(dataset, false).catch((err) =>
          console.warn('Scheduled 6-hour history check error:', err)
        );
      }
    }
  }, 5 * 60 * 1000);

  return () => {
    window.clearInterval(intervalId);
  };
}
