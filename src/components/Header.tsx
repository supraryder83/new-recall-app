import React from 'react';
import { RefreshCw, BellRing, AlertTriangle } from 'lucide-react';
import { CanadaLogo } from './CanadaLogo';
import type { DatasetSyncState } from '../types/recall';

interface HeaderProps {
  syncState: DatasetSyncState;
  onRefreshFeed: () => void;
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
  alertCount?: number;
  onOpenAlerts?: () => void;
  onOpenNotifications?: () => void;
  notificationsGranted?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  syncState,
  onRefreshFeed,
  alertCount = 0,
  onOpenAlerts,
  onOpenNotifications,
  notificationsGranted = false
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3.5 py-2.5 shadow-xs">
      <div className="max-w-md mx-auto flex items-center justify-between gap-2">
        {/* Left: Mobile App Title & Logo */}
        <CanadaLogo size={30} />

        {/* Right: Quick App Actions (Alert Icon & Bell Icon) */}
        <div className="flex items-center gap-1.5">
          {/* Top Alert Icon (Prominently displayed at top of screen when recalls are detected) */}
          {alertCount > 0 && (
            <button
              type="button"
              onClick={onOpenAlerts}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full text-[11px] font-extrabold shadow-xs animate-pulse transition-all"
              title={`${alertCount} active Canadian safety recall alert${alertCount > 1 ? 's' : ''}`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-white" />
              <span>{alertCount} Alert{alertCount > 1 ? 's' : ''}</span>
            </button>
          )}

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
                ? 'Syncing'
                : syncState.totalRecords > 0
                  ? `${syncState.totalRecords.toLocaleString()} Live`
                  : 'Offline'}
            </span>
            <RefreshCw
              className={`w-3 h-3 text-slate-400 ${syncState.status === 'loading' ? 'animate-spin text-red-600' : ''}`}
            />
          </button>

          {/* Notification Bell Icon */}
          <button
            type="button"
            onClick={onOpenNotifications}
            className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all relative border border-slate-200/70 active:scale-95"
            title="Recall Notifications & 6-Hour Monitor"
            aria-label="Recall Notifications"
          >
            <BellRing className="w-4 h-4 text-slate-700" />
            {notificationsGranted && (
              <span
                className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full ring-1 ring-white"
                title="Notifications active"
              />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
