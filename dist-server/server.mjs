// server.ts
import http from "node:http";
import fs5 from "node:fs";
import path7 from "node:path";
import { fileURLToPath as fileURLToPath5 } from "node:url";
import dotenv5 from "dotenv";

// src/server/api.ts
import path5 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import dotenv3 from "dotenv";

// src/server/env.ts
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function initServerEnv() {
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
  const cwdParentEnv = path.resolve(process.cwd(), "../.env");
  if (fs.existsSync(cwdParentEnv)) {
    dotenv.config({ path: cwdParentEnv });
  }
  const repoParentEnv = path.resolve(__dirname, "../../.env");
  if (fs.existsSync(repoParentEnv)) {
    dotenv.config({ path: repoParentEnv });
  }
  const cwdEnv = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv });
  }
}
initServerEnv();

// src/server/store.ts
import fs2 from "node:fs";
import path2 from "node:path";
var DATA_DIR = path2.resolve(process.cwd(), "data");
var STORE_FILE = path2.join(DATA_DIR, "pipeline-store.json");
var INITIAL_WORKER_STATE = {
  cronExpression: "0 */6 * * *",
  isRunning: false,
  lastRunAt: null,
  nextRunAt: null,
  totalRuns: 0,
  lastSummary: null
};
var INITIAL_WATCHLIST_SEEDS = [
  {
    id: "watch_sample_1",
    userId: "default_user",
    productName: "Plantropy Jack'd Up Bites Crispy Protein Bites - Jalapeno",
    brand: "Plantropy",
    modelNumber: "JAL-100",
    upcBarcode: "065633458921",
    keywords: ["plantropy", "jackd", "protein", "bites", "jalapeno"],
    notes: "Sample food item for reverse-lookup testing",
    createdAt: Date.now() - 864e5
  },
  {
    id: "watch_sample_2",
    userId: "default_user",
    productName: "JKMAX Heated Blankets and Heating Pads",
    brand: "JKMAX",
    modelNumber: "JK-2026",
    keywords: ["jkmax", "heated", "blanket", "heating", "pad"],
    notes: "Sample consumer product for model number matching",
    createdAt: Date.now() - 864e5
  },
  {
    id: "watch_sample_3",
    userId: "default_user",
    productName: "Cochlear Implant Receiver",
    brand: "Cochlear",
    modelNumber: "CI1012",
    keywords: ["cochlear", "implant"],
    notes: "Sample medical device for exact model substring matching",
    createdAt: Date.now() - 864e5
  }
];
var PipelineStore = class {
  data;
  filePath;
  writeTimer = null;
  constructor(customPath) {
    this.filePath = customPath || STORE_FILE;
    this.data = this.load();
  }
  load() {
    try {
      if (!fs2.existsSync(DATA_DIR)) {
        fs2.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs2.existsSync(this.filePath)) {
        const raw = fs2.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        return {
          processedRecalls: parsed.processedRecalls || {},
          watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : INITIAL_WATCHLIST_SEEDS,
          pushSubscriptions: Array.isArray(parsed.pushSubscriptions) ? parsed.pushSubscriptions : [],
          notificationHistory: Array.isArray(parsed.notificationHistory) ? parsed.notificationHistory : [],
          workerState: parsed.workerState || INITIAL_WORKER_STATE
        };
      }
    } catch (err) {
      console.warn("[PipelineStore] Error loading store file, initializing fresh store:", err);
    }
    const fresh = {
      processedRecalls: {},
      watchlist: INITIAL_WATCHLIST_SEEDS,
      pushSubscriptions: [],
      notificationHistory: [],
      workerState: INITIAL_WORKER_STATE
    };
    this.saveImmediate(fresh);
    return fresh;
  }
  scheduleSave() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.saveImmediate(this.data);
    }, 50);
  }
  flush() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.saveImmediate(this.data);
  }
  saveImmediate(dataToSave) {
    try {
      const dir = path2.dirname(this.filePath);
      if (!fs2.existsSync(dir)) {
        fs2.mkdirSync(dir, { recursive: true });
      }
      const tmpFile = `${this.filePath}.tmp.${Date.now()}`;
      fs2.writeFileSync(tmpFile, JSON.stringify(dataToSave, null, 2), "utf8");
      fs2.renameSync(tmpFile, this.filePath);
    } catch (err) {
      console.error("[PipelineStore] Failed to persist data to disk:", err);
    }
  }
  // ==================== PROCESSED RECALLS ====================
  isRecallProcessed(recallNid) {
    return Boolean(this.data.processedRecalls[recallNid]);
  }
  getProcessedRecall(recallNid) {
    return this.data.processedRecalls[recallNid];
  }
  markRecallProcessed(record) {
    this.data.processedRecalls[record.recallNid] = record;
    this.scheduleSave();
  }
  markRecallsProcessedBatch(records) {
    for (const rec of records) {
      this.data.processedRecalls[rec.recallNid] = rec;
    }
    this.flush();
  }
  getProcessedCount() {
    return Object.keys(this.data.processedRecalls).length;
  }
  getAllProcessedRecalls() {
    return Object.values(this.data.processedRecalls);
  }
  clearProcessedRecalls() {
    this.data.processedRecalls = {};
    this.scheduleSave();
  }
  // ==================== USER WATCHLIST ====================
  getWatchlist(userId) {
    if (!userId) return this.data.watchlist;
    return this.data.watchlist.filter((item) => item.userId === userId);
  }
  getWatchlistItem(id) {
    return this.data.watchlist.find((item) => item.id === id);
  }
  addToWatchlist(item) {
    const id = item.id || `watch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newItem = {
      ...item,
      id,
      createdAt: Date.now()
    };
    this.data.watchlist = [newItem, ...this.data.watchlist.filter((w) => w.id !== id)];
    this.scheduleSave();
    return newItem;
  }
  removeFromWatchlist(id) {
    const beforeCount = this.data.watchlist.length;
    this.data.watchlist = this.data.watchlist.filter((w) => w.id !== id);
    const removed = this.data.watchlist.length < beforeCount;
    if (removed) this.scheduleSave();
    return removed;
  }
  updateWatchlistItem(id, updates) {
    const index = this.data.watchlist.findIndex((w) => w.id === id);
    if (index === -1) return null;
    this.data.watchlist[index] = {
      ...this.data.watchlist[index],
      ...updates,
      updatedAt: Date.now()
    };
    this.scheduleSave();
    return this.data.watchlist[index];
  }
  // ==================== PUSH SUBSCRIPTIONS ====================
  savePushSubscription(sub) {
    const existingIndex = this.data.pushSubscriptions.findIndex((s) => s.endpoint === sub.endpoint);
    const now = Date.now();
    let saved;
    if (existingIndex >= 0) {
      saved = {
        ...this.data.pushSubscriptions[existingIndex],
        ...sub,
        active: true,
        updatedAt: now
      };
      this.data.pushSubscriptions[existingIndex] = saved;
    } else {
      saved = {
        ...sub,
        active: true,
        createdAt: now,
        updatedAt: now
      };
      this.data.pushSubscriptions.push(saved);
    }
    this.scheduleSave();
    return saved;
  }
  getPushSubscriptionsForUser(userId) {
    return this.data.pushSubscriptions.filter((s) => s.userId === userId && s.active);
  }
  getAllActivePushSubscriptions() {
    return this.data.pushSubscriptions.filter((s) => s.active);
  }
  removePushSubscription(endpoint) {
    const initialLen = this.data.pushSubscriptions.length;
    this.data.pushSubscriptions = this.data.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
    const removed = this.data.pushSubscriptions.length < initialLen;
    if (removed) {
      this.scheduleSave();
    }
    return removed;
  }
  // ==================== NOTIFICATION HISTORY ====================
  recordNotificationHistory(record) {
    const id = record.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullRecord = {
      ...record,
      id,
      sentAt: Date.now()
    };
    this.data.notificationHistory = [fullRecord, ...this.data.notificationHistory].slice(0, 2e3);
    this.scheduleSave();
    return fullRecord;
  }
  getNotificationHistory(userId) {
    if (!userId) return this.data.notificationHistory;
    return this.data.notificationHistory.filter((n) => n.userId === userId);
  }
  hasUserBeenNotifiedForRecall(userId, recallNid) {
    return this.data.notificationHistory.some(
      (n) => n.userId === userId && n.recallNid === recallNid && n.status === "sent"
    );
  }
  // ==================== WORKER STATE ====================
  getWorkerState() {
    return { ...this.data.workerState };
  }
  updateWorkerState(updates) {
    this.data.workerState = {
      ...this.data.workerState,
      ...updates
    };
    this.scheduleSave();
  }
  recordRunSummary(summary) {
    this.data.workerState = {
      ...this.data.workerState,
      isRunning: false,
      lastRunAt: summary.finishedAt,
      nextRunAt: summary.finishedAt + 6 * 60 * 60 * 1e3,
      totalRuns: this.data.workerState.totalRuns + 1,
      lastSummary: summary
    };
    this.flush();
  }
  /**
   * Reset entire store to initial state (useful for tests)
   */
  reset() {
    this.data = {
      processedRecalls: {},
      watchlist: INITIAL_WATCHLIST_SEEDS,
      pushSubscriptions: [],
      notificationHistory: [],
      workerState: INITIAL_WORKER_STATE
    };
    this.saveImmediate(this.data);
  }
};
var pipelineStore = new PipelineStore();

// src/server/fetchFeed.ts
import fs3 from "node:fs";
import path3 from "node:path";

// src/server/normalizer.ts
var STOPWORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "in",
  "for",
  "with",
  "by",
  "to",
  "at",
  "from",
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "du",
  "de",
  "et",
  "ou",
  "pour",
  "avec",
  "par",
  "recalled",
  "recall",
  "recalls",
  "rappel",
  "rappels",
  "alert",
  "alerte",
  "safety",
  "product",
  "products",
  "produit",
  "produits",
  "item",
  "items",
  "brand",
  "marque",
  "certain",
  "certains",
  "various",
  "divers",
  "all",
  "tous",
  "pack",
  "pkg",
  "size",
  "format",
  "net",
  "wt",
  "weight",
  "poids",
  "gram",
  "grams",
  "ml",
  "oz",
  "kg",
  "lb",
  "due",
  "because",
  "canada",
  "canadian",
  "canadien",
  "canadienne",
  "notice",
  "avis",
  "number",
  "code",
  "lot",
  "date",
  "best",
  "before",
  "upc",
  "inc",
  "ltd",
  "corp",
  "co",
  "may",
  "are",
  "was",
  "were",
  "not",
  "that",
  "this",
  "have",
  "has",
  "been",
  "which",
  "contain",
  "contains",
  "foreign",
  "pieces",
  "particles",
  "risk",
  "hazard",
  "safety"
]);
function cleanAlphanumeric(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function normalizeCleanText(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['"’`]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function extractDistinctiveTokens(text) {
  const norm = normalizeCleanText(text);
  const rawTokens = norm.split(" ");
  const tokenSet = /* @__PURE__ */ new Set();
  for (const t of rawTokens) {
    if (t.length >= 3 && !STOPWORDS.has(t)) {
      tokenSet.add(t);
    }
  }
  return Array.from(tokenSet);
}
function parsePublicationDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") {
    const now = Date.now();
    return { formatted: new Date(now).toISOString().slice(0, 10), timestamp: now };
  }
  const clean = dateStr.trim();
  const ymdMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const ts = (/* @__PURE__ */ new Date(`${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}T00:00:00Z`)).getTime();
    return { formatted: `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`, timestamp: isNaN(ts) ? Date.now() : ts };
  }
  const parsedTs = Date.parse(clean);
  if (!isNaN(parsedTs)) {
    return { formatted: new Date(parsedTs).toISOString().slice(0, 10), timestamp: parsedTs };
  }
  return { formatted: clean.slice(0, 10), timestamp: Date.now() };
}
function extractUpcs(rawText) {
  const upcs = /* @__PURE__ */ new Set();
  const explicitPattern = /\b(?:upc|ean|gtin|barcode|bar\s*code)[\s:#-]*([0-9]{8,14})\b/gi;
  let match;
  while ((match = explicitPattern.exec(rawText)) !== null) {
    const code = match[1].replace(/[^0-9]/g, "");
    if (code.length >= 8 && code.length <= 14) {
      upcs.add(code);
    }
  }
  const standalonePattern = /\b(\d{12,13})\b/g;
  while ((match = standalonePattern.exec(rawText)) !== null) {
    const digits = match[1];
    if (!digits.startsWith("202") && !digits.startsWith("199")) {
      upcs.add(digits);
    }
  }
  return Array.from(upcs);
}
function extractModelNumbers(rawText) {
  const models = /* @__PURE__ */ new Set();
  const explicitModelPattern = /\b(?:model|item|sku|part|ref|reference)[\s#:]*([a-z0-9][a-z0-9\-_]{2,18})\b/gi;
  let match;
  while ((match = explicitModelPattern.exec(rawText)) !== null) {
    const rawVal = match[1].toLowerCase().replace(/^[\-_]+|[\-_]+$/g, "");
    if (rawVal.length >= 3 && !STOPWORDS.has(rawVal)) {
      if (/\d/.test(rawVal) || rawVal.includes("-")) {
        models.add(cleanAlphanumeric(rawVal));
      }
    }
  }
  const tcPattern = /\b(?:Transport\s+Canada\s+Recall\s*[-–—]?\s*|TC\s+Recall\s*[-–—]?\s*)(\d{6,8})\b/gi;
  while ((match = tcPattern.exec(rawText)) !== null) {
    models.add(cleanAlphanumeric(match[1]));
  }
  const tokenModelPattern = /\b([A-Z]{1,5}\d{2,8}[A-Z0-9\-]*)\b/g;
  while ((match = tokenModelPattern.exec(rawText)) !== null) {
    const candidate = match[1].toLowerCase();
    if (candidate.length >= 3 && !STOPWORDS.has(candidate)) {
      models.add(cleanAlphanumeric(candidate));
    }
  }
  return Array.from(models);
}
function extractLotCodes(rawText) {
  const lots = /* @__PURE__ */ new Set();
  const lotPattern = /\b(?:lot|batch|lots|batches)[\s#:]*([a-z0-9][a-z0-9\-_]{2,18})\b/gi;
  let match;
  while ((match = lotPattern.exec(rawText)) !== null) {
    const val = match[1].toLowerCase().replace(/^[\-_]+|[\-_]+$/g, "");
    if (val.length >= 3 && !STOPWORDS.has(val) && (/\d/.test(val) || val.includes("-"))) {
      lots.add(cleanAlphanumeric(val));
    }
  }
  return Array.from(lots);
}
function extractBrand(rawItem) {
  const title = rawItem.Title || "";
  const product = rawItem.Product || "";
  const organization = rawItem.Organization || "";
  let candidate = "";
  const brandRegex = /^([A-Za-z0-9&'\s]+?)\s+brand\b/i;
  const brandMatch = title.match(brandRegex);
  if (brandMatch && brandMatch[1].trim().length > 1) {
    candidate = brandMatch[1].trim();
  }
  if (!candidate) {
    const recallRegex = /^([A-Za-z0-9&'\s]+?)\s+(?:recalls|recalling|voluntarily\s+recalls)\b/i;
    const recallMatch = title.match(recallRegex);
    if (recallMatch && recallMatch[1].trim().length > 1) {
      candidate = recallMatch[1].trim();
    }
  }
  if (!candidate && product) {
    const parts = product.split(/\s+/);
    if (parts.length > 0 && parts[0].length >= 3) {
      candidate = parts[0];
    }
  }
  if (!candidate && organization && !["CFIA", "Consumer product safety", "Health Canada"].includes(organization)) {
    candidate = organization;
  }
  const normalized = cleanAlphanumeric(candidate);
  const tokens = extractDistinctiveTokens(candidate);
  return { brand: normalized, tokens };
}
function normalizeRecall(item) {
  const recallId = (item.NID || "").trim();
  const title = (item.Title || "").trim();
  const category = (item.Category || "").trim();
  const url = (item.URL || "").trim();
  const organization = (item.Organization || "").trim();
  const product = (item.Product || "").trim();
  const issue = (item.Issue || "").trim();
  const whatToDo = (item["What you should do"] || "").trim();
  const fullCorpus = `${title} ${product} ${issue} ${whatToDo} ${organization} ${category}`;
  const { formatted: publicationDate, timestamp: publicationTimestamp } = parsePublicationDate(
    item["Last updated"]
  );
  const { brand: normalizedBrand, tokens: brandTokens } = extractBrand(item);
  const normalizedProduct = cleanAlphanumeric(product || title);
  const productTokens = extractDistinctiveTokens(`${product} ${title}`);
  const upcs = extractUpcs(fullCorpus);
  const modelNumbers = extractModelNumbers(fullCorpus);
  const lotCodes = extractLotCodes(fullCorpus);
  const searchIndexText = normalizeCleanText(fullCorpus);
  return {
    recallId,
    title,
    category,
    publicationDate,
    publicationTimestamp,
    url,
    organization,
    rawItem: item,
    normalizedBrand,
    brandTokens,
    normalizedProduct,
    productTokens,
    upcs,
    modelNumbers,
    lotCodes,
    searchIndexText
  };
}
function normalizeRecallsBatch(items) {
  return items.map(normalizeRecall);
}

// src/server/fetchFeed.ts
var HEALTH_CANADA_FEED_URL = "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json";
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchWithExponentialBackoff(url, options = {}) {
  const maxRetries = options.maxRetries ?? 4;
  const initialDelay = options.initialDelayMs ?? 1e3;
  const factor = options.backoffFactor ?? 2;
  const timeoutMs = options.timeoutMs ?? 15e3;
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
          Accept: "application/json, text/plain, */*",
          "User-Agent": "Canada-Recall-6Hour-Sync-Worker/1.0 (+https://recalls-rappels.canada.ca)"
        }
      });
      clearTimeout(timer);
      if (response.ok) {
        return response;
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new Error(`External feed responded with HTTP ${response.status}: ${response.statusText}`);
      }
      console.warn(
        `[FeedFetcher] External feed returned HTTP ${response.status}. Retrying in ${delay}ms...`
      );
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err.name === "AbortError";
      const msg = isAbort ? `Request timed out after ${timeoutMs}ms` : err.message;
      console.warn(`[FeedFetcher] Attempt ${attempt + 1} failed: ${msg}`);
      if (attempt >= maxRetries) {
        throw new Error(`Failed to fetch Health Canada feed after ${maxRetries + 1} attempts: ${msg}`);
      }
    }
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    await sleep(Math.max(200, delay + jitter));
    attempt++;
    delay *= factor;
  }
  throw new Error(`Exhausted retries fetching ${url}`);
}
function loadBundledFallback() {
  try {
    const localPath = path3.resolve(process.cwd(), "public/data/initial-recalls.json");
    if (fs3.existsSync(localPath)) {
      const raw = fs3.readFileSync(localPath, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`[FeedFetcher] Fallback loaded ${data.length.toLocaleString()} bundled records.`);
        return data;
      }
    }
  } catch (err) {
    console.warn("[FeedFetcher] Failed to load local bundled fallback:", err);
  }
  return [];
}
async function queryHealthCanadaFeed(options = {}) {
  const startTime = Date.now();
  const feedUrl = options.feedUrl || HEALTH_CANADA_FEED_URL;
  const windowHours = options.windowHours ?? 24;
  const windowMs = windowHours * 60 * 60 * 1e3;
  const referenceTime = options.referenceTimestamp || Date.now();
  const cutoffTimestamp = referenceTime - windowMs;
  let rawData = [];
  let feedSource = feedUrl;
  try {
    const res = await fetchWithExponentialBackoff(feedUrl, {
      maxRetries: options.maxRetries ?? 3,
      initialDelayMs: options.initialDelayMs ?? 1e3,
      backoffFactor: options.backoffFactor ?? 2,
      timeoutMs: options.timeoutMs ?? 15e3
    });
    let json = await res.json();
    if (json && json.contents && typeof json.contents === "string") {
      json = JSON.parse(json.contents);
    }
    if (typeof json === "string") {
      json = JSON.parse(json);
    }
    if (Array.isArray(json)) {
      rawData = json;
    }
  } catch (err) {
    console.warn(`[FeedFetcher] Network query failed (${err.message}). Falling back to bundled dataset...`);
    rawData = loadBundledFallback();
    feedSource = "bundled-fallback";
    if (rawData.length === 0) {
      throw new Error(`Unable to fetch Health Canada feed and fallback dataset is unavailable: ${err.message}`);
    }
  }
  const allRecordsCount = rawData.length;
  let inWindow = [];
  if (options.forceAll) {
    inWindow = rawData;
  } else {
    let latestFeedDateTs = 0;
    for (const r of rawData.slice(0, 100)) {
      const { timestamp } = parsePublicationDate(r["Last updated"]);
      if (timestamp > latestFeedDateTs) latestFeedDateTs = timestamp;
    }
    const effectiveCutoff = referenceTime - latestFeedDateTs > windowMs * 7 ? latestFeedDateTs - windowMs : cutoffTimestamp;
    inWindow = rawData.filter((item) => {
      const { timestamp } = parsePublicationDate(item["Last updated"]);
      return timestamp >= effectiveCutoff;
    });
    if (inWindow.length === 0 && rawData.length > 0) {
      inWindow = rawData.slice(0, 20);
    }
  }
  const recordsInWindowCount = inWindow.length;
  const newRecallsToProcess = [];
  let deduplicatedCount = 0;
  for (const item of inWindow) {
    const nid = (item.NID || "").trim();
    if (!nid) continue;
    if (!options.bypassDeduplication && pipelineStore.isRecallProcessed(nid)) {
      deduplicatedCount++;
      continue;
    }
    newRecallsToProcess.push(item);
  }
  const durationMs = Date.now() - startTime;
  console.log(
    `[FeedFetcher] Completed feed query: ${allRecordsCount.toLocaleString()} total records, ${recordsInWindowCount} in 24h window, ${deduplicatedCount} skipped (already processed), ${newRecallsToProcess.length} new records to process (${durationMs}ms)`
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

// src/server/matcher.ts
function evaluateItemMatch(watchItem, recall, options = {}) {
  const rawUpc = (watchItem.upcBarcode || "").trim();
  const upcDigits = rawUpc.replace(/\D/g, "");
  if (upcDigits.length >= 8) {
    const exactUpcMatch = recall.upcs.includes(upcDigits);
    const textContainsUpc = recall.searchIndexText.includes(upcDigits);
    if (exactUpcMatch || textContainsUpc) {
      return {
        watchItem,
        recall,
        matchType: "upc",
        score: 100,
        reason: `Exact match on UPC/barcode (${upcDigits})`
      };
    }
  }
  const rawModel = (watchItem.modelNumber || "").trim();
  const normModel = cleanAlphanumeric(rawModel);
  if (normModel.length >= 3) {
    const exactModelMatch = recall.modelNumbers.includes(normModel);
    if (exactModelMatch) {
      return {
        watchItem,
        recall,
        matchType: "model",
        score: 95,
        reason: `Exact match on model number (${rawModel})`
      };
    }
    const isAlphanumericCode = /\d/.test(normModel) && /[a-z]/.test(normModel);
    if (normModel.length >= 4 || isAlphanumericCode) {
      if (recall.searchIndexText.includes(normModel)) {
        return {
          watchItem,
          recall,
          matchType: "model",
          score: 90,
          reason: `Normalized substring match on model number (${rawModel})`
        };
      }
    }
  }
  const rawBrand = (watchItem.brand || "").trim();
  const normBrand = cleanAlphanumeric(rawBrand);
  const rawProduct = (watchItem.productName || "").trim();
  const productTokens = extractDistinctiveTokens(rawProduct);
  const rawKeywords = watchItem.keywords || [];
  const keywordTokens = rawKeywords.map((k) => cleanAlphanumeric(k)).filter((k) => k.length >= 3);
  const targetTokens = Array.from(/* @__PURE__ */ new Set([...productTokens, ...keywordTokens]));
  let brandMatches = false;
  if (normBrand.length >= 2) {
    brandMatches = recall.normalizedBrand.includes(normBrand) || normBrand.includes(recall.normalizedBrand) || recall.searchIndexText.includes(normBrand);
  }
  if (normBrand.length >= 3 && !brandMatches) {
    return null;
  }
  const normProductText = normalizeCleanText(rawProduct);
  let hasExactPhraseMatch = false;
  if (normProductText.length >= 5 && recall.searchIndexText.includes(normProductText)) {
    hasExactPhraseMatch = true;
  }
  let matchedTokensCount = 0;
  for (const token of targetTokens) {
    if (recall.searchIndexText.includes(token)) {
      matchedTokensCount++;
    }
  }
  const tokenRatio = targetTokens.length > 0 ? matchedTokensCount / targetTokens.length : 0;
  let score = 0;
  if (brandMatches) score += 35;
  score += Math.round(tokenRatio * 50);
  if (hasExactPhraseMatch) score += 15;
  const tokenConditionMet = targetTokens.length <= 1 ? matchedTokensCount === 1 && (brandMatches || !normBrand) : tokenRatio >= 0.5 || matchedTokensCount >= 2;
  const validFuzzy = (brandMatches || !normBrand) && (hasExactPhraseMatch || tokenConditionMet) && score >= (options.fuzzyThreshold ?? 70);
  if (validFuzzy) {
    return {
      watchItem,
      recall,
      matchType: "brand_keyword",
      score: Math.min(100, score),
      reason: `Tokenized fuzzy match on brand + product keywords (${matchedTokensCount}/${targetTokens.length} tokens matched${brandMatches ? ", brand confirmed" : ""})`
    };
  }
  return null;
}
function matchWatchlistAgainstRecalls(watchlist, incomingRecalls, options = {}) {
  const userGroupMap = /* @__PURE__ */ new Map();
  for (const watchItem of watchlist) {
    for (const recall of incomingRecalls) {
      const evaluation = evaluateItemMatch(watchItem, recall, options);
      if (evaluation) {
        let userMatches = userGroupMap.get(watchItem.userId);
        if (!userMatches) {
          userMatches = [];
          userGroupMap.set(watchItem.userId, userMatches);
        }
        const alreadyAdded = userMatches.some(
          (m) => m.watchItem.id === watchItem.id && m.recall.recallId === recall.recallId
        );
        if (!alreadyAdded) {
          userMatches.push(evaluation);
        }
      }
    }
  }
  const result = [];
  for (const [userId, matches] of userGroupMap.entries()) {
    matches.sort((a, b) => b.score - a.score);
    result.push({
      userId,
      matches
    });
  }
  return result;
}

// src/server/pushService.ts
import fs4 from "node:fs";
import path4 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import dotenv2 from "dotenv";
import webpush from "web-push";
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = path4.dirname(__filename2);
dotenv2.config({ path: path4.resolve(__dirname2, "../.env") });
var VAPID_FILE = path4.resolve(process.cwd(), "data/vapid.json");
function getOrGenerateVapidKeys() {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  const envSubject = process.env.VAPID_SUBJECT || "mailto:support@204webhosting.online";
  if (envPublic && envPrivate) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject: envSubject
    };
  }
  try {
    if (fs4.existsSync(VAPID_FILE)) {
      const raw = fs4.readFileSync(VAPID_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.publicKey && parsed.privateKey) {
        return {
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
          subject: parsed.subject || envSubject
        };
      }
    }
  } catch (err) {
    console.warn("[PushService] Error reading vapid.json:", err);
  }
  const vapidData = {
    publicKey: "BEWplbXClOE7-dY339tirCxloT6u_sdJfvBs0uvZQuOz4OM4ZC0uoKomdiOZOXqKEvzmaJIzMBcIxZQHbDzw3ws",
    privateKey: "ssF7rH7kOgIerTJzoUZuaNrYpT69-uZVJ6ybmSkUml0",
    subject: envSubject
  };
  try {
    const dir = path4.dirname(VAPID_FILE);
    if (!fs4.existsSync(dir)) fs4.mkdirSync(dir, { recursive: true });
    fs4.writeFileSync(VAPID_FILE, JSON.stringify(vapidData, null, 2), "utf8");
    console.log("[PushService] Generated and persisted new VAPID keys to data/vapid.json");
  } catch (err) {
    console.error("[PushService] Could not save vapid.json:", err);
  }
  return vapidData;
}
var isVapidConfigured = false;
function initVapid() {
  const keys = getOrGenerateVapidKeys();
  if (!isVapidConfigured) {
    try {
      webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
      isVapidConfigured = true;
      console.log("[PushService] VAPID details configured successfully.");
    } catch (err) {
      console.error("[PushService] Failed to set VAPID details:", err);
    }
  }
  return keys;
}
async function dispatchNotificationForUser(userGroup, store = pipelineStore) {
  initVapid();
  const { userId, matches } = userGroup;
  const result = {
    userId,
    notificationsDispatched: 0,
    subscriptionsPruned: 0,
    recordsLogged: 0,
    errors: []
  };
  if (!matches || matches.length === 0) {
    return result;
  }
  const subscriptions = store.getPushSubscriptionsForUser(userId);
  const firstMatch = matches[0];
  const firstRecall = firstMatch.recall;
  const firstProduct = firstMatch.watchItem.productName || firstRecall.title;
  const deepLink = `/recalls/${firstRecall.recallId}`;
  let title;
  let body;
  if (matches.length === 1) {
    title = `Product Recall Alert: ${firstProduct}`;
    const hazard = firstRecall.rawItem.Issue ? `Hazard: ${firstRecall.rawItem.Issue}` : "Check official Canada safety notice";
    body = `${firstRecall.title}. ${hazard}.`;
  } else {
    title = `Product Recall Alert: ${firstProduct} (+${matches.length - 1} more)`;
    const otherCount = matches.length - 1;
    const hazard = firstRecall.rawItem.Issue ? `Hazard: ${firstRecall.rawItem.Issue}` : "Check safety notices";
    body = `Safety alerts affect ${firstProduct} and ${otherCount} other item(s) on your watchlist. ${hazard}.`;
  }
  const payload = {
    title,
    body,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
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
          TTL: 86400
          // 24 hours TTL
        });
        result.notificationsDispatched++;
        pushSuccessful = true;
        console.log(`[PushService] Dispatched push notification to user ${userId} (${sub.endpoint.slice(0, 45)}...)`);
      } catch (err) {
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
  for (const m of matches) {
    try {
      const alreadyLogged = store.hasUserBeenNotifiedForRecall(userId, m.recall.recallId);
      if (!alreadyLogged) {
        store.recordNotificationHistory({
          userId,
          recallNid: m.recall.recallId,
          productName: m.watchItem.productName,
          title: `Product Recall Alert: ${m.watchItem.productName}`,
          body: `${m.recall.title}. Hazard: ${m.recall.rawItem.Issue || "Check official Canada safety instructions."}`,
          deepLink: `/recalls/${m.recall.recallId}`,
          matchType: m.matchType,
          matchScore: m.score,
          status: pushSuccessful || subscriptions.length === 0 ? "sent" : "failed"
        });
        store.updateWatchlistItem(m.watchItem.id, {
          lastCheckedAt: Date.now(),
          lastMatchNid: m.recall.recallId
        });
        result.recordsLogged++;
      }
    } catch (err) {
      result.errors.push(`Failed to log notification history: ${err.message}`);
    }
  }
  return result;
}
async function dispatchBatchNotifications(userGroups, store = pipelineStore) {
  let totalDispatched = 0;
  let totalPruned = 0;
  let totalLogged = 0;
  const errors = [];
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

// src/server/pipeline.ts
async function runSyncPipeline(options = {}) {
  const startedAt = Date.now();
  const errors = [];
  console.log("=".repeat(70));
  console.log(`[Pipeline] Starting 6-Hour Background Sync Worker at ${new Date(startedAt).toISOString()}`);
  console.log("=".repeat(70));
  pipelineStore.updateWorkerState({ isRunning: true });
  let recordsQueried = 0;
  let recordsWithinWindow = 0;
  let recordsSkippedDeduplicated = 0;
  let recordsIngested = 0;
  let usersEvaluated = 0;
  let userMatchesFound = 0;
  let pushNotificationsDispatched = 0;
  let pushSubscriptionsPruned = 0;
  try {
    const feedResult = await queryHealthCanadaFeed(options);
    recordsQueried = feedResult.allRecordsCount;
    recordsWithinWindow = feedResult.recordsInWindowCount;
    recordsSkippedDeduplicated = feedResult.deduplicatedCount;
    const rawNewRecalls = feedResult.newRecallsToProcess;
    recordsIngested = rawNewRecalls.length;
    console.log(
      `[Pipeline] Feed query successful. ${recordsIngested} new or updated recalls ready for processing.`
    );
    if (recordsIngested > 0) {
      const normalizedBatch = normalizeRecallsBatch(rawNewRecalls);
      const allWatchlist = pipelineStore.getWatchlist();
      const distinctUsers = new Set(allWatchlist.map((w) => w.userId));
      usersEvaluated = distinctUsers.size;
      console.log(
        `[Pipeline] Running reverse-lookup matching across ${allWatchlist.length} watchlist item(s) for ${usersEvaluated} user(s)...`
      );
      const userMatchGroups = matchWatchlistAgainstRecalls(allWatchlist, normalizedBatch, options);
      userMatchesFound = userMatchGroups.reduce((acc, g) => acc + g.matches.length, 0);
      console.log(
        `[Pipeline] Matching complete: ${userMatchesFound} item match(es) grouped across ${userMatchGroups.length} user(s).`
      );
      if (userMatchGroups.length > 0) {
        console.log(`[Pipeline] Dispatching Web Push notifications for matched users...`);
        const dispatchResult = await dispatchBatchNotifications(userMatchGroups);
        pushNotificationsDispatched = dispatchResult.totalDispatched;
        pushSubscriptionsPruned = dispatchResult.totalPruned;
        if (dispatchResult.errors.length > 0) {
          errors.push(...dispatchResult.errors);
        }
      }
      const processedRecords = normalizedBatch.map((nr) => ({
        id: `proc_${nr.recallId}_${Date.now()}`,
        recallNid: nr.recallId,
        title: nr.title,
        category: nr.category,
        publicationDate: nr.publicationDate,
        publicationTimestamp: nr.publicationTimestamp,
        url: nr.url,
        processedAt: Date.now()
      }));
      pipelineStore.markRecallsProcessedBatch(processedRecords);
      console.log(`[Pipeline] Marked ${processedRecords.length} recalls as processed in store.`);
    } else {
      console.log(`[Pipeline] No new recalls required processing in this cycle.`);
    }
  } catch (err) {
    const msg = `Pipeline execution error: ${err.message}`;
    console.error(`[Pipeline] ${msg}`);
    errors.push(msg);
  }
  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  const status = errors.length === 0 ? "success" : pushNotificationsDispatched > 0 ? "partial" : "error";
  const summary = {
    startedAt,
    finishedAt,
    durationMs,
    recordsQueried,
    recordsWithinWindow,
    recordsSkippedDeduplicated,
    recordsIngested,
    usersEvaluated,
    userMatchesFound,
    pushNotificationsDispatched,
    pushSubscriptionsPruned,
    errors,
    status
  };
  pipelineStore.recordRunSummary(summary);
  console.log("=".repeat(70));
  console.log(
    `[Pipeline] Finished in ${durationMs}ms with status: ${status.toUpperCase()} | Ingested: ${recordsIngested} | Matches: ${userMatchesFound} | Dispatched: ${pushNotificationsDispatched}`
  );
  console.log("=".repeat(70));
  return summary;
}

// src/server/api.ts
import webpush2 from "web-push";
var __filename3 = fileURLToPath3(import.meta.url);
var __dirname3 = path5.dirname(__filename3);
dotenv3.config({ path: path5.resolve(__dirname3, "../.env") });
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.end(JSON.stringify(data));
}
async function handlePipelineApiRequest(req, res, next) {
  const url = req.url || "";
  const method = req.method || "GET";
  if (!url.startsWith("/api/")) {
    return next();
  }
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    });
    res.end();
    return;
  }
  if (url === "/api/vapid-public-key" && method === "GET") {
    const keys = initVapid();
    return sendJson(res, 200, {
      publicKey: keys.publicKey,
      subject: keys.subject
    });
  }
  if (url === "/api/push-subscribe" && method === "POST") {
    try {
      const body = await parseJsonBody(req);
      if (!body.endpoint || !body.keys) {
        return sendJson(res, 400, { error: "Invalid PushSubscription: missing endpoint or keys" });
      }
      const userId = body.userId || "default_user";
      const saved = pipelineStore.savePushSubscription({
        userId,
        endpoint: body.endpoint,
        keys: body.keys,
        expirationTime: body.expirationTime || null,
        active: true,
        userAgent: req.headers["user-agent"]
      });
      console.log(`[API] Saved push subscription for user: ${userId}`);
      return sendJson(res, 200, { success: true, subscription: saved });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (url === "/api/push-subscribe" && method === "DELETE") {
    try {
      const body = await parseJsonBody(req);
      if (body.endpoint) {
        pipelineStore.removePushSubscription(body.endpoint);
      }
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (url === "/api/push-test" && method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const userId = body.userId || "default_user";
      initVapid();
      const subs = pipelineStore.getPushSubscriptionsForUser(userId);
      if (subs.length === 0) {
        return sendJson(res, 400, {
          error: "No active push subscriptions found for user. Please enable notifications first."
        });
      }
      const payload = JSON.stringify({
        title: "Product Recall Alert: Test Notification",
        body: "Your 6-hour background sync worker and reverse-lookup alert pipeline is active! Deep link test for Canada.ca recall #82848.",
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-192x192.png",
        tag: `recall-test-${Date.now()}`,
        data: {
          url: "/recalls/82848",
          recallId: "82848",
          timestamp: Date.now()
        }
      });
      let sentCount = 0;
      for (const sub of subs) {
        try {
          await webpush2.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            payload,
            { TTL: 60 }
          );
          sentCount++;
        } catch (pushErr) {
          if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
            pipelineStore.removePushSubscription(sub.endpoint);
          }
        }
      }
      return sendJson(res, 200, {
        success: true,
        sentCount,
        message: `Dispatched test push notification to ${sentCount} device(s)`
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (url.startsWith("/api/watchlist") && method === "GET") {
    const parsedUrl = new URL(url, "http://localhost");
    const userId = parsedUrl.searchParams.get("userId") || "default_user";
    const list = pipelineStore.getWatchlist(userId);
    return sendJson(res, 200, { watchlist: list });
  }
  if (url === "/api/watchlist" && method === "POST") {
    try {
      const body = await parseJsonBody(req);
      if (!body.productName && !body.upcBarcode && !body.modelNumber) {
        return sendJson(res, 400, {
          error: "At least one of productName, upcBarcode, or modelNumber is required."
        });
      }
      const item = pipelineStore.addToWatchlist({
        userId: body.userId || "default_user",
        productName: (body.productName || "Product").trim(),
        brand: (body.brand || "").trim(),
        modelNumber: (body.modelNumber || "").trim() || void 0,
        upcBarcode: (body.upcBarcode || "").trim() || void 0,
        keywords: Array.isArray(body.keywords) ? body.keywords : void 0,
        notes: body.notes
      });
      return sendJson(res, 201, { success: true, item });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (url.startsWith("/api/watchlist/") && method === "DELETE") {
    const id = url.replace("/api/watchlist/", "").split("?")[0];
    const removed = pipelineStore.removeFromWatchlist(id);
    return sendJson(res, 200, { success: removed });
  }
  if (url.startsWith("/api/notifications") && method === "GET") {
    const parsedUrl = new URL(url, "http://localhost");
    const userId = parsedUrl.searchParams.get("userId") || "default_user";
    const notifications = pipelineStore.getNotificationHistory(userId);
    return sendJson(res, 200, { notifications });
  }
  if (url === "/api/sync/status" && method === "GET") {
    const state = pipelineStore.getWorkerState();
    const processedCount = pipelineStore.getProcessedCount();
    const watchlistCount = pipelineStore.getWatchlist().length;
    const subscriptionsCount = pipelineStore.getAllActivePushSubscriptions().length;
    return sendJson(res, 200, {
      ...state,
      processedRecallsCount: processedCount,
      watchlistCount,
      activePushSubscriptionsCount: subscriptionsCount
    });
  }
  if (url === "/api/sync/trigger" && method === "POST") {
    try {
      const body = await parseJsonBody(req);
      console.log("[API] Manual sync trigger requested...");
      const summary = await runSyncPipeline({
        forceAll: Boolean(body.forceAll),
        windowHours: body.windowHours ? Number(body.windowHours) : void 0,
        bypassDeduplication: Boolean(body.bypassDeduplication)
      });
      return sendJson(res, 200, { success: true, summary });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  return next();
}

// src/server/worker.ts
import path6 from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
import dotenv4 from "dotenv";
import cron from "node-cron";
var __filename4 = fileURLToPath4(import.meta.url);
var __dirname4 = path6.dirname(__filename4);
dotenv4.config({ path: path6.resolve(__dirname4, "../.env") });
var SIX_HOURS_CRON = "0 */6 * * *";
var scheduledTask = null;
function startSyncWorker(options = {}) {
  initVapid();
  console.log(`[SyncWorker] Initializing 6-hour background sync worker (cron: '${SIX_HOURS_CRON}')...`);
  const state = pipelineStore.getWorkerState();
  const nextRun = Date.now() + 6 * 60 * 60 * 1e3;
  pipelineStore.updateWorkerState({
    cronExpression: SIX_HOURS_CRON,
    nextRunAt: nextRun
  });
  if (options.runOnStartupIfDue !== false) {
    const lastRun = state.lastRunAt;
    const sixHoursMs = 6 * 60 * 60 * 1e3;
    if (!lastRun || Date.now() - lastRun >= sixHoursMs) {
      console.log(`[SyncWorker] Initial sync is due (last run: ${lastRun ? new Date(lastRun).toISOString() : "Never"}). Triggering initial sync run...`);
      runSyncPipeline().catch((err) => {
        console.error("[SyncWorker] Error during initial startup sync:", err);
      });
    }
  }
  scheduledTask = cron.schedule(
    SIX_HOURS_CRON,
    async () => {
      console.log(`[SyncWorker] Cron trigger activated ('${SIX_HOURS_CRON}'). Executing scheduled 6-hour sync...`);
      try {
        await runSyncPipeline();
      } catch (err) {
        console.error("[SyncWorker] Scheduled 6-hour sync failed:", err);
      }
    },
    {
      timezone: "America/Toronto"
      // Standard Canadian Health Canada time zone
    }
  );
  console.log(`[SyncWorker] Background sync scheduled. Next estimated execution in ~6 hours.`);
  return {
    stop: () => {
      if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        console.log("[SyncWorker] 6-hour sync worker stopped.");
      }
    },
    task: scheduledTask
  };
}
var isMain = (process.argv[1]?.endsWith("worker.ts") || process.argv[1]?.endsWith("worker.js") || process.argv[1]?.endsWith("worker.mjs")) && !process.argv[1]?.includes("server");
if (isMain) {
  const args = process.argv.slice(2);
  const isRunOnce = args.includes("--run-once") || args.includes("-1");
  const isForceAll = args.includes("--force-all");
  const windowArg = args.find((a) => a.startsWith("--window-hours="));
  const customWindowHours = windowArg ? parseInt(windowArg.split("=")[1], 10) : void 0;
  console.log("=".repeat(70));
  console.log("\u{1F1E8}\u{1F1E6} Health Canada 6-Hour Background Sync & Web Push Notification Worker");
  console.log("=".repeat(70));
  if (isRunOnce) {
    console.log("[CLI] Running single sync cycle and exiting (--run-once)...");
    runSyncPipeline({
      forceAll: isForceAll,
      windowHours: customWindowHours
    }).then((summary) => {
      console.log("[CLI] Sync completed successfully:", JSON.stringify(summary, null, 2));
      process.exit(0);
    }).catch((err) => {
      console.error("[CLI] Sync failed:", err);
      process.exit(1);
    });
  } else {
    console.log("[CLI] Starting daemon in background mode with cron: 0 */6 * * *");
    const worker = startSyncWorker({ runOnStartupIfDue: true });
    const shutdown = () => {
      console.log("\n[CLI] Received termination signal. Shutting down worker...");
      worker.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

// server.ts
var __filename5 = fileURLToPath5(import.meta.url);
var __dirname5 = path7.dirname(__filename5);
dotenv5.config({ path: path7.resolve(__dirname5, "../.env") });
dotenv5.config({ path: path7.resolve(process.cwd(), "../.env") });
dotenv5.config({ path: path7.resolve(process.cwd(), ".env") });
var PORT = parseInt(process.env.PORT || "3000", 10);
var HOST = process.env.HOST || "0.0.0.0";
var DIST_DIR = fs5.existsSync(path7.resolve(__dirname5, "dist")) ? path7.resolve(__dirname5, "dist") : path7.resolve(__dirname5, "../dist");
var DATA_DIR2 = path7.resolve(process.cwd(), "data");
var RECALLS_CACHE_FILE = path7.join(DATA_DIR2, "recalls-cache.json");
var INITIAL_BUNDLED_FILE = fs5.existsSync(path7.resolve(process.cwd(), "public/data/initial-recalls.json")) ? path7.resolve(process.cwd(), "public/data/initial-recalls.json") : path7.resolve(__dirname5, "../public/data/initial-recalls.json");
var cachedRecallsBuffer = null;
var lastCacheFetchTime = 0;
var CACHE_TTL_MS = 30 * 60 * 1e3;
function getLocalFallbackRecalls() {
  try {
    if (fs5.existsSync(RECALLS_CACHE_FILE)) {
      return fs5.readFileSync(RECALLS_CACHE_FILE);
    }
    if (fs5.existsSync(INITIAL_BUNDLED_FILE)) {
      return fs5.readFileSync(INITIAL_BUNDLED_FILE);
    }
    const distBundled = path7.join(DIST_DIR, "data/initial-recalls.json");
    if (fs5.existsSync(distBundled)) {
      return fs5.readFileSync(distBundled);
    }
  } catch (err) {
    console.warn("[Server] Error reading local fallback recalls:", err);
  }
  return null;
}
async function refreshRecallsFeed() {
  const targetUrl = "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2e4);
    const upstream = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "CanadaRecallAlert-Backend/1.0"
      }
    });
    clearTimeout(timeout);
    if (upstream.ok) {
      const arrayBuf = await upstream.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      if (buf.length > 1e3) {
        cachedRecallsBuffer = buf;
        lastCacheFetchTime = Date.now();
        if (!fs5.existsSync(DATA_DIR2)) {
          fs5.mkdirSync(DATA_DIR2, { recursive: true });
        }
        fs5.writeFile(RECALLS_CACHE_FILE, buf, (err) => {
          if (err) console.warn("[Server] Could not persist recalls cache:", err.message);
        });
        console.log(`[Server] Cached Health Canada recalls feed (${(buf.length / 1024 / 1024).toFixed(1)} MB).`);
        return buf;
      }
    }
  } catch (err) {
    console.warn("[Server] Background refresh of recalls feed failed:", err.message);
  }
  return null;
}
var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
var server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";
  if (url.startsWith("/api/")) {
    if (url.startsWith("/api/recalls")) {
      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        });
        return res.end();
      }
      const isCacheFresh = cachedRecallsBuffer && Date.now() - lastCacheFetchTime < CACHE_TTL_MS;
      if (isCacheFresh && cachedRecallsBuffer) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=1800"
        });
        return res.end(cachedRecallsBuffer);
      }
      if (!cachedRecallsBuffer) {
        cachedRecallsBuffer = getLocalFallbackRecalls();
      }
      if (cachedRecallsBuffer) {
        if (Date.now() - lastCacheFetchTime >= CACHE_TTL_MS) {
          refreshRecallsFeed();
        }
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=1800"
        });
        return res.end(cachedRecallsBuffer);
      }
      try {
        const freshBuf = await refreshRecallsFeed();
        if (freshBuf) {
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=1800"
          });
          return res.end(freshBuf);
        }
      } catch (err) {
      }
      res.writeHead(502, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      return res.end(JSON.stringify({ error: "Proxy fetch failed", message: "Unable to load recall data feed" }));
    }
    return handlePipelineApiRequest(req, res, () => {
      res.writeHead(404, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ error: "Endpoint not found" }));
    });
  }
  const cleanPath = url.split("?")[0];
  let filePath = path7.join(DIST_DIR, cleanPath === "/" ? "index.html" : cleanPath);
  if (!fs5.existsSync(filePath) || fs5.statSync(filePath).isDirectory()) {
    filePath = path7.join(DIST_DIR, "index.html");
  }
  if (fs5.existsSync(filePath)) {
    const ext = path7.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable"
    });
    fs5.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Canada Recall Alert</h1><p>Building or static files not found. Run <code>npm run build</code>.</p>");
  }
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[Server] Error: Port ${PORT} is already in use by another process.`);
  } else if (err.code === "EACCES") {
    console.error(`[Server] Error: Permission denied on ${HOST}:${PORT}.`);
  } else {
    console.error("[Server] Server error:", err);
  }
});
server.listen(PORT, HOST, () => {
  console.log(`[Server] Canada Recall Alert production server running on http://${HOST}:${PORT}`);
  console.log(`[Server] Environment loaded from: ${fs5.existsSync(path7.resolve(__dirname5, "../.env")) ? path7.resolve(__dirname5, "../.env") : "current directory"}`);
  refreshRecallsFeed();
  try {
    startSyncWorker({ runOnStartupIfDue: false });
  } catch (err) {
    console.warn("[Server] Could not start sync worker:", err);
  }
});
