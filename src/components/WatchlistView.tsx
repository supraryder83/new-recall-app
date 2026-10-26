import React, { useState, useEffect, useCallback } from 'react';
import {
  BookmarkCheck,
  Plus,
  Trash2,
  RefreshCw,
  Barcode,
  Search,
  CheckCircle2,
  AlertTriangle,
  Bell,
  Clock,
  Sparkles,
  ExternalLink,
  Tag,
  ShieldAlert
} from 'lucide-react';
import type { WatchlistItem, NotificationHistoryRecord, PipelineSyncSummary } from '../types/pipeline';
import type { RecallItem } from '../types/recall';
import {
  fetchWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  fetchNotificationHistory,
  triggerManualSync
} from '../services/pipelineClient';

interface WatchlistViewProps {
  onSelectRecall: (recall: RecallItem) => void;
  allRecalls: RecallItem[];
}

export const WatchlistView: React.FC<WatchlistViewProps> = ({ onSelectRecall, allRecalls }) => {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<PipelineSyncSummary | null>(null);

  // Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newUpc, setNewUpc] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [activeTab, setActiveTab] = useState<'items' | 'notifications'>('items');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [wList, nList] = await Promise.all([fetchWatchlist(), fetchNotificationHistory()]);
      setWatchlist(wList);
      setNotifications(nList);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim() && !newUpc.trim() && !newModel.trim()) return;

    const keywords = newKeywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    const created = await addWatchlistItem({
      productName: newProductName.trim() || 'Watched Product',
      brand: newBrand.trim(),
      modelNumber: newModel.trim() || undefined,
      upcBarcode: newUpc.trim() || undefined,
      keywords: keywords.length > 0 ? keywords : undefined
    });

    if (created) {
      setWatchlist((prev) => [created, ...prev]);
      setIsAddModalOpen(false);
      setNewProductName('');
      setNewBrand('');
      setNewModel('');
      setNewUpc('');
      setNewKeywords('');
    }
  };

  const handleDeleteItem = async (id: string) => {
    const ok = await removeWatchlistItem(id);
    if (ok) {
      setWatchlist((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const handleTriggerSync = async () => {
    setIsSyncing(true);
    setSyncSummary(null);
    try {
      const res = await triggerManualSync({ forceAll: true });
      if (res.success && res.summary) {
        setSyncSummary(res.summary);
      }
      await loadData();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenRecallDetails = (recallNid: string) => {
    const found = allRecalls.find((r) => r.NID === recallNid);
    if (found) {
      onSelectRecall(found);
    } else {
      // Create minimal fallback
      onSelectRecall({
        NID: recallNid,
        Title: `Recall #${recallNid}`,
        URL: `https://recalls-rappels.canada.ca/en/alert-recall/${recallNid}`,
        Organization: 'Health Canada',
        Product: 'Watched product item',
        Issue: 'Safety Hazard',
        'What you should do': 'Verify product details',
        Category: 'General',
        'Recall class': 'Class 1',
        'Last updated': new Date().toISOString().slice(0, 10),
        Archived: '0'
      });
    }
  };

  return (
    <div className="space-y-6 text-left animate-in fade-in duration-200">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 tracking-tight">
              Product Watchlist
            </h2>
            <span className="bg-red-50 text-red-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-red-200">
              6h Auto-Check
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-500 mt-0.5">
            Automatic reverse-lookup alerts via Web Push when Health Canada issues matching recalls.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTriggerSync}
            disabled={isSyncing}
            className="py-2 px-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-red-600' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Check Watchlist Now'}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="py-2 px-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm shadow-red-600/25 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Sync Summary Result Banner if just triggered */}
      {syncSummary && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-xs space-y-1 animate-in fade-in">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Watchlist Check Completed in {syncSummary.durationMs}ms</span>
          </div>
          <p className="text-emerald-700">
            Ingested: {syncSummary.recordsIngested} | Matches found: {syncSummary.userMatchesFound} | Web Push Dispatched:{' '}
            {syncSummary.pushNotificationsDispatched} | Subscriptions Pruned: {syncSummary.pushSubscriptionsPruned}
          </p>
        </div>
      )}

      {/* Sub-tabs: Watchlist Items vs Notification History */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('items')}
          className={`pb-2.5 px-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'items'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookmarkCheck className="w-4 h-4" />
          <span>Watched Products ({watchlist.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('notifications')}
          className={`pb-2.5 px-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'notifications'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Pushed Recall Alerts ({notifications.length})</span>
        </button>
      </div>

      {/* Tab 1: Watchlist Items */}
      {activeTab === 'items' && (
        <div className="space-y-3">
          {watchlist.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
              <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl mx-auto flex items-center justify-center">
                <BookmarkCheck className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm">Your Watchlist is Empty</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Add everyday products, groceries, baby gear, or appliances by UPC barcode, model number, or brand to receive immediate recall alerts.
              </p>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="py-2 px-4 bg-red-600 text-white rounded-xl text-xs font-bold"
              >
                Add Your First Product
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {watchlist.map((item) => (
                <div
                  key={item.id}
                  className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {item.brand && (
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-red-600 bg-red-50 px-2 py-0.5 rounded-md">
                            {item.brand}
                          </span>
                        )}
                        <h4 className="font-extrabold text-sm text-slate-900 mt-1 line-clamp-2">
                          {item.productName}
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                        title="Delete from Watchlist"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Identifiers */}
                    <div className="space-y-1 text-[11px] text-slate-600">
                      {item.upcBarcode && (
                        <div className="flex items-center gap-1.5 font-mono">
                          <Barcode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>UPC: {item.upcBarcode}</span>
                        </div>
                      )}
                      {item.modelNumber && (
                        <div className="flex items-center gap-1.5 font-mono">
                          <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>Model: {item.modelNumber}</span>
                        </div>
                      )}
                      {item.keywords && item.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {item.keywords.map((kw, i) => (
                            <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded">
                              #{kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status & actions */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    {item.lastMatchNid ? (
                      <button
                        type="button"
                        onClick={() => handleOpenRecallDetails(item.lastMatchNid!)}
                        className="text-red-600 font-bold hover:underline flex items-center gap-1"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Recall #{item.lastMatchNid}</span>
                      </button>
                    ) : (
                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Active Monitoring</span>
                      </span>
                    )}

                    <span className="text-slate-400">
                      {new Date(item.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Notification History */}
      {activeTab === 'notifications' && (
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-500 text-xs">
              No recall push notifications sent yet. You will see alerts logged here when matches occur.
            </div>
          ) : (
            <div className="space-y-2.5">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className="p-4 bg-white rounded-2xl border border-red-100 shadow-2xs hover:border-red-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="p-1 bg-red-100 text-red-700 rounded-md">
                        <ShieldAlert className="w-3.5 h-3.5" />
                      </span>
                      <h4 className="font-extrabold text-sm text-slate-900">{notif.title}</h4>
                      <span className="text-[10px] bg-slate-100 text-slate-600 font-mono px-1.5 py-0.5 rounded uppercase">
                        {notif.matchType} ({notif.matchScore}%)
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">{notif.body}</p>
                    <div className="text-[10px] text-slate-400 flex items-center gap-3">
                      <span>Sent: {new Date(notif.sentAt).toLocaleString()}</span>
                      <span>Product: {notif.productName}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenRecallDetails(notif.recallNid)}
                    className="py-1.5 px-3 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-bold transition-colors shrink-0 flex items-center justify-center gap-1"
                  >
                    <span>View Recall #{notif.recallNid}</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: Add Product to Watchlist */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-red-50 text-red-600 rounded-xl">
                  <BookmarkCheck className="w-5 h-5" />
                </div>
                <h3 className="font-extrabold text-lg text-slate-900">Add to Watchlist</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              The 6-hour background sync worker will query Health Canada safety feeds and dispatch Web Push notifications if a recall affects these identifiers.
            </p>

            <form onSubmit={handleAddItem} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Product Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Jack'd Up Crispy Protein Bites"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Brand</label>
                  <input
                    type="text"
                    placeholder="e.g. Plantropy"
                    value={newBrand}
                    onChange={(e) => setNewBrand(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Model / Part #</label>
                  <input
                    type="text"
                    placeholder="e.g. JAL-100 or CI1012"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">UPC / Barcode (Exact Match)</label>
                <input
                  type="text"
                  placeholder="e.g. 065633458921 (8 to 14 digits)"
                  value={newUpc}
                  onChange={(e) => setNewUpc(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Distinctive Keywords</label>
                <input
                  type="text"
                  placeholder="e.g. jalapeno, protein bites (comma separated)"
                  value={newKeywords}
                  onChange={(e) => setNewKeywords(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-hidden"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="py-2 px-3.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 text-xs font-extrabold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs"
                >
                  Save to Watchlist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
