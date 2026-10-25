import React from 'react';

interface CanadaLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

export const CanadaLogo: React.FC<CanadaLogoProps> = ({
  className = '',
  showText = true
}) => {
  if (!showText) return null;

  return (
    <div className={`flex flex-col text-left leading-tight select-none ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-extrabold text-lg sm:text-xl tracking-tight text-slate-900 font-sans">
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
  );
};
