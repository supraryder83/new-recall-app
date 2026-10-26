import React from 'react';
import {
  Sparkles,
  Database,
  RefreshCw,
  Download,
  Trash2,
  ExternalLink,
  Info
} from 'lucide-react';
import { recallStorage } from '../services/storage';
import type { DatasetSyncState } from '../types/recall';

interface SettingsViewProps {
  syncState: DatasetSyncState;
  onRefreshFeed: () => void;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  syncState,
  onRefreshFeed,
  canInstallPwa,
  onInstallPwa
}) => {
  const handleClearCache = async () => {
    if (confirm('Clear offline recall cache from IndexedDB?')) {
      await recallStorage.clear();
      onRefreshFeed();
    }
  };

  const formatSyncTime = (timestamp: number | null) => {
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
        <p className="text-xs md:text-sm text-slate-500 mt-0.5">Offline database, AI recognition & system info</p>
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

        {/* AI Recognition Engine Card (Clean, no API key details) */}
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
            <span>Engine: <strong className="text-slate-700">Gemini 2.5 Flash Lite</strong></span>
            <span className="text-emerald-600 font-semibold">Enabled</span>
          </div>
        </div>
      </div>

      {/* PWA Install Card */}
      {canInstallPwa && (
        <div className="p-4 sm:p-5 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-2xl shadow-sm flex items-center justify-between">
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
        <a
          href="https://recalls-rappels.canada.ca/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-red-600 font-bold hover:underline inline-flex items-center gap-1 pt-1"
        >
          <span>recalls-rappels.canada.ca</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
};
