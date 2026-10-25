import type { RecallItem, CategoryFilter, CategoryDefinition } from '../types/recall';
import { recallStorage } from './storage';

export const PRIMARY_FEED_URL =
  'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json';

// Proxy paths (Vite dev proxy first, then fast public gateways)
export const PROXY_ENDPOINTS = [
  '/api/recalls',
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

/**
 * INSTANT LOAD: Always serves cached / bundled data immediately (< 20ms).
 * Does NOT sync every time. Only syncs when user clicks "Sync Live Feed" (forceRefresh=true).
 */
export async function fetchRecallsData(
  forceRefresh = false,
  onProgress?: (step: string) => void
): Promise<FetchFeedResult> {
  // 1. FAST PATH: Return cached IndexedDB data immediately if available and full dataset (> 5,000 records)
  if (!forceRefresh) {
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
          // Save to IndexedDB in background
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
  }

  // 3. NETWORK SYNC (Only when user explicitly asked or initial setup)
  onProgress?.('Fetching live Canadian recall notices...');

  // Try Vite proxy or direct fetch with short 5s timeout
  const candidateUrls = ['/api/recalls', PRIMARY_FEED_URL, ...PROXY_ENDPOINTS.slice(1)];

  for (const url of candidateUrls) {
    try {
      onProgress?.('Checking Canadian Open Data feed...');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      clearTimeout(timeout);

      if (res.ok) {
        onProgress?.('Processing safety notices...');
        let json = await res.json();
        if (json && json.contents && typeof json.contents === 'string') {
          json = JSON.parse(json.contents);
        }
        if (typeof json === 'string') {
          json = JSON.parse(json);
        }

        if (Array.isArray(json) && json.length > 0) {
          onProgress?.(`Caching ${json.length.toLocaleString()} notices...`);
          await recallStorage.saveRecalls(json, url === '/api/recalls' || url === PRIMARY_FEED_URL ? 'live' : 'proxy');
          return {
            data: json,
            source: url === '/api/recalls' || url === PRIMARY_FEED_URL ? 'live' : 'proxy',
            count: json.length
          };
        }
      }
    } catch {
      // Try next candidate without stalling
    }
  }

  // Fallback if network was unreachable
  const existing = await recallStorage.getAllRecalls();
  if (existing.length > 0) {
    return {
      data: existing,
      source: 'indexeddb',
      count: existing.length
    };
  }

  // Final fallback to bundled data
  const res = await fetch('/data/initial-recalls.json');
  const data = await res.json();
  await recallStorage.saveRecalls(data, 'bundled');
  return {
    data,
    source: 'bundled',
    count: data.length
  };
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

  const matched = filtered.filter((item) => {
    const title = (item.Title || '').toLowerCase();
    const product = (item.Product || '').toLowerCase();
    const issue = (item.Issue || '').toLowerCase();
    const whatToDo = (item['What you should do'] || '').toLowerCase();
    const nid = (item.NID || '').toLowerCase();
    const fullText = `${title} ${product} ${issue} ${whatToDo} ${nid}`;

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
  codeOrQuery: string
): RecallItem[] {
  const code = codeOrQuery.trim().toLowerCase();
  if (!code) return [];

  const digitsOnly = code.replace(/[^0-9]/g, '');

  return items.filter((item) => {
    const fullText = `${item.Title} ${item.Product} ${item.Issue} ${item['What you should do']}`.toLowerCase();
    if (fullText.includes(code)) return true;
    if (digitsOnly.length >= 8 && fullText.includes(digitsOnly)) return true;
    return false;
  });
}
