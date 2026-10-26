import React from 'react';
import {
  ShieldAlert,
  LayoutGrid,
  Camera,
  Settings,
  RefreshCw,
  Download,
  Database,
  ExternalLink,
  History,
  BookmarkCheck
} from 'lucide-react';
import { CanadaLogo } from './CanadaLogo';
import type { DatasetSyncState } from '../types/recall';
import type { MobileTab } from './BottomNavBar';

interface SidebarProps {
  currentTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  onOpenScanner: () => void;
  syncState: DatasetSyncState;
  onRefreshFeed: () => void;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  onOpenScanner,
  syncState,
  onRefreshFeed,
  canInstallPwa,
  onInstallPwa
}) => {
  const formatSyncTime = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const minsAgo = Math.floor((Date.now() - timestamp) / (1000 * 60));
    if (minsAgo < 1) return 'Just now';
    if (minsAgo < 60) return `${minsAgo}m ago`;
    const hoursAgo = Math.floor(minsAgo / 60);
    return `${hoursAgo}h ago`;
  };

  return (
    <aside className="hidden md:flex flex-col w-64 lg:w-72 shrink-0 bg-white border-r border-slate-200/80 p-5 sticky top-0 h-screen overflow-y-auto justify-between select-none">
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="pb-2">
          <CanadaLogo size={36} showText={true} />
        </div>

        {/* Primary Action Button: 2-Step Camera Scan */}
        <button
          type="button"
          onClick={onOpenScanner}
          className="w-full py-3 px-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-2xl font-extrabold text-sm shadow-md shadow-red-600/25 hover:shadow-red-600/35 active:scale-[0.98] transition-all flex items-center justify-center gap-2.5"
        >
          <Camera className="w-4 h-4" />
          <span>Scan Item</span>
          <span className="bg-white/20 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
            2-Step
          </span>
        </button>

        {/* Navigation Items */}
        <nav className="space-y-1.5 text-sm font-semibold">
          {/* Alerts Feed */}
          <button
            type="button"
            onClick={() => onTabChange('feed')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all ${
              currentTab === 'feed'
                ? 'bg-red-50 text-red-600 font-extrabold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <ShieldAlert
                className={`w-4 h-4 ${currentTab === 'feed' ? 'text-red-600' : 'text-slate-400'}`}
              />
              <span>Safety Alerts</span>
            </div>
            {syncState.totalRecords > 0 && (
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                  currentTab === 'feed'
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {syncState.totalRecords.toLocaleString()}
              </span>
            )}
          </button>

          {/* Categories */}
          <button
            type="button"
            onClick={() => onTabChange('categories')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all ${
              currentTab === 'categories'
                ? 'bg-red-50 text-red-600 font-extrabold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <LayoutGrid
                className={`w-4 h-4 ${currentTab === 'categories' ? 'text-red-600' : 'text-slate-400'}`}
              />
              <span>Categories</span>
            </div>
            <span className="text-[10px] text-slate-400">4 Depts</span>
          </button>

          {/* Watchlist */}
          <button
            type="button"
            onClick={() => onTabChange('watchlist')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all ${
              currentTab === 'watchlist'
                ? 'bg-red-50 text-red-600 font-extrabold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <BookmarkCheck
                className={`w-4 h-4 ${currentTab === 'watchlist' ? 'text-red-600' : 'text-slate-400'}`}
              />
              <span>Watchlist</span>
            </div>
            <span className="text-[10px] text-red-600 bg-red-50 font-bold px-1.5 py-0.5 rounded">6h Sync</span>
          </button>

          {/* Scan History */}
          <button
            type="button"
            onClick={() => onTabChange('history')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all ${
              currentTab === 'history'
                ? 'bg-red-50 text-red-600 font-extrabold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <History
                className={`w-4 h-4 ${currentTab === 'history' ? 'text-red-600' : 'text-slate-400'}`}
              />
              <span>Scan History</span>
            </div>
            <span className="text-[10px] text-slate-400">Logs</span>
          </button>

          {/* Settings */}
          <button
            type="button"
            onClick={() => onTabChange('settings')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all ${
              currentTab === 'settings'
                ? 'bg-red-50 text-red-600 font-extrabold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <Settings
                className={`w-4 h-4 ${currentTab === 'settings' ? 'text-red-600' : 'text-slate-400'}`}
              />
              <span>Settings</span>
            </div>
          </button>
        </nav>
      </div>

      {/* Bottom Sync Info & Utilities in Sidebar */}
      <div className="space-y-3 pt-6 border-t border-slate-100 text-left">
        {/* PWA Install Button if available */}
        {canInstallPwa && (
          <button
            type="button"
            onClick={onInstallPwa}
            className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-amber-300" />
            <span>Install App (PWA)</span>
          </button>
        )}

        {/* Database Sync Card */}
        <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              <span>Offline Database</span>
            </div>
            <button
              type="button"
              onClick={onRefreshFeed}
              disabled={syncState.status === 'loading'}
              className="p-1 hover:text-red-600 transition-colors disabled:opacity-50"
              title="Force sync live feed"
            >
              <RefreshCw
                className={`w-3 h-3 text-slate-400 ${syncState.status === 'loading' ? 'animate-spin text-red-600' : ''}`}
              />
            </button>
          </div>

          <div className="text-[11px] text-slate-500 space-y-0.5">
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="font-semibold text-slate-700 capitalize">
                {syncState.status === 'loading' ? 'Syncing...' : syncState.source}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Updated:</span>
              <span className="text-slate-700">{formatSyncTime(syncState.lastSynced)}</span>
            </div>
          </div>
        </div>

        {/* Source link */}
        <div className="text-[11px] text-slate-400 flex items-center justify-between px-1">
          <span>Canada Open Data</span>
          <a
            href="https://recalls-rappels.canada.ca/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-red-600 transition-colors flex items-center gap-0.5"
          >
            <span>Portal</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </aside>
  );
};
