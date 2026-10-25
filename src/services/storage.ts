import { RecallItem } from '../types/recall';

const DB_NAME = 'CanadaRecallDB';
const DB_VERSION = 1;
const STORE_RECALLS = 'recalls';
const STORE_META = 'metadata';

class RecallStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this browser'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(STORE_RECALLS)) {
          const recallStore = db.createObjectStore(STORE_RECALLS, { keyPath: 'NID' });
          recallStore.createIndex('by_updated', 'Last updated', { unique: false });
          recallStore.createIndex('by_category', 'Category', { unique: false });
          recallStore.createIndex('by_org', 'Organization', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async saveRecalls(recalls: RecallItem[], source: 'live' | 'proxy' | 'bundled'): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction([STORE_RECALLS, STORE_META], 'readwrite');
      const recallStore = tx.objectStore(STORE_RECALLS);
      const metaStore = tx.objectStore(STORE_META);

      // Clear existing records before batch saving fresh full feed
      recallStore.clear();

      for (const item of recalls) {
        recallStore.put(item);
      }

      metaStore.put({
        key: 'sync_state',
        lastSynced: Date.now(),
        count: recalls.length,
        source
      });

      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('IndexedDB write failed, falling back to localStorage metadata:', err);
      try {
        localStorage.setItem('recalls_last_sync', Date.now().toString());
        localStorage.setItem('recalls_count', recalls.length.toString());
        localStorage.setItem('recalls_source', source);
      } catch (e) {
        // storage full
      }
    }
  }

  async getAllRecalls(): Promise<RecallItem[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_RECALLS, 'readonly');
        const store = tx.objectStore(STORE_RECALLS);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('IndexedDB read failed:', err);
      return [];
    }
  }

  async getMetadata(): Promise<{ lastSynced: number | null; count: number; source: string }> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_META, 'readonly');
        const store = tx.objectStore(STORE_META);
        const request = store.get('sync_state');

        request.onsuccess = () => {
          if (request.result) {
            resolve({
              lastSynced: request.result.lastSynced || null,
              count: request.result.count || 0,
              source: request.result.source || 'indexeddb'
            });
          } else {
            resolve({ lastSynced: null, count: 0, source: 'none' });
          }
        };
        request.onerror = () => resolve({ lastSynced: null, count: 0, source: 'none' });
      });
    } catch {
      const lsTime = localStorage.getItem('recalls_last_sync');
      const lsCount = localStorage.getItem('recalls_count');
      const lsSource = localStorage.getItem('recalls_source');
      return {
        lastSynced: lsTime ? parseInt(lsTime, 10) : null,
        count: lsCount ? parseInt(lsCount, 10) : 0,
        source: lsSource || 'none'
      };
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction([STORE_RECALLS, STORE_META], 'readwrite');
      tx.objectStore(STORE_RECALLS).clear();
      tx.objectStore(STORE_META).clear();
      localStorage.removeItem('recalls_last_sync');
      localStorage.removeItem('recalls_count');
    } catch (e) {
      console.error('Failed to clear database:', e);
    }
  }
}

export const recallStorage = new RecallStorageService();
