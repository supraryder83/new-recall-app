import type { RecallItem } from '../types/recall';

const DB_NAME = 'CanadaRecallDB_v2';
const DB_VERSION = 1;
const STORE_DATA = 'app_data';

export interface StorageMetadata {
  lastSynced: number | null;
  count: number;
  source: 'live' | 'proxy' | 'indexeddb' | 'bundled' | 'none';
}

class FastRecallStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private inMemoryCache: RecallItem[] | null = null;
  private inMemoryMeta: StorageMetadata | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB is not supported'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_DATA)) {
          db.createObjectStore(STORE_DATA, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  /**
   * Save entire recalls dataset in 1 single high-speed transaction
   */
  async saveRecalls(recalls: RecallItem[], source: 'live' | 'proxy' | 'bundled'): Promise<void> {
    this.inMemoryCache = recalls;
    this.inMemoryMeta = {
      lastSynced: Date.now(),
      count: recalls.length,
      source
    };

    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_DATA, 'readwrite');
      const store = tx.objectStore(STORE_DATA);

      store.put({
        key: 'dataset_bundle',
        data: recalls,
        timestamp: Date.now(),
        source
      });

      store.put({
        key: 'meta',
        lastSynced: Date.now(),
        count: recalls.length,
        source
      });

      return new Promise((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve(); // Don't crash if IndexedDB storage error
      });
    } catch (err) {
      console.warn('Fast storage write warning:', err);
    }
  }

  /**
   * Get all recalls instantly from RAM or single-key IndexedDB fetch (< 15ms)
   */
  async getAllRecalls(): Promise<RecallItem[]> {
    if (this.inMemoryCache && this.inMemoryCache.length > 0) {
      return this.inMemoryCache;
    }

    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_DATA, 'readonly');
        const store = tx.objectStore(STORE_DATA);
        const req = store.get('dataset_bundle');

        req.onsuccess = () => {
          if (req.result && Array.isArray(req.result.data) && req.result.data.length > 0) {
            // Upgrade legacy truncated 1,200 cache to the full 34,000+ Canadian recall dataset
            if (req.result.data.length <= 1200) {
              console.log('Legacy 1,200 cache detected in IndexedDB. Upgrading to full Canadian dataset.');
              resolve([]);
              return;
            }
            this.inMemoryCache = req.result.data;
            this.inMemoryMeta = {
              lastSynced: req.result.timestamp || null,
              count: req.result.data.length,
              source: req.result.source || 'indexeddb'
            };
            resolve(req.result.data);
          } else {
            resolve([]);
          }
        };

        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  /**
   * Fast metadata fetch
   */
  async getMetadata(): Promise<StorageMetadata> {
    if (this.inMemoryMeta) {
      return this.inMemoryMeta;
    }

    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_DATA, 'readonly');
        const store = tx.objectStore(STORE_DATA);
        const req = store.get('meta');

        req.onsuccess = () => {
          if (req.result) {
            this.inMemoryMeta = {
              lastSynced: req.result.lastSynced || null,
              count: req.result.count || 0,
              source: req.result.source || 'none'
            };
            resolve(this.inMemoryMeta);
          } else {
            resolve({ lastSynced: null, count: 0, source: 'none' });
          }
        };

        req.onerror = () => resolve({ lastSynced: null, count: 0, source: 'none' });
      });
    } catch {
      return { lastSynced: null, count: 0, source: 'none' };
    }
  }

  /**
   * Clear cache
   */
  async clear(): Promise<void> {
    this.inMemoryCache = null;
    this.inMemoryMeta = null;
    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_DATA, 'readwrite');
      tx.objectStore(STORE_DATA).clear();
    } catch (e) {
      console.warn('Failed to clear storage:', e);
    }
  }
}

export const recallStorage = new FastRecallStorageService();
