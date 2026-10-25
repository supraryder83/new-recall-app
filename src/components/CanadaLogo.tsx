import React from 'react';

interface CanadaLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

export const CanadaLogo: React.FC<CanadaLogoProps> = ({
  className = '',
  size = 40,
  showText = true
}) => {
  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <div
        className="relative flex items-center justify-center shrink-0 transition-transform duration-300 hover:scale-105"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full drop-shadow-md"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Shield Outline with subtle gradient */}
          <defs>
            <linearGradient id="shieldGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ef4444" />
              <stop offset="1" stopColor="#b91c1c" />
            </linearGradient>
            <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#fde047" />
              <stop offset="1" stopColor="#eab308" />
            </linearGradient>
          </defs>

          {/* Shield Outer Shape */}
          <path
            d="M50 4
               C74 4, 92 12, 92 36
               C92 68, 64 88, 50 96
               C36 88, 8 68, 8 36
               C8 12, 26 4, 50 4 Z"
            fill="url(#shieldGrad)"
          />

          {/* Shield Inner Border */}
          <path
            d="M50 9
               C70 9, 86 16, 86 37
               C86 64, 61 82, 50 90
               C39 82, 14 64, 14 37
               C14 16, 30 9, 50 9 Z"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="2"
            fill="none"
          />

          {/* Stylized Canadian Maple Leaf (11-point national emblem) */}
          <path
            d="M50 18
               L54 32
               L66 26
               L64 38
               L78 42
               L69 53
               L74 62
               L59 61
               L53 73
               L52 82
               L48 82
               L47 73
               L41 61
               L26 62
               L31 53
               L22 42
               L36 38
               L34 26
               L46 32
               Z"
            fill="#ffffff"
          />

          {/* Alert Beacon / Shield Badge in Corner */}
          <circle cx="74" cy="74" r="14" fill="#0f172a" stroke="#ffffff" strokeWidth="2.5" />
          <rect x="72.2" y="65" width="3.6" height="10" rx="1.8" fill="url(#goldGrad)" />
          <circle cx="74" cy="79" r="1.8" fill="url(#goldGrad)" />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col text-left leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-xl tracking-tight text-slate-900 font-sans">
              Canada<span className="text-red-600 ml-1">Recall</span>
            </span>
            <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
              Alert
            </span>
          </div>
          <span className="text-[11px] font-medium text-slate-500 tracking-wide">
            Official Safety & Recall Intelligence
          </span>
        </div>
      )}
    </div>
  );
};
