import { RecallItem, CategoryFilter, CategoryDefinition } from '../types/recall';
import { recallStorage } from './storage';

export const PRIMARY_FEED_URL =
  'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json';

// Fallback proxy paths in order of preference
export const PROXY_ENDPOINTS = [
  '/api/recalls', // Vite dev proxy
  'https://api.allorigins.win/raw?url=' + encodeURIComponent(PRIMARY_FEED_URL),
  'https://corsproxy.io/?url=' + encodeURIComponent(PRIMARY_FEED_URL)
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

export async function fetchRecallsData(
  forceRefresh = false,
  onProgress?: (step: string) => void
): Promise<FetchFeedResult> {
  // 1. Check existing IndexedDB cache unless user forced refresh
  if (!forceRefresh) {
    onProgress?.('Checking cached safety alerts...');
    const cached = await recallStorage.getAllRecalls();
    const meta = await recallStorage.getMetadata();

    // Cache valid if within 12 hours and has records
    const isFresh = meta.lastSynced && Date.now() - meta.lastSynced < 12 * 60 * 60 * 1000;
    if (cached.length > 0 && isFresh) {
      return {
        data: cached,
        source: 'indexeddb',
        count: cached.length
      };
    }
  }

  // 2. If online, attempt to fetch live feed directly or via proxies
  if (navigator.onLine) {
    onProgress?.('Connecting to Canadian Open Data feed (recalls-rappels.canada.ca)...');

    // Attempt 1: Direct Fetch
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(PRIMARY_FEED_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      clearTimeout(timeout);

      if (res.ok) {
        onProgress?.('Parsing Canadian Open Data safety records...');
        const json = await res.json();
        if (Array.isArray(json) && json.length > 0) {
          onProgress?.(`Caching ${json.length.toLocaleString()} recalls for offline access...`);
          await recallStorage.saveRecalls(json, 'live');
          return { data: json, source: 'live', count: json.length };
        }
      }
    } catch (directErr) {
      console.warn('Direct fetch failed (likely CORS or network):', directErr);
    }

    // Attempt 2: Proxy fallbacks (dev proxy or CORS gateway)
    for (const proxyUrl of PROXY_ENDPOINTS) {
      try {
        onProgress?.(`Trying alternate gateway (${proxyUrl.split('?')[0]})...`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(proxyUrl, {
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
        clearTimeout(timeout);

        if (res.ok) {
          onProgress?.('Parsing recall feed response...');
          let json = await res.json();
          // allOrigins wraps response in { contents: "..." } if not raw, but we used raw
          if (typeof json === 'string') {
            json = JSON.parse(json);
          }
          if (json && json.contents && typeof json.contents === 'string') {
            json = JSON.parse(json.contents);
          }
          if (Array.isArray(json) && json.length > 0) {
            onProgress?.(`Caching ${json.length.toLocaleString()} recalls to IndexedDB...`);
            await recallStorage.saveRecalls(json, 'proxy');
            return { data: json, source: 'proxy', count: json.length };
          }
        }
      } catch (proxyErr) {
        console.warn(`Proxy ${proxyUrl} failed:`, proxyErr);
      }
    }
  }

  // 3. Fallback: Any existing IndexedDB cache (even if older than 12h)
  const existingCache = await recallStorage.getAllRecalls();
  if (existingCache.length > 0) {
    onProgress?.('Using previously saved offline alerts.');
    return {
      data: existingCache,
      source: 'indexeddb',
      count: existingCache.length
    };
  }

  // 4. Fallback: Pre-bundled snapshot in /data/initial-recalls.json
  try {
    onProgress?.('Loading bundled safety database...');
    const bundledRes = await fetch('/data/initial-recalls.json');
    if (bundledRes.ok) {
      const bundledData = await bundledRes.json();
      if (Array.isArray(bundledData) && bundledData.length > 0) {
        await recallStorage.saveRecalls(bundledData, 'bundled');
        return {
          data: bundledData,
          source: 'bundled',
          count: bundledData.length
        };
      }
    }
  } catch (bundledErr) {
    console.error('Bundled dataset failed to load:', bundledErr);
  }

  throw new Error(
    'Unable to fetch Canadian recall data. Direct feed was blocked by CORS/network, and no cached alerts were available. Please check your internet connection and click Retry.'
  );
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
    // Sort newest first by default
    return filtered.slice().sort((a, b) => {
      const dateA = a['Last updated'] || '';
      const dateB = b['Last updated'] || '';
      return dateB.localeCompare(dateA);
    });
  }

  // Split multi-word query
  const queryTokens = cleanQuery.split(/\s+/).filter(Boolean);

  const matched = filtered.filter((item) => {
    const title = (item.Title || '').toLowerCase();
    const product = (item.Product || '').toLowerCase();
    const issue = (item.Issue || '').toLowerCase();
    const whatToDo = (item['What you should do'] || '').toLowerCase();
    const nid = (item.NID || '').toLowerCase();
    const fullText = `${title} ${product} ${issue} ${whatToDo} ${nid}`;

    // All tokens must match somewhere
    return queryTokens.every((token) => fullText.includes(token));
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
  codeOrQuery: string,
  categoryHint?: string
): RecallItem[] {
  const code = codeOrQuery.trim().toLowerCase();
  if (!code) return [];

  // Remove common barcode punctuation
  const digitsOnly = code.replace(/[^0-9]/g, '');

  const matches = items.filter((item) => {
    const fullText = `${item.Title} ${item.Product} ${item.Issue} ${item['What you should do']}`.toLowerCase();

    // Direct string match
    if (fullText.includes(code)) return true;

    // If we have an 8-13 digit UPC, check if digits appear
    if (digitsOnly.length >= 8 && fullText.includes(digitsOnly)) {
      return true;
    }

    return false;
  });

  return matches;
}
