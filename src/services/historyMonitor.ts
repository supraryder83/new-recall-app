import type { RecallItem, ScanHistoryItem } from '../types/recall';
import { getScanHistory, updateMultipleScansInHistory } from './scanHistory';
import { crossReferenceRecallDataset } from './gemini';

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
const LAST_CHECK_KEY = 'canada_recall_history_last_check_ts';
const NOTIFIED_RECORDS_KEY = 'canada_recall_history_notified_records_v2';

export interface NotifiedRecallRecord {
  key: string; // Composite unique key: `${itemId}_${recallNid}`
  itemId: string;
  itemTitle: string;
  recallNid: string;
  recallTitle: string;
  hazard?: string;
  notifiedAt: number;
}

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

  // Try service worker notification first (best on mobile PWAs)
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
 * Retrieve the persistent list of all recall notices we have already notified the user about
 */
export function getNotifiedRecallRecords(): NotifiedRecallRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(NOTIFIED_RECORDS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Check if the user has ALREADY been notified about a specific recall for a scanned item.
 * Prevents sending repeated notifications for the same recall.
 */
export function hasRecallBeenNotified(itemId: string, recallNid: string): boolean {
  const records = getNotifiedRecallRecords();
  const searchKey = `${itemId}_${recallNid}`;
  return records.some(
    (r) => r.key === searchKey || (r.itemId === itemId && r.recallNid === recallNid)
  );
}

/**
 * Record a recall notification so that the system never notifies about this item/recall again.
 */
export function recordNotifiedRecall(record: NotifiedRecallRecord): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = getNotifiedRecallRecords();
    const searchKey = record.key || `${record.itemId}_${record.recallNid}`;
    if (current.some((r) => r.key === searchKey)) {
      return; // Already recorded
    }
    const updated = [record, ...current].slice(0, 1000); // Preserve up to 1000 historical notification records
    localStorage.setItem(NOTIFIED_RECORDS_KEY, JSON.stringify(updated));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('recall-notified-records-updated'));
    }
  } catch (err) {
    console.warn('Failed to save notified recall record:', err);
  }
}

/**
 * Normalizes and extracts product line and variation information.
 * Variations of the same product (e.g. different sizes, flavors, or batch lots) share the same groupKey.
 */
export function getProductVariationGrouping(item: ScanHistoryItem): {
  groupKey: string;
  brand: string;
  baseTitle: string;
  variationName: string;
} {
  const brand = (item.extractedInfo?.brand || '').trim();
  const rawTitle = (item.identifiedTitle || item.extractedInfo?.productName || 'Product').trim();
  const flavor = (item.extractedInfo?.flavorOrVariant || '').trim();
  const size = (item.extractedInfo?.packageSize || '').trim();
  const model = (item.extractedInfo?.modelOrLot || item.extractedInfo?.modelOrBatchNumber || '').trim();

  // Strip weight/size patterns like "450g", "1.2kg", "500ml", "12 pk"
  const strippedTitle = rawTitle
    .replace(/\b\d+(\.\d+)?\s*(g|kg|ml|l|oz|lb|fl\.?\s*oz|pack|pk|ct)\b/gi, '')
    .trim();

  // If brand is in the title, isolate base product name
  let baseName = strippedTitle;
  if (brand && baseName.toLowerCase().startsWith(brand.toLowerCase())) {
    baseName = baseName.slice(brand.length).replace(/^[\s\-–—:]+/, '').trim();
  }

  // Remove flavor/variant suffix from base name if present
  if (flavor && baseName.toLowerCase().includes(flavor.toLowerCase())) {
    const regex = new RegExp(`\\b${flavor}\\b`, 'gi');
    const potentialBase = baseName.replace(regex, '').replace(/^[\s\-–—:]+|[\s\-–—:]+$/, '').trim();
    if (potentialBase.length > 2) {
      baseName = potentialBase;
    }
  }

  const normalizedBrand = brand.toLowerCase();
  const normalizedBase = (baseName || rawTitle).toLowerCase().replace(/\s+/g, ' ');
  const groupKey = normalizedBrand ? `${normalizedBrand}::${normalizedBase}` : normalizedBase;

  // Specific variation label (e.g. "Honey Nut • 430g" or "Crunchy")
  const variationParts = [flavor, size, model].filter(Boolean);
  const variationName = variationParts.length > 0 ? variationParts.join(' • ') : rawTitle;

  return {
    groupKey,
    brand,
    baseTitle: brand ? `${brand} ${baseName || rawTitle}` : (baseName || rawTitle),
    variationName
  };
}

/**
 * Checks ONLY the items that are present in your scan history against the Canadian safety recall database.
 * Tracks recalls it notified you about in a notification, and never notifies about that item again (only new recalls).
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

  // ALWAYS and ONLY check the list of items the user scanned that are in the persistent history log
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

  const updatedHistoryItems: ScanHistoryItem[] = [];
  const newlyRecalledItems: { historyItem: ScanHistoryItem; recall: RecallItem }[] = [];

  for (const item of history) {
    // Cross-reference this specific scanned product against the recall registry
    const extraction = item.extractedInfo || {
      brand: '',
      productName: item.identifiedTitle,
      category: 'Other',
      searchKeywords: item.searchKeywords || item.identifiedTitle
    };

    const matchResult = crossReferenceRecallDataset(extraction, recallsDataset);
    const hasMatches = matchResult.matchedRecalls.length > 0;
    const wasSafe = item.verdict === 'NO_RECALL_FOUND';

    let itemHasNewNotification = false;

    if (hasMatches) {
      for (const recall of matchResult.matchedRecalls) {
        // Check if we have ALREADY notified the user about this recall for this item
        if (!hasRecallBeenNotified(item.id, recall.NID)) {
          // Brand new recall for this item! Add to newly recalled list for notification
          itemHasNewNotification = true;
          newlyRecalledItems.push({ historyItem: item, recall });

          // Immediately record so duplicate notifications are NEVER sent for this recall/item
          recordNotifiedRecall({
            key: `${item.id}_${recall.NID}`,
            itemId: item.id,
            itemTitle: item.identifiedTitle,
            recallNid: recall.NID,
            recallTitle: recall.Title,
            hazard: recall.Issue,
            notifiedAt: now
          });
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
      isNewlyRecalled: itemHasNewNotification || (wasSafe && hasMatches)
    };

    updatedHistoryItems.push(updatedItem);
  }

  // Persist updated history items with new check timestamps and verdicts
  updateMultipleScansInHistory(updatedHistoryItems);
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(now));
  } catch {}

  // Group notifications from different variations of the same product into 1 single notification
  if (newlyRecalledItems.length > 0) {
    const productGroups = new Map<
      string,
      {
        brand: string;
        baseTitle: string;
        variationNames: Set<string>;
        historyItems: ScanHistoryItem[];
        recalls: Map<string, RecallItem>;
      }
    >();

    for (const { historyItem, recall } of newlyRecalledItems) {
      const { groupKey, brand, baseTitle, variationName } = getProductVariationGrouping(historyItem);
      let group = productGroups.get(groupKey);
      if (!group) {
        group = {
          brand,
          baseTitle,
          variationNames: new Set(),
          historyItems: [],
          recalls: new Map()
        };
        productGroups.set(groupKey, group);
      }
      group.variationNames.add(variationName);
      if (!group.historyItems.some((h) => h.id === historyItem.id)) {
        group.historyItems.push(historyItem);
      }
      group.recalls.set(recall.NID, recall);
    }

    // Send 1 consolidated system notification per product group
    for (const [, group] of productGroups) {
      const recallList = Array.from(group.recalls.values());
      const firstRecall = recallList[0];
      const variations = Array.from(group.variationNames);

      let title: string;
      let body: string;

      if (group.historyItems.length > 1 || variations.length > 1) {
        // Grouped notification for multiple variations of the same product
        title = `🚨 Canada Recall Alert: ${group.baseTitle} (${variations.length} Variations)`;
        const varListStr =
          variations.slice(0, 3).join(', ') + (variations.length > 3 ? ` +${variations.length - 3} more` : '');
        body = `Recall notices affect your scanned variations (${varListStr}). Hazard: ${
          firstRecall.Issue || 'Check official instructions immediately'
        }.`;
      } else {
        // Single product variation
        title = `🚨 Canada Recall Alert: ${group.historyItems[0].identifiedTitle}`;
        body = `${firstRecall.Title}\nHazard: ${
          firstRecall.Issue || 'Check official instructions immediately'
        }.`;
      }

      await sendRecallSystemNotification(title, body, firstRecall.URL);
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

  // Notify listeners that 6-hour check completed
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
 * Runs on startup automatically if due (or never run), and periodically evaluates every 1 minute.
 */
export function startPeriodicHistoryMonitor(
  getRecallsDataset: () => RecallItem[]
): () => void {
  // Check automatically on startup if due or never run before
  const initialDataset = getRecallsDataset();
  if (initialDataset && initialDataset.length > 0) {
    const lastCheck = getLastHistoryCheckTime();
    if (!lastCheck || Date.now() - lastCheck >= SIX_HOURS_MS) {
      checkHistoryAgainstRecalls(initialDataset, false).catch((err) =>
        console.warn('Automatic initial 6-hour history check error:', err)
      );
    }
  }

  // Check every 1 minute whether the 6-hour interval has elapsed
  const intervalId = window.setInterval(() => {
    const dataset = getRecallsDataset();
    if (dataset && dataset.length > 0) {
      const lastCheck = getLastHistoryCheckTime();
      if (!lastCheck || Date.now() - lastCheck >= SIX_HOURS_MS) {
        checkHistoryAgainstRecalls(dataset, false).catch((err) =>
          console.warn('Automatic scheduled 6-hour history check error:', err)
        );
      }
    }
  }, 60 * 1000);

  return () => {
    window.clearInterval(intervalId);
  };
}
