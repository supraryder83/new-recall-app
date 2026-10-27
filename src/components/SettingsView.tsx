import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Database,
  RefreshCw,
  Download,
  Trash2,
  ExternalLink,
  Info,
  Clock,
  Bell,
  BellRing,
  Send
} from 'lucide-react';
import { recallStorage } from '../services/storage';
import type { DatasetSyncState } from '../types/recall';
import {
  fetchWorkerStatus,
  registerWebPushSubscription,
  unsubscribeWebPush,
  getWebPushSubscriptionStatus,
  sendTestWebPush,
  triggerManualSync,
  type WorkerStatusResponse
} from '../services/pipelineClient';

interface SettingsViewProps {
  syncState: DatasetSyncState;
  onRefreshFeed: () => void;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
  onNavigateToHistory?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  syncState,
  onRefreshFeed,
  canInstallPwa,
  onInstallPwa,
  onNavigateToHistory
}) => {
  const [workerStatus, setWorkerStatus] = useState<WorkerStatusResponse | null>(null);
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [isSubscribingPush, setIsSubscribingPush] = useState(false);
  const [isTriggeringSync, setIsTriggeringSync] = useState(false);
  const [testPushStatus, setTestPushStatus] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkerStatus().then((s) => {
      if (s) setWorkerStatus(s);
    });
    getWebPushSubscriptionStatus().then(setIsPushSubscribed);
  }, []);

  const handleTogglePush = async () => {
    setIsSubscribingPush(true);
    setTestPushStatus(null);
    try {
      if (isPushSubscribed) {
        await unsubscribeWebPush();
        setIsPushSubscribed(false);
        setTestPushStatus('Web Push notifications disabled for this device.');
      } else {
        const res = await registerWebPushSubscription();
        if (res.success) {
          setIsPushSubscribed(true);
          setTestPushStatus('Successfully subscribed to Canadian Recall Web Push notifications!');
        } else {
          setTestPushStatus(`Subscription error: ${res.error}`);
        }
      }
      // Refresh status
      const updated = await fetchWorkerStatus();
      if (updated) setWorkerStatus(updated);
    } finally {
      setIsSubscribingPush(false);
    }
  };

  const handleSendTestPush = async () => {
    setTestPushStatus('Dispatching test Web Push notification...');
    const res = await sendTestWebPush();
    if (res.success) {
      setTestPushStatus('Test notification sent! Check your device or notification tray.');
    } else {
      setTestPushStatus(`Test failed: ${res.error}`);
    }
  };

  const handleTriggerManualSync = async () => {
    setIsTriggeringSync(true);
    setSyncFeedback('Updating recall database and verifying scan history...');
    try {
      const res = await triggerManualSync({ forceAll: true });
      if (res.success && res.summary) {
        setSyncFeedback(
          `Sync completed in ${res.summary.durationMs}ms: Ingested ${res.summary.recordsIngested} recalls, verified scan history, dispatched ${res.summary.pushNotificationsDispatched} push alert(s).`
        );
      } else {
        setSyncFeedback(`Sync error: ${res.error || 'Unknown error'}`);
      }
      const updated = await fetchWorkerStatus();
      if (updated) setWorkerStatus(updated);
      onRefreshFeed();
    } finally {
      setIsTriggeringSync(false);
    }
  };

  const handleClearCache = async () => {
    if (confirm('Clear offline recall cache from IndexedDB?')) {
      await recallStorage.clear();
      onRefreshFeed();
    }
  };

  const formatSyncTime = (timestamp: number | null | undefined) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-4 text-left animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 tracking-tight">App Settings</h2>
        <p className="text-xs md:text-sm text-slate-500 mt-0.5">
          Live safety database updates, scan history protection & Web Push notifications
        </p>
      </div>

      {/* RECALL DATABASE SYNC & HISTORY VERIFICATION CARD */}
      <div className="p-4 sm:p-5 bg-white rounded-2xl border border-red-200/90 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-50 text-red-600 rounded-xl">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-extrabold text-sm md:text-base text-slate-900">
                  Recall Database Sync & History Protection
                </h4>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase bg-emerald-100 text-emerald-800">
                  Checks On App Open
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Pulls Health Canada & CFIA updates on open and verifies against your scan history.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTriggerManualSync}
            disabled={isTriggeringSync}
            className="py-2 px-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs disabled:opacity-60 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTriggeringSync ? 'animate-spin' : ''}`} />
            <span>{isTriggeringSync ? 'Updating...' : 'Update & Check History Now'}</span>
          </button>
        </div>

        {/* Worker Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-xs">
          <div>
            <span className="text-slate-500 block text-[11px]">Last Sync Run</span>
            <strong className="text-slate-900">{formatSyncTime(workerStatus?.lastRunAt || syncState.lastSynced)}</strong>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Auto Verification</span>
            <strong className="text-slate-900">Every App Open</strong>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Database Notices</span>
            <strong className="text-slate-900 font-mono">
              {workerStatus ? workerStatus.processedRecallsCount.toLocaleString() : (syncState.totalRecords ? syncState.totalRecords.toLocaleString() : 'Loading...')}
            </strong>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Monitored Products</span>
            <strong className="text-slate-900 font-mono">
              Scan History
            </strong>
          </div>
        </div>

        {syncFeedback && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 font-medium">
            {syncFeedback}
          </div>
        )}

        <div className="text-[11px] text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-slate-100">
          <span>
            Continuously syncs with Health Canada and alerts you immediately if scanned products are recalled.
          </span>
          {onNavigateToHistory && (
            <button
              type="button"
              onClick={onNavigateToHistory}
              className="text-red-600 font-bold hover:underline shrink-0 text-left"
            >
              View Scan History →
            </button>
          )}
        </div>
      </div>

      {/* WEB PUSH API & NOTIFICATIONS CARD */}
      <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-50 text-purple-600 rounded-xl">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-sm md:text-base text-slate-900">
                PWA Web Push Notifications
              </h4>
              <p className="text-xs text-slate-500">
                Receive instant alerts with deep links to official Canada safety recall notices
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTogglePush}
              disabled={isSubscribingPush}
              className={`py-2 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs ${
                isPushSubscribed
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>{isPushSubscribed ? 'Subscribed (Turn Off)' : 'Enable Web Push'}</span>
            </button>
            {isPushSubscribed && (
              <button
                type="button"
                onClick={handleSendTestPush}
                className="py-2 px-3 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
                title="Send test push to device"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Test Push</span>
              </button>
            )}
          </div>
        </div>

        {testPushStatus && (
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900 font-medium">
            {testPushStatus}
          </div>
        )}

        <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-[11px] text-slate-600 space-y-1">
          <div className="flex justify-between">
            <span>RFC 8291 / 8292 VAPID Status:</span>
            <span className="font-semibold text-emerald-600">Configured & Active</span>
          </div>
          <div className="flex justify-between">
            <span>Expired Subscription Cleanup:</span>
            <span className="text-slate-800 font-medium">Automatic on HTTP 404/410 Gone</span>
          </div>
          <div className="flex justify-between">
            <span>Deep Link Destination:</span>
            <span className="text-slate-800 font-mono">/recalls/:id</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 md:gap-4">
        {/* Offline Storage & Sync Card */}
        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-slate-900">IndexedDB Storage</h4>
              <p className="text-xs text-slate-500">Searches 100% locally on your device without network</p>
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Cached Safety Records:</span>
              <strong className="text-slate-900">{syncState.totalRecords.toLocaleString()} items</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Last Feed Sync:</span>
              <span className="text-slate-900 font-medium">{formatSyncTime(syncState.lastSynced)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Sync Source:</span>
              <span className="text-slate-900 uppercase font-mono text-[11px] font-bold">
                {syncState.source}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={onRefreshFeed}
              disabled={syncState.status === 'loading'}
              className="py-2 px-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncState.status === 'loading' ? 'animate-spin' : ''}`} />
              <span>Sync Live Feed</span>
            </button>
            <button
              type="button"
              onClick={handleClearCache}
              className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Cache</span>
            </button>
          </div>
        </div>

        {/* AI Recognition Engine Card */}
        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3.5 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-amber-50 rounded-xl text-amber-600">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900">AI Visual Recognition</h4>
                  <p className="text-xs text-slate-500">Multimodal Product Identification</p>
                </div>
              </div>
              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider bg-emerald-100 text-emerald-800 shadow-2xs">
                Active
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              When you photograph packaging, labels, or product barcodes, the vision model identifies the brand, product name, and batch numbers to cross-reference Canadian safety hazards in real time.
            </p>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
            <span>Model: <strong className="text-slate-700">Gemini 3.5 Flash Lite</strong></span>
            <span className="text-emerald-600 font-semibold">Active</span>
          </div>
        </div>
      </div>

      {/* PWA Install Card */}
      {canInstallPwa && (
        <div className="p-4 sm:p-5 bg-linear-to-r from-red-600 to-red-700 text-white rounded-2xl shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Download className="w-6 h-6 text-amber-300" />
            <div>
              <h4 className="font-bold text-sm sm:text-base">Install App on Desktop & Mobile</h4>
              <p className="text-xs text-red-100">Add icon for 1-tap offline recall scanner anywhere</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onInstallPwa}
            className="px-4 py-2 bg-white text-red-600 rounded-xl text-xs font-extrabold shadow-sm hover:bg-slate-100 transition-colors shrink-0"
          >
            Install PWA
          </button>
        </div>
      )}

      {/* Official Data Source info */}
      <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-2 text-xs text-slate-600">
        <div className="flex items-center gap-2 text-slate-900 font-bold">
          <Info className="w-4 h-4 text-slate-500" />
          <span>Official Canadian Open Data</span>
        </div>
        <p className="leading-relaxed">
          Notices are provided directly by Health Canada, Canadian Food Inspection Agency (CFIA), and
          Transport Canada under the Open Government Licence – Canada.
        </p>
        <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
          <div className="p-3 bg-slate-50 border border-slate-200/70 rounded-xl text-[11px] text-slate-600 leading-relaxed">
            <strong className="text-slate-800">Non-Endorsement Disclaimer:</strong> This application is an independent public safety utility. It is not endorsed by, sponsored by, or affiliated with Health Canada, CFIA, Transport Canada, or the Government of Canada.
          </div>
          <a
            href="https://recalls-rappels.canada.ca/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-red-600 font-bold hover:underline inline-flex items-center gap-1 self-start"
          >
            <span>Visit Official Recalls Portal (Canada.ca)</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
