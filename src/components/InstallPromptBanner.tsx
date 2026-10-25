import React from 'react';
import { X, Smartphone } from 'lucide-react';

interface InstallPromptBannerProps {
  onInstall: () => void;
  onDismiss: () => void;
}

export const InstallPromptBanner: React.FC<InstallPromptBannerProps> = ({ onInstall, onDismiss }) => {
  return (
    <div className="bg-gradient-to-r from-red-600 via-red-700 to-slate-900 text-white px-4 py-3 rounded-2xl shadow-lg border border-red-500/30 flex items-center justify-between gap-4 animate-in slide-in-from-top duration-300">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
          <Smartphone className="w-5 h-5 text-amber-300" />
        </div>
        <div className="text-left">
          <h4 className="font-bold text-xs sm:text-sm leading-tight flex items-center gap-1.5">
            <span>Install Canada Recall Alert App</span>
            <span className="bg-white/20 text-[10px] font-bold px-1.5 py-0.5 rounded">PWA</span>
          </h4>
          <p className="text-[11px] text-red-100">
            Search 34,000+ safety alerts offline & check product photos anywhere from your home screen.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onInstall}
          className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-red-700 rounded-xl font-extrabold text-xs shadow-sm transition-all"
        >
          Install
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="p-1.5 text-white/70 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
