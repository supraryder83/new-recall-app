import fs from 'node:fs';
import path from 'node:path';
import type { RecallItem } from '../types/recall';
import { pipelineStore } from './store';
import { parsePublicationDate } from './normalizer';

export const HEALTH_CANADA_FEED_URL =
  'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json';

export interface FetchOptions {
  feedUrl?: string;
  windowHours?: number; // default: 24 hours
  maxRetries?: number; // default: 4
  initialDelayMs?: number; // default: 1000ms
  backoffFactor?: number; // default: 2
  timeoutMs?: number; // default: 15000ms
  forceAll?: boolean; // if true, bypasses 24h filter (useful for full testing)
  bypassDeduplication?: boolean; // if true, returns items even if already in processed_recalls
  referenceTimestamp?: number; // allows simulating a specific date/time
}

export interface FetchFeedResult {
  allRecordsCount: number;
  recordsInWindowCount: number;
  newRecallsToProcess: RecallItem[];
  deduplicatedCount: number;
  feedSource: string;
  fetchDurationMs: number;
}

/**
 * Utility to sleep for a given duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap fetch in exponential backoff retry logic
 */
export async function fetchWithExponentialBackoff(
  url: string,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    backoffFactor?: number;
    timeoutMs?: number;
  } = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 4;
  const initialDelay = options.initialDelayMs ?? 1000;
  const factor = options.backoffFactor ?? 2;
  const timeoutMs = options.timeoutMs ?? 15000;

  let attempt = 0;
  let delay = initialDelay;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`[FeedFetcher] Requesting ${url} (Attempt ${attempt + 1}/${maxRetries + 1})...`);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Canada-Recall-6Hour-Sync-Worker/1.0 (+https://recalls-rappels.canada.ca)'
        }
      });
      clearTimeout(timer);

      // Success
      if (response.ok) {
        return response;
      }

      // If client error that is not 429 (rate limit), don't retry non-recoverable errors
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new Error(`External feed responded with HTTP ${response.status}: ${response.statusText}`);
      }

      console.warn(
        `[FeedFetcher] External feed returned HTTP ${response.status}. Retrying in ${delay}ms...`
      );
    } catch (err: any) {
      clearTimeout(timer);
      const isAbort = err.name === 'AbortError';
      const msg = isAbort ? `Request timed out after ${timeoutMs}ms` : err.message;
      console.warn(`[FeedFetcher] Attempt ${attempt + 1} failed: ${msg}`);

      if (attempt >= maxRetries) {
        throw new Error(`Failed to fetch Health Canada feed after ${maxRetries + 1} attempts: ${msg}`);
      }
    }

    // Add jitter: ±20% of delay
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    await sleep(Math.max(200, delay + jitter));

    attempt++;
    delay *= factor;
  }

  throw new Error(`Exhausted retries fetching ${url}`);
}

/**
 * Loads records from offline bundle file if external feed is unreachable
 */
function loadBundledFallback(): RecallItem[] {
  try {
    const localPath = path.resolve(process.cwd(), 'public/data/initial-recalls.json');
    if (fs.existsSync(localPath)) {
      const raw = fs.readFileSync(localPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`[FeedFetcher] Fallback loaded ${data.length.toLocaleString()} bundled records.`);
        return data;
      }
    }
  } catch (err) {
    console.warn('[FeedFetcher] Failed to load local bundled fallback:', err);
  }
  return [];
}

/**
 * Queries the Health Canada Recalls feed with exponential backoff,
 * filters for records published/modified within the last 24 hours,
 * and deduplicates incoming recall IDs against the processed_recalls store.
 */
export async function queryHealthCanadaFeed(options: FetchOptions = {}): Promise<FetchFeedResult> {
  const startTime = Date.now();
  const feedUrl = options.feedUrl || HEALTH_CANADA_FEED_URL;
  const windowHours = options.windowHours ?? 24;
  const windowMs = windowHours * 60 * 60 * 1000;
  const referenceTime = options.referenceTimestamp || Date.now();
  const cutoffTimestamp = referenceTime - windowMs;

  let rawData: RecallItem[] = [];
  let feedSource = feedUrl;

  try {
    const res = await fetchWithExponentialBackoff(feedUrl, {
      maxRetries: options.maxRetries ?? 3,
      initialDelayMs: options.initialDelayMs ?? 1000,
      backoffFactor: options.backoffFactor ?? 2,
      timeoutMs: options.timeoutMs ?? 15000
    });

    let json: any = await res.json();
    if (json && json.contents && typeof json.contents === 'string') {
      json = JSON.parse(json.contents);
    }
    if (typeof json === 'string') {
      json = JSON.parse(json);
    }

    if (Array.isArray(json)) {
      rawData = json;
    }
  } catch (err: any) {
    console.warn(`[FeedFetcher] Network query failed (${err.message}). Falling back to bundled dataset...`);
    rawData = loadBundledFallback();
    feedSource = 'bundled-fallback';
    if (rawData.length === 0) {
      throw new Error(`Unable to fetch Health Canada feed and fallback dataset is unavailable: ${err.message}`);
    }
  }

  const allRecordsCount = rawData.length;

  // 1. Filter records published or modified within the last 24 hours (to account for time drifts and overlap)
  let inWindow: RecallItem[] = [];

  if (options.forceAll) {
    inWindow = rawData;
  } else {
    // If the latest record in the feed is older than 24 hours (e.g., weekend or historical snapshot),
    // we also determine the most recent record date in the feed so testing / sync continues seamlessly
    let latestFeedDateTs = 0;
    for (const r of rawData.slice(0, 100)) {
      const { timestamp } = parsePublicationDate(r['Last updated']);
      if (timestamp > latestFeedDateTs) latestFeedDateTs = timestamp;
    }

    // Relative cutoff: use referenceTime or latest record timestamp in feed
    const effectiveCutoff =
      referenceTime - latestFeedDateTs > windowMs * 7
        ? latestFeedDateTs - windowMs // If feed snapshot is frozen, use relative 24h window from latest feed date
        : cutoffTimestamp;

    inWindow = rawData.filter((item) => {
      const { timestamp } = parsePublicationDate(item['Last updated']);
      return timestamp >= effectiveCutoff;
    });

    // If still 0 due to date gaps, include the top 20 latest records as the active batch
    if (inWindow.length === 0 && rawData.length > 0) {
      inWindow = rawData.slice(0, 20);
    }
  }

  const recordsInWindowCount = inWindow.length;

  // 2. Deduplicate incoming recall IDs against existing processed_recalls store
  const newRecallsToProcess: RecallItem[] = [];
  let deduplicatedCount = 0;

  for (const item of inWindow) {
    const nid = (item.NID || '').trim();
    if (!nid) continue;

    if (!options.bypassDeduplication && pipelineStore.isRecallProcessed(nid)) {
      deduplicatedCount++;
      continue;
    }

    newRecallsToProcess.push(item);
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[FeedFetcher] Completed feed query: ${allRecordsCount.toLocaleString()} total records, ` +
      `${recordsInWindowCount} in 24h window, ${deduplicatedCount} skipped (already processed), ` +
      `${newRecallsToProcess.length} new records to process (${durationMs}ms)`
  );

  return {
    allRecordsCount,
    recordsInWindowCount,
    newRecallsToProcess,
    deduplicatedCount,
    feedSource,
    fetchDurationMs: durationMs
  };
}
