import type { ScanHistoryItem } from '../types/recall';

const STORAGE_KEY = 'canada_recall_scan_history_v1';
const MAX_HISTORY_ITEMS = 60;

/**
 * Retrieve all logged scans from localStorage
 */
export function getScanHistory(): ScanHistoryItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to parse scan history:', err);
    return [];
  }
}

/**
 * Add a new scan to the persistent history log
 */
export function addScanToHistory(
  item: Omit<ScanHistoryItem, 'id' | 'timestamp'> & { id?: string; timestamp?: number }
): ScanHistoryItem {
  const current = getScanHistory();

  // Create unique id and timestamp
  const newItem: ScanHistoryItem = {
    ...item,
    id: item.id || `scan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: item.timestamp || Date.now()
  };

  // Prepend to list
  const updated = [newItem, ...current.filter((s) => s.id !== newItem.id)].slice(0, MAX_HISTORY_ITEMS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e: any) {
    console.warn('Failed to write scan history directly, attempting quota cleanup:', e);
    // If quota exceeded, strip image previews from older items to save space
    try {
      const stripped = updated.map((it, idx) =>
        idx > 5 ? { ...it, imagePreview: undefined, tagImagePreview: undefined } : it
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
    } catch {
      // Last resort: keep top 10 items without images
      try {
        const minimal = updated
          .slice(0, 10)
          .map((it) => ({ ...it, imagePreview: undefined, tagImagePreview: undefined }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
      } catch {}
    }
  }

  // Notify listeners across the app
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('scan-history-updated', { detail: newItem }));
  }

  return newItem;
}

/**
 * Update an existing scan in the persistent history log
 */
export function updateScanInHistory(updatedItem: ScanHistoryItem): void {
  const current = getScanHistory();
  const index = current.findIndex((it) => it.id === updatedItem.id);
  if (index === -1) return;

  current[index] = updatedItem;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('scan-history-updated', { detail: updatedItem }));
  }
}

/**
 * Bulk update multiple scans in history
 */
export function updateMultipleScansInHistory(updatedItems: ScanHistoryItem[]): void {
  if (!updatedItems || updatedItems.length === 0) return;
  const current = getScanHistory();
  const map = new Map(updatedItems.map((it) => [it.id, it]));

  const updated = current.map((it) => (map.has(it.id) ? map.get(it.id)! : it));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('scan-history-updated'));
  }
}
