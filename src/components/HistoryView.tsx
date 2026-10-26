import React, { useState, useEffect } from 'react';
import {
  History,
  Camera,
  Search,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Tag,
  ArrowRight,
  Clock,
  Download,
  Bell,
  BellRing,
  RefreshCw,
  CheckCircle2,
  Shield
} from 'lucide-react';
import type { RecallItem, ScanHistoryItem } from '../types/recall';
import { getScanHistory } from '../services/scanHistory';
import {
  checkHistoryAgainstRecalls,
  getLastHistoryCheckTime,
  getNextHistoryCheckTime,
  hasNotificationPermission,
  requestRecallNotificationPermission,
  getNotifiedRecallRecords,
  hasRecallBeenNotified,
  type NotifiedRecallRecord
} from '../services/historyMonitor';

interface HistoryViewProps {
  onOpenScanner: () => void;
  onApplySearchQuery: (query: string) => void;
  onSelectRecall: (recall: RecallItem) => void;
  recallsDataset?: RecallItem[];
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
    'Flavor or Variant',
    'Package Size',
    'Category',
    'Model or Batch',
    'UPC or Barcode',
    'Recall Verdict',
    'Matched Recalls Count',
    'Match Reason',
    'Search Keywords',
    'Last Verified At'
  ];

  const escapeCSV = (value: string | number | undefined | null) => {
    if (value === undefined || value === null) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = items.map((item) => {
    const dateStr = new Date(item.timestamp).toLocaleString();
    const brand = item.extractedInfo?.brand || '';
    const flavor = item.extractedInfo?.flavorOrVariant || '';
    const size = item.extractedInfo?.packageSize || '';
    const category = item.extractedInfo?.category || '';
    const model = item.extractedInfo?.modelOrLot || item.extractedInfo?.modelOrBatchNumber || '';
    const upc = item.extractedInfo?.upcOrCode || '';
    const verdictLabel =
      item.verdict === 'MATCH_FOUND'
        ? 'RECALL FLAGGED'
        : item.verdict === 'POSSIBLE_MATCH'
          ? 'POSSIBLE MATCH'
          : 'SAFE (NO RECALL DETECTED)';
    const lastCheckedStr = item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString() : 'Pending';

    return [
      escapeCSV(item.id),
      escapeCSV(dateStr),
      escapeCSV(item.identifiedTitle),
      escapeCSV(brand),
      escapeCSV(flavor),
      escapeCSV(size),
      escapeCSV(category),
      escapeCSV(model),
      escapeCSV(upc),
      escapeCSV(verdictLabel),
      escapeCSV(item.matchedRecallsCount || 0),
      escapeCSV(item.matchReason || ''),
      escapeCSV(item.searchKeywords || ''),
      escapeCSV(lastCheckedStr)
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
  onSelectRecall,
  recallsDataset = []
}) => {
  const [historyItems, setHistoryItems] = useState<ScanHistoryItem[]>([]);
  const [notifiedRecords, setNotifiedRecords] = useState<NotifiedRecallRecord[]>([]);
  const [showNotifiedLog, setShowNotifiedLog] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);
  const [nextCheckTime, setNextCheckTime] = useState<number>(Date.now());
  const [isVerifyingNow, setIsVerifyingNow] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(null);
  const [notificationsGranted, setNotificationsGranted] = useState(false);

  // Load history, check timestamps, notification records & permissions
  useEffect(() => {
    const load = () => {
      setHistoryItems(getScanHistory());
      setNotifiedRecords(getNotifiedRecallRecords());
      setLastCheckTime(getLastHistoryCheckTime());
      setNextCheckTime(getNextHistoryCheckTime());
      setNotificationsGranted(hasNotificationPermission());
    };
    load();

    const handleUpdate = () => load();
    window.addEventListener('scan-history-updated', handleUpdate);
    window.addEventListener('recall-monitoring-check-completed', handleUpdate);
    window.addEventListener('recall-notified-records-updated', handleUpdate);

    return () => {
      window.removeEventListener('scan-history-updated', handleUpdate);
      window.removeEventListener('recall-monitoring-check-completed', handleUpdate);
      window.removeEventListener('recall-notified-records-updated', handleUpdate);
    };
  }, []);

  const handleExport = () => {
    exportHistoryToCSV(historyItems);
  };

  const handleRequestNotifications = async () => {
    const result = await requestRecallNotificationPermission();
    setNotificationsGranted(result === 'granted');
    if (result === 'granted') {
      setVerificationFeedback('System notifications enabled! You will be alerted whenever a scanned item is recalled.');
      setTimeout(() => setVerificationFeedback(null), 5000);
    }
  };

  const handleVerifyNow = async () => {
    if (!recallsDataset || recallsDataset.length === 0) {
      setVerificationFeedback('Canadian recall database is syncing. Please wait a moment...');
      setTimeout(() => setVerificationFeedback(null), 4000);
      return;
    }

    setIsVerifyingNow(true);
    setVerificationFeedback(null);
    try {
      const result = await checkHistoryAgainstRecalls(recallsDataset, true);
      setLastCheckTime(result.timestamp);
      setNextCheckTime(getNextHistoryCheckTime());
      setHistoryItems(getScanHistory());
      setNotifiedRecords(getNotifiedRecallRecords());

      if (result.newlyRecalledCount > 0) {
        setVerificationFeedback(
          `⚠️ Safety check completed: ${result.newlyRecalledCount} product(s) in your history matched new Canadian recalls! Notification sent.`
        );
      } else {
        setVerificationFeedback(
          `✅ 6-Hour verification complete: All ${result.checkedCount} scanned products verified against ${recallsDataset.length.toLocaleString()} Canadian recall notices. No new recalls found.`
        );
      }
    } catch (err) {
      console.error('Manual history verification error:', err);
      setVerificationFeedback('Failed to complete recall verification. Please try again.');
    } finally {
      setIsVerifyingNow(false);
      setTimeout(() => {
        setVerificationFeedback(null);
      }, 7000);
    }
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
            Permanent safety log & continuous 6-hour Canadian recall monitoring
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
          {totalScans > 0 && (
            <button
              type="button"
              onClick={handleExport}
              className="px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-all border border-slate-200/80 flex items-center gap-1.5 shadow-2xs active:scale-95"
              title="Download scan history as CSV file"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>Save as CSV</span>
            </button>
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

      {/* 6-Hour Safety Verification & Notification Monitor Card */}
      <div className="bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-md border border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-red-500/20 text-red-400 rounded-2xl border border-red-500/30 shrink-0 mt-0.5">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-extrabold text-base sm:text-lg text-white">
                  6-Hour Safety Recall Monitor
                </h3>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Active (Every 6h)
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                Checks <strong>only the products in your scan history</strong> against Health Canada, CFIA, and Transport Canada safety databases every 6 hours. Notifications from different variations of the same product are consolidated into 1 notification and tracked to prevent duplicate alerts.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start md:self-center">
            {/* Notification Permission Toggle */}
            {notificationsGranted ? (
              <span className="px-3 py-2 bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-emerald-400" />
                <span>Alerts On</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleRequestNotifications}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
                title="Enable browser notifications for recall alerts"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>Enable Alerts</span>
              </button>
            )}

            {/* Manual Check Now Button */}
            <button
              type="button"
              onClick={handleVerifyNow}
              disabled={isVerifyingNow || totalScans === 0}
              className="px-3.5 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all border border-white/20 flex items-center gap-1.5 active:scale-95"
              title="Run on-demand check of history items against latest Canadian recall records"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingNow ? 'animate-spin text-red-400' : ''}`} />
              <span>{isVerifyingNow ? 'Verifying...' : 'Verify Now'}</span>
            </button>
          </div>
        </div>

        {/* Verification Status Details & Timestamps */}
        <div className="pt-2 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Last Checked:</span>
              <strong className="text-slate-200">
                {lastCheckTime ? formatTimestamp(lastCheckTime) : 'Checking automatically'}
              </strong>
            </span>

            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Next Check:</span>
              <strong className="text-slate-200">
                {nextCheckTime ? (
                  Date.now() >= nextCheckTime
                    ? 'Due now'
                    : `In ~${Math.max(1, Math.round((nextCheckTime - Date.now()) / (1000 * 60 * 60)))}h`
                ) : (
                  'Every 6 hours'
                )}
              </strong>
            </span>

            {/* Notified recalls tracked counter */}
            {notifiedRecords.length > 0 && (
              <button
                type="button"
                onClick={() => setShowNotifiedLog(!showNotifiedLog)}
                className="flex items-center gap-1.5 text-slate-300 hover:text-white underline underline-offset-2"
              >
                <BellRing className="w-3.5 h-3.5 text-amber-400" />
                <span>{notifiedRecords.length} Notification{notifiedRecords.length === 1 ? '' : 's'} Tracked</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showNotifiedLog ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          <span className="text-[11px] text-slate-400 italic">
            Scan history is permanent and cannot be cleared
          </span>
        </div>

        {/* Expandable Sent Notifications Log */}
        {showNotifiedLog && notifiedRecords.length > 0 && (
          <div className="mt-3 p-4 bg-slate-800/80 rounded-2xl border border-slate-700 space-y-2 text-xs animate-in fade-in">
            <div className="flex items-center justify-between font-bold text-slate-200">
              <span className="flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-red-400" />
                <span>Tracked Recall Notifications Log (No Duplicates)</span>
              </span>
              <span className="text-[11px] text-slate-400">
                {notifiedRecords.length} item{notifiedRecords.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1 divide-y divide-slate-700/50">
              {notifiedRecords.map((rec) => (
                <div key={rec.key} className="pt-2 first:pt-0 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-200 truncate">{rec.itemTitle}</p>
                    <p className="text-[11px] text-red-300 truncate">{rec.recallTitle}</p>
                    {rec.hazard && (
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">{rec.hazard}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {formatTimestamp(rec.notifiedAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* On-demand Feedback Banner */}
        {verificationFeedback && (
          <div className="p-3 bg-white/10 border border-white/20 rounded-xl text-xs text-white animate-in fade-in">
            {verificationFeedback}
          </div>
        )}
      </div>

      {/* Summary KPI Badges */}
      {totalScans > 0 && (
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Permanent Scans
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
              When you snap a photo of any grocery item, household product, or vehicle part, Gemini will identify it, check for active Canadian recalls, and save it to your permanent safety log for continuous 6-hour monitoring.
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
            <button
              type="button"
              onClick={handleExport}
              className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 hover:underline"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

          {historyItems.map((item) => {
            const isMatch = item.verdict === 'MATCH_FOUND';
            const isPossible = item.verdict === 'POSSIBLE_MATCH';
            const isNewlyRecalled = item.isNewlyRecalled === true;

            // Check if any matched recall on this item has been tracked as notified
            const hasTrackedNotification =
              item.matchedRecalls &&
              item.matchedRecalls.length > 0 &&
              item.matchedRecalls.some((rec) => hasRecallBeenNotified(item.id, rec.NID));

            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl p-4 sm:p-5 border shadow-xs transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group ${
                  isNewlyRecalled
                    ? 'border-red-400 ring-2 ring-red-500/20 bg-red-50/20'
                    : isMatch
                      ? 'border-red-200 hover:border-red-300'
                      : 'border-slate-200/80 hover:border-slate-300'
                }`}
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
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {isMatch ? (
                          <ShieldAlert className="w-3 h-3 text-red-600" />
                        ) : (
                          <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        )}
                        <span>
                          {isMatch
                            ? 'Exact Recall Match'
                            : 'No Recall Found'}
                        </span>
                      </span>

                      {/* Brand & Similar Product Advisories Badge */}
                      {!isMatch &&
                        ((item.similarProductRecalls?.length || 0) + (item.relatedBrandRecalls?.length || 0) > 0) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-100 text-amber-900 border border-amber-300">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            <span>
                              {(item.similarProductRecalls?.length || 0) + (item.relatedBrandRecalls?.length || 0)} Advisory Notice{((item.similarProductRecalls?.length || 0) + (item.relatedBrandRecalls?.length || 0)) === 1 ? '' : 's'}
                            </span>
                          </span>
                        )}

                      {/* 6-Hour Monitor Recall Alert Badge */}
                      {isNewlyRecalled && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-red-600 text-white animate-pulse">
                          <span>🚨 Recalled After Scan</span>
                        </span>
                      )}

                      {/* Notified Tracking Status Badge */}
                      {hasTrackedNotification && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          <BellRing className="w-3 h-3 text-slate-500" />
                          <span>Notified (Logged)</span>
                        </span>
                      )}

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

                    {/* Variant / Size info */}
                    {(item.extractedInfo?.flavorOrVariant || item.extractedInfo?.packageSize) && (
                      <span className="text-[11px] text-slate-600 font-medium mt-0.5 block">
                        {[item.extractedInfo.flavorOrVariant, item.extractedInfo.packageSize].filter(Boolean).join(' • ')}
                      </span>
                    )}

                    {/* Batch / Model info */}
                    {(item.extractedInfo?.modelOrLot || item.extractedInfo?.modelOrBatchNumber) && (
                      <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
                        Batch/Model: {item.extractedInfo.modelOrLot || item.extractedInfo.modelOrBatchNumber}
                      </span>
                    )}

                    {/* 6-Hour Verification Status Timestamp */}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <ShieldCheck className="w-3 h-3 text-emerald-500" />
                        <span>Protected by 6h monitor</span>
                      </span>
                      {item.lastCheckedAt && (
                        <span>• Verified {formatTimestamp(item.lastCheckedAt)}</span>
                      )}
                    </div>
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

                  {item.matchedRecalls && item.matchedRecalls.length > 0 ? (
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
                      <span>View Notice{item.matchedRecalls.length > 1 ? ` (${item.matchedRecalls.length})` : ''}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  ) : ((item.similarProductRecalls?.length || 0) + (item.relatedBrandRecalls?.length || 0) > 0) ? (
                    <button
                      type="button"
                      onClick={() => {
                        const first = item.similarProductRecalls?.[0] || item.relatedBrandRecalls?.[0];
                        if (first) {
                          onSelectRecall(first);
                        }
                      }}
                      className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-xs"
                      title="View advisory notice for similar products or brand"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-slate-950" />
                      <span>
                        Advisories (
                        {(item.similarProductRecalls?.length || 0) + (item.relatedBrandRecalls?.length || 0)}
                        )
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
