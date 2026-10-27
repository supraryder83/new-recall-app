import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Volume2,
  VolumeX,
  ExternalLink,
  ShieldAlert,
  Calendar,
  Barcode,
  History,
  X,
  Check
} from 'lucide-react';
import type { RecallItem, ScanHistoryItem } from '../types/recall';
import { playRecallAlarmSound, stopRecallAlarmSound, isAlarmSoundPlaying } from '../services/alarmSound';

export interface EmergencyRecallModalProps {
  isOpen: boolean;
  onClose: () => void;
  historyItem: ScanHistoryItem;
  recall: RecallItem;
  onNavigateToHistory?: () => void;
  onViewFullRecallNotice?: (recall: RecallItem) => void;
}

export const EmergencyRecallModal: React.FC<EmergencyRecallModalProps> = ({
  isOpen,
  onClose,
  historyItem,
  recall,
  onNavigateToHistory,
  onViewFullRecallNotice
}) => {
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Play alarm siren as soon as modal opens
      playRecallAlarmSound(15).then((played) => {
        setIsAudioPlaying(played);
      });
    } else {
      stopRecallAlarmSound();
      setIsAudioPlaying(false);
    }

    const handleAlarmState = (e: any) => {
      setIsAudioPlaying(!!e.detail?.isPlaying);
    };

    window.addEventListener('recall-alarm-playing-changed', handleAlarmState);
    return () => {
      window.removeEventListener('recall-alarm-playing-changed', handleAlarmState);
      stopRecallAlarmSound();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleSound = () => {
    if (isAudioPlaying) {
      stopRecallAlarmSound();
      setIsAudioPlaying(false);
    } else {
      playRecallAlarmSound(15);
      setIsAudioPlaying(true);
    }
  };

  const handleClose = () => {
    stopRecallAlarmSound();
    setIsAudioPlaying(false);
    onClose();
  };

  const hazardText = recall.Issue || 'Check official instructions for critical health & safety instructions.';
  const upc = historyItem.extractedInfo?.upcOrCode;

  return (
    <div
      id="emergency-recall-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-modal-title"
    >
      <div className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl border-2 border-red-500 overflow-hidden animate-in zoom-in-95 duration-200 text-left">
        {/* Pulsing Emergency Header Banner */}
        <div className="bg-linear-to-r from-red-600 via-rose-600 to-red-700 text-white p-4 sm:p-5 relative overflow-hidden">
          {/* Subtle animated background pulse */}
          <div className="absolute inset-0 bg-red-500/20 animate-pulse pointer-events-none" />

          <div className="relative z-10 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white/20 rounded-2xl shrink-0 backdrop-blur-xs ring-2 ring-white/30 animate-bounce">
                <AlertTriangle className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-white/25 text-white mb-1">
                  Canadian Safety Alert
                </span>
                <h3 id="emergency-modal-title" className="text-lg sm:text-xl font-black tracking-tight leading-tight">
                  Scanned Product Recalled!
                </h3>
              </div>
            </div>

            {/* Audio Siren Mute / Play Button */}
            <button
              id="emergency-siren-toggle"
              type="button"
              onClick={toggleSound}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all shadow-sm shrink-0 ${
                isAudioPlaying
                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 animate-pulse ring-2 ring-amber-300'
                  : 'bg-white/20 hover:bg-white/30 text-white'
              }`}
              title={isAudioPlaying ? 'Mute emergency siren' : 'Play emergency siren sound'}
            >
              {isAudioPlaying ? (
                <>
                  <VolumeX className="w-4 h-4 text-slate-950" />
                  <span>Silence Alarm</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4 text-white" />
                  <span>Test Siren</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Audio siren playing banner */}
          {isAudioPlaying && (
            <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-900 font-semibold animate-pulse">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                <span>🚨 Safety alarm siren sounding. Please review hazard instructions below.</span>
              </div>
              <button
                type="button"
                onClick={toggleSound}
                className="text-[11px] font-bold text-red-700 hover:text-red-900 underline shrink-0 ml-2"
              >
                Mute
              </button>
            </div>
          )}

          {/* Recalled Item from User's History */}
          <div className="p-3.5 bg-slate-50 border border-slate-200/90 rounded-2xl space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
              Item in your scan history
            </span>
            <div className="flex items-center gap-3">
              {historyItem.imagePreview ? (
                <img
                  src={historyItem.imagePreview}
                  alt={historyItem.identifiedTitle}
                  className="w-14 h-14 object-cover rounded-xl border border-slate-200 shrink-0 shadow-2xs"
                />
              ) : (
                <div className="w-14 h-14 bg-red-100 text-red-600 rounded-xl flex items-center justify-center font-bold text-base shrink-0 border border-red-200">
                  ⚠️
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h4 className="font-extrabold text-sm sm:text-base text-slate-900 line-clamp-2">
                  {historyItem.identifiedTitle}
                </h4>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500 font-medium">
                  {historyItem.extractedInfo?.brand && (
                    <span>Brand: <strong className="text-slate-800">{historyItem.extractedInfo.brand}</strong></span>
                  )}
                  {upc && (
                    <span className="flex items-center gap-1 font-mono">
                      <Barcode className="w-3.5 h-3.5 text-slate-400" />
                      {upc}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    Scanned {new Date(historyItem.timestamp).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Official Recall Notice Details */}
          <div className="p-4 bg-linear-to-br from-red-50 to-orange-50/50 border border-red-200 rounded-2xl space-y-3">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-700 block mb-0.5">
                Official Canada Recall Notice
              </span>
              <h5 className="font-bold text-sm sm:text-base text-slate-900 leading-snug">
                {recall.Title}
              </h5>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-red-200/80">
              <span className="text-xs font-bold text-red-900 block flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                Reported Hazard / Safety Issue:
              </span>
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-normal bg-white/70 p-3 rounded-xl border border-red-100">
                {hazardText}
              </p>
            </div>

            {recall.URL && (
              <a
                href={recall.URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 hover:text-red-700 hover:underline pt-1"
              >
                <span>View Official Health Canada / CFIA Publication</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            {onNavigateToHistory && (
              <button
                id="emergency-goto-history"
                type="button"
                onClick={() => {
                  handleClose();
                  onNavigateToHistory();
                }}
                className="px-3.5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <History className="w-3.5 h-3.5 text-slate-600" />
                <span>View in Scan History</span>
              </button>
            )}

            {onViewFullRecallNotice && (
              <button
                id="emergency-view-notice"
                type="button"
                onClick={() => {
                  handleClose();
                  onViewFullRecallNotice(recall);
                }}
                className="px-3.5 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <span>Full Notice Details</span>
              </button>
            )}
          </div>

          <button
            id="emergency-acknowledge-btn"
            type="button"
            onClick={handleClose}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-extrabold transition-all shadow-sm flex items-center justify-center gap-1.5 active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>Acknowledge & Close</span>
          </button>
        </div>
      </div>
    </div>
  );
};
