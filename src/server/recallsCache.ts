import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const HEALTH_CANADA_FEED_URL =
  'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json';

// Exact 1-hour cache TTL
export const ONE_HOUR_MS = 1 * 60 * 60 * 1000; // 3,600,000 ms
export const SIX_HOURS_MS = ONE_HOUR_MS; // Alias for backward compatibility

const DATA_DIR = path.resolve(process.cwd(), 'data');
const RECALLS_CACHE_FILE = path.join(DATA_DIR, 'recalls-cache.json');

// Possible bundled fallback file locations
function getBundledFallbackPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'public/data/initial-recalls.json'),
    path.resolve(process.cwd(), 'dist/data/initial-recalls.json'),
    path.resolve(__dirname, '../../public/data/initial-recalls.json'),
    path.resolve(__dirname, '../public/data/initial-recalls.json')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// In-memory cache buffer & timestamp
let cachedRecallsBuffer: Buffer | null = null;
let lastCacheFetchTime = 0;
let activeFetchPromise: Promise<Buffer | null> | null = null;

/**
 * Initializes cache from disk on startup if present
 */
function initFromDisk(): void {
  try {
    if (fs.existsSync(RECALLS_CACHE_FILE)) {
      const stat = fs.statSync(RECALLS_CACHE_FILE);
      const buf = fs.readFileSync(RECALLS_CACHE_FILE);
      if (buf && buf.length > 1000) {
        cachedRecallsBuffer = buf;
        lastCacheFetchTime = stat.mtimeMs;
        const ageMinutes = Math.round((Date.now() - lastCacheFetchTime) / (60 * 1000));
        const isFresh = Date.now() - lastCacheFetchTime < ONE_HOUR_MS;
        console.log(
          `[RecallsCache] Initialized with disk cache (${(buf.length / 1024 / 1024).toFixed(1)} MB, updated ${ageMinutes}m ago). ` +
            (isFresh
              ? `Cache is fresh for next ${Math.round((ONE_HOUR_MS - (Date.now() - lastCacheFetchTime)) / 60000)}m.`
              : 'Cache is older than 1h, background refresh scheduled.')
        );

        if (!isFresh) {
          // Stale (> 1h): trigger background refresh
          refreshRecallsFeed(true).catch(() => {});
        }
        return;
      }
    }

    // Fallback: bundled file if cache doesn't exist yet
    const bundledPath = getBundledFallbackPath();
    if (bundledPath) {
      const buf = fs.readFileSync(bundledPath);
      if (buf && buf.length > 1000) {
        cachedRecallsBuffer = buf;
        lastCacheFetchTime = 0; // marked as 0 so it will refresh from Health Canada
        console.log(
          `[RecallsCache] Initialized with local bundled fallback (${(buf.length / 1024 / 1024).toFixed(1)} MB). Fetching live 1-hour cache...`
        );
        refreshRecallsFeed(true).catch(() => {});
        return;
      }
    }

    // No local files: trigger immediate fetch
    refreshRecallsFeed(true).catch(() => {});
  } catch (err: any) {
    console.warn('[RecallsCache] Error initializing cache from disk:', err.message);
  }
}

// Initialize on load
initFromDisk();

/**
 * Refreshes the Health Canada open data feed from upstream.
 * Ensures only ONE network request happens even if multiple callers request refresh simultaneously.
 */
export async function refreshRecallsFeed(force = false): Promise<Buffer | null> {
  const isFresh = cachedRecallsBuffer && Date.now() - lastCacheFetchTime < ONE_HOUR_MS;
  if (!force && isFresh) {
    return cachedRecallsBuffer;
  }

  if (activeFetchPromise) {
    return activeFetchPromise;
  }

  activeFetchPromise = (async () => {
    try {
      console.log('[RecallsCache] Fetching fresh Health Canada open data feed (1-hour update window)...');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const upstream = await fetch(HEALTH_CANADA_FEED_URL, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'CanadaRecallAlert-Backend/1.0 (+https://recalls-rappels.canada.ca)'
        }
      });
      clearTimeout(timeout);

      if (upstream.ok) {
        const arrayBuf = await upstream.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        if (buf.length > 1000) {
          cachedRecallsBuffer = buf;
          lastCacheFetchTime = Date.now();

          // Persist to disk in data/recalls-cache.json
          try {
            if (!fs.existsSync(DATA_DIR)) {
              fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(RECALLS_CACHE_FILE, buf);
          } catch (writeErr: any) {
            console.warn('[RecallsCache] Could not persist cache to disk:', writeErr.message);
          }

          console.log(
            `[RecallsCache] Successfully cached Health Canada recalls feed (${(buf.length / 1024 / 1024).toFixed(1)} MB). Locked for 1 hour until ${new Date(
              lastCacheFetchTime + ONE_HOUR_MS
            ).toISOString()}.`
          );
          return buf;
        }
      } else {
        console.warn(`[RecallsCache] Upstream Health Canada returned HTTP ${upstream.status}: ${upstream.statusText}`);
      }
    } catch (err: any) {
      console.warn('[RecallsCache] Failed to refresh Health Canada feed:', err.message);
    } finally {
      activeFetchPromise = null;
    }

    // If upstream fetch failed, fall back to existing cache if available
    return cachedRecallsBuffer;
  })();

  return activeFetchPromise;
}

/**
 * Returns the cached buffer if fresh (< 1 hour), otherwise refreshes.
 */
export async function getOrFetchRecallsBuffer(force = false): Promise<{
  buffer: Buffer | null;
  fromCache: boolean;
  lastUpdated: number;
}> {
  const isFresh = cachedRecallsBuffer && Date.now() - lastCacheFetchTime < ONE_HOUR_MS;
  if (!force && isFresh && cachedRecallsBuffer) {
    return {
      buffer: cachedRecallsBuffer,
      fromCache: true,
      lastUpdated: lastCacheFetchTime
    };
  }

  const buf = await refreshRecallsFeed(force);
  return {
    buffer: buf || cachedRecallsBuffer,
    fromCache: !force && Boolean(isFresh),
    lastUpdated: lastCacheFetchTime
  };
}

/**
 * Returns cache status metadata
 */
export function getRecallsCacheStatus() {
  const now = Date.now();
  const ageMs = lastCacheFetchTime ? now - lastCacheFetchTime : null;
  const isFresh = Boolean(cachedRecallsBuffer && ageMs !== null && ageMs < ONE_HOUR_MS);

  return {
    isCached: Boolean(cachedRecallsBuffer),
    cacheTtlHours: 1,
    cacheTtlMs: ONE_HOUR_MS,
    lastUpdated: lastCacheFetchTime,
    lastUpdatedIso: lastCacheFetchTime ? new Date(lastCacheFetchTime).toISOString() : null,
    nextUpdateAt: lastCacheFetchTime ? lastCacheFetchTime + ONE_HOUR_MS : null,
    nextUpdateIso: lastCacheFetchTime ? new Date(lastCacheFetchTime + ONE_HOUR_MS).toISOString() : null,
    ageSeconds: ageMs !== null ? Math.floor(ageMs / 1000) : null,
    ageMinutes: ageMs !== null ? Math.floor(ageMs / (1000 * 60)) : null,
    sizeBytes: cachedRecallsBuffer?.length || 0,
    sizeMb: Number(((cachedRecallsBuffer?.length || 0) / (1024 * 1024)).toFixed(2)),
    isFresh
  };
}

/**
 * HTTP Request Handler for /api/recalls and /api/recalls/status
 */
export async function handleRecallsApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = req.url || '';
  const method = req.method || 'GET';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // GET /api/recalls/status (or /api/recalls-status)
  if (url === '/api/recalls/status' || url === '/api/recalls-status') {
    const status = getRecallsCacheStatus();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify(status, null, 2));
    return;
  }

  // GET /api/recalls
  const etag = lastCacheFetchTime ? `"recalls-${lastCacheFetchTime}"` : null;
  const clientEtag = req.headers['if-none-match'];

  // Check If-None-Match for 304 Not Modified
  if (clientEtag && etag && clientEtag === etag && cachedRecallsBuffer) {
    res.writeHead(304, {
      'Access-Control-Allow-Origin': '*',
      'ETag': etag,
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600'
    });
    res.end();
    return;
  }

  // Get cached or fresh buffer
  const { buffer, fromCache, lastUpdated } = await getOrFetchRecallsBuffer(false);

  if (!buffer) {
    res.writeHead(502, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(
      JSON.stringify({
        error: 'Recalls Cache Unavailable',
        message: 'Could not fetch Health Canada dataset and no cache is currently available.'
      })
    );
    return;
  }

  const ageSeconds = lastUpdated ? Math.floor((Date.now() - lastUpdated) / 1000) : 0;
  const nextUpdateSeconds = Math.max(0, Math.floor((ONE_HOUR_MS - (Date.now() - lastUpdated)) / 1000));
  const currentEtag = lastUpdated ? `"recalls-${lastUpdated}"` : '"recalls-initial"';

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600', // 1 hour
    'ETag': currentEtag,
    'Last-Modified': lastUpdated ? new Date(lastUpdated).toUTCString() : new Date().toUTCString(),
    'X-Server-Cache': fromCache ? 'HIT' : 'MISS',
    'X-Cache-Age-Seconds': String(ageSeconds),
    'X-Next-Update-In-Seconds': String(nextUpdateSeconds)
  });
  res.end(buffer);
}
