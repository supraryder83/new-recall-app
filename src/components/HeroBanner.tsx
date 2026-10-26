import React from 'react';
import { Camera, Database, ArrowRight } from 'lucide-react';
import type { CategoryFilter } from '../types/recall';

interface HeroBannerProps {
  totalCount: number;
  onOpenScanner: () => void;
  onSelectCategory: (cat: CategoryFilter) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  totalCount,
  onOpenScanner
}) => {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6 sm:p-8 shadow-xl border border-slate-800">
      {/* Decorative background accents */}
      <div className="absolute -right-16 -top-16 w-64 h-64 bg-red-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute right-32 -bottom-20 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-2xl text-left space-y-4">
        {/* Top Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-semibold text-slate-200 border border-white/10">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span>Government of Canada Open Data Feed</span>
        </div>

        {/* Main Title */}
        <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
          Protect Your Family With Real-Time{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-500">
            Canadian Recall
          </span>{' '}
          Alerts.
        </h1>

        {/* Subtitle */}
        <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-normal">
          Instant safety alerts directly from Health Canada, CFIA, and Transport Canada. Use our guided
          <strong> 2-photo camera scanner</strong> to photograph your item and its up-close serial & model
          number tag for forensic recall verification.
        </p>

        {/* Disclaimer Note */}
        <p className="text-[11px] text-slate-400 font-medium">
          Disclaimer: Independent safety resource. Not endorsed by, affiliated with, or sponsored by Health Canada, CFIA, or the Government of Canada.
        </p>

        {/* CTA Buttons */}
        <div className="pt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenScanner}
            className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white font-extrabold text-sm rounded-2xl shadow-lg shadow-red-600/30 flex items-center gap-2.5 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Camera className="w-4 h-4" />
            <span>Scan Item to Check Recalls</span>
            <ArrowRight className="w-4 h-4 ml-0.5" />
          </button>

          <div className="flex items-center gap-2 text-xs text-slate-300 bg-white/5 border border-white/10 px-3.5 py-2.5 rounded-2xl">
            <Database className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong className="text-white">{totalCount.toLocaleString()}</strong> Recalls Cached Offline
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
