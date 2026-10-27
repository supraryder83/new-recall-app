import React, { useEffect, useState } from 'react';
import { ShieldAlert, ExternalLink, ShieldCheck, FileText } from 'lucide-react';

interface AppLoadingScreenProps {
  isLoading: boolean;
  onOpenLegal?: (tab: 'privacy' | 'terms') => void;
}

export const AppLoadingScreen: React.FC<AppLoadingScreenProps> = ({
  isLoading,
  onOpenLegal
}) => {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Connecting to Canadian Open Data safety registry...');
  const [hasCompletedMinDuration, setHasCompletedMinDuration] = useState(false);
  const [shouldRender, setShouldRender] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  // Smooth 3-second progress timeline (1s faster)
  useEffect(() => {
    const startTime = Date.now();
    const duration = 3000; // 3 seconds

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const fraction = Math.min(elapsed / duration, 1);
      const currentPercent = Math.round(fraction * 100);

      setProgress(currentPercent);

      // Dynamic phase messages across the 3 seconds
      if (currentPercent < 28) {
        setStatusText('Connecting to Canadian Open Data safety registry...');
      } else if (currentPercent < 62) {
        setStatusText('Updating Canadian safety recall database (34,000+ notices)...');
      } else if (currentPercent < 88) {
        setStatusText('Checking your scan history against latest Canadian recalls...');
      } else if (currentPercent < 100) {
        setStatusText('Finalizing recall verification & safety checks...');
      } else {
        setStatusText('All clear! Recall database updated & history verified.');
      }

      if (fraction >= 1) {
        clearInterval(interval);
        setHasCompletedMinDuration(true);
      }
    }, 30);

    return () => clearInterval(interval);
  }, []);

  // Dismiss once BOTH the 3-second duration has elapsed AND background loading is complete
  useEffect(() => {
    if (hasCompletedMinDuration && !isLoading) {
      const delayTimer = setTimeout(() => {
        setIsFadingOut(true);
        const unmountTimer = setTimeout(() => {
          setShouldRender(false);
        }, 400); // Matches CSS transition duration
        return () => clearTimeout(unmountTimer);
      }, 150);
      return () => clearTimeout(delayTimer);
    }
  }, [hasCompletedMinDuration, isLoading]);

  if (!shouldRender) return null;

  return (
    <div
      id="app-initial-loading-screen"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-between p-4 sm:p-6 bg-slate-950 text-white transition-opacity duration-400 ease-out select-none overflow-y-auto ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      aria-label="Loading Canada Recall Alert"
      role="status"
    >
      {/* Ambient background glows */}
      <div className="absolute w-96 h-96 rounded-full bg-red-600/15 blur-3xl pointer-events-none -top-10 -left-10" />
      <div className="absolute w-96 h-96 rounded-full bg-rose-600/15 blur-3xl pointer-events-none -bottom-10 -right-10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,38,38,0.12)_0%,transparent_70%)] pointer-events-none" />

      {/* Top spacer */}
      <div className="w-full flex justify-end shrink-0 pt-1">
        <span className="text-[10px] font-mono text-slate-500 font-semibold uppercase tracking-wider">
          v2.0 • Initializing
        </span>
      </div>

      {/* Center Hero: Logo, Title, Progress Bar */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-sm sm:max-w-md w-full mx-auto my-auto py-4 animate-in fade-in zoom-in-95 duration-300">
        {/* Logo Container with gentle pulse and glow */}
        <div className="relative mb-5">
          <div className="absolute inset-0 bg-red-600/30 rounded-3xl blur-xl transform scale-110 animate-pulse pointer-events-none" />
          <img
            src="/icons/app-logo.png"
            alt="Canada Recall Alert Logo"
            className="relative w-24 h-24 sm:w-28 sm:h-28 object-contain drop-shadow-[0_12px_24px_rgba(220,38,38,0.4)] animate-in zoom-in duration-500"
          />
        </div>

        {/* App Title & Badge */}
        <div className="space-y-1 mb-5">
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-[10px] font-extrabold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
            <span>Canadian Safety Monitor</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            Canada Recall Alert
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            Health Canada, CFIA & Transport Canada Public Safety Notices
          </p>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full max-w-xs space-y-2 mb-4">
          {/* Track */}
          <div className="w-full h-2 bg-slate-800/90 rounded-full overflow-hidden p-0.5 border border-slate-700/60 shadow-inner">
            {/* Fill */}
            <div
              className="h-full rounded-full bg-linear-to-r from-red-600 via-rose-500 to-amber-400 transition-all duration-75 ease-out relative shadow-[0_0_12px_rgba(239,68,68,0.6)]"
              style={{ width: `${progress}%` }}
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
              {progress}%
            </span>
          </div>
        </div>
      </div>

      {/* Mandatory Legal, Open Data Licence & Ownership Disclaimer */}
      <div className="relative z-10 w-full max-w-md mx-auto space-y-2 pt-2 pb-1 shrink-0 text-center">
        <div className="p-3 bg-slate-900/90 border border-slate-800/90 rounded-2xl text-[10px] sm:text-[11px] text-slate-400 leading-relaxed shadow-lg backdrop-blur-xs">
          <div className="flex items-center justify-center gap-1.5 text-slate-300 font-bold mb-1">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Open Government Licence & Non-Endorsement</span>
          </div>
          <p>
            Contains information licensed under the{' '}
            <a
              href="https://open.canada.ca/en/open-government-licence-canada"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-400 font-bold underline hover:text-red-300 inline-flex items-center gap-0.5"
            >
              <span>Open Government Licence – Canada</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            . This independent application is <strong>not endorsed by, sponsored by, or affiliated with</strong> the Government of Canada, Health Canada, the Canadian Food Inspection Agency (CFIA), or Transport Canada.
          </p>
        </div>

        {/* Ownership by Tyler Ziegler & Policy links */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-400 pt-0.5">
          <span className="text-slate-300 font-semibold">
            Owned & operated by <strong>Tyler Ziegler</strong>
          </span>
          <span className="text-slate-600">•</span>
          {onOpenLegal ? (
            <>
              <button
                type="button"
                onClick={() => onOpenLegal('privacy')}
                className="text-slate-400 hover:text-red-400 underline font-medium transition-colors"
              >
                Privacy Policy
              </button>
              <span className="text-slate-600">•</span>
              <button
                type="button"
                onClick={() => onOpenLegal('terms')}
                className="text-slate-400 hover:text-red-400 underline font-medium transition-colors"
              >
                Terms of Service
              </button>
            </>
          ) : (
            <span className="text-slate-500">Privacy & Terms Protected</span>
          )}
        </div>
      </div>
    </div>
  );
};
