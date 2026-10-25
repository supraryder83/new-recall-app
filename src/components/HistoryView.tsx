import React, { useState, useEffect } from 'react';
import {
  History,
  Camera,
  Trash2,
  Search,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
  Tag,
  ArrowRight,
  Clock,
  Download
} from 'lucide-react';
import type { RecallItem, ScanHistoryItem } from '../types/recall';
import { getScanHistory, removeScanFromHistory, clearScanHistory } from '../services/scanHistory';

interface HistoryViewProps {
  onOpenScanner: () => void;
  onApplySearchQuery: (query: string) => void;
  onSelectRecall: (recall: RecallItem) => void;
}

function formatTimestamp(timestamp: number): string {
  try {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return 'Recently';
  }
}

/**
 * Exports scan history list to a formatted CSV file and triggers download
 */
function exportHistoryToCSV(items: ScanHistoryItem[]): void {
  if (!items || items.length === 0) return;

  const headers = [
    'Scan ID',
    'Date & Time',
    'Product Name',
    'Brand',
    'Category',
    'Model or Batch',
    'Recall Verdict',
    'Matched Recalls Count',
    'Match Reason',
    'Search Keywords'
  ];

  const escapeCSV = (value: string | number | undefined | null) => {
    if (value === undefined || value === null) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = items.map((item) => {
    const dateStr = new Date(item.timestamp).toLocaleString();
    const brand = item.extractedInfo?.brand || '';
    const category = item.extractedInfo?.category || '';
    const model = item.extractedInfo?.modelOrLot || item.extractedInfo?.modelOrBatchNumber || '';
    const verdictLabel =
      item.verdict === 'MATCH_FOUND'
        ? 'RECALL FLAGGED'
        : item.verdict === 'POSSIBLE_MATCH'
          ? 'POSSIBLE MATCH'
          : 'SAFE (NO RECALL DETECTED)';

    return [
      escapeCSV(item.id),
      escapeCSV(dateStr),
      escapeCSV(item.identifiedTitle),
      escapeCSV(brand),
      escapeCSV(category),
      escapeCSV(model),
      escapeCSV(verdictLabel),
      escapeCSV(item.matchedRecallsCount || 0),
      escapeCSV(item.matchReason || ''),
      escapeCSV(item.searchKeywords || '')
    ].join(',');
  });

  // Include UTF-8 BOM (\uFEFF) for Excel & Sheets compatibility
  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `canada_recall_scan_history_${dateStamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  onOpenScanner,
  onApplySearchQuery,
  onSelectRecall
}) => {
  const [historyItems, setHistoryItems] = useState<ScanHistoryItem[]>([]);

  // Load history & listen for updates
  useEffect(() => {
    const load = () => {
      setHistoryItems(getScanHistory());
    };
    load();

    const handleUpdate = () => load();
    window.addEventListener('scan-history-updated', handleUpdate);
    return () => {
      window.removeEventListener('scan-history-updated', handleUpdate);
    };
  }, []);

  const handleDeleteItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeScanFromHistory(id);
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear your entire scan history? This action cannot be undone.')) {
      clearScanHistory();
    }
  };

  const handleExport = () => {
    exportHistoryToCSV(historyItems);
  };

  const totalScans = historyItems.length;
  const flaggedRecalls = historyItems.filter((i) => i.verdict === 'MATCH_FOUND').length;
  const safeScans = historyItems.filter((i) => i.verdict === 'NO_RECALL_FOUND').length;

  return (
    <div className="space-y-4 text-left animate-in fade-in duration-200">
      {/* Top Header Card */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 bg-red-50 text-red-600 rounded-xl">
              <History className="w-5 h-5" />
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Product Scan History
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Log of photographed items and Canadian recall verification results
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
          {totalScans > 0 && (
            <>
              {/* Save as CSV */}
              <button
                type="button"
                onClick={handleExport}
                className="px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-all border border-slate-200/80 flex items-center gap-1.5 shadow-2xs active:scale-95"
                title="Download scan history as CSV file"
              >
                <Download className="w-4 h-4 text-slate-600" />
                <span>Save as CSV</span>
              </button>

              {/* Clear History */}
              <button
                type="button"
                onClick={handleClearAll}
                className="px-3.5 py-2.5 text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-xl transition-all border border-red-200/80 flex items-center gap-1.5 shadow-2xs active:scale-95"
                title="Clear entire scan history"
              >
                <Trash2 className="w-4 h-4 text-red-600" />
                <span>Clear History</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onOpenScanner}
            className="flex-1 sm:flex-initial px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 active:scale-95"
          >
            <Camera className="w-4 h-4" />
            <span>Scan Product</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Badges */}
      {totalScans > 0 && (
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Total Scans
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-0.5 block">
              {totalScans}
            </span>
          </div>

          <div className="bg-red-50/70 p-3.5 sm:p-4 rounded-2xl border border-red-200/80 shadow-xs">
            <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider block">
              Recalls Flagged
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-red-700 mt-0.5 block">
              {flaggedRecalls}
            </span>
          </div>

          <div className="bg-emerald-50/70 p-3.5 sm:p-4 rounded-2xl border border-emerald-200/80 shadow-xs">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
              Safe Items
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-emerald-700 mt-0.5 block">
              {safeScans}
            </span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {totalScans === 0 ? (
        <div className="py-16 px-6 text-center bg-white rounded-3xl border border-slate-200/80 space-y-4 shadow-xs">
          <div className="w-16 h-16 mx-auto bg-red-50 text-red-600 rounded-3xl flex items-center justify-center shadow-inner">
            <Camera className="w-8 h-8 animate-pulse-subtle" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="font-extrabold text-lg text-slate-900">No Product Scans Yet</h3>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              When you snap a photo of any grocery item, household product, or vehicle part, Gemini will identify it, check for active Canadian recalls, and save your scan here.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenScanner}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs sm:text-sm font-extrabold transition-all shadow-md shadow-red-600/30 inline-flex items-center gap-2 active:scale-95"
          >
            <Camera className="w-4 h-4" />
            <span>Take Your First Scan</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* History Log Grid */
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Recorded Scans ({totalScans})
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleExport}
                className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs font-bold text-red-600 hover:text-red-700 flex items-center gap-1 hover:underline"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            </div>
          </div>

          {historyItems.map((item) => {
            const isMatch = item.verdict === 'MATCH_FOUND';
            const isPossible = item.verdict === 'POSSIBLE_MATCH';

            return (
              <div
                key={item.id}
                className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 hover:border-slate-300 shadow-xs transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group"
              >
                {/* Left Section: Thumbnail & Identifiers */}
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  {/* Photo Thumbnail or Placeholder */}
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center relative">
                    {item.imagePreview ? (
                      <img
                        src={item.imagePreview}
                        alt={item.identifiedTitle}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="p-2 text-slate-400 flex flex-col items-center">
                        <Tag className="w-6 h-6" />
                        <span className="text-[9px] mt-0.5 font-bold uppercase">Item</span>
                      </div>
                    )}
                  </div>

                  {/* Title & Metadata */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {/* Status Verdict Badge */}
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                          isMatch
                            ? 'bg-red-100 text-red-800 border border-red-200'
                            : isPossible
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {isMatch ? (
                          <ShieldAlert className="w-3 h-3 text-red-600" />
                        ) : isPossible ? (
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                        ) : (
                          <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        )}
                        <span>
                          {isMatch
                            ? 'Recall Flagged'
                            : isPossible
                              ? 'Possible Match'
                              : 'No Recall Found'}
                        </span>
                      </span>

                      {/* Extracted Category */}
                      {item.extractedInfo?.category && (
                        <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                          {item.extractedInfo.category}
                        </span>
                      )}

                      {/* Time ago */}
                      <span className="text-[10px] text-slate-400 flex items-center gap-1 ml-auto">
                        <Clock className="w-3 h-3" />
                        {formatTimestamp(item.timestamp)}
                      </span>
                    </div>

                    <h4 className="font-extrabold text-sm sm:text-base text-slate-900 group-hover:text-red-600 transition-colors truncate">
                      {item.identifiedTitle}
                    </h4>

                    {item.matchReason && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                        {item.matchReason}
                      </p>
                    )}

                    {/* Batch / Model info */}
                    {(item.extractedInfo?.modelOrLot || item.extractedInfo?.modelOrBatchNumber) && (
                      <span className="text-[10px] text-slate-400 font-mono mt-1 block">
                        Batch/Model: {item.extractedInfo.modelOrLot || item.extractedInfo.modelOrBatchNumber}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right Section: Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const query = item.searchKeywords || item.identifiedTitle;
                      onApplySearchQuery(query);
                    }}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
                    title="Search Canadian Recalls for this item"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>Search Recalls</span>
                  </button>

                  {item.matchedRecalls && item.matchedRecalls.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (item.matchedRecalls && item.matchedRecalls.length > 0) {
                          onSelectRecall(item.matchedRecalls[0]);
                        }
                      }}
                      className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-xs"
                      title="View active safety notice"
                    >
                      <span>View Notice</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => handleDeleteItem(item.id, e)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                    title="Remove from history"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
