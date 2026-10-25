import React from 'react';
import {
  X,
  ExternalLink,
  ShieldAlert,
  Calendar,
  Share2,
  Check
} from 'lucide-react';
import type { RecallItem } from '../types/recall';

interface RecallDetailModalProps {
  recall: RecallItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export const RecallDetailModal: React.FC<RecallDetailModalProps> = ({ recall, isOpen, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen || !recall) return null;

  const handleShare = async () => {
    const shareData = {
      title: recall.Title,
      text: `Canadian Safety Recall Alert: ${recall.Product || recall.Title}`,
      url: recall.URL || window.location.href
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(`${shareData.text} - ${shareData.url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  };

  const recallClass = (recall['Recall class'] || '').trim();
  const isClass1 = recallClass.toLowerCase().includes('class 1') || recallClass.toLowerCase().includes('type i');
  const isClass2 = recallClass.toLowerCase().includes('class 2') || recallClass.toLowerCase().includes('type ii');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl md:max-w-2xl max-h-[90vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-bottom duration-300 sm:zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Pull Handle (Hidden on desktop) */}
        <div className="pt-2.5 pb-1 flex justify-center bg-white shrink-0 sm:hidden">
          <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
        </div>

        {/* Top Header */}
        <div className="px-5 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 flex items-start justify-between shrink-0 bg-white">
          <div className="space-y-1.5 pr-4 text-left">
            <div className="flex flex-wrap items-center gap-1.5">
              {recallClass && (
                <span
                  className={`text-[10px] sm:text-xs font-extrabold px-2 py-0.5 rounded uppercase tracking-wider ${
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
                <span className="bg-slate-100 text-slate-700 text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded border border-slate-200/60">
                  {recall.Organization}
                </span>
              )}
              {recall.Category && (
                <span className="bg-slate-100 text-slate-600 text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded">
                  {recall.Category}
                </span>
              )}
              {recall.NID && (
                <span className="bg-slate-100 text-slate-500 font-mono text-[10px] sm:text-xs px-2 py-0.5 rounded">
                  ID: #{recall.NID}
                </span>
              )}
              <span className="text-[10px] sm:text-xs text-slate-400 font-medium flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-400" />
                {recall['Last updated']}
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${recall.Archived === '1' ? 'bg-slate-200 text-slate-600' : 'bg-red-100 text-red-700'}`}>
                {recall.Archived === '1' ? 'Archived' : 'Active Notice'}
              </span>
            </div>
            <h3 className="font-extrabold text-sm sm:text-lg text-slate-900 leading-snug pt-0.5">
              {recall.Title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 text-left">
          {/* Risk Level Card */}
          {recallClass && (
            <div
              className={`p-3 sm:p-4 rounded-2xl border text-xs sm:text-sm flex items-start gap-3 ${
                isClass1
                  ? 'bg-red-50 border-red-200 text-red-950'
                  : isClass2
                    ? 'bg-amber-50 border-amber-200 text-amber-950'
                    : 'bg-blue-50 border-blue-200 text-blue-950'
              }`}
            >
              <div
                className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                  isClass1 ? 'bg-red-600 text-white' : isClass2 ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'
                }`}
              >
                <ShieldAlert className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <strong className="block font-bold">
                  {isClass1 ? 'Class 1 High Risk' : isClass2 ? 'Class 2 Moderate Hazard' : 'Class 3 Low Risk'}
                </strong>
                <p className="text-[11px] sm:text-xs opacity-90 mt-0.5 leading-relaxed">
                  {isClass1
                    ? 'High probability of serious adverse health consequences or life-threatening injury.'
                    : isClass2
                      ? 'May cause temporary adverse health consequences.'
                      : 'Not likely to cause adverse health consequences.'}
                </p>
              </div>
            </div>
          )}

          {/* Product & Hazard Grid (2 columns on tablet/desktop) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 sm:p-4 bg-slate-50 border border-slate-200/70 rounded-2xl">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Affected Product
              </span>
              <p className="text-xs sm:text-sm font-bold text-slate-900 leading-snug">
                {recall.Product || recall.Title}
              </p>
              {recall.Category && (
                <span className="inline-block mt-1 text-[11px] text-slate-500 font-medium">
                  {recall.Category}
                </span>
              )}
            </div>

            <div className="p-3.5 sm:p-4 bg-red-50/60 border border-red-100 rounded-2xl">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 block mb-1">
                Safety Hazard / Defect
              </span>
              <p className="text-xs sm:text-sm font-semibold text-red-900 leading-snug">
                {recall.Issue || 'Product safety defect or health risk.'}
              </p>
            </div>
          </div>

          {/* What you should do */}
          {recall['What you should do'] && (
            <div className="p-4 sm:p-5 bg-slate-50 border border-slate-200/70 rounded-2xl">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                What You Should Do (Official Instructions)
              </span>
              <p className="text-xs sm:text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                {recall['What you should do']}
              </p>
            </div>
          )}
        </div>

        {/* Bottom Actions */}
        <div className="px-5 sm:px-6 py-3.5 sm:py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0 pb-safe">
          <button
            type="button"
            onClick={handleShare}
            className="p-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-100 transition-colors shadow-xs"
            title="Share recall notice"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Share2 className="w-4 h-4" />}
          </button>

          {recall.URL && (
            <a
              href={recall.URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm flex items-center justify-center gap-2 transition-colors"
            >
              <span>Canada.ca Official Notice</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
