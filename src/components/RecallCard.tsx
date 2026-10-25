import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { RecallItem } from '../types/recall';

interface RecallCardProps {
  recall: RecallItem;
  onClick: () => void;
}

export const RecallCard: React.FC<RecallCardProps> = ({ recall, onClick }) => {
  const recallClass = (recall['Recall class'] || '').trim();
  const isClass1 =
    recallClass.toLowerCase().includes('class 1') || recallClass.toLowerCase().includes('type i');
  const isClass2 =
    recallClass.toLowerCase().includes('class 2') || recallClass.toLowerCase().includes('type ii');

  return (
    <article
      onClick={onClick}
      className="group relative bg-white rounded-2xl p-3.5 border border-slate-200/80 shadow-xs hover:border-red-400 active:scale-[0.99] transition-all flex flex-col justify-between cursor-pointer text-left"
    >
      <div>
        {/* Top meta row */}
        <div className="flex items-center justify-between gap-1.5 mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {recallClass && (
              <span
                className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                  isClass1
                    ? 'bg-red-600 text-white shadow-xs'
                    : isClass2
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-700 text-white'
                }`}
              >
                {recallClass}
              </span>
            )}
            {recall.Organization && (
              <span className="bg-slate-100 text-slate-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-200/60">
                {recall.Organization}
              </span>
            )}
          </div>

          <span className="text-[10px] text-slate-400 font-medium shrink-0">
            {recall['Last updated'] || 'Recent'}
          </span>
        </div>

        {/* Title */}
        <h3 className="font-extrabold text-xs sm:text-sm text-slate-900 group-hover:text-red-600 transition-colors line-clamp-2 leading-snug">
          {recall.Title}
        </h3>

        {/* Hazard alert preview */}
        {recall.Issue && (
          <div className="mt-2 p-2 bg-red-50/60 border border-red-100/80 rounded-xl flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 text-red-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-800 line-clamp-1 leading-snug">
              <strong>Hazard:</strong> {recall.Issue}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
        <span className="text-slate-400 truncate max-w-[200px]">
          {recall.Category || 'Notice'}
        </span>
        <span className="inline-flex items-center gap-0.5 text-red-600 font-bold group-hover:translate-x-0.5 transition-transform">
          <span>Details</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </article>
  );
};
