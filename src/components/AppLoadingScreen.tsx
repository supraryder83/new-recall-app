import React, { useEffect, useState } from 'react';

interface AppLoadingScreenProps {
  isLoading: boolean;
  progressPercent: number;
  statusText: string;
}

export const AppLoadingScreen: React.FC<AppLoadingScreenProps> = ({
  isLoading,
  progressPercent,
  statusText
}) => {
  const [shouldRender, setShouldRender] = useState(isLoading);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setIsFadingOut(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 450); // Matches fade-out transition duration
      return () => clearTimeout(timer);
    } else {
      setShouldRender(true);
      setIsFadingOut(false);
    }
  }, [isLoading]);

  if (!shouldRender) return null;

  const clampedPercent = Math.min(Math.max(Math.round(progressPercent), 5), 100);

  return (
    <div
      id="app-initial-loading-screen"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center p-6 bg-slate-950 text-white transition-opacity duration-400 ease-out select-none ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      aria-label="Loading Canada Recall Alert"
      role="status"
    >
      {/* Ambient background glows */}
      <div className="absolute w-96 h-96 rounded-full bg-red-600/15 blur-3xl pointer-events-none -top-10 -left-10" />
      <div className="absolute w-96 h-96 rounded-full bg-rose-600/15 blur-3xl pointer-events-none -bottom-10 -right-10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,38,38,0.12)_0%,transparent_70%)] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center text-center max-w-sm w-full mx-auto animate-in fade-in zoom-in-95 duration-300">
        {/* Logo Container with gentle pulse and glow */}
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-red-600/30 rounded-3xl blur-xl transform scale-110 animate-pulse pointer-events-none" />
          <img
            src="/icons/app-logo.png"
            alt="Canada Recall Alert Logo"
            className="relative w-28 h-28 sm:w-32 sm:h-32 object-contain drop-shadow-[0_12px_24px_rgba(220,38,38,0.4)] animate-in zoom-in duration-500"
          />
        </div>

        {/* App Title & Badge */}
        <div className="space-y-1.5 mb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-[10px] font-extrabold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
            <span>Canadian Safety Monitor</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            Canada Recall Alert
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            Health Canada, CFIA & Transport Canada Official Notices
          </p>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full max-w-xs space-y-2.5">
          {/* Track */}
          <div className="w-full h-2 bg-slate-800/90 rounded-full overflow-hidden p-0.5 border border-slate-700/60 shadow-inner">
            {/* Fill */}
            <div
              className="h-full rounded-full bg-linear-to-r from-red-600 via-rose-500 to-amber-400 transition-all duration-300 ease-out relative shadow-[0_0_12px_rgba(239,68,68,0.6)]"
              style={{ width: `${clampedPercent}%` }}
            >
              {/* Shimmer light effect */}
              <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
            </div>
          </div>

          {/* Progress Status Text & Percentage */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold px-0.5 min-w-0 gap-2">
            <span className="truncate text-left" title={statusText}>
              {statusText}
            </span>
            <span className="shrink-0 font-mono text-slate-300 font-bold">
              {clampedPercent}%
            </span>
          </div>
        </div>

        {/* Subtle bottom note */}
        <p className="mt-8 text-[10px] text-slate-500 tracking-wide font-medium">
          Verifying 34,000+ Canadian safety notices
        </p>
      </div>
    </div>
  );
};
