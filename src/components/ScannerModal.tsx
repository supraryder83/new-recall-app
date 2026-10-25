import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  SwitchCamera,
  Flashlight,
  Key,
  Save,
  Upload,
  Search,
  Tag
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type { RecallItem, ScanMatchResult } from '../types/recall';
import {
  hasGeminiApiKey,
  analyzeProductImageWithGemini,
  setGeminiApiKey
} from '../services/gemini';
import { optimizeImage } from '../utils/imageOptimizer';
import { addScanToHistory } from '../services/scanHistory';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  recallsDataset: RecallItem[];
  onSelectRecall: (recall: RecallItem) => void;
  onApplySearchQuery?: (query: string) => void;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  recallsDataset,
  onSelectRecall,
  onApplySearchQuery
}) => {
  // Camera & stream state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Helper functions to identify camera facing from hardware label
  const isBackCameraLabel = (label: string) => {
    const l = label.toLowerCase();
    return (
      (l.includes('back') ||
        l.includes('rear') ||
        l.includes('environment') ||
        l.includes('trás') ||
        l.includes('arrière') ||
        l.includes('rück') ||
        l.includes('camera2 0')) &&
      !l.includes('front') &&
      !l.includes('user') &&
      !l.includes('selfie')
    );
  };

  const isFrontCameraLabel = (label: string) => {
    const l = label.toLowerCase();
    return (
      l.includes('front') ||
      l.includes('user') ||
      l.includes('selfie') ||
      l.includes('avant') ||
      l.includes('vorne')
    );
  };

  // Vision Photo Analysis State
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [visionError, setVisionError] = useState<string | null>(null);

  // Verdict state
  const [scanResult, setScanResult] = useState<ScanMatchResult | null>(null);

  // Quick API key state if missing
  const [hasKey, setHasKey] = useState(hasGeminiApiKey());
  const [quickApiKey, setQuickApiKey] = useState('');
  const [showKeyForm, setShowKeyForm] = useState(false);

  const handleSaveQuickKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickApiKey.trim()) return;
    setGeminiApiKey(quickApiKey.trim());
    setHasKey(true);
    setQuickApiKey('');
    setShowKeyForm(false);
    setVisionError(null);
  };

  // Starts camera feed defaulting to back/rear camera ('environment') with explicit 720p constraints
  const startCamera = async (targetDeviceId?: string, requestedFacing: 'environment' | 'user' = 'environment') => {
    stopCamera();
    setCameraError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported by your browser.');
      }

      let stream: MediaStream | null = null;

      // 1. If explicit targetDeviceId specified, attempt to open that exact hardware device
      if (targetDeviceId) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: targetDeviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch (err) {
          console.warn('Direct deviceId camera request failed, falling back:', err);
        }
      }

      // 2. Query available devices (if permission was previously granted or labels exist)
      if (!stream) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');
          setAvailableVideoDevices(videoInputs);

          let matchingDevice: MediaDeviceInfo | undefined;
          if (requestedFacing === 'environment') {
            matchingDevice = videoInputs.find((d) => isBackCameraLabel(d.label));
            if (!matchingDevice && videoInputs.some((d) => isFrontCameraLabel(d.label))) {
              matchingDevice = videoInputs.find((d) => !isFrontCameraLabel(d.label));
            }
          } else {
            matchingDevice = videoInputs.find((d) => isFrontCameraLabel(d.label));
          }

          if (matchingDevice && matchingDevice.deviceId) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: {
                  deviceId: { exact: matchingDevice.deviceId },
                  width: { ideal: 1280 },
                  height: { ideal: 720 }
                },
                audio: false
              });
            } catch (err) {
              console.warn('Enumerate-matched deviceId request failed:', err);
            }
          }
        } catch (err) {
          console.warn('enumerateDevices check failed:', err);
        }
      }

      // 3. Try exact facingMode constraint (forces back camera on mobile iOS/Android)
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { exact: requestedFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch (err: any) {
          console.warn(`Exact ${requestedFacing} facingMode failed, falling back:`, err?.name);
        }
      }

      // 4. Fallback to ideal facingMode (standard preference)
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: requestedFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch (err: any) {
          console.warn(`Ideal ${requestedFacing} facingMode failed:`, err?.name);
        }
      }

      // 5. Ultimate fallback: any available video input
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
      }

      // Inspect active track and capabilities
      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings ? track.getSettings() : {};
        if (settings.facingMode) {
          setFacingMode(settings.facingMode as 'environment' | 'user');
        } else {
          setFacingMode(requestedFacing);
        }
        if (settings.deviceId) {
          setCurrentDeviceId(settings.deviceId);
        }

        const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
        setSupportsTorch(Boolean(capabilities?.torch));
        setTorchOn(false);
      }

      // Refresh devices list
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setAvailableVideoDevices(videoInputs);
      } catch {}

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (e) {
          console.warn('Video play error:', e);
        }
      }

      setCameraActive(true);
    } catch (err: any) {
      console.warn('Camera start error:', err);
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Please allow camera access in browser settings, or upload a photo below.'
          : 'Unable to start camera feed. You can take a photo or upload an image from your gallery below.'
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
    setTorchOn(false);
    setSupportsTorch(false);
  };

  // Switch between back and front camera
  const toggleCameraFacing = async () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);

    let nextDeviceId: string | undefined;
    if (availableVideoDevices.length > 1) {
      const isTarget = nextFacing === 'environment' ? isBackCameraLabel : isFrontCameraLabel;
      const match = availableVideoDevices.find((d) => isTarget(d.label));
      if (match) {
        nextDeviceId = match.deviceId;
      } else {
        const other = availableVideoDevices.find((d) => d.deviceId !== currentDeviceId);
        if (other) nextDeviceId = other.deviceId;
      }
    }

    await startCamera(nextDeviceId, nextFacing);
  };

  // Toggle flashlight / torch
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const nextTorch = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextTorch }]
      });
      setTorchOn(nextTorch);
    } catch (err) {
      console.warn('Torch toggle failed:', err);
    }
  };

  // Start camera when opening modal, default to back camera
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setScanResult(null);
      setImagePreview(null);
      setVisionError(null);
      setFacingMode('environment');
      setCurrentDeviceId(null);
    } else {
      setHasKey(hasGeminiApiKey());
      setFacingMode('environment');
      setCurrentDeviceId(null);
      startCamera(undefined, 'environment');
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  // Live in-app camera snapshot without leaving browser
  const handleSnapLivePhoto = async () => {
    if (!videoRef.current || !streamRef.current) {
      setVisionError('Camera feed is not active. Please retry camera or choose a photo from gallery.');
      return;
    }
    try {
      const video = videoRef.current;
      let width = video.videoWidth || 1280;
      let height = video.videoHeight || 720;
      const maxDim = 1280;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        throw new Error('Canvas context unavailable');
      }

      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

      canvas.width = 0;
      canvas.height = 0;

      setImagePreview(dataUrl);
      stopCamera();

      runGeminiPhotoAnalysis(dataUrl, 'image/jpeg');
    } catch (err: any) {
      console.error('Live photo snap failed:', err);
      setVisionError('Failed to capture photo from live camera.');
    }
  };

  // Vision photo upload handler (downsamples with imageOptimizer, then calls Gemini)
  const handleVisionImageFile = async (file: File) => {
    if (!file) return;
    stopCamera();
    setAnalyzingPhoto(true);
    setAnalysisStep('Optimizing photo for Gemini AI...');
    setVisionError(null);

    try {
      const optimized = await optimizeImage(file, { maxDimension: 1280, quality: 0.8 });
      setImagePreview(optimized.dataUrl);
      runGeminiPhotoAnalysis(optimized.dataUrl, 'image/jpeg');
    } catch (err: any) {
      console.error('Image optimization failed:', err);
      setVisionError(err?.message || 'Failed to optimize photo. Please try another image.');
      setAnalyzingPhoto(false);
    }
  };

  const runGeminiPhotoAnalysis = async (base64Image: string, mimeType: string) => {
    setAnalyzingPhoto(true);
    setVisionError(null);
    setScanResult(null);

    try {
      setAnalysisStep('Sending photo to Gemini 2.5 Flash...');
      await new Promise((r) => setTimeout(r, 250));
      setAnalysisStep('Identifying product brand, model & packaging details...');

      const result = await analyzeProductImageWithGemini({
        base64Data: base64Image,
        mimeType: mimeType || 'image/jpeg',
        recallsDataset
      });

      setAnalysisStep('Cross-referencing Canadian open safety registry...');
      await new Promise((r) => setTimeout(r, 250));

      setScanResult(result);

      // Save scan to persistent history log
      addScanToHistory({
        imagePreview: base64Image,
        identifiedTitle: result.identifiedTitle || 'Product Scan',
        verdict: result.verdict,
        matchReason: result.matchReason,
        matchedRecallsCount: result.matchedRecalls.length,
        extractedInfo: result.extractedInfo,
        matchedRecalls: result.matchedRecalls,
        searchKeywords: result.searchKeywords
      });

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

  const resetScan = () => {
    setScanResult(null);
    setImagePreview(null);
    setVisionError(null);
    setFacingMode('environment');
    setCurrentDeviceId(null);
    startCamera(undefined, 'environment');
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
            <div className="p-2 bg-gradient-to-tr from-red-600 to-red-500 rounded-xl text-white shadow-md">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-base leading-tight">AI Recall Scanner</h3>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-400/30 text-[10px] font-bold px-1.5 py-0.2 rounded">
                  Gemini 2.5
                </span>
              </div>
              <p className="text-xs text-slate-400">Snap a photo of any item to identify it and check for recalls</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {/* VERDICT CARD VIEW (If scanned) */}
          {scanResult ? (
            <div className="space-y-4 animate-in zoom-in-95 duration-200">
              {/* Identified Product Spotlight Banner */}
              {scanResult.identifiedTitle && (
                <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-md flex items-center justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">
                      <Tag className="w-3 h-3" />
                      <span>Identified Product</span>
                    </div>
                    <h4 className="font-extrabold text-sm sm:text-base text-white truncate">
                      {scanResult.identifiedTitle}
                    </h4>
                    {scanResult.extractedInfo?.category && (
                      <span className="inline-block mt-1 text-[10px] font-semibold text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                        {scanResult.extractedInfo.category}
                      </span>
                    )}
                  </div>
                  {onApplySearchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        const q =
                          scanResult.searchKeywords ||
                          scanResult.identifiedTitle ||
                          scanResult.query;
                        onApplySearchQuery(q);
                        onClose();
                      }}
                      className="shrink-0 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 active:scale-95"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>Search Recalls</span>
                    </button>
                  )}
                </div>
              )}

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

                {/* Extracted Details breakdown */}
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
                    {(scanResult.extractedInfo.modelOrLot || scanResult.extractedInfo.modelOrBatchNumber) && (
                      <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                        <span className="text-slate-500 block text-[10px] font-semibold uppercase">Batch / Model</span>
                        <span className="font-mono font-bold text-slate-800">
                          {scanResult.extractedInfo.modelOrLot || scanResult.extractedInfo.modelOrBatchNumber}
                        </span>
                      </div>
                    )}
                    {scanResult.extractedInfo.category && (
                      <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                        <span className="text-slate-500 block text-[10px] font-semibold uppercase">Category</span>
                        <span className="font-bold text-slate-800">{scanResult.extractedInfo.category}</span>
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
                  <p className="font-semibold text-slate-800">Safety & Verification Tips:</p>
                  <p>• Verify the exact batch code or expiry date printed on your product packaging.</p>
                  <p>• Canadian recall notices are updated daily from CFIA, Health Canada, and Transport Canada.</p>
                  <p>• If you suspect a product hazard or illness, report it directly to Health Canada.</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-2">
                {onApplySearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      const q =
                        scanResult.searchKeywords ||
                        scanResult.identifiedTitle ||
                        scanResult.query;
                      onApplySearchQuery(q);
                      onClose();
                    }}
                    className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-md"
                  >
                    <Search className="w-4 h-4" />
                    <span>View in Full Canadian Recall Database</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetScan}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors border border-slate-200"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Take Another Photo</span>
                </button>
              </div>
            </div>
          ) : (
            /* SINGLE UNIFIED CAMERA VIEW & CONTROLS */
            <div className="space-y-4">
              {/* API Key Missing Guidance Banner (if key missing) */}
              {!hasKey && (
                <div className="p-3.5 bg-amber-50/90 border border-amber-200 rounded-2xl text-left space-y-2">
                  <div className="flex items-start gap-2.5">
                    <Key className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <h5 className="font-bold text-xs text-amber-950">Gemini API Key Needed</h5>
                      <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                        Configure <code className="font-mono font-bold bg-amber-100/90 px-1 py-0.5 rounded">VITE_GEMINI_API_KEY=your_key</code> in your <code className="font-mono">.env</code> file (then restart server), or paste your key below:
                      </p>
                    </div>
                  </div>

                  {!showKeyForm ? (
                    <button
                      type="button"
                      onClick={() => setShowKeyForm(true)}
                      className="w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>Paste API Key Directly</span>
                    </button>
                  ) : (
                    <form onSubmit={handleSaveQuickKey} className="space-y-2 animate-in fade-in pt-1">
                      <input
                        type="password"
                        value={quickApiKey}
                        onChange={(e) => setQuickApiKey(e.target.value)}
                        placeholder="Paste Gemini API key (AIzaSy...)"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={!quickApiKey.trim()}
                          className="flex-1 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1 shadow-xs"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Save Key</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowKeyForm(false)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* Single Camera Viewfinder */}
              <div className="relative aspect-video sm:aspect-[4/3] bg-black rounded-2xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover transition-opacity duration-300 ${
                    cameraActive ? 'opacity-100' : 'opacity-0'
                  }`}
                />

                {/* If photo captured or selected, display preview in the frame */}
                {!cameraActive && imagePreview && (
                  <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-3 animate-in fade-in">
                    <img
                      src={imagePreview}
                      alt="Captured preview"
                      className="max-h-full max-w-full object-contain rounded-xl shadow-lg"
                    />
                    <div className="absolute bottom-3 inset-x-3 flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-950/80 border border-emerald-500/30 px-2.5 py-1 rounded-full backdrop-blur-sm">
                        ✓ Scaled for memory (&lt;100KB)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setImagePreview(null);
                          setVisionError(null);
                          startCamera(undefined, facingMode);
                        }}
                        className="text-[11px] font-bold text-white bg-black/70 hover:bg-black/90 px-3 py-1 rounded-full border border-white/20 backdrop-blur-sm flex items-center gap-1 transition-all"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retake
                      </button>
                    </div>
                  </div>
                )}

                {/* If camera is inactive, no image preview, and no error */}
                {!cameraActive && !imagePreview && !cameraError && (
                  <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-white bg-slate-900/90 backdrop-blur-sm">
                    <div className="p-3 bg-slate-800/80 rounded-2xl mb-2 text-slate-300 border border-slate-700/60 shadow-inner">
                      <Camera className="w-6 h-6 text-red-400" />
                    </div>
                    <p className="text-xs font-semibold text-slate-200">Live Camera Paused</p>
                    <p className="text-[11px] text-slate-400 max-w-xs mt-0.5">
                      Hardware memory freed. Take a photo, upload from gallery, or resume live feed below.
                    </p>
                    <button
                      type="button"
                      onClick={() => startCamera(undefined, facingMode)}
                      className="mt-3 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border border-slate-700 shadow-md active:scale-95"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Resume Live Camera
                    </button>
                  </div>
                )}

                {/* Viewfinder Controls & Framing Overlay */}
                {cameraActive && (
                  <>
                    {/* Top Status & Action Bar */}
                    <div className="absolute top-3 inset-x-3 flex items-center justify-between z-10 pointer-events-auto">
                      <span className="text-[11px] font-medium text-white/95 bg-black/60 px-2.5 py-1 rounded-full backdrop-blur-md flex items-center gap-1.5 border border-white/10 shadow-sm">
                        <Camera className="w-3.5 h-3.5 text-red-400" />
                        <span>{facingMode === 'environment' ? 'Back Camera' : 'Front Camera'}</span>
                      </span>

                      <div className="flex items-center gap-1.5">
                        {supportsTorch && (
                          <button
                            type="button"
                            onClick={toggleTorch}
                            title={torchOn ? 'Turn off flash' : 'Turn on flash'}
                            className={`p-2 rounded-full backdrop-blur-md transition-all border active:scale-90 shadow-md flex items-center justify-center ${
                              torchOn
                                ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-amber-400/30'
                                : 'bg-black/60 hover:bg-black/80 text-white border-white/10'
                            }`}
                          >
                            <Flashlight className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={toggleCameraFacing}
                          title={`Switch to ${facingMode === 'environment' ? 'front' : 'back'} camera`}
                          className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full backdrop-blur-md transition-all border border-white/10 active:scale-90 shadow-md flex items-center justify-center group"
                        >
                          <SwitchCamera className="w-4 h-4 group-hover:rotate-180 transition-transform duration-300" />
                        </button>
                      </div>
                    </div>

                    {/* Framing Reticle */}
                    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                      <div className="w-64 h-44 sm:w-72 sm:h-48 border-2 border-dashed border-red-500/80 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                        <div className="absolute -top-1 -left-1 w-5 h-5 border-t-3 border-l-3 border-red-500 rounded-tl" />
                        <div className="absolute -top-1 -right-1 w-5 h-5 border-t-3 border-r-3 border-red-500 rounded-tr" />
                        <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-3 border-l-3 border-red-500 rounded-bl" />
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-3 border-r-3 border-red-500 rounded-br" />
                      </div>
                      <span className="text-[11px] font-medium text-white/95 bg-black/60 px-3.5 py-1 rounded-full mt-3 backdrop-blur-sm border border-white/10">
                        Frame product item, label or packaging
                      </span>
                    </div>
                  </>
                )}

                {/* Camera fallback / error message */}
                {cameraError && (
                  <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-white bg-slate-900/90 backdrop-blur-sm">
                    <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
                    <p className="text-xs text-slate-300 max-w-xs">{cameraError}</p>
                    <button
                      type="button"
                      onClick={() => startCamera(undefined, 'environment')}
                      className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-md"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Back Camera
                    </button>
                  </div>
                )}
              </div>

              {/* PHOTO ACTION CONTROLS */}
              <div className="space-y-3 pt-1">
                {/* Primary Shutter Action: Snap photo directly from active viewfinder */}
                {cameraActive && (
                  <button
                    type="button"
                    onClick={handleSnapLivePhoto}
                    disabled={analyzingPhoto}
                    className="w-full py-3.5 px-4 bg-gradient-to-r from-red-600 via-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-2xl font-extrabold text-sm sm:text-base flex items-center justify-center gap-3 shadow-lg shadow-red-600/30 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    <div className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center">
                      <div className="w-3 h-3 rounded-full bg-white" />
                    </div>
                    <span>Take Photo & Check Recall</span>
                  </button>
                )}

                {/* Dual Action Buttons: Native Camera vs Gallery Upload */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Take Photo with Device Camera (capture="environment") */}
                  <div>
                    <input
                      type="file"
                      id="product-photo-camera"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleVisionImageFile(file);
                        e.target.value = '';
                      }}
                    />
                    <label
                      htmlFor="product-photo-camera"
                      onClick={() => stopCamera()}
                      className="w-full py-3 px-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm active:scale-95 text-center"
                    >
                      <Camera className="w-4 h-4 shrink-0" />
                      <span>Take Photo</span>
                    </label>
                  </div>

                  {/* Choose Existing Photo from Gallery (No capture attribute) */}
                  <div>
                    <input
                      type="file"
                      id="product-photo-upload"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleVisionImageFile(file);
                        e.target.value = '';
                      }}
                    />
                    <label
                      htmlFor="product-photo-upload"
                      onClick={() => stopCamera()}
                      className="w-full py-3 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all border border-slate-200/80 active:scale-95 text-center"
                    >
                      <Upload className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>Choose from Gallery</span>
                    </label>
                  </div>
                </div>

                {/* Resume Live Camera if inactive */}
                {!cameraActive && !analyzingPhoto && (
                  <button
                    type="button"
                    onClick={() => {
                      setImagePreview(null);
                      setVisionError(null);
                      startCamera(undefined, facingMode);
                    }}
                    className="w-full py-2.5 px-3 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-200"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Resume Live Camera Viewfinder</span>
                  </button>
                )}

                {/* Analyzing indicator */}
                {analyzingPhoto && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2 animate-in fade-in">
                    <div className="inline-flex p-3 bg-red-600 text-white rounded-2xl shadow-md animate-bounce">
                      <Sparkles className="w-6 h-6 text-amber-300" />
                    </div>
                    <h5 className="font-extrabold text-sm text-red-950">
                      Analyzing Product Identification...
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
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:px-6 sm:py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Search Scope: {recallsDataset.length.toLocaleString()} Canadian safety notices</span>
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
