import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Barcode,
  Camera,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  ChevronRight
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type { RecallItem, ScanMatchResult } from '../types/recall';
import { findRecallsByCodeOrQuery } from '../services/recallData';
import {
  hasGeminiApiKey,
  analyzeProductImageWithGemini
} from '../services/gemini';

// Web standard BarcodeDetector interface for TypeScript
declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats: string[] }): {
        detect: (image: ImageBitmapSource) => Promise<Array<{ rawValue: string; format: string }>>;
      };
      getSupportedFormats: () => Promise<string[]>;
    };
  }
}

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  recallsDataset: RecallItem[];
  onSelectRecall: (recall: RecallItem) => void;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  recallsDataset,
  onSelectRecall
}) => {
  const [activeTab, setActiveTab] = useState<'barcode' | 'vision'>('barcode');
  
  // Camera & stream state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Manual code input
  const [manualCode, setManualCode] = useState('');

  // Vision Photo Analysis State
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [visionError, setVisionError] = useState<string | null>(null);

  // Verdict state
  const [scanResult, setScanResult] = useState<ScanMatchResult | null>(null);

  // Clean trigger for camera on barcode tab
  const startCamera = async () => {
    stopCamera();
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported by your browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
      startBarcodeScanningLoop();
    } catch (err: any) {
      console.warn('Camera start error:', err);
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Please allow camera access in browser settings, or enter barcode manually below.'
          : 'Unable to start camera feed. You can upload a photo or enter the barcode manually.'
      );
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Stop camera when closing modal
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setScanResult(null);
      setImagePreview(null);
      setVisionError(null);
    } else {
      if (activeTab === 'barcode') {
        startCamera();
      }
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab]);

  // Barcode scanning loop using Native BarcodeDetector
  const startBarcodeScanningLoop = () => {
    let barcodeDetector: any = null;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        barcodeDetector = new window.BarcodeDetector!({
          formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code']
        });
      } catch (e) {
        console.warn('BarcodeDetector format error:', e);
      }
    }

    let intervalId: any;

    const scanFrame = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2 || !streamRef.current) {
        return;
      }

      // Try Native BarcodeDetector
      if (barcodeDetector) {
        try {
          const barcodes = await barcodeDetector.detect(videoRef.current);
          if (barcodes && barcodes.length > 0) {
            const detectedValue = barcodes[0].rawValue;
            if (detectedValue) {
              handleBarcodeDetected(detectedValue);
              clearInterval(intervalId);
              return;
            }
          }
        } catch (e) {}
      }
    };

    intervalId = setInterval(scanFrame, 350);

    return () => clearInterval(intervalId);
  };

  const handleBarcodeDetected = (code: string) => {
    try {
      if (navigator.vibrate) navigator.vibrate(100);
    } catch {}

    const matches = findRecallsByCodeOrQuery(recallsDataset, code);
    const hasMatches = matches.length > 0;

    const result: ScanMatchResult = {
      verdict: hasMatches ? 'MATCH_FOUND' : 'NO_RECALL_FOUND',
      query: code,
      searchType: 'barcode',
      matchedRecalls: matches,
      matchReason: hasMatches
        ? `Product barcode ${code} matched ${matches.length} active Canadian safety notice(s).`
        : `Barcode ${code} was checked against ${recallsDataset.length.toLocaleString()} Canadian safety recalls. No active notices found.`
    };

    setScanResult(result);
    stopCamera();

    if (!hasMatches) {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.6 }
      });
    }
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleBarcodeDetected(manualCode.trim());
  };

  const handleImageFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      setImagePreview(base64);
      runGeminiPhotoAnalysis(base64, file.type);
    };
    reader.readAsDataURL(file);
  };

  const runGeminiPhotoAnalysis = async (base64Image: string, mimeType: string) => {
    setAnalyzingPhoto(true);
    setVisionError(null);
    setScanResult(null);

    try {
      setAnalysisStep('Sending image to Gemini 2.5 Flash...');
      await new Promise((r) => setTimeout(r, 400));
      setAnalysisStep('Extracting brand, product name, and batch numbers...');

      const result = await analyzeProductImageWithGemini({
        base64Data: base64Image,
        mimeType: mimeType || 'image/jpeg',
        recallsDataset
      });

      setAnalysisStep('Cross-referencing Canadian open safety registry...');
      await new Promise((r) => setTimeout(r, 400));

      setScanResult(result);

      if (result.verdict === 'NO_RECALL_FOUND') {
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.65 }
        });
      }
    } catch (err: any) {
      console.error('Gemini vision analysis failed:', err);
      setVisionError(err?.message || 'Failed to analyze photo with Gemini.');
    } finally {
      setAnalyzingPhoto(false);
      setAnalysisStep('');
    }
  };

  const handleSamplePhotoTest = (sampleType: 'food' | 'heater' | 'vehicle') => {
    let mockBrand = '';
    let mockProduct = '';
    let mockCategory = '';
    let mockModel = '';

    if (sampleType === 'food') {
      mockBrand = 'Plantropy';
      mockProduct = "Jack'd Up Bites Crispy Protein Bites";
      mockCategory = 'Food';
      mockModel = 'Jalapeno';
    } else if (sampleType === 'heater') {
      mockBrand = 'JKMAX';
      mockProduct = 'Heated Blanket';
      mockCategory = 'Consumer Products';
      mockModel = 'JKMAX Heated Blankets and Heating Pads';
    } else {
      mockBrand = 'Ford';
      mockProduct = 'F-150 Steering Gear';
      mockCategory = 'Vehicles';
      mockModel = '2024 F-150';
    }

    const simulatedExtracted = {
      brand: mockBrand,
      productName: mockProduct,
      modelOrBatchNumber: mockModel,
      detectedCategory: mockCategory,
      confidenceNotes: `Demo sample recognition for ${mockBrand} ${mockProduct}`
    };

    const matches = recallsDataset.filter((item) => {
      const text = `${item.Title} ${item.Product}`.toLowerCase();
      return text.includes(mockBrand.toLowerCase()) || text.includes(mockProduct.toLowerCase());
    });

    const isMatch = matches.length > 0;
    setScanResult({
      verdict: isMatch ? 'MATCH_FOUND' : 'NO_RECALL_FOUND',
      query: `${mockBrand} ${mockProduct}`,
      searchType: 'vision',
      extractedInfo: simulatedExtracted,
      matchedRecalls: matches.slice(0, 5),
      matchReason: isMatch
        ? `Found ${matches.length} active Canadian safety notice(s) matching "${mockBrand} ${mockProduct}".`
        : `No active safety recalls found for "${mockBrand} ${mockProduct}".`
    });
  };

  const resetScan = () => {
    setScanResult(null);
    setImagePreview(null);
    setVisionError(null);
    setManualCode('');
    if (activeTab === 'barcode') {
      startCamera();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-xl max-h-[92vh] bg-white rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden text-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-red-600 rounded-xl text-white shadow-md">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight">Product Safety Scanner</h3>
              <p className="text-xs text-slate-400">Barcode scanner & Multimodal Gemini AI recognition</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="p-3 bg-slate-100/70 border-b border-slate-200/80 shrink-0">
          <div className="grid grid-cols-2 gap-2 bg-slate-200/80 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setActiveTab('barcode');
                setScanResult(null);
              }}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeTab === 'barcode'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Barcode className="w-4 h-4 text-red-600" />
              <span>Barcode / UPC</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('vision');
                stopCamera();
                setScanResult(null);
              }}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeTab === 'vision'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Gemini Photo AI</span>
            </button>
          </div>
        </div>

        {/* Main Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {/* VERDICT CARD VIEW (If scanned) */}
          {scanResult ? (
            <div className="space-y-4 animate-in zoom-in-95 duration-200">
              {/* Verdict Banner */}
              <div
                className={`p-5 rounded-2xl border text-left shadow-sm ${
                  scanResult.verdict === 'MATCH_FOUND'
                    ? 'bg-red-50 border-red-200 text-red-950'
                    : scanResult.verdict === 'POSSIBLE_MATCH'
                      ? 'bg-amber-50 border-amber-200 text-amber-950'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-950'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`p-3 rounded-2xl shrink-0 ${
                      scanResult.verdict === 'MATCH_FOUND'
                        ? 'bg-red-600 text-white shadow-lg shadow-red-500/30'
                        : scanResult.verdict === 'POSSIBLE_MATCH'
                          ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                          : 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30'
                    }`}
                  >
                    {scanResult.verdict === 'MATCH_FOUND' ? (
                      <ShieldAlert className="w-6 h-6 animate-pulse" />
                    ) : scanResult.verdict === 'POSSIBLE_MATCH' ? (
                      <AlertTriangle className="w-6 h-6" />
                    ) : (
                      <ShieldCheck className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <h4 className="font-extrabold text-base sm:text-lg">
                      {scanResult.verdict === 'MATCH_FOUND'
                        ? 'Potential Recall Detected!'
                        : scanResult.verdict === 'POSSIBLE_MATCH'
                          ? 'Possible Recall Match Found'
                          : 'No Active Recall Detected in Dataset'}
                    </h4>
                    <p className="text-xs sm:text-sm mt-1 opacity-90 leading-relaxed">
                      {scanResult.matchReason}
                    </p>
                  </div>
                </div>

                {/* Gemini Extracted Details breakdown */}
                {scanResult.extractedInfo && (
                  <div className="mt-4 pt-3.5 border-t border-slate-200/60 grid grid-cols-2 gap-2 text-xs">
                    {scanResult.extractedInfo.brand && (
                      <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                        <span className="text-slate-500 block text-[10px] font-semibold uppercase">Brand</span>
                        <span className="font-bold text-slate-800">{scanResult.extractedInfo.brand}</span>
                      </div>
                    )}
                    {scanResult.extractedInfo.productName && (
                      <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                        <span className="text-slate-500 block text-[10px] font-semibold uppercase">Product</span>
                        <span className="font-bold text-slate-800">{scanResult.extractedInfo.productName}</span>
                      </div>
                    )}
                    {scanResult.extractedInfo.modelOrBatchNumber && (
                      <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                        <span className="text-slate-500 block text-[10px] font-semibold uppercase">Batch / Model</span>
                        <span className="font-mono font-bold text-slate-800">{scanResult.extractedInfo.modelOrBatchNumber}</span>
                      </div>
                    )}
                    {scanResult.extractedInfo.detectedCategory && (
                      <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                        <span className="text-slate-500 block text-[10px] font-semibold uppercase">Category</span>
                        <span className="font-bold text-slate-800">{scanResult.extractedInfo.detectedCategory}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Matched Recalls list if any */}
              {scanResult.matchedRecalls.length > 0 && (
                <div className="space-y-2 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Official Safety Notices ({scanResult.matchedRecalls.length})
                    </span>
                    <span className="text-[11px] text-red-600 font-semibold">Tap to view instructions</span>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {scanResult.matchedRecalls.map((recall) => (
                      <div
                        key={recall.NID}
                        onClick={() => {
                          onSelectRecall(recall);
                          onClose();
                        }}
                        className="p-3.5 bg-slate-50 hover:bg-red-50/60 border border-slate-200 hover:border-red-300 rounded-xl cursor-pointer transition-all flex items-start justify-between gap-3 group"
                      >
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            {recall['Recall class'] && (
                              <span className="bg-red-600 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded">
                                {recall['Recall class']}
                              </span>
                            )}
                            <span className="text-[10px] text-slate-500 font-medium">
                              {recall['Last updated']}
                            </span>
                          </div>
                          <h5 className="font-bold text-xs sm:text-sm text-slate-900 group-hover:text-red-600 transition-colors line-clamp-2">
                            {recall.Title}
                          </h5>
                          {recall.Issue && (
                            <p className="text-[11px] text-slate-600 mt-1 line-clamp-1">
                              <strong>Issue:</strong> {recall.Issue}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-red-600 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Safe guidance when no recall */}
              {scanResult.verdict === 'NO_RECALL_FOUND' && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-left text-xs text-slate-600 space-y-1.5">
                  <p className="font-semibold text-slate-800">Verification Tips:</p>
                  <p>• Verify the exact batch code or expiration date on your packaging.</p>
                  <p>• Canadian recall notices are updated daily from CFIA, Health Canada, and Transport Canada.</p>
                  <p>• If you suspect a product illness or hazard, report it directly to Health Canada.</p>
                </div>
              )}

              {/* Scan Another Button */}
              <button
                type="button"
                onClick={resetScan}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-md"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Scan Another Product</span>
              </button>
            </div>
          ) : activeTab === 'barcode' ? (
            /* BARCODE SCANNER TAB */
            <div className="space-y-4">
              {/* Camera Viewfinder */}
              <div className="relative aspect-video sm:aspect-[4/3] bg-black rounded-2xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`w-full h-full object-cover transition-opacity duration-300 ${
                    cameraActive ? 'opacity-100' : 'opacity-0'
                  }`}
                />

                {/* Viewfinder Target / Laser overlay */}
                {cameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                    <div className="w-64 h-36 border-2 border-red-500/80 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-red-500 shadow-[0_0_8px_#ef4444] animate-scan" />
                      <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-white rounded-tl" />
                      <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-white rounded-tr" />
                      <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-white rounded-bl" />
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-white rounded-br" />
                    </div>
                    <span className="text-[11px] font-medium text-white/90 bg-black/60 px-3 py-1 rounded-full mt-3 backdrop-blur-sm">
                      Align barcode inside frame
                    </span>
                  </div>
                )}

                {/* Camera fallback / error message */}
                {cameraError && (
                  <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-white bg-slate-900/90 backdrop-blur-sm">
                    <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
                    <p className="text-xs text-slate-300 max-w-xs">{cameraError}</p>
                    <button
                      type="button"
                      onClick={startCamera}
                      className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Camera
                    </button>
                  </div>
                )}
              </div>

              {/* Manual Barcode Search Form */}
              <div className="pt-2">
                <form onSubmit={handleManualSearch} className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Barcode className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      placeholder="Enter UPC / barcode (e.g. 068745123456 or lot code)..."
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-bold rounded-xl transition-colors shadow-sm shrink-0"
                  >
                    Check Code
                  </button>
                </form>
                <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 px-1">
                  <span>Reads UPC-A, EAN-13, EAN-8, Code 128</span>
                  <button
                    type="button"
                    onClick={() => handleBarcodeDetected('82848')}
                    className="text-red-600 hover:underline font-medium"
                  >
                    Try Sample Recall Code #82848
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* GEMINI PHOTO RECALL CHECK TAB */
            <div className="space-y-4">
              {/* Photo Upload / Snap Area */}
              <div className="border-2 border-dashed border-slate-200 hover:border-red-400 bg-slate-50/70 rounded-2xl p-6 text-center transition-all group">
                <input
                  type="file"
                  id="gemini-photo-upload"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageFile(file);
                  }}
                />
                <label
                  htmlFor="gemini-photo-upload"
                  className="cursor-pointer flex flex-col items-center justify-center"
                >
                  <div className="w-14 h-14 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-sm">
                    <Camera className="w-7 h-7" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-800">
                    Snap Photo or Upload Image
                  </h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs">
                    Take a photo of product packaging, ingredient label, or vehicle VIN plate
                  </p>
                  <span className="mt-3 px-4 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl shadow-xs hover:bg-slate-50">
                    Choose Photo / Take Picture
                  </span>
                </label>
              </div>

              {imagePreview && (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <img src={imagePreview} alt="Selected preview" className="w-14 h-14 object-cover rounded-xl" />
                  <div className="text-left text-xs">
                    <span className="font-bold text-slate-800 block">Captured Photo</span>
                    <span className="text-slate-500">Ready for Gemini 2.5 Flash analysis</span>
                  </div>
                </div>
              )}

              {/* Analyzing indicator */}
              {analyzingPhoto && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2 animate-in fade-in">
                  <div className="inline-flex p-3 bg-red-600 text-white rounded-2xl shadow-md animate-bounce">
                    <Sparkles className="w-6 h-6 text-amber-300" />
                  </div>
                  <h5 className="font-extrabold text-sm text-red-950">
                    Gemini 2.5 Flash Vision Analysis
                  </h5>
                  <p className="text-xs text-red-700 font-medium animate-pulse">
                    {analysisStep || 'Analyzing visual packaging details...'}
                  </p>
                </div>
              )}

              {/* Error message */}
              {visionError && (
                <div className="p-3.5 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-center gap-2 text-left">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{visionError}</span>
                </div>
              )}

              {/* 1-Click Interactive Test Samples */}
              <div className="pt-2 text-left">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  1-Click AI Recognition Demo Tests
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSamplePhotoTest('food')}
                    className="p-2.5 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-300 rounded-xl text-left transition-all"
                  >
                    <span className="text-[10px] font-bold text-emerald-600 block">Food Sample</span>
                    <span className="text-xs font-bold text-slate-800 block truncate">Plantropy Bites</span>
                    <span className="text-[10px] text-slate-500">Known CFIA Recall</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSamplePhotoTest('heater')}
                    className="p-2.5 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-300 rounded-xl text-left transition-all"
                  >
                    <span className="text-[10px] font-bold text-blue-600 block">Consumer Product</span>
                    <span className="text-xs font-bold text-slate-800 block truncate">JKMAX Heated Pad</span>
                    <span className="text-[10px] text-slate-500">Fire hazard alert</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSamplePhotoTest('vehicle')}
                    className="p-2.5 bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 rounded-xl text-left transition-all"
                  >
                    <span className="text-[10px] font-bold text-amber-600 block">Vehicle Part</span>
                    <span className="text-xs font-bold text-slate-800 block truncate">Ford F-150 Gear</span>
                    <span className="text-[10px] text-slate-500">Transport Canada</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:px-6 sm:py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Dataset: {recallsDataset.length.toLocaleString()} Canadian safety notices</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-600 hover:text-slate-900 font-semibold px-3 py-1 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
