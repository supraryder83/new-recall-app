import React, { useState } from 'react';
import {
  Sparkles,
  Database,
  RefreshCw,
  Download,
  Trash2,
  ExternalLink,
  Check,
  Info,
  Key,
  AlertTriangle,
  Save
} from 'lucide-react';
import { recallStorage } from '../services/storage';
import {
  getGeminiApiKeySource,
  setGeminiApiKey,
  getMaskedApiKey
} from '../services/gemini';
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
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keySavedMsg, setKeySavedMsg] = useState(false);
  const [keySource, setKeySource] = useState<'env' | 'localStorage' | 'none'>(getGeminiApiKeySource());

  const handleSaveCustomKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;
    setGeminiApiKey(apiKeyInput.trim());
    setKeySource(getGeminiApiKeySource());
    setApiKeyInput('');
    setShowKeyInput(false);
    setKeySavedMsg(true);
    setTimeout(() => setKeySavedMsg(false), 3000);
  };

  const handleRemoveCustomKey = () => {
    setGeminiApiKey('');
    setKeySource(getGeminiApiKeySource());
    setKeySavedMsg(true);
    setTimeout(() => setKeySavedMsg(false), 3000);
  };

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
        <p className="text-xs md:text-sm text-slate-500 mt-0.5">Offline database, AI engine & system info</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 md:gap-4">
        {/* AI Engine Status Card */}
        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-amber-50 rounded-xl text-amber-600">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-900">Gemini 2.5 Flash Vision</h4>
                <p className="text-xs text-slate-500">Google GenAI Multimodal Recognition</p>
              </div>
            </div>
            {keySource === 'env' ? (
              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider bg-emerald-100 text-emerald-800 flex items-center gap-1 shadow-2xs">
                <Check className="w-3 h-3 text-emerald-600" />
                Active (.env)
              </span>
            ) : keySource === 'localStorage' ? (
              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider bg-blue-100 text-blue-800 flex items-center gap-1 shadow-2xs">
                <Check className="w-3 h-3 text-blue-600" />
                Custom Key
              </span>
            ) : (
              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider bg-amber-100 text-amber-800 flex items-center gap-1 shadow-2xs">
                <AlertTriangle className="w-3 h-3 text-amber-600" />
                Key Missing
              </span>
            )}
          </div>

          {/* Key Status Message */}
          {keySource === 'env' ? (
            <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-xl text-xs space-y-1.5 text-emerald-950">
              <div className="flex items-center justify-between font-semibold">
                <span>Loaded from environment:</span>
                <span className="font-mono bg-white px-2 py-0.5 rounded border border-emerald-200 text-emerald-800">
                  {getMaskedApiKey()}
                </span>
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed">
                Your key is securely loaded from <code className="font-mono font-bold">.env</code> (<code className="font-mono">VITE_GEMINI_API_KEY</code>). Multimodal label recognition is active.
              </p>
            </div>
          ) : keySource === 'localStorage' ? (
            <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs space-y-1.5 text-blue-950">
              <div className="flex items-center justify-between font-semibold">
                <span>Using Custom Saved Key:</span>
                <span className="font-mono bg-white px-2 py-0.5 rounded border border-blue-200 text-blue-800">
                  {getMaskedApiKey()}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-blue-700">Stored in browser localStorage</span>
                <button
                  type="button"
                  onClick={handleRemoveCustomKey}
                  className="text-[11px] text-red-600 hover:underline font-semibold"
                >
                  Remove Key
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs space-y-2 text-amber-950">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">No API Key Detected</span>
                  <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                    Configure <code className="font-mono font-bold bg-amber-100/80 px-1 py-0.2 rounded">VITE_GEMINI_API_KEY=your_key</code> in your <code className="font-mono">.env</code> file (then restart server), or paste it directly below:
                  </p>
                </div>
              </div>

              {!showKeyInput && (
                <button
                  type="button"
                  onClick={() => setShowKeyInput(true)}
                  className="w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Paste API Key Directly</span>
                </button>
              )}
            </div>
          )}

          {/* Direct Key Input Form */}
          {showKeyInput && (
            <form onSubmit={handleSaveCustomKey} className="space-y-2 animate-in fade-in pt-1">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                  <Key className="w-3.5 h-3.5" />
                </div>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste Gemini API key (AIzaSy...)"
                  className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!apiKeyInput.trim()}
                  className="flex-1 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1 shadow-xs"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Key</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowKeyInput(false)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {keySavedMsg && (
            <div className="p-2 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Gemini API key updated successfully!</span>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
            <span>Model: <strong className="text-slate-700">gemini-2.5-flash</strong></span>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-600 hover:underline font-semibold inline-flex items-center gap-1"
            >
              <span>Get Free Key</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

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
