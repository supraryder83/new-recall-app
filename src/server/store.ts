import fs from 'node:fs';
import path from 'node:path';
import type {
  ProcessedRecallRecord,
  WatchlistItem,
  UserPushSubscription,
  NotificationHistoryRecord,
  SyncWorkerState,
  PipelineSyncSummary
} from '../types/pipeline';

interface StoreData {
  processedRecalls: Record<string, ProcessedRecallRecord>;
  watchlist: WatchlistItem[];
  pushSubscriptions: UserPushSubscription[];
  notificationHistory: NotificationHistoryRecord[];
  workerState: SyncWorkerState;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'pipeline-store.json');

const INITIAL_WORKER_STATE: SyncWorkerState = {
  cronExpression: '0 */6 * * *',
  isRunning: false,
  lastRunAt: null,
  nextRunAt: null,
  totalRuns: 0,
  lastSummary: null
};

// Seed sample watchlist items if fresh install, so reverse-lookup and notifications can be verified immediately
const INITIAL_WATCHLIST_SEEDS: WatchlistItem[] = [
  {
    id: 'watch_sample_1',
    userId: 'default_user',
    productName: "Plantropy Jack'd Up Bites Crispy Protein Bites - Jalapeno",
    brand: 'Plantropy',
    modelNumber: 'JAL-100',
    upcBarcode: '065633458921',
    keywords: ['plantropy', 'jackd', 'protein', 'bites', 'jalapeno'],
    notes: 'Sample food item for reverse-lookup testing',
    createdAt: Date.now() - 86400000
  },
  {
    id: 'watch_sample_2',
    userId: 'default_user',
    productName: 'JKMAX Heated Blankets and Heating Pads',
    brand: 'JKMAX',
    modelNumber: 'JK-2026',
    keywords: ['jkmax', 'heated', 'blanket', 'heating', 'pad'],
    notes: 'Sample consumer product for model number matching',
    createdAt: Date.now() - 86400000
  },
  {
    id: 'watch_sample_3',
    userId: 'default_user',
    productName: 'Cochlear Implant Receiver',
    brand: 'Cochlear',
    modelNumber: 'CI1012',
    keywords: ['cochlear', 'implant'],
    notes: 'Sample medical device for exact model substring matching',
    createdAt: Date.now() - 86400000
  }
];

export class PipelineStore {
  private data: StoreData;
  private filePath: string;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(customPath?: string) {
    this.filePath = customPath || STORE_FILE;
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
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
      console.warn('[PipelineStore] Error loading store file, initializing fresh store:', err);
    }

    const fresh: StoreData = {
      processedRecalls: {},
      watchlist: INITIAL_WATCHLIST_SEEDS,
      pushSubscriptions: [],
      notificationHistory: [],
      workerState: INITIAL_WORKER_STATE
    };
    this.saveImmediate(fresh);
    return fresh;
  }

  private scheduleSave(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.saveImmediate(this.data);
    }, 50);
  }

  public flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.saveImmediate(this.data);
  }

  private saveImmediate(dataToSave: StoreData): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpFile = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpFile, JSON.stringify(dataToSave, null, 2), 'utf8');
      fs.renameSync(tmpFile, this.filePath);
    } catch (err) {
      console.error('[PipelineStore] Failed to persist data to disk:', err);
    }
  }

  // ==================== PROCESSED RECALLS ====================

  isRecallProcessed(recallNid: string): boolean {
    return Boolean(this.data.processedRecalls[recallNid]);
  }

  getProcessedRecall(recallNid: string): ProcessedRecallRecord | undefined {
    return this.data.processedRecalls[recallNid];
  }

  markRecallProcessed(record: ProcessedRecallRecord): void {
    this.data.processedRecalls[record.recallNid] = record;
    this.scheduleSave();
  }

  markRecallsProcessedBatch(records: ProcessedRecallRecord[]): void {
    for (const rec of records) {
      this.data.processedRecalls[rec.recallNid] = rec;
    }
    this.flush();
  }

  getProcessedCount(): number {
    return Object.keys(this.data.processedRecalls).length;
  }

  getAllProcessedRecalls(): ProcessedRecallRecord[] {
    return Object.values(this.data.processedRecalls);
  }

  clearProcessedRecalls(): void {
    this.data.processedRecalls = {};
    this.scheduleSave();
  }

  // ==================== USER WATCHLIST ====================

  getWatchlist(userId?: string): WatchlistItem[] {
    if (!userId) return this.data.watchlist;
    return this.data.watchlist.filter((item) => item.userId === userId);
  }

  getWatchlistItem(id: string): WatchlistItem | undefined {
    return this.data.watchlist.find((item) => item.id === id);
  }

  addToWatchlist(item: Omit<WatchlistItem, 'id' | 'createdAt'> & { id?: string }): WatchlistItem {
    const id = item.id || `watch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newItem: WatchlistItem = {
      ...item,
      id,
      createdAt: Date.now()
    };
    this.data.watchlist = [newItem, ...this.data.watchlist.filter((w) => w.id !== id)];
    this.scheduleSave();
    return newItem;
  }

  removeFromWatchlist(id: string): boolean {
    const beforeCount = this.data.watchlist.length;
    this.data.watchlist = this.data.watchlist.filter((w) => w.id !== id);
    const removed = this.data.watchlist.length < beforeCount;
    if (removed) this.scheduleSave();
    return removed;
  }

  updateWatchlistItem(id: string, updates: Partial<WatchlistItem>): WatchlistItem | null {
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

  savePushSubscription(sub: Omit<UserPushSubscription, 'createdAt' | 'updatedAt'>): UserPushSubscription {
    const existingIndex = this.data.pushSubscriptions.findIndex((s) => s.endpoint === sub.endpoint);
    const now = Date.now();
    let saved: UserPushSubscription;

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

  getPushSubscriptionsForUser(userId: string): UserPushSubscription[] {
    return this.data.pushSubscriptions.filter((s) => s.userId === userId && s.active);
  }

  getAllActivePushSubscriptions(): UserPushSubscription[] {
    return this.data.pushSubscriptions.filter((s) => s.active);
  }

  removePushSubscription(endpoint: string): boolean {
    const initialLen = this.data.pushSubscriptions.length;
    this.data.pushSubscriptions = this.data.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
    const removed = this.data.pushSubscriptions.length < initialLen;
    if (removed) {
      this.scheduleSave();
    }
    return removed;
  }

  // ==================== NOTIFICATION HISTORY ====================

  recordNotificationHistory(record: Omit<NotificationHistoryRecord, 'id' | 'sentAt'> & { id?: string }): NotificationHistoryRecord {
    const id = record.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullRecord: NotificationHistoryRecord = {
      ...record,
      id,
      sentAt: Date.now()
    };
    // Keep top 2000 records
    this.data.notificationHistory = [fullRecord, ...this.data.notificationHistory].slice(0, 2000);
    this.scheduleSave();
    return fullRecord;
  }

  getNotificationHistory(userId?: string): NotificationHistoryRecord[] {
    if (!userId) return this.data.notificationHistory;
    return this.data.notificationHistory.filter((n) => n.userId === userId);
  }

  hasUserBeenNotifiedForRecall(userId: string, recallNid: string): boolean {
    return this.data.notificationHistory.some(
      (n) => n.userId === userId && n.recallNid === recallNid && n.status === 'sent'
    );
  }

  // ==================== WORKER STATE ====================

  getWorkerState(): SyncWorkerState {
    return { ...this.data.workerState };
  }

  updateWorkerState(updates: Partial<SyncWorkerState>): void {
    this.data.workerState = {
      ...this.data.workerState,
      ...updates
    };
    this.scheduleSave();
  }

  recordRunSummary(summary: PipelineSyncSummary): void {
    this.data.workerState = {
      ...this.data.workerState,
      isRunning: false,
      lastRunAt: summary.finishedAt,
      nextRunAt: summary.finishedAt + 6 * 60 * 60 * 1000,
      totalRuns: this.data.workerState.totalRuns + 1,
      lastSummary: summary
    };
    this.flush();
  }

  /**
   * Reset entire store to initial state (useful for tests)
   */
  reset(): void {
    this.data = {
      processedRecalls: {},
      watchlist: INITIAL_WATCHLIST_SEEDS,
      pushSubscriptions: [],
      notificationHistory: [],
      workerState: INITIAL_WORKER_STATE
    };
    this.saveImmediate(this.data);
  }
}

// Global singleton instance
export const pipelineStore = new PipelineStore();
