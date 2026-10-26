import React from 'react';
import { ShieldAlert, Camera, Settings, History, BookmarkCheck } from 'lucide-react';

export type MobileTab = 'feed' | 'categories' | 'watchlist' | 'history' | 'settings';

interface BottomNavBarProps {
  currentTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  onOpenScanner: () => void;
  unreadCount?: number;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  currentTab,
  onTabChange,
  onOpenScanner
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-safe md:hidden">
      <div className="max-w-md mx-auto px-2 h-16 flex items-center justify-between relative">
        {/* Tab 1: Alert Feed */}
        <button
          type="button"
          onClick={() => onTabChange('feed')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
            currentTab === 'feed'
              ? 'text-red-600 font-bold scale-105'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <div className="relative">
            <ShieldAlert className="w-5 h-5" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-600 rounded-full" />
          </div>
          <span className="text-[10px] mt-1 tracking-tight">Alerts</span>
        </button>

        {/* Tab 2: Watchlist */}
        <button
          type="button"
          onClick={() => onTabChange('watchlist')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
            currentTab === 'watchlist'
              ? 'text-red-600 font-bold scale-105'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <BookmarkCheck className="w-5 h-5" />
          <span className="text-[10px] mt-1 tracking-tight">Watchlist</span>
        </button>

        {/* CENTER PROMINENT CAMERA 2-STEP RECALL SCAN BUTTON */}
        <div className="relative -top-5 flex flex-col items-center px-1">
          <button
            type="button"
            onClick={onOpenScanner}
            className="w-13 h-13 rounded-full bg-linear-to-tr from-red-600 via-red-600 to-red-500 text-white shadow-lg shadow-red-600/40 hover:shadow-red-600/60 active:scale-95 transition-all flex items-center justify-center border-4 border-white ring-2 ring-red-500/20"
            aria-label="Scan Item to Check Recalls"
            title="Scan Item"
          >
            <Camera className="w-5 h-5 animate-pulse-subtle" />
          </button>
          <span className="text-[9px] font-extrabold text-red-600 mt-0.5 tracking-tight">
            Scan
          </span>
        </div>

        {/* Tab 3: History */}
        <button
          type="button"
          onClick={() => onTabChange('history')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
            currentTab === 'history'
              ? 'text-red-600 font-bold scale-105'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <History className="w-5 h-5" />
          <span className="text-[10px] mt-1 tracking-tight">History</span>
        </button>

        {/* Tab 4: Settings */}
        <button
          type="button"
          onClick={() => onTabChange('settings')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
            currentTab === 'settings'
              ? 'text-red-600 font-bold scale-105'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] mt-1 tracking-tight">Settings</span>
        </button>
      </div>
    </nav>
  );
};
