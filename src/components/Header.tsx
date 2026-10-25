import React from 'react';
import { RefreshCw, Camera } from 'lucide-react';
import { CanadaLogo } from './CanadaLogo';
import type { DatasetSyncState } from '../types/recall';

interface HeaderProps {
  syncState: DatasetSyncState;
  onRefreshFeed: () => void;
  onOpenScanner: () => void;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  syncState,
  onRefreshFeed,
  onOpenScanner
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-3 shadow-xs">
      <div className="max-w-md mx-auto flex items-center justify-between gap-2">
        {/* Left: Mobile App Title & Logo */}
        <CanadaLogo size={32} />

        {/* Right: Quick App Actions */}
        <div className="flex items-center gap-1.5">
          {/* Live Sync Status Pill */}
          <button
            type="button"
            onClick={onRefreshFeed}
            disabled={syncState.status === 'loading'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200/80 rounded-full text-[11px] font-semibold text-slate-700 transition-colors border border-slate-200/60"
            title="Refresh open data feed"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                syncState.status === 'loading'
                  ? 'bg-amber-400 animate-ping'
                  : syncState.status === 'error'
                    ? 'bg-red-500'
                    : 'bg-emerald-500'
              }`}
            />
            <span>
              {syncState.status === 'loading'
                ? 'Syncing...'
                : syncState.totalRecords > 0
                  ? `${syncState.totalRecords.toLocaleString()} Live`
                  : 'Offline'}
            </span>
            <RefreshCw
              className={`w-3 h-3 text-slate-400 ${syncState.status === 'loading' ? 'animate-spin text-red-600' : ''}`}
            />
          </button>

          {/* Quick Camera Scan Icon */}
          <button
            type="button"
            onClick={onOpenScanner}
            className="p-2 rounded-full bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all"
            title="Scan Product"
          >
            <Camera className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
