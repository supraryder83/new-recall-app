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
  modelOrLot?: string;
  modelOrBatchNumber?: string;
  searchKeywords?: string;
  detectedCategory?: string;
  upcOrCode?: string;
  confidenceNotes?: string;
}

export interface ScanMatchResult {
  verdict: 'MATCH_FOUND' | 'NO_RECALL_FOUND' | 'POSSIBLE_MATCH';
  query: string;
  searchType: 'barcode' | 'vision';
  identifiedTitle?: string;
  searchKeywords?: string;
  extractedInfo?: GeminiExtractionResult;
  matchedRecalls: RecallItem[];
  matchReason?: string;
}

export interface DatasetSyncState {
  status: 'idle' | 'loading' | 'cached' | 'error';
  lastSynced: number | null;
  totalRecords: number;
  source: 'live' | 'proxy' | 'indexeddb' | 'bundled';
  errorMessage?: string;
}
