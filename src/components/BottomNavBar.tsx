import React from 'react';
import { ShieldAlert, LayoutGrid, Settings, History } from 'lucide-react';

export type MobileTab = 'feed' | 'categories' | 'history' | 'settings';

interface BottomNavBarProps {
  currentTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  onOpenScanner?: () => void;
  unreadCount?: number;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  currentTab,
  onTabChange
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-safe md:hidden">
      <div className="max-w-md mx-auto px-2 h-16 grid grid-cols-4 items-center">
        {/* Tab 1: Alert Feed */}
        <button
          type="button"
          onClick={() => onTabChange('feed')}
          className={`flex flex-col items-center justify-center py-1 transition-all ${
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

        {/* Tab 2: Categories */}
        <button
          type="button"
          onClick={() => onTabChange('categories')}
          className={`flex flex-col items-center justify-center py-1 transition-all ${
            currentTab === 'categories'
              ? 'text-red-600 font-bold scale-105'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[10px] mt-1 tracking-tight">Categories</span>
        </button>

        {/* Tab 3: Scan History */}
        <button
          type="button"
          onClick={() => onTabChange('history')}
          className={`flex flex-col items-center justify-center py-1 transition-all ${
            currentTab === 'history'
              ? 'text-red-600 font-bold scale-105'
              : 'text-slate-500 hover:text-slate-800 font-medium'
          }`}
        >
          <div className="relative">
            <History className="w-5 h-5" />
          </div>
          <span className="text-[10px] mt-1 tracking-tight">History</span>
        </button>

        {/* Tab 4: Settings */}
        <button
          type="button"
          onClick={() => onTabChange('settings')}
          className={`flex flex-col items-center justify-center py-1 transition-all ${
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
