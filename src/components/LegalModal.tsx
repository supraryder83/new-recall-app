import React, { useState } from 'react';
import { X, ShieldCheck, FileText, ExternalLink, Shield } from 'lucide-react';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'privacy' | 'terms';
}

export const LegalModal: React.FC<LegalModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'privacy'
}) => {
  const [activeTab, setActiveTab] = useState<'privacy' | 'terms'>(initialTab);

  if (!isOpen) return null;

  return (
    <div
      id="legal-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh] text-left animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-600/20 text-red-400 rounded-xl border border-red-500/30">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 id="legal-modal-title" className="text-base sm:text-lg font-extrabold text-white">
                Legal & Privacy Information
              </h3>
              <p className="text-xs text-slate-400">
                Owned and operated by Tyler Ziegler
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-3 shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('privacy')}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'privacy'
                ? 'border-red-600 text-red-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Privacy Policy</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('terms')}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'terms'
                ? 'border-red-600 text-red-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Terms of Service</span>
          </button>
        </div>

        {/* Ownership & Open Data Banner */}
        <div className="p-3.5 bg-amber-50/70 border-b border-amber-200/60 text-amber-950 text-xs shrink-0 flex items-start gap-2.5">
          <span className="text-base shrink-0">🍁</span>
          <div className="leading-relaxed">
            <strong>Ownership & Non-Endorsement Notice:</strong> This website is owned and operated by{' '}
            <strong>Tyler Ziegler</strong>. It contains public safety recall information licensed under the{' '}
            <a
              href="https://open.canada.ca/en/open-government-licence-canada"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-700 font-bold underline hover:text-red-800"
            >
              Open Government Licence – Canada
            </a>
            . This independent application is not endorsed by, sponsored by, or affiliated with the Government of Canada, Health Canada, the Canadian Food Inspection Agency (CFIA), or Transport Canada.
          </div>
        </div>

        {/* Scrollable Body Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-700 leading-relaxed">
          {activeTab === 'privacy' ? (
            <div className="space-y-4">
              <h4 className="text-base font-extrabold text-slate-900 border-b pb-2">
                Privacy Policy
              </h4>
              <p className="text-xs text-slate-500">
                Effective Date: October 2026 • Owned and operated by Tyler Ziegler
              </p>

              <section className="space-y-1.5">
                <h5 className="font-bold text-slate-900">1. Overview</h5>
                <p>
                  Canada Recall Alert ("we", "us", or "our"), operated by Tyler Ziegler, respects your privacy. This application is designed as a privacy-first utility to help Canadian consumers verify product and food safety recalls quickly and securely.
                </p>
              </section>

              <section className="space-y-1.5">
                <h5 className="font-bold text-slate-900">2. Camera & Image Processing</h5>
                <p>
                  When you use the barcode or photo scanner, the camera stream is processed directly in your browser. Barcode detection occurs locally using the browser's native BarcodeDetector API. When analyzing product label photos, images are securely analyzed solely to extract text, brand names, model numbers, and UPC codes to match against safety notices. Photographs are never sold, rented, or repurposed for commercial advertising.
                </p>
              </section>

              <section className="space-y-1.5">
                <h5 className="font-bold text-slate-900">3. Local Scan History Storage</h5>
                <p>
                  Your scan history is stored locally in your web browser (IndexedDB and localStorage). You have full control over your history and can delete individual items with a two-click confirmation or export your logs at any time.
                </p>
              </section>

              <section className="space-y-1.5">
                <h5 className="font-bold text-slate-900">4. Web Push Notifications</h5>
                <p>
                  If you opt in to recall notifications, a randomized push subscription endpoint generated by your browser is used to send automated alerts when new recalls match items in your history. You can unsubscribe at any time in Settings.
                </p>
              </section>

              <section className="space-y-1.5">
                <h5 className="font-bold text-slate-900">5. Contact Information</h5>
                <p>
                  For any privacy questions or requests regarding this service, please contact Tyler Ziegler through the official project repository.
                </p>
              </section>
            </div>
          ) : (
            <div className="space-y-4">
              <h4 className="text-base font-extrabold text-slate-900 border-b pb-2">
                Terms of Service
              </h4>
              <p className="text-xs text-slate-500">
                Effective Date: October 2026 • Owned and operated by Tyler Ziegler
              </p>

              <section className="space-y-1.5">
                <h5 className="font-bold text-slate-900">1. Acceptance of Terms</h5>
                <p>
                  By accessing or using Canada Recall Alert, owned and operated by Tyler Ziegler, you agree to be bound by these Terms of Service. If you do not agree to these terms, please discontinue use of the application.
                </p>
              </section>

              <section className="space-y-1.5">
                <h5 className="font-bold text-slate-900">2. Informational Purpose & Government Data Disclaimer</h5>
                <p>
                  This service provides consolidated Canadian safety recall notices obtained from public feeds under the Open Government Licence – Canada. While automated matching strives to cross-reference consumer products accurately, this tool is provided on an "as-is" and "as-available" basis for general informational and educational awareness.
                </p>
                <p>
                  This service is independently owned and operated by Tyler Ziegler and is not an official government portal. It is not endorsed by, sponsored by, or affiliated with Health Canada, the Canadian Food Inspection Agency (CFIA), Transport Canada, or the Government of Canada. For official regulatory instructions, please always refer directly to{' '}
                  <a
                    href="https://recalls-rappels.canada.ca/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-600 font-bold underline"
                  >
                    recalls-rappels.canada.ca
                  </a>.
                </p>
              </section>

              <section className="space-y-1.5">
                <h5 className="font-bold text-slate-900">3. Limitation of Liability</h5>
                <p>
                  In no event shall the operator (Tyler Ziegler) be liable for any direct, indirect, incidental, or consequential damages resulting from the use or inability to use this service, or from reliance on any information provided herein. Users should always inspect physical product labels and manufacturer notices.
                </p>
              </section>

              <section className="space-y-1.5">
                <h5 className="font-bold text-slate-900">4. Ownership & Intellectual Property</h5>
                <p>
                  The website software, interface, design, and trademarks are owned and operated by Tyler Ziegler. Official Canadian safety notice text remains under the Open Government Licence – Canada.
                </p>
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-500">
            Site owned & operated by <strong>Tyler Ziegler</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
