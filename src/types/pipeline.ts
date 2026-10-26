import type { RecallItem } from './recall';

export interface ProcessedRecallRecord {
  id: string;
  recallNid: string;
  title: string;
  category: string;
  publicationDate: string; // YYYY-MM-DD or ISO
  publicationTimestamp: number;
  url: string;
  processedAt: number;
  hash?: string;
}

export interface WatchlistItem {
  id: string;
  userId: string;
  productName: string;
  brand: string;
  modelNumber?: string;
  upcBarcode?: string;
  lotCode?: string;
  keywords?: string[];
  notes?: string;
  createdAt: number;
  updatedAt?: number;
  lastCheckedAt?: number;
  lastMatchNid?: string;
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface UserPushSubscription {
  userId: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  expirationTime?: number | null;
  active: boolean;
  userAgent?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationHistoryRecord {
  id: string;
  userId: string;
  recallNid: string;
  productName: string;
  title: string;
  body: string;
  deepLink: string; // e.g. '/recalls/:id'
  matchType: 'upc' | 'model' | 'brand_keyword';
  matchScore: number;
  sentAt: number;
  status: 'sent' | 'failed' | 'expired';
  error?: string;
}

export interface NormalizedRecall {
  recallId: string; // NID
  title: string;
  category: string;
  publicationDate: string;
  publicationTimestamp: number;
  url: string;
  organization: string;
  rawItem: RecallItem;

  // Normalized entities for high-speed indexing (lowercase, alphanumeric)
  normalizedBrand: string;
  brandTokens: string[];
  normalizedProduct: string;
  productTokens: string[];

  // Extracted identification keys
  upcs: string[];          // Extracted UPCs/barcodes (e.g. ['065633458921'])
  modelNumbers: string[];  // Extracted models (e.g. ['ci1012', 'jkmax'])
  lotCodes: string[];      // Extracted lot / batch codes

  // Full normalized searchable string
  searchIndexText: string;
}

export interface MatchEvaluation {
  watchItem: WatchlistItem;
  recall: NormalizedRecall;
  matchType: 'upc' | 'model' | 'brand_keyword';
  score: number;
  reason: string;
}

export interface UserMatchGroup {
  userId: string;
  matches: MatchEvaluation[];
}

export interface PipelineSyncSummary {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  recordsQueried: number;
  recordsWithinWindow: number;
  recordsSkippedDeduplicated: number;
  recordsIngested: number;
  usersEvaluated: number;
  userMatchesFound: number;
  pushNotificationsDispatched: number;
  pushSubscriptionsPruned: number;
  errors: string[];
  status: 'success' | 'partial' | 'error';
}

export interface SyncWorkerState {
  cronExpression: string; // '0 */6 * * *'
  isRunning: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  totalRuns: number;
  lastSummary: PipelineSyncSummary | null;
}
