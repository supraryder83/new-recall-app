import type { RecallItem, CategoryFilter, CategoryDefinition } from '../types/recall';
import { recallStorage } from './storage';

export const PRIMARY_FEED_URL = '/api/recalls';

// Server endpoints: clients fetch from this server (cached 6 hours), falling back to local bundled dataset
export const PROXY_ENDPOINTS = [
  '/api/recalls',
  '/data/initial-recalls.json'
];

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'ALL',
    label: 'All Recalls',
    shortLabel: 'All',
    iconName: 'ShieldAlert',
    color: 'bg-slate-100 text-slate-800 border-slate-200',
    accentColor: '#475569',
    match: () => true
  },
  {
    id: 'FOOD',
    label: 'Food & Nutrition',
    shortLabel: 'Food',
    iconName: 'Utensils',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    accentColor: '#059669',
    match: (item) => {
      const org = (item.Organization || '').toLowerCase();
      const cat = (item.Category || '').toLowerCase();
      return (
        org === 'cfia' ||
        cat.includes('food') ||
        cat.includes('confectionary') ||
        cat.includes('snack') ||
        cat.includes('meat') ||
        cat.includes('dairy') ||
        cat.includes('beverage')
      );
    }
  },
  {
    id: 'CONSUMER',
    label: 'Consumer Products',
    shortLabel: 'Consumer',
    iconName: 'ShoppingBag',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    accentColor: '#2563eb',
    match: (item) => {
      const org = (item.Organization || '').toLowerCase();
      const cat = (item.Category || '').toLowerCase();
      return (
        org.includes('consumer product') ||
        cat.includes('household') ||
        cat.includes('toy') ||
        cat.includes('game') ||
        cat.includes('clothing') ||
        cat.includes('accessory') ||
        cat.includes('sports') ||
        cat.includes('electronics')
      );
    }
  },
  {
    id: 'HEALTH',
    label: 'Health & Medical',
    shortLabel: 'Health/Medical',
    iconName: 'HeartPulse',
    color: 'bg-purple-50 text-purple-700 border-purple-200',
    accentColor: '#9333ea',
    match: (item) => {
      const org = (item.Organization || '').toLowerCase();
      const cat = (item.Category || '').toLowerCase();
      return (
        org.includes('medical') ||
        org.includes('health') ||
        org.includes('drug') ||
        cat.includes('medical') ||
        cat.includes('drug') ||
        cat.includes('natural health') ||
        cat.includes('hospital')
      );
    }
  },
  {
    id: 'VEHICLES',
    label: 'Vehicles & Transport',
    shortLabel: 'Vehicles',
    iconName: 'Car',
    color: 'bg-amber-50 text-amber-800 border-amber-200',
    accentColor: '#d97706',
    match: (item) => {
      const org = (item.Organization || '').toUpperCase();
      const cat = (item.Category || '').toLowerCase();
      return (
        org === 'TC' ||
        org.includes('TRANSPORT') ||
        cat.includes('car') ||
        cat.includes('suv') ||
        cat.includes('truck') ||
        cat.includes('rv') ||
        cat.includes('bus') ||
        cat.includes('trailer') ||
        cat.includes('motorcycle')
      );
    }
  }
];

export interface FetchFeedResult {
  data: RecallItem[];
  source: 'live' | 'proxy' | 'indexeddb' | 'bundled';
  count: number;
}

/**
 * INSTANT LOAD: Serves cached IndexedDB or bundled data immediately (< 20ms)
 * so the application displays without waiting on network.
 */
export async function loadInstantCachedRecalls(): Promise<FetchFeedResult | null> {
  // 1. FAST PATH: Return cached IndexedDB data immediately if available
  const cached = await recallStorage.getAllRecalls();
  if (cached && cached.length > 5000) {
    return {
      data: cached,
      source: 'indexeddb',
      count: cached.length
    };
  }

  // 2. FAST FALLBACK: Pre-bundled local file loads in ~10ms
  try {
    const bundledRes = await fetch('/data/initial-recalls.json');
    if (bundledRes.ok) {
      const bundledData = await bundledRes.json();
      if (Array.isArray(bundledData) && bundledData.length > 0) {
        recallStorage.saveRecalls(bundledData, 'bundled');
        return {
          data: bundledData,
          source: 'bundled',
          count: bundledData.length
        };
      }
    }
  } catch {
    // Continue to network if bundled fails
  }

  return null;
}

/**
 * LIVE DATABASE SYNC: Fetches the latest live Health Canada / CFIA / Transport Canada
 * open data feed, saves the updated records into IndexedDB, and returns the dataset.
 * Called automatically when the app is opened and on manual refresh.
 */
export async function syncLiveRecallsDatabase(
  onProgress?: (step: string) => void
): Promise<FetchFeedResult> {
  onProgress?.('Connecting to Canadian recall server cache...');

  // Clients fetch directly from this server's 6-hour cached API endpoint,
  // falling back to local bundled data if server is unreachable
  const candidateUrls = ['/api/recalls', '/data/initial-recalls.json'];

  for (const url of candidateUrls) {
    try {
      onProgress?.(
        url === '/api/recalls'
          ? 'Fetching 6-hour cached recall notices from server...'
          : 'Loading local safety registry...'
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      clearTimeout(timeout);

      if (res.ok) {
        onProgress?.('Parsing Canadian safety notices...');
        let json = await res.json();
        if (json && json.contents && typeof json.contents === 'string') {
          json = JSON.parse(json.contents);
        }
        if (typeof json === 'string') {
          json = JSON.parse(json);
        }

        if (Array.isArray(json) && json.length > 0) {
          onProgress?.(`Updating database with ${json.length.toLocaleString()} notices...`);
          const source = url === '/api/recalls' ? 'live' : 'bundled';
          await recallStorage.saveRecalls(json, source);

          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('recalls-database-synced', {
                detail: { count: json.length, source, timestamp: Date.now() }
              })
            );
          }

          return {
            data: json,
            source,
            count: json.length
          };
        }
      }
    } catch {
      // Try next candidate without crashing
    }
  }

  // If live network requests failed (e.g. offline mode), return existing cached IndexedDB
  const existing = await recallStorage.getAllRecalls();
  if (existing.length > 0) {
    return {
      data: existing,
      source: 'indexeddb',
      count: existing.length
    };
  }

  // Final fallback to bundled data
  try {
    const res = await fetch('/data/initial-recalls.json');
    const data = await res.json();
    await recallStorage.saveRecalls(data, 'bundled');
    return {
      data,
      source: 'bundled',
      count: data.length
    };
  } catch (err: any) {
    throw new Error('Unable to connect to Canadian safety registry or load offline database.');
  }
}

/**
 * Fetch recalls dataset with instant cached fallback or live update
 */
export async function fetchRecallsData(
  forceRefresh = false,
  onProgress?: (step: string) => void
): Promise<FetchFeedResult> {
  if (!forceRefresh) {
    const instant = await loadInstantCachedRecalls();
    if (instant) return instant;
  }
  return syncLiveRecallsDatabase(onProgress);
}

/**
 * Filter and search recall items with ranking
 */
export function filterRecalls(
  items: RecallItem[],
  query: string,
  category: CategoryFilter,
  selectedClass?: string
): RecallItem[] {
  let filtered = items;

  // Category filter
  if (category !== 'ALL') {
    const catDef = CATEGORIES.find((c) => c.id === category);
    if (catDef) {
      filtered = filtered.filter(catDef.match);
    }
  }

  // Recall class filter
  if (selectedClass && selectedClass !== 'ALL') {
    filtered = filtered.filter((item) => {
      const cls = (item['Recall class'] || '').trim().toLowerCase();
      return cls === selectedClass.toLowerCase();
    });
  }

  // Text search
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) {
    // Return items sorted newest first
    return filtered.slice().sort((a, b) => {
      const dateA = a['Last updated'] || '';
      const dateB = b['Last updated'] || '';
      return dateB.localeCompare(dateA);
    });
  }

  // Split multi-word query
  const queryTokens = cleanQuery.split(/\s+/).filter(Boolean);
  const digitsOnly = cleanQuery.replace(/[^0-9]/g, '');
  const digitsNoLeadingZero = digitsOnly.replace(/^0+/, '');

  const matched = filtered.filter((item) => {
    const title = (item.Title || '').toLowerCase();
    const product = (item.Product || '').toLowerCase();
    const issue = (item.Issue || '').toLowerCase();
    const whatToDo = (item['What you should do'] || '').toLowerCase();
    const org = (item.Organization || '').toLowerCase();
    const nid = (item.NID || '').toLowerCase();
    const fullText = `${title} ${product} ${issue} ${whatToDo} ${org} ${nid}`;

    // Barcode number search: Check digits-only text to match barcodes formatted with spaces or dashes
    if (digitsOnly.length >= 8) {
      const fullDigits = fullText.replace(/[^0-9]/g, '');
      if (
        fullDigits.includes(digitsOnly) ||
        (digitsNoLeadingZero.length >= 7 && fullDigits.includes(digitsNoLeadingZero)) ||
        fullDigits.includes('0' + digitsOnly)
      ) {
        return true;
      }
    }

    return queryTokens.every((token) => {
      if (fullText.includes(token)) return true;
      // Stem match (plural / singular)
      if (token.endsWith('s') && fullText.includes(token.slice(0, -1))) return true;
      if (!token.endsWith('s') && fullText.includes(token + 's')) return true;
      return false;
    });
  });

  // Sort matched: prioritize title/product matches first, then date
  return matched.sort((a, b) => {
    const aInTitle = (a.Title || '').toLowerCase().includes(cleanQuery);
    const bInTitle = (b.Title || '').toLowerCase().includes(cleanQuery);
    if (aInTitle && !bInTitle) return -1;
    if (!aInTitle && bInTitle) return 1;

    const dateA = a['Last updated'] || '';
    const dateB = b['Last updated'] || '';
    return dateB.localeCompare(dateA);
  });
}

/**
 * Specifically search for UPC / barcode or model code
 */
export function findRecallsByCodeOrQuery(
  items: RecallItem[],
  codeOrQuery: string
): RecallItem[] {
  const code = codeOrQuery.trim().toLowerCase();
  if (!code) return [];

  const digitsOnly = code.replace(/[^0-9]/g, '');
  const digitsNoLeadingZero = digitsOnly.replace(/^0+/, '');

  return items.filter((item) => {
    const title = (item.Title || '').toLowerCase();
    const product = (item.Product || '').toLowerCase();
    const issue = (item.Issue || '').toLowerCase();
    const whatToDo = (item['What you should do'] || '').toLowerCase();
    const org = (item.Organization || '').toLowerCase();
    const nid = (item.NID || '').toLowerCase();
    const fullText = `${title} ${product} ${issue} ${whatToDo} ${org} ${nid}`;

    if (fullText.includes(code)) return true;

    if (digitsOnly.length >= 7) {
      const fullDigits = fullText.replace(/[^0-9]/g, '');
      if (
        fullDigits.includes(digitsOnly) ||
        (digitsNoLeadingZero.length >= 7 && fullDigits.includes(digitsNoLeadingZero)) ||
        fullDigits.includes('0' + digitsOnly)
      ) {
        return true;
      }
    }
    return false;
  });
}
