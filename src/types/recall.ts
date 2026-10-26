export interface RecallItem {
  NID: string;
  Title: string;
  URL: string;
  Organization: string;
  Product: string;
  Issue: string;
  'What you should do': string;
  Category: string;
  'Recall class': string;
  'Last updated': string;
  Archived: string;
}

export type CategoryFilter = 'ALL' | 'FOOD' | 'CONSUMER' | 'HEALTH' | 'VEHICLES';

export interface CategoryDefinition {
  id: CategoryFilter;
  label: string;
  shortLabel: string;
  iconName: string;
  color: string;
  accentColor: string;
  match: (item: RecallItem) => boolean;
}

export interface GeminiExtractionResult {
  brand: string;
  productName: string;
  category: string;
  flavorOrVariant?: string;
  packageSize?: string;
  modelOrLot?: string;
  modelOrBatchNumber?: string;
  serialNumber?: string;
  searchKeywords?: string;
  detectedCategory?: string;
  upcOrCode?: string;
  confidenceNotes?: string;
  isSpecificProduct?: boolean;
}

export interface ScanMatchResult {
  verdict: 'MATCH_FOUND' | 'NO_RECALL_FOUND' | 'POSSIBLE_MATCH';
  query: string;
  searchType: 'camera' | 'vision' | 'barcode';
  identifiedTitle?: string;
  searchKeywords?: string;
  extractedInfo?: GeminiExtractionResult;
  itemImage?: string;
  tagImage?: string;
  matchedRecalls: RecallItem[]; // Exact product matches only
  similarProductRecalls?: RecallItem[]; // Recalls for similar variations/models
  relatedBrandRecalls?: RecallItem[]; // Recalls for other products from the same brand
  matchReason?: string;
  matchScore?: number;
}

export interface DatasetSyncState {
  status: 'idle' | 'loading' | 'cached' | 'error';
  lastSynced: number | null;
  totalRecords: number;
  source: 'live' | 'proxy' | 'indexeddb' | 'bundled';
  errorMessage?: string;
}

export interface ScanHistoryItem {
  id: string;
  timestamp: number;
  imagePreview?: string;
  tagImagePreview?: string;
  identifiedTitle: string;
  verdict: 'MATCH_FOUND' | 'NO_RECALL_FOUND' | 'POSSIBLE_MATCH';
  matchReason?: string;
  matchedRecallsCount: number;
  extractedInfo?: GeminiExtractionResult;
  matchedRecalls?: RecallItem[]; // Exact product matches only
  similarProductRecalls?: RecallItem[];
  relatedBrandRecalls?: RecallItem[];
  searchKeywords?: string;
  lastCheckedAt?: number;
  isNewlyRecalled?: boolean;
}
