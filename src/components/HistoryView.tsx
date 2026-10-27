import React, { useState, useEffect } from 'react';
import {
  History,
  Camera,
  Search,
  ShieldAlert,
  ShieldCheck,
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
  Check,
  Shield,
  AlertTriangle,
  VolumeX,
  Trash2
} from 'lucide-react';
import { playRecallAlarmSound, stopRecallAlarmSound } from '../services/alarmSound';
import type { RecallItem, ScanHistoryItem } from '../types/recall';
import { getScanHistory, deleteScanFromHistory, markScanRecallAcknowledged } from '../services/scanHistory';
import {
  updateDatabaseAndCheckHistory,
  checkHistoryAgainstRecalls,
  getLastHistoryCheckTime,
  hasNotificationPermission,
  requestRecallNotificationPermission,
  getNotifiedRecallRecords,
  hasRecallBeenNotified,
  isRecallNotificationAcknowledged,
  acknowledgeRecallNotification,
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
  const [isVerifyingNow, setIsVerifyingNow] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(null);
  const [verifyResultState, setVerifyResultState] = useState<'idle' | 'all-clear' | 'recall-alert'>('idle');
  const [isAlarmPlaying, setIsAlarmPlaying] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Auto-reset delete confirmation after 4 seconds if not confirmed
  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => {
      setConfirmDeleteId(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  // Load history, check timestamps, notification records & permissions
  useEffect(() => {
    const load = () => {
      setHistoryItems(getScanHistory());
      setNotifiedRecords(getNotifiedRecallRecords());
      setLastCheckTime(getLastHistoryCheckTime());
      setNotificationsGranted(hasNotificationPermission());
    };
    load();

    const handleUpdate = () => load();
    window.addEventListener('scan-history-updated', handleUpdate);
    window.addEventListener('recall-monitoring-check-completed', handleUpdate);
    window.addEventListener('recall-notified-records-updated', handleUpdate);
    window.addEventListener('recall-notification-acknowledged', handleUpdate);

    const handleAlarmState = (e: any) => {
      setIsAlarmPlaying(!!e.detail?.isPlaying);
    };
    window.addEventListener('recall-alarm-playing-changed', handleAlarmState);

    return () => {
      window.removeEventListener('scan-history-updated', handleUpdate);
      window.removeEventListener('recall-monitoring-check-completed', handleUpdate);
      window.removeEventListener('recall-notified-records-updated', handleUpdate);
      window.removeEventListener('recall-notification-acknowledged', handleUpdate);
      window.removeEventListener('recall-alarm-playing-changed', handleAlarmState);
    };
  }, []);

  const handleAcknowledgeRecall = (historyItem: ScanHistoryItem, recall?: RecallItem) => {
    if (recall) {
      acknowledgeRecallNotification(historyItem.id, recall);
    } else if (historyItem.matchedRecalls && historyItem.matchedRecalls.length > 0) {
      historyItem.matchedRecalls.forEach((r) => {
        acknowledgeRecallNotification(historyItem.id, r);
      });
    } else {
      markScanRecallAcknowledged(historyItem.id);
    }
    setHistoryItems(getScanHistory());
    setNotifiedRecords(getNotifiedRecallRecords());
  };

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
    setIsVerifyingNow(true);
    setVerifyResultState('idle');
    setVerificationFeedback('Updating Canadian recall database and checking history...');
    try {
      const result = await updateDatabaseAndCheckHistory((step) => {
        setVerificationFeedback(step);
      }, true);
      setLastCheckTime(result.timestamp);
      setHistoryItems(getScanHistory());
      setNotifiedRecords(getNotifiedRecallRecords());

      if (result.newlyRecalledCount > 0) {
        setVerifyResultState('recall-alert');
        setVerificationFeedback(
          `🚨 URGENT RECALL DETECTED: ${result.newlyRecalledCount} product(s) in your history matched new Canadian recalls!`
        );
        playRecallAlarmSound(15);
      } else {
        setVerifyResultState('all-clear');
        setVerificationFeedback(
          `✅ All clear! Database updated with ${result.recallsCount.toLocaleString()} notices. All ${result.checkedCount} scanned products checked. No new recalls found.`
        );
      }
    } catch (err: any) {
      console.error('Manual history verification error:', err);
      // Fallback check against existing dataset if network was unreachable
      if (recallsDataset && recallsDataset.length > 0) {
        try {
          const res = await checkHistoryAgainstRecalls(recallsDataset, true);
          setLastCheckTime(res.timestamp);
          setHistoryItems(getScanHistory());
          setVerifyResultState('all-clear');
          setVerificationFeedback(
            `Checked against offline database: All ${res.checkedCount} products verified.`
          );
        } catch {
          setVerificationFeedback('Failed to complete recall verification.');
        }
      } else {
        setVerificationFeedback('Failed to complete recall verification. Please try again.');
      }
    } finally {
      setIsVerifyingNow(false);
      setTimeout(() => {
        setVerificationFeedback(null);
      }, 9000);
    }
  };

  const totalScans = historyItems.length;
  const flaggedRecalls = historyItems.filter((i) => i.verdict === 'MATCH_FOUND').length;
  const safeScans = historyItems.filter((i) => i.verdict === 'NO_RECALL_FOUND').length;

  return (
    <div className="w-full max-w-full overflow-x-hidden space-y-4 text-left animate-in fade-in duration-200">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 max-w-full min-w-0 overflow-hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 sm:p-2 bg-red-50 text-red-600 rounded-xl shrink-0">
              <History className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 tracking-tight break-words">
              Product Scan History
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 break-words [overflow-wrap:anywhere]">
            Your permanent safety log & 6-hour automatic recall sync on app open
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto self-stretch sm:self-auto min-w-0">
          {totalScans > 0 && (
            <button
              type="button"
              onClick={handleExport}
              className="flex-1 sm:flex-initial px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-all border border-slate-200/80 flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 whitespace-nowrap min-w-0"
              title="Download scan history as CSV file"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Save as CSV</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenScanner}
            className="flex-1 sm:flex-initial px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 active:scale-95 whitespace-nowrap min-w-0"
          >
            <Camera className="w-4 h-4 shrink-0" />
            <span>Scan Item</span>
          </button>
        </div>
      </div>

      {/* Automatic Safety Verification & Notification Monitor Card */}
      <div className="bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-md border border-slate-800 space-y-3 sm:space-y-4 max-w-full min-w-0 overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 min-w-0">
          <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="p-2 sm:p-2.5 bg-red-500/20 text-red-400 rounded-2xl border border-red-500/30 shrink-0 mt-0.5">
              <Shield className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                <h3 className="font-extrabold text-sm sm:text-lg text-white break-words">
                  Automatic Recall Protection
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Syncs Every 6h On Open
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed break-words [overflow-wrap:anywhere]">
                Every product in your scan history is continuously monitored. On app open, the recall database is synced every 6 hours from Health Canada and checked against your scan history. You receive immediate alerts if any scanned product is recalled.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto self-start md:self-center min-w-0">
            {/* Notification Permission Toggle */}
            {notificationsGranted ? (
              <span className="flex-1 sm:flex-initial px-3 py-2 bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap min-w-0">
                <BellRing className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Alerts On</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleRequestNotifications}
                className="flex-1 sm:flex-initial px-3 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-95 whitespace-nowrap min-w-0"
                title="Enable browser notifications for recall alerts"
              >
                <Bell className="w-3.5 h-3.5 shrink-0" />
                <span>Enable Alerts</span>
              </button>
            )}

            {/* Manual Check Now Button */}
            <button
              type="button"
              id="history-verify-now-btn"
              onClick={handleVerifyNow}
              disabled={isVerifyingNow || totalScans === 0}
              className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-1.5 active:scale-95 whitespace-nowrap shrink-0 ${
                isVerifyingNow
                  ? 'bg-slate-700/60 border-slate-600 text-slate-300 cursor-wait'
                  : verifyResultState === 'all-clear'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-400 ring-2 ring-emerald-400 shadow-md shadow-emerald-500/20'
                  : verifyResultState === 'recall-alert'
                  ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse border-red-500 ring-4 ring-red-400 shadow-lg shadow-red-500/40'
                  : 'bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white border-white/20'
              }`}
              title="Check for new recalls now"
            >
              {isVerifyingNow ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin text-white" />
                  <span>Checking...</span>
                </>
              ) : verifyResultState === 'all-clear' ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-white" />
                  <span>All Clear (0 Recalls)</span>
                </>
              ) : verifyResultState === 'recall-alert' ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-white animate-bounce" />
                  <span>⚠️ Recall Detected!</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                  <span>Check Now</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Verification Status Details & Timestamps */}
        <div className="pt-2 border-t border-slate-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 text-xs text-slate-400 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
            <span className="flex items-center gap-1.5 flex-wrap min-w-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="shrink-0">Last Verified:</span>
              <strong className="text-slate-200 break-words">
                {lastCheckTime ? formatTimestamp(lastCheckTime) : 'Checking automatically'}
              </strong>
            </span>

            <span className="flex items-center gap-1.5 flex-wrap min-w-0">
              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="shrink-0">Schedule:</span>
              <strong className="text-slate-200 break-words">
                Every 6 hours on app open
              </strong>
            </span>

            {/* Notified recalls tracked counter */}
            {notifiedRecords.length > 0 && (
              <button
                type="button"
                onClick={() => setShowNotifiedLog(!showNotifiedLog)}
                className="flex items-center gap-1 text-slate-300 hover:text-white underline underline-offset-2 shrink-0"
              >
                <BellRing className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{notifiedRecords.length} Notification{notifiedRecords.length === 1 ? '' : 's'} Tracked</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showNotifiedLog ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          <span className="text-[10px] sm:text-[11px] text-slate-400 italic break-words [overflow-wrap:anywhere]">
            Tap Delete twice to remove an item from your monitored history
          </span>
        </div>

        {/* Expandable Sent Notifications Log */}
        {showNotifiedLog && notifiedRecords.length > 0 && (
          <div className="mt-3 p-3.5 sm:p-4 bg-slate-800/80 rounded-2xl border border-slate-700 space-y-2 text-xs animate-in fade-in max-w-full min-w-0 overflow-hidden">
            <div className="flex items-center justify-between font-bold text-slate-200 min-w-0">
              <span className="flex items-center gap-1.5 truncate">
                <BellRing className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="truncate">Tracked Recall Notifications Log (No Duplicates)</span>
              </span>
              <span className="text-[11px] text-slate-400 shrink-0 ml-2">
                {notifiedRecords.length} item{notifiedRecords.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1 divide-y divide-slate-700/50 min-w-0">
              {notifiedRecords.map((rec) => (
                <div key={rec.key} className="pt-2 first:pt-0 flex flex-col sm:flex-row sm:items-start justify-between gap-1 sm:gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-200 break-words [overflow-wrap:anywhere]">{rec.itemTitle}</p>
                    <p className="text-[11px] text-red-300 break-words [overflow-wrap:anywhere]">{rec.recallTitle}</p>
                    {rec.hazard && (
                      <p className="text-[10px] text-slate-400 break-words [overflow-wrap:anywhere] mt-0.5">{rec.hazard}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0 sm:self-start">
                    {formatTimestamp(rec.notifiedAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* On-demand Feedback Banner */}
        {verificationFeedback && (
          <div
            className={`p-3 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-in fade-in break-words [overflow-wrap:anywhere] ${
              verifyResultState === 'all-clear'
                ? 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 font-semibold'
                : verifyResultState === 'recall-alert'
                ? 'bg-red-950/90 border-2 border-red-500 text-red-200 font-bold animate-pulse'
                : 'bg-white/10 border border-white/20 text-white'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {verifyResultState === 'all-clear' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : verifyResultState === 'recall-alert' ? (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 animate-bounce" />
              ) : null}
              <span>{verificationFeedback}</span>
            </div>

            {isAlarmPlaying && (
              <button
                type="button"
                onClick={() => stopRecallAlarmSound()}
                className="px-3 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-xs shrink-0 self-start sm:self-center active:scale-95"
              >
                <VolumeX className="w-3.5 h-3.5" />
                <span>Silence Alarm</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Summary KPI Badges */}
      {totalScans > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 max-w-full min-w-0">
          <div className="bg-white p-2.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-xs min-w-0 overflow-hidden text-center sm:text-left">
            <span className="text-[9px] sm:text-[11px] font-bold text-slate-500 uppercase tracking-tight sm:tracking-wider block truncate">
              Total Scans
            </span>
            <span className="text-lg sm:text-2xl font-extrabold text-slate-900 mt-0.5 block truncate">
              {totalScans}
            </span>
          </div>

          <div className="bg-red-50/70 p-2.5 sm:p-4 rounded-xl sm:rounded-2xl border border-red-200/80 shadow-xs min-w-0 overflow-hidden text-center sm:text-left">
            <span className="text-[9px] sm:text-[11px] font-bold text-red-600 uppercase tracking-tight sm:tracking-wider block truncate">
              Recalls Found
            </span>
            <span className="text-lg sm:text-2xl font-extrabold text-red-700 mt-0.5 block truncate">
              {flaggedRecalls}
            </span>
          </div>

          <div className="bg-emerald-50/70 p-2.5 sm:p-4 rounded-xl sm:rounded-2xl border border-emerald-200/80 shadow-xs min-w-0 overflow-hidden text-center sm:text-left">
            <span className="text-[9px] sm:text-[11px] font-bold text-emerald-700 uppercase tracking-tight sm:tracking-wider block truncate">
              Safe Items
            </span>
            <span className="text-lg sm:text-2xl font-extrabold text-emerald-700 mt-0.5 block truncate">
              {safeScans}
            </span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {totalScans === 0 ? (
        <div className="py-14 sm:py-16 px-4 sm:px-6 text-center bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 space-y-4 shadow-xs max-w-full min-w-0 overflow-hidden">
          <div className="w-16 h-16 mx-auto bg-red-50 text-red-600 rounded-3xl flex items-center justify-center shadow-inner">
            <Camera className="w-8 h-8 animate-pulse-subtle" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5 min-w-0">
            <h3 className="font-extrabold text-lg text-slate-900 break-words">No Product Scans Yet</h3>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed break-words [overflow-wrap:anywhere]">
              When you photograph an item and its serial / model number tag, the system will identify it, check for active Canadian safety recalls, and save it to your permanent safety log for continuous 6-hour monitoring.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenScanner}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs sm:text-sm font-extrabold transition-all shadow-md shadow-red-600/30 inline-flex items-center justify-center gap-2 active:scale-95 whitespace-nowrap"
          >
            <Camera className="w-4 h-4" />
            <span>Scan Your First Product</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* History Log Grid */
        <div className="space-y-3 max-w-full min-w-0">
          <div className="flex items-center justify-between px-1 min-w-0">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider truncate">
              Recorded Scans ({totalScans})
            </span>
            <button
              type="button"
              onClick={handleExport}
              className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 hover:underline shrink-0 ml-2"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

          {historyItems.map((item) => {
            const isMatch = item.verdict === 'MATCH_FOUND';
            const isNewlyRecalled = item.isNewlyRecalled === true;

            // Check if all matched recalls on this item are acknowledged
            const isAcknowledged =
              Boolean(item.acknowledged) ||
              (Boolean(item.matchedRecalls && item.matchedRecalls.length > 0) &&
                item.matchedRecalls!.every(
                  (rec) =>
                    item.acknowledgedRecallNids?.map((n) => String(n).trim()).includes(String(rec.NID).trim()) ||
                    isRecallNotificationAcknowledged(item.id, rec)
                ));

            // Check if any matched recall on this item has been tracked as notified
            const hasTrackedNotification =
              item.matchedRecalls &&
              item.matchedRecalls.length > 0 &&
              item.matchedRecalls.some((rec) => hasRecallBeenNotified(item.id, rec.NID));

            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl p-3.5 sm:p-5 border shadow-xs transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 group max-w-full min-w-0 overflow-hidden w-full ${
                  isNewlyRecalled && !isAcknowledged
                    ? 'border-red-400 ring-2 ring-red-500/20 bg-red-50/20'
                    : isMatch && !isAcknowledged
                      ? 'border-red-300 ring-1 ring-red-400/20 bg-red-50/10 hover:border-red-400'
                      : isMatch && isAcknowledged
                        ? 'border-slate-200/90 bg-white hover:border-slate-300'
                        : 'border-slate-200/80 hover:border-slate-300'
                }`}
              >
                {/* Left Section: Thumbnail & Identifiers */}
                <div className="flex items-start gap-3 min-w-0 w-full flex-1 overflow-hidden">
                  {/* Photo Thumbnail or Placeholder */}
                  <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center relative">
                    {item.imagePreview ? (
                      <img
                        src={item.imagePreview}
                        alt={item.identifiedTitle}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="p-1.5 text-slate-400 flex flex-col items-center justify-center">
                        <Tag className="w-5 h-5 sm:w-6 sm:h-6" />
                        <span className="text-[8px] sm:text-[9px] font-bold uppercase">Item</span>
                      </div>
                    )}
                  </div>

                  {/* Title & Metadata */}
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap min-w-0">
                      {/* Status Verdict Badge */}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide shrink-0 ${
                          isMatch
                            ? isAcknowledged
                              ? 'bg-slate-100 text-slate-700 border border-slate-300'
                              : 'bg-red-100 text-red-800 border border-red-200'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {isMatch ? (
                          isAcknowledged ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                          ) : (
                            <ShieldAlert className="w-3 h-3 text-red-600 shrink-0" />
                          )
                        ) : (
                          <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0" />
                        )}
                        <span>
                          {isMatch
                            ? isAcknowledged
                              ? 'Recall Acknowledged'
                              : 'Exact Recall Match'
                            : 'No Recall Found'}
                        </span>
                      </span>

                      {/* 6-Hour Monitor Recall Alert Badge (only if newly recalled and not yet acknowledged) */}
                      {isNewlyRecalled && !isAcknowledged && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-extrabold uppercase bg-red-600 text-white animate-pulse shrink-0">
                          <span>🚨 Recalled After Scan</span>
                        </span>
                      )}

                      {/* Acknowledged Badge */}
                      {isMatch && isAcknowledged && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                          <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span>Acknowledged</span>
                        </span>
                      )}

                      {/* Notified Tracking Status Badge */}
                      {hasTrackedNotification && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                          <BellRing className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Notified</span>
                        </span>
                      )}

                      {/* Extracted Category */}
                      {item.extractedInfo?.category && (
                        <span className="text-[9px] sm:text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                          {item.extractedInfo.category}
                        </span>
                      )}

                      {/* Time ago */}
                      <span className="text-[9px] sm:text-[10px] text-slate-400 flex items-center gap-1 shrink-0 ml-auto">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span>{formatTimestamp(item.timestamp)}</span>
                      </span>
                    </div>

                    <h4 className="font-extrabold text-sm sm:text-base text-slate-900 group-hover:text-red-600 transition-colors break-words [overflow-wrap:anywhere] leading-snug">
                      {item.identifiedTitle}
                    </h4>

                    {item.matchReason && (
                      <p className="text-xs text-slate-500 mt-1 break-words [overflow-wrap:anywhere] line-clamp-2 leading-relaxed">
                        {item.matchReason}
                      </p>
                    )}

                    {/* Variant / Size info */}
                    {(item.extractedInfo?.flavorOrVariant || item.extractedInfo?.packageSize) && (
                      <span className="text-[11px] text-slate-600 font-medium mt-0.5 block break-words [overflow-wrap:anywhere]">
                        {[item.extractedInfo.flavorOrVariant, item.extractedInfo.packageSize].filter(Boolean).join(' • ')}
                      </span>
                    )}

                    {/* Batch / Model info */}
                    {(item.extractedInfo?.modelOrLot || item.extractedInfo?.modelOrBatchNumber) && (
                      <span className="text-[10px] text-slate-400 font-mono mt-0.5 block break-all">
                        Batch/Model: {item.extractedInfo.modelOrLot || item.extractedInfo.modelOrBatchNumber}
                      </span>
                    )}

                    {/* Automatic Verification Status Timestamp */}
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px] text-slate-400 min-w-0">
                      <span className="inline-flex items-center gap-1 text-slate-500 shrink-0">
                        <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span>Auto-checked on app open</span>
                      </span>
                      {item.lastCheckedAt && (
                        <span className="break-words">• Verified {formatTimestamp(item.lastCheckedAt)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Section: Actions */}
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 min-w-0">
                  {isMatch && isAcknowledged ? (
                    <span
                      className="px-2.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center gap-1 shrink-0"
                      title="Recall acknowledged by you. This recall will not trigger popups again unless a new recall is issued for this product."
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Acknowledged</span>
                    </span>
                  ) : (
                    <span
                      className="px-2.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center justify-center gap-1 shrink-0"
                      title="This product is in your history and is automatically verified for recalls when the app is opened"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Monitored</span>
                    </span>
                  )}

                  {/* Acknowledge Button - allows 1-click acknowledgment of recalls in history */}
                  {isMatch && !isAcknowledged && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAcknowledgeRecall(item);
                      }}
                      className="flex-1 sm:flex-initial px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 active:scale-95 whitespace-nowrap shrink-0"
                      title="Mark this recall as acknowledged"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Acknowledge</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const query = item.searchKeywords || item.identifiedTitle;
                      onApplySearchQuery(query);
                    }}
                    className="flex-1 sm:flex-initial px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 min-w-0 truncate"
                    title="Search Canadian Recalls for this item"
                  >
                    <Search className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Search Recalls</span>
                  </button>

                  {item.matchedRecalls && item.matchedRecalls.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (item.matchedRecalls && item.matchedRecalls.length > 0) {
                          onSelectRecall(item.matchedRecalls[0]);
                        }
                      }}
                      className="flex-1 sm:flex-initial px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-xs min-w-0 truncate"
                      title="View active safety notice"
                    >
                      <span className="truncate">Notice{item.matchedRecalls.length > 1 ? ` (${item.matchedRecalls.length})` : ''}</span>
                      <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  ) : null}

                  {/* Delete Item (Requires 2 Clicks to Confirm) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmDeleteId === item.id) {
                        deleteScanFromHistory(item.id);
                        setHistoryItems((prev) => prev.filter((it) => it.id !== item.id));
                        setConfirmDeleteId(null);
                      } else {
                        setConfirmDeleteId(item.id);
                      }
                    }}
                    className={`px-2.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 active:scale-95 ${
                      confirmDeleteId === item.id
                        ? 'bg-red-600 hover:bg-red-700 text-white ring-2 ring-red-400 shadow-sm animate-pulse'
                        : 'bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200/80 hover:border-red-200'
                    }`}
                    title={confirmDeleteId === item.id ? 'Click again to confirm deletion' : 'Delete item from history'}
                    aria-label={confirmDeleteId === item.id ? 'Confirm delete' : 'Delete scan'}
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{confirmDeleteId === item.id ? 'Confirm Delete?' : 'Delete'}</span>
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
