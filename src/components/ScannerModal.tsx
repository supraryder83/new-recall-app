import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Camera,
  ShieldAlert,
  ShieldCheck,
  Shield,
  RefreshCw,
  AlertTriangle,
  SwitchCamera,
  Flashlight,
  Key,
  Upload,
  Search,
  Tag,
  ExternalLink,
  Calendar,
  Check,
  ArrowRight,
  Layers,
  Copy
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type { RecallItem, ScanMatchResult } from '../types/recall';
import {
  hasGeminiApiKey,
  analyzeProductImageWithGemini,
  resolveBarcodeWithGemini,
  setGeminiApiKey
} from '../services/gemini';
import { optimizeImage } from '../utils/imageOptimizer';
import { addScanToHistory } from '../services/scanHistory';
import { recordNotifiedRecall } from '../services/historyMonitor';
import { playRecallAlarmSound } from '../services/alarmSound';

export type PhotoStep = 1 | 2;
export type ModalFlowState = 'camera' | 'analyzing' | 'result';

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
  // Current active step in the 2-photo workflow:
  // 1 = Photo of Item (overall product/packaging)
  // 2 = Photo up-close at the SN and model number tag
  const [photoStep, setPhotoStep] = useState<PhotoStep>(1);
  const [flowState, setFlowState] = useState<ModalFlowState>('camera');

  // Captured photos
  const [itemPhoto, setItemPhoto] = useState<string | null>(null);
  const [tagPhoto, setTagPhoto] = useState<string | null>(null);

  // Native camera state & refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Hidden file inputs for photo upload fallback
  const itemFileInputRef = useRef<HTMLInputElement | null>(null);
  const tagFileInputRef = useRef<HTMLInputElement | null>(null);

  // AI analysis state
  const [analyzingStep, setAnalyzingStep] = useState<string>('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Verdict state
  const [scanResult, setScanResult] = useState<ScanMatchResult | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  // Gemini API key state
  const [hasKey, setHasKey] = useState(hasGeminiApiKey());
  const [quickApiKey, setQuickApiKey] = useState('');
  const [showKeyForm, setShowKeyForm] = useState(false);

  // Barcode detection and manual lookup state
  const [showManualCodeInput, setShowManualCodeInput] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const runBarcodeVerificationRef = useRef<((code: string) => Promise<void>) | null>(null);
  const isAutoScanningBarcodeRef = useRef(false);

  // Native BarcodeDetector scanning loop from video stream
  // When a barcode is detected, directly triggers verification without requiring manual confirmation
  useEffect(() => {
    if (!isOpen || flowState !== 'camera' || !cameraActive || !videoRef.current) return;
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return;

    let isCancelled = false;
    let detector: any = null;
    try {
      detector = new (window as any).BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code']
      });
    } catch {
      return;
    }

    const interval = setInterval(async () => {
      if (isCancelled || isAutoScanningBarcodeRef.current || !videoRef.current || videoRef.current.readyState < 2) return;
      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          const raw = barcodes[0].rawValue.trim();
          if (raw && !isAutoScanningBarcodeRef.current) {
            isAutoScanningBarcodeRef.current = true;
            isCancelled = true;
            clearInterval(interval);
            try {
              navigator.vibrate?.(60);
            } catch {}
            // Bypasses the unreliable "Barcode found, verify barcode" prompt and verifies immediately
            runBarcodeVerificationRef.current?.(raw);
          }
        }
      } catch {}
    }, 350);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [isOpen, flowState, cameraActive]);

  const handleSaveQuickKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickApiKey.trim()) return;
    setGeminiApiKey(quickApiKey.trim());
    setHasKey(true);
    setQuickApiKey('');
    setShowKeyForm(false);
    setAnalysisError(null);
  };

  // Helper functions to identify camera facing labels
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

  // Cleanly stops the native camera feed
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setTorchOn(false);
    setSupportsTorch(false);
  }, []);

  // Starts the camera stream
  const startCamera = useCallback(
    async (targetDeviceId?: string, requestedFacing: 'environment' | 'user' = 'environment') => {
      stopCamera();
      setCameraError(null);
      isAutoScanningBarcodeRef.current = false;

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported by your browser.');
        }

        let stream: MediaStream | null = null;

        // 1. Try explicit targetDeviceId
        if (targetDeviceId) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: { exact: targetDeviceId },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
              },
              audio: false
            });
          } catch {}
        }

        // 2. Query available devices to pick ideal rear camera
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

            if (matchingDevice?.deviceId) {
              try {
                stream = await navigator.mediaDevices.getUserMedia({
                  video: {
                    deviceId: { exact: matchingDevice.deviceId },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                  },
                  audio: false
                });
              } catch {}
            }
          } catch {}
        }

        // 3. Fallback to ideal facingMode
        if (!stream) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: { ideal: requestedFacing },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
              },
              audio: false
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false
            });
          }
        }

        if (!stream) throw new Error('Could not initialize camera stream.');

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

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch {}
        }

        setCameraActive(true);
      } catch (err: any) {
        console.warn('Camera start error:', err);
        setCameraError(
          err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Please allow camera access in browser settings.'
            : 'Unable to start camera feed. You can upload photos using the upload button.'
        );
        setCameraActive(false);
      }
    },
    [stopCamera]
  );

  // Toggle camera facing (front/back)
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

  // Capture snapshot from current video feed
  const captureSnapshot = (): string | null => {
    if (!videoRef.current || !streamRef.current) return null;
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
      if (!ctx) return null;

      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      canvas.width = 0;
      canvas.height = 0;
      return dataUrl;
    } catch (err) {
      console.error('Snapshot capture error:', err);
      return null;
    }
  };

  // Run AI multimodal analysis with Gemini 3.5 Flash Lite on both captured photos
  const runVerificationAnalysis = async (itemImg: string, tagImg: string | null) => {
    stopCamera();
    setFlowState('analyzing');
    setAnalysisError(null);
    setScanResult(null);

    try {
      setAnalyzingStep('1 of 3: Inspecting product form factor & brand...');
      await new Promise((r) => setTimeout(r, 250));

      setAnalyzingStep(
        tagImg
          ? '2 of 3: Reading model number, serial number (SN) & rating plate...'
          : '2 of 3: Scanning packaging identifiers & markings...'
      );
      await new Promise((r) => setTimeout(r, 250));

      setAnalyzingStep('3 of 3: Cross-referencing 34,287 official Canadian recall records...');

      const result = await analyzeProductImageWithGemini({
        itemImage: { base64Data: itemImg, mimeType: 'image/jpeg' },
        tagImage: tagImg ? { base64Data: tagImg, mimeType: 'image/jpeg' } : undefined,
        recallsDataset
      });

      setScanResult(result);
      setFlowState('result');

      // Save scan to persistent history
      const savedItem = addScanToHistory({
        imagePreview: itemImg,
        tagImagePreview: tagImg || undefined,
        identifiedTitle: result.identifiedTitle || 'Product Scan',
        verdict: result.verdict,
        matchReason: result.matchReason,
        matchedRecallsCount: result.matchedRecalls.length,
        extractedInfo: result.extractedInfo,
        matchedRecalls: result.matchedRecalls,
        similarProductRecalls: result.similarProductRecalls,
        relatedBrandRecalls: result.relatedBrandRecalls,
        searchKeywords: result.searchKeywords
      });

      // Record for 6-hour background monitoring
      if (result.matchedRecalls && result.matchedRecalls.length > 0) {
        for (const recall of result.matchedRecalls) {
          recordNotifiedRecall({
            key: `${savedItem.id}_${recall.NID}`,
            itemId: savedItem.id,
            itemTitle: savedItem.identifiedTitle,
            recallNid: recall.NID,
            recallTitle: recall.Title,
            hazard: recall.Issue,
            notifiedAt: Date.now()
          });
        }
      }

      if (result.verdict === 'MATCH_FOUND') {
        try {
          playRecallAlarmSound(6);
        } catch {}
      } else if (result.verdict === 'NO_RECALL_FOUND') {
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.65 }
        });
      }
    } catch (err: any) {
      console.error('Verification analysis failed:', err);
      setAnalysisError(
        err?.message ||
          'Failed to complete recall verification. Please verify your Gemini API key or retry with clear photos.'
      );
      setFlowState('camera');
      // Resume camera
      await startCamera(undefined, facingMode);
    } finally {
      setAnalyzingStep('');
    }
  };

  // Run verification directly on a barcode or model code
  const runBarcodeVerification = async (barcodeOrCode: string) => {
    stopCamera();
    setFlowState('analyzing');
    setAnalysisError(null);
    setScanResult(null);

    try {
      const clean = barcodeOrCode.trim();
      setAnalyzingStep(`Checking code "${clean}" against 34,287 Canadian safety notices...`);

      const result = await resolveBarcodeWithGemini(clean, recallsDataset);
      setScanResult(result);
      setFlowState('result');

      // Save scan to persistent history
      const savedItem = addScanToHistory({
        identifiedTitle: result.identifiedTitle || `Code ${clean}`,
        verdict: result.verdict,
        matchReason: result.matchReason,
        matchedRecallsCount: result.matchedRecalls.length,
        extractedInfo: result.extractedInfo,
        matchedRecalls: result.matchedRecalls,
        similarProductRecalls: result.similarProductRecalls,
        relatedBrandRecalls: result.relatedBrandRecalls,
        searchKeywords: result.searchKeywords
      });

      // Record for 6-hour background monitoring
      if (result.matchedRecalls && result.matchedRecalls.length > 0) {
        for (const recall of result.matchedRecalls) {
          recordNotifiedRecall({
            key: `${savedItem.id}_${recall.NID}`,
            itemId: savedItem.id,
            itemTitle: savedItem.identifiedTitle,
            recallNid: recall.NID,
            recallTitle: recall.Title,
            hazard: recall.Issue,
            notifiedAt: Date.now()
          });
        }
      }

      if (result.verdict === 'MATCH_FOUND') {
        try {
          playRecallAlarmSound(6);
        } catch {}
      } else if (result.verdict === 'NO_RECALL_FOUND') {
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.65 }
        });
      }
    } catch (err: any) {
      console.error('Barcode verification failed:', err);
      setAnalysisError(err?.message || 'Failed to verify code.');
      setFlowState('camera');
      isAutoScanningBarcodeRef.current = false;
      await startCamera(undefined, facingMode);
    } finally {
      setAnalyzingStep('');
    }
  };

  runBarcodeVerificationRef.current = runBarcodeVerification;

  // Handle shutter button click based on current step
  const handleShutterClick = async () => {
    // Haptic feedback
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(50);
      }
    } catch {}

    const snapshot = captureSnapshot();
    if (!snapshot) {
      setCameraError('Failed to capture snapshot from camera feed. Please retry.');
      return;
    }

    if (photoStep === 1) {
      // Step 1: Overall item captured -> advance to Step 2 (SN & Model tag)
      setItemPhoto(snapshot);
      setPhotoStep(2);
    } else {
      // Step 2: Up-close SN & Model tag captured -> trigger verification
      setTagPhoto(snapshot);
      if (itemPhoto) {
        await runVerificationAnalysis(itemPhoto, snapshot);
      }
    }
  };

  // Skip Step 2 (verify item only if product has no tag or rating plate)
  const handleSkipTagStep = async () => {
    if (!itemPhoto) return;
    setTagPhoto(null);
    await runVerificationAnalysis(itemPhoto, null);
  };

  // Upload Photo for Step 1
  const handleUploadItemPhoto = async (file: File) => {
    if (!file) return;
    try {
      const optimized = await optimizeImage(file, { maxDimension: 1280, quality: 0.85 });
      setItemPhoto(optimized.dataUrl);
      setPhotoStep(2);
    } catch (err: any) {
      setCameraError(err?.message || 'Failed to process selected item photo.');
    }
  };

  // Upload Photo for Step 2
  const handleUploadTagPhoto = async (file: File) => {
    if (!file) return;
    try {
      const optimized = await optimizeImage(file, { maxDimension: 1280, quality: 0.85 });
      setTagPhoto(optimized.dataUrl);
      if (itemPhoto) {
        await runVerificationAnalysis(itemPhoto, optimized.dataUrl);
      }
    } catch (err: any) {
      setCameraError(err?.message || 'Failed to process selected tag photo.');
    }
  };

    // Reset to Step 1 to scan another item
  const handleScanAnother = async () => {
    isAutoScanningBarcodeRef.current = false;
    setPhotoStep(1);
    setItemPhoto(null);
    setTagPhoto(null);
    setScanResult(null);
    setAnalysisError(null);
    setFlowState('camera');
    await startCamera(undefined, facingMode);
  };

  // Retake Step 1 photo
  const handleRetakeItemPhoto = async () => {
    isAutoScanningBarcodeRef.current = false;
    setPhotoStep(1);
    setItemPhoto(null);
    setTagPhoto(null);
    setScanResult(null);
    setFlowState('camera');
    if (!cameraActive) {
      await startCamera(undefined, facingMode);
    }
  };

  // Copy brief recall report to clipboard
  const handleCopyReport = async () => {
    if (!scanResult) return;
    const title = scanResult.identifiedTitle || 'Product';
    const isRecall = scanResult.verdict === 'MATCH_FOUND';
    const text = `Canada Recall Check: ${title}
Status: ${isRecall ? '⚠️ SAFETY RECALL CONFIRMED' : '✅ NO ACTIVE RECALLS'}
Model: ${scanResult.extractedInfo?.modelOrLot || 'N/A'}
Serial: ${scanResult.extractedInfo?.serialNumber || 'N/A'}
Reason: ${scanResult.matchReason || ''}
Verified via Canada Recall Alert (Health Canada, CFIA, Transport Canada)`;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2500);
    } catch {}
  };

  // Modal lifecycle
  useEffect(() => {
    isAutoScanningBarcodeRef.current = false;
    if (!isOpen) {
      stopCamera();
      setItemPhoto(null);
      setTagPhoto(null);
      setScanResult(null);
      setPhotoStep(1);
      setFlowState('camera');
      setCameraError(null);
      setAnalysisError(null);
    } else {
      setHasKey(hasGeminiApiKey());
      setPhotoStep(1);
      setItemPhoto(null);
      setTagPhoto(null);
      setScanResult(null);
      setFlowState('camera');
      startCamera(undefined, 'environment');
    }
    return () => {
      isAutoScanningBarcodeRef.current = false;
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 w-full h-full bg-black overflow-hidden flex flex-col animate-in fade-in duration-200 select-none">
      {/* Hidden File Inputs for Gallery Upload */}
      <input
        ref={itemFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadItemPhoto(file);
          e.target.value = '';
        }}
      />
      <input
        ref={tagFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadTagPhoto(file);
          e.target.value = '';
        }}
      />

      {/* =========================================================================
          CAMERA VIEWPORT & LIVE FEED
         ========================================================================= */}
      <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden">
        {/* Native Video Element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            cameraActive && flowState === 'camera'
              ? 'opacity-100 z-10'
              : 'opacity-0 pointer-events-none -z-10'
          }`}
        />

        {/* Camera Permission / Error Banner */}
        {cameraError && flowState === 'camera' && (
          <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-white bg-slate-950/95 z-30">
            <div className="p-4 bg-amber-500/10 rounded-3xl mb-3 border border-amber-500/30">
              <AlertTriangle className="w-10 h-10 text-amber-400" />
            </div>
            <h4 className="text-base font-bold text-white">Camera Access Notice</h4>
            <p className="text-xs text-slate-300 max-w-sm mt-1 leading-relaxed">{cameraError}</p>
            <div className="mt-5 flex flex-wrap gap-2.5 justify-center">
              <button
                type="button"
                onClick={() => startCamera(undefined, facingMode)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Camera</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (photoStep === 1) itemFileInputRef.current?.click();
                  else tagFileInputRef.current?.click();
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Photo from Gallery</span>
              </button>
            </div>
          </div>
        )}

        {/* =========================================================================
            ANALYZING STATE (Interactive 2-Photo Scanning Animation)
           ========================================================================= */}
        {flowState === 'analyzing' && (
          <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-white bg-slate-950/95 z-35 animate-in fade-in duration-200">
            {/* Visual dual photo cards being scanned */}
            <div className="flex items-center gap-3 mb-6">
              {itemPhoto && (
                <div className="relative w-28 h-36 rounded-2xl overflow-hidden border-2 border-red-500/80 shadow-2xl">
                  <img src={itemPhoto} alt="Product Item" className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 inset-x-1 text-[9px] font-bold bg-slate-900/90 text-white py-0.5 rounded text-center">
                    1. Item
                  </span>
                </div>
              )}
              {tagPhoto ? (
                <div className="relative w-28 h-36 rounded-2xl overflow-hidden border-2 border-amber-500/80 shadow-2xl">
                  <img src={tagPhoto} alt="Serial Tag" className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 inset-x-1 text-[9px] font-bold bg-slate-900/90 text-white py-0.5 rounded text-center">
                    2. SN Tag
                  </span>
                </div>
              ) : (
                <div className="w-28 h-36 rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/60 flex flex-col items-center justify-center p-2 text-slate-500 text-center">
                  <Tag className="w-6 h-6 mb-1 opacity-50" />
                  <span className="text-[10px] font-semibold">Tag Skipped</span>
                </div>
              )}
            </div>

            {/* Radar Spinner & Progress Message */}
            <div className="relative mb-4">
              <div className="w-14 h-14 rounded-full border-3 border-red-600/30 border-t-red-500 animate-spin" />
              <Shield className="w-6 h-6 text-red-500 absolute inset-0 m-auto" />
            </div>

            <h4 className="text-base font-extrabold text-white">Forensic Safety Verification</h4>
            <p className="text-xs text-red-400 font-semibold mt-1.5 animate-pulse max-w-xs leading-relaxed">
              {analyzingStep || 'Analyzing photos with Gemini 3.5 Flash Lite...'}
            </p>
            <p className="text-[11px] text-slate-400 mt-2">
              Cross-referencing Health Canada, CFIA & Transport Canada databases
            </p>
          </div>
        )}
      </div>

      {/* =========================================================================
          TOP MODAL BAR & STEP PROGRESS
         ========================================================================= */}
      <div className="relative z-30 pt-safe px-4 pt-4 pb-2 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          {/* Header Title with Canadian Maple Accent */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center">
              <Camera className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-white tracking-tight flex items-center gap-1.5">
                <span>Recall Camera Verification</span>
              </h3>
              <p className="text-[10px] text-slate-300">2-Photo Forensic Verification</p>
            </div>
          </div>

          {/* Close Modal Button */}
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center backdrop-blur-md transition-all border border-white/15"
            aria-label="Close Scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2-Step Progress Indicator Bar (shown during camera capture) */}
        {flowState === 'camera' && (
          <div className="grid grid-cols-2 gap-2 mt-1">
            {/* Step 1 Indicator */}
            <button
              type="button"
              onClick={() => {
                if (itemPhoto) handleRetakeItemPhoto();
              }}
              className={`p-2 rounded-xl text-left border transition-all flex items-center gap-2 ${
                photoStep === 1
                  ? 'bg-red-600/30 border-red-500 text-white shadow-sm ring-1 ring-red-500/50'
                  : itemPhoto
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/60'
                  : 'bg-white/5 border-white/10 text-white/50'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                  photoStep === 1
                    ? 'bg-red-600 text-white'
                    : itemPhoto
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-white/20 text-white'
                }`}
              >
                {itemPhoto ? <Check className="w-3 h-3 stroke-[3]" /> : '1'}
              </div>
              <div className="min-w-0">
                <span className="block text-[11px] font-bold truncate">
                  {itemPhoto ? '1. Item Captured' : '1. Photo of Item'}
                </span>
                <span className="block text-[9px] text-white/70 truncate">
                  {photoStep === 1 ? 'Frame whole product' : 'Tap to retake'}
                </span>
              </div>
            </button>

            {/* Step 2 Indicator */}
            <div
              className={`p-2 rounded-xl text-left border transition-all flex items-center gap-2 ${
                photoStep === 2
                  ? 'bg-amber-600/30 border-amber-500 text-white shadow-sm ring-1 ring-amber-500/50'
                  : tagPhoto
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                  : 'bg-white/5 border-white/10 text-white/50'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                  photoStep === 2
                    ? 'bg-amber-500 text-slate-950'
                    : tagPhoto
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-white/20 text-white'
                }`}
              >
                {tagPhoto ? <Check className="w-3 h-3 stroke-[3]" /> : '2'}
              </div>
              <div className="min-w-0">
                <span className="block text-[11px] font-bold truncate">
                  {tagPhoto ? '2. Tag Captured' : '2. SN & Model Tag'}
                </span>
                <span className="block text-[9px] text-white/70 truncate">
                  {photoStep === 2 ? 'Up-close tag/sticker' : 'Upcoming step'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          VIEWFINDER GUIDES (Tailored per Step: Item vs Macro Tag)
         ========================================================================= */}
      {flowState === 'camera' && (
        <div className="relative flex-1 flex flex-col items-center justify-center p-4 pointer-events-none">

          {/* Step 1: Overall Product Guide Frame */}
          {photoStep === 1 && (
            <div className="relative w-[85%] max-w-sm aspect-[4/5] rounded-3xl border-2 border-white/50 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] flex flex-col justify-between p-4 transition-all">
              {/* Corner Accents */}
              <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-red-500 rounded-tl-xl" />
              <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-red-500 rounded-tr-xl" />
              <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-red-500 rounded-bl-xl" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-red-500 rounded-br-xl" />

              {/* Instructions Pill */}
              <div className="self-center bg-black/75 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/20 text-center">
                <span className="text-[11px] font-extrabold text-white tracking-wide flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-red-400" />
                  <span>STEP 1: Capture Entire Item</span>
                </span>
              </div>

              <div className="self-center bg-black/60 px-3 py-1 rounded-full text-[10px] text-white/90">
                Position product front & packaging inside box
              </div>
            </div>
          )}

          {/* Step 2: Macro Serial Number & Model Tag Focus Reticle */}
          {photoStep === 2 && (
            <div className="relative w-[90%] max-w-md aspect-[16/9] rounded-2xl border-2 border-amber-400/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] flex flex-col justify-between p-3.5 transition-all">
              {/* Macro Tag Corner Accents */}
              <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-amber-400 rounded-tl-lg" />
              <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-amber-400 rounded-tr-lg" />
              <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-amber-400 rounded-bl-lg" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-amber-400 rounded-br-lg" />

              {/* Animated Horizontal Laser Focus Bar */}
              <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-0.5 bg-linear-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_8px_#f59e0b] opacity-80" />

              {/* Step 2 Instructions Pill */}
              <div className="self-center bg-black/85 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-amber-400/30 text-center">
                <span className="text-[11px] font-extrabold text-amber-300 tracking-wide flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-amber-400" />
                  <span>STEP 2: Up-Close Serial / Model Tag</span>
                </span>
              </div>

              <div className="self-center bg-black/75 px-3 py-1 rounded-full text-[10px] text-amber-200">
                Hold 4-8 inches away from rating plate, model # or barcode
              </div>
            </div>
          )}

          {/* Floating Thumbnail of Step 1 Photo while on Step 2 */}
          {photoStep === 2 && itemPhoto && (
            <button
              type="button"
              onClick={handleRetakeItemPhoto}
              className="pointer-events-auto absolute top-4 right-4 bg-slate-900/90 border border-white/20 rounded-2xl p-1.5 flex items-center gap-2 shadow-xl backdrop-blur-md active:scale-95 transition-all"
              title="Tap to retake Item photo"
            >
              <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/20">
                <img src={itemPhoto} alt="Item thumbnail" className="w-full h-full object-cover" />
              </div>
              <div className="pr-1.5 text-left">
                <span className="block text-[10px] font-bold text-white flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>Item Saved</span>
                </span>
                <span className="block text-[9px] text-red-400 font-semibold underline">Retake</span>
              </div>
            </button>
          )}
        </div>
      )}

      {/* =========================================================================
          BOTTOM CAMERA CONTROLS BAR
         ========================================================================= */}
      {flowState === 'camera' && (
        <div className="relative z-30 pb-safe px-5 pt-3 pb-4 bg-gradient-to-t from-black/95 via-black/85 to-transparent flex flex-col gap-3">
          {/* Analysis Error Alert */}
          {analysisError && (
            <div className="bg-red-500/20 border border-red-500/40 rounded-2xl p-2.5 flex items-center justify-between gap-2 text-xs text-red-200">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-[11px] leading-tight truncate">{analysisError}</span>
              </div>
              <button
                type="button"
                onClick={() => setAnalysisError(null)}
                className="text-white/70 hover:text-white p-1"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Missing API Key Warning / Prompt */}
          {!hasKey && (
            <div className="bg-amber-500/20 border border-amber-500/40 rounded-2xl p-2.5 flex items-center justify-between gap-2 text-xs text-amber-200">
              <div className="flex items-center gap-2 min-w-0">
                <Key className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate text-[11px]">Gemini API key recommended for AI verification</span>
              </div>
              <button
                type="button"
                onClick={() => setShowKeyForm(!showKeyForm)}
                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg text-[10px] shrink-0"
              >
                {showKeyForm ? 'Cancel' : 'Set Key'}
              </button>
            </div>
          )}

          {/* Quick API Key Entry Form */}
          {showKeyForm && (
            <form onSubmit={handleSaveQuickKey} className="flex gap-2">
              <input
                type="password"
                placeholder="Paste Gemini API Key (AIzaSy...)"
                value={quickApiKey}
                onChange={(e) => setQuickApiKey(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold"
              >
                Save
              </button>
            </form>
          )}

          {/* Secondary Actions: Skip Tag Photo or Enter Barcode Manually */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {photoStep === 2 && (
              <button
                type="button"
                onClick={handleSkipTagStep}
                className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-full text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all shadow-sm"
              >
                <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
                <span>No Tag? Verify Item Only</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowManualCodeInput(!showManualCodeInput)}
              className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white/90 rounded-full text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all"
            >
              <Tag className="w-3.5 h-3.5 text-amber-400" />
              <span>{showManualCodeInput ? 'Hide Code Entry' : 'Type Barcode / Model #'}</span>
            </button>
          </div>

          {/* Manual Code Input Form */}
          {showManualCodeInput && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (manualCode.trim()) {
                  runBarcodeVerification(manualCode.trim());
                }
              }}
              className="flex gap-2 max-w-sm mx-auto w-full"
            >
              <input
                type="text"
                placeholder="Enter UPC, barcode, or model #"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500 font-mono"
                autoFocus
              />
              <button
                type="submit"
                className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shrink-0"
              >
                Check
              </button>
            </form>
          )}

          {/* Primary Controls Row: Torch | Shutter | Flip | Upload */}
          <div className="flex items-center justify-around max-w-sm mx-auto w-full">
            {/* Flashlight / Torch Toggle */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={toggleTorch}
                disabled={!supportsTorch}
                className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all active:scale-90 shadow-md ${
                  torchOn
                    ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-amber-400/40 ring-2 ring-amber-300'
                    : supportsTorch
                    ? 'bg-white/15 hover:bg-white/25 text-white border-white/20'
                    : 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
                }`}
                title={supportsTorch ? 'Toggle Torch Light' : 'Flashlight not supported on this camera'}
              >
                <Flashlight className="w-5 h-5" />
              </button>
              <span className="text-[10px] font-semibold text-white/80 mt-1">Light</span>
            </div>

            {/* MAIN SHUTTER BUTTON */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={handleShutterClick}
                disabled={!cameraActive}
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-2xl p-1.5 ${
                  photoStep === 1
                    ? 'border-4 border-red-500 bg-red-600/30'
                    : 'border-4 border-amber-400 bg-amber-500/30'
                }`}
                aria-label={photoStep === 1 ? 'Snap Photo of Item' : 'Snap Photo of Tag'}
              >
                <div
                  className={`w-full h-full rounded-full transition-all flex items-center justify-center ${
                    photoStep === 1
                      ? 'bg-gradient-to-tr from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400 shadow-lg shadow-red-600/50'
                      : 'bg-gradient-to-tr from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 shadow-lg shadow-amber-500/50'
                  }`}
                >
                  <Camera
                    className={`w-8 h-8 ${photoStep === 1 ? 'text-white' : 'text-slate-950'}`}
                  />
                </div>
              </button>
              <span className="text-[11px] font-extrabold text-white mt-1.5 tracking-wide drop-shadow-md">
                {photoStep === 1 ? '1. Snap Item' : '2. Snap Tag'}
              </span>
            </div>

            {/* Switch Camera Facing (Front/Back) */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={toggleCameraFacing}
                className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 border border-white/20 text-white flex items-center justify-center transition-all active:scale-90 shadow-md"
                title="Flip Camera"
              >
                <SwitchCamera className="w-5 h-5" />
              </button>
              <span className="text-[10px] font-semibold text-white/80 mt-1">Flip</span>
            </div>

            {/* Upload from Gallery Button */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => {
                  if (photoStep === 1) itemFileInputRef.current?.click();
                  else tagFileInputRef.current?.click();
                }}
                className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 border border-white/20 text-white flex items-center justify-center transition-all active:scale-90 shadow-md"
                title="Upload Photo from Device Gallery"
              >
                <Upload className="w-5 h-5" />
              </button>
              <span className="text-[10px] font-semibold text-white/80 mt-1">Gallery</span>
            </div>
          </div>

          {/* Disclaimer Note */}
          <p className="text-[9px] text-white/50 text-center max-w-sm mx-auto leading-tight pt-0.5">
            Independent safety tool. Not affiliated with Health Canada, CFIA, or Transport Canada.
          </p>
        </div>
      )}

      {/* =========================================================================
          VERDICT BOTTOM SHEET (Presented when 2-Photo Analysis Completes)
         ========================================================================= */}
      {flowState === 'result' && scanResult && (
        <div className="absolute inset-x-0 bottom-0 max-h-[90vh] z-40 bg-white rounded-t-3xl shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-bottom duration-300">
          {/* Sheet Handle */}
          <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto my-3 shrink-0" />

          {/* Sheet Content */}
          <div className="px-5 pb-6 overflow-y-auto space-y-4 text-left flex-1">
            {/* Top Product Spotlight Header */}
            <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-md flex items-center justify-between gap-3 text-left">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">
                  <Camera className="w-3 h-3" />
                  <span>2-Photo Multimodal Forensic Verification</span>
                </div>
                <h4 className="font-extrabold text-sm sm:text-base text-white truncate">
                  {scanResult.identifiedTitle || 'Verified Product'}
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
                  <span>Search</span>
                </button>
              )}
            </div>

            {/* Verdict Banner Card */}
            <div
              className={`p-5 rounded-2xl border text-left shadow-sm ${
                scanResult.verdict === 'MATCH_FOUND'
                  ? 'bg-red-50 border-red-200 text-red-950'
                  : scanResult.verdict === 'POSSIBLE_MATCH'
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
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
                    <AlertTriangle className="w-6 h-6 animate-pulse" />
                  ) : (
                    <ShieldCheck className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <h4 className="font-extrabold text-base sm:text-lg">
                    {scanResult.verdict === 'MATCH_FOUND'
                      ? (scanResult.extractedInfo?.serialNumber ||
                         (scanResult.extractedInfo?.modelOrLot && /\d/.test(scanResult.extractedInfo.modelOrLot)) ||
                         scanResult.extractedInfo?.upcOrCode
                          ? 'Exact Product Safety Recall Confirmed!'
                          : 'Product Line Safety Recall Alert!')
                      : scanResult.verdict === 'POSSIBLE_MATCH'
                      ? 'Potential Recall Found for Related Model!'
                      : 'No Active Recall For This Product'}
                  </h4>
                  <p className="text-xs sm:text-sm mt-1 opacity-90 leading-relaxed">
                    {scanResult.matchReason}
                  </p>
                  {scanResult.verdict === 'MATCH_FOUND' &&
                    !scanResult.extractedInfo?.serialNumber &&
                    !(scanResult.extractedInfo?.modelOrLot && /\d/.test(scanResult.extractedInfo.modelOrLot)) &&
                    !scanResult.extractedInfo?.upcOrCode && (
                      <div className="mt-2.5 px-3 py-1.5 bg-red-600/10 border border-red-300 rounded-xl text-xs text-red-900 font-medium flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                        <span>
                          <strong>Action required:</strong> Compare your unit’s label or receipt against the affected models & date codes in the notices below.
                        </span>
                      </div>
                    )}
                </div>
              </div>

              {/* Photos Captured Comparison */}
              <div className="mt-4 pt-3.5 border-t border-slate-200/60 flex items-center gap-3">
                {scanResult.itemImage && (
                  <div className="flex items-center gap-2 bg-white/80 p-1.5 rounded-xl border border-slate-200">
                    <img
                      src={scanResult.itemImage}
                      alt="Item preview"
                      className="w-12 h-12 object-cover rounded-lg"
                    />
                    <div className="pr-2">
                      <span className="block text-[9px] font-bold text-slate-500 uppercase">
                        Photo 1
                      </span>
                      <span className="block text-[11px] font-bold text-slate-800">Item</span>
                    </div>
                  </div>
                )}
                {scanResult.tagImage ? (
                  <div className="flex items-center gap-2 bg-white/80 p-1.5 rounded-xl border border-slate-200">
                    <img
                      src={scanResult.tagImage}
                      alt="Tag preview"
                      className="w-12 h-12 object-cover rounded-lg"
                    />
                    <div className="pr-2">
                      <span className="block text-[9px] font-bold text-amber-700 uppercase">
                        Photo 2
                      </span>
                      <span className="block text-[11px] font-bold text-slate-800">Tag / SN</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-white/60 rounded-xl border border-slate-200 text-slate-500 text-[11px] font-medium">
                    <Tag className="w-3.5 h-3.5 opacity-60" />
                    <span>Tag photo was skipped</span>
                  </div>
                )}
              </div>

              {/* Extracted Details Grid */}
              {scanResult.extractedInfo && (
                <div className="mt-3.5 pt-3 border-t border-slate-200/60 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {scanResult.extractedInfo.brand && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">
                        Brand
                      </span>
                      <span className="font-bold text-slate-800">
                        {scanResult.extractedInfo.brand}
                      </span>
                    </div>
                  )}
                  {scanResult.extractedInfo.productName && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">
                        Product Line
                      </span>
                      <span className="font-bold text-slate-800">
                        {scanResult.extractedInfo.productName}
                      </span>
                    </div>
                  )}
                  {scanResult.extractedInfo.modelOrLot && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-amber-200">
                      <span className="text-amber-800 block text-[10px] font-bold uppercase">
                        Model / Lot #
                      </span>
                      <span className="font-mono font-extrabold text-amber-950">
                        {scanResult.extractedInfo.modelOrLot}
                      </span>
                    </div>
                  )}
                  {scanResult.extractedInfo.serialNumber && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-amber-200">
                      <span className="text-amber-800 block text-[10px] font-bold uppercase">
                        Serial Number (SN)
                      </span>
                      <span className="font-mono font-extrabold text-amber-950">
                        {scanResult.extractedInfo.serialNumber}
                      </span>
                    </div>
                  )}
                  {scanResult.extractedInfo.upcOrCode && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">
                        Barcode / Code
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {scanResult.extractedInfo.upcOrCode}
                      </span>
                    </div>
                  )}
                  {scanResult.extractedInfo.packageSize && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">
                        Size / Rating
                      </span>
                      <span className="font-bold text-slate-800">
                        {scanResult.extractedInfo.packageSize}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Matched Official Canadian Recall Notices */}
            {scanResult.matchedRecalls.length > 0 && (
              <div className="space-y-3.5 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-red-600 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Official Safety Notice Details ({scanResult.matchedRecalls.length})</span>
                  </span>
                  <span className="text-[11px] text-slate-500 font-semibold">Government notices</span>
                </div>

                <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                  {scanResult.matchedRecalls.map((recall, index) => {
                    const recallClass = (recall['Recall class'] || '').trim();
                    const isClass1 =
                      recallClass.toLowerCase().includes('class 1') ||
                      recallClass.toLowerCase().includes('type i');

                    return (
                      <div
                        key={recall.NID || index}
                        className="p-4 sm:p-5 bg-slate-50 border-2 border-red-200 hover:border-red-400 rounded-2xl shadow-sm text-left space-y-3.5 transition-all"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          {recallClass && (
                            <span
                              className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase tracking-wider ${
                                isClass1 ? 'bg-red-600 text-white shadow-xs' : 'bg-amber-500 text-white'
                              }`}
                            >
                              {recallClass}
                            </span>
                          )}
                          <span className="bg-red-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded uppercase tracking-wider">
                            Recall Notice
                          </span>
                          {recall.Organization && (
                            <span className="bg-white text-slate-700 border border-slate-200 text-[10px] font-bold px-2 py-0.5 rounded">
                              {recall.Organization}
                            </span>
                          )}
                          {recall.NID && (
                            <span className="bg-white text-slate-500 border border-slate-200 font-mono text-[10px] px-2 py-0.5 rounded">
                              ID: #{recall.NID}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-500 font-medium flex items-center gap-1 ml-auto">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            {recall['Last updated']}
                          </span>
                        </div>

                        <h4 className="font-extrabold text-sm sm:text-base text-slate-900 leading-snug">
                          {recall.Title}
                        </h4>

                        <div className="p-3 bg-white border border-slate-200/90 rounded-xl space-y-1">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                            <Tag className="w-3 h-3 text-slate-400" />
                            <span>Affected Product Description & Model Numbers</span>
                          </span>
                          <p className="text-xs sm:text-sm font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                            {recall.Product || recall.Title}
                          </p>
                        </div>

                        {recall.Issue && (
                          <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-red-700 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-red-600" />
                              <span>Safety Hazard & Defect Details</span>
                            </span>
                            <p className="text-xs sm:text-sm font-semibold text-red-950 leading-relaxed whitespace-pre-line">
                              {recall.Issue}
                            </p>
                          </div>
                        )}

                        {recall['What you should do'] && (
                          <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-1">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-emerald-600" />
                              <span>What You Should Do (Official Consumer Action)</span>
                            </span>
                            <p className="text-xs sm:text-sm text-emerald-950 leading-relaxed whitespace-pre-line font-medium">
                              {recall['What you should do']}
                            </p>
                          </div>
                        )}

                        <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectRecall(recall);
                              onClose();
                            }}
                            className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
                          >
                            <span>Open Full Notice</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>

                          {recall.URL && (
                            <a
                              href={recall.URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-slate-600 hover:text-red-600 font-semibold flex items-center gap-1 underline underline-offset-2 transition-colors py-1"
                            >
                              <span>Official Government Webpage</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Similar Variations & Product Line Recalls */}
            {scanResult.similarProductRecalls && scanResult.similarProductRecalls.length > 0 && (
              <div className="space-y-3.5 text-left pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Related Product Line Recalls ({scanResult.similarProductRecalls.length})</span>
                  </span>
                  <span className="text-[11px] text-amber-800 font-semibold">Inspect affected models</span>
                </div>

                <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1">
                  {scanResult.similarProductRecalls.map((recall, index) => {
                    const recallClass = (recall['Recall class'] || '').trim();
                    return (
                      <div
                        key={`similar_${recall.NID || index}`}
                        className="p-4 sm:p-5 bg-amber-50/70 border-2 border-amber-300 hover:border-amber-400 rounded-2xl shadow-sm text-left space-y-3 transition-all"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="bg-amber-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded uppercase tracking-wider">
                            Related Model Notice
                          </span>
                          {recallClass && (
                            <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                              {recallClass}
                            </span>
                          )}
                          {recall.NID && (
                            <span className="bg-white text-slate-500 border border-slate-200 font-mono text-[10px] px-2 py-0.5 rounded">
                              ID: #{recall.NID}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-500 font-medium flex items-center gap-1 ml-auto">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            {recall['Last updated']}
                          </span>
                        </div>

                        <h4 className="font-extrabold text-sm sm:text-base text-slate-900 leading-snug">
                          {recall.Title}
                        </h4>

                        <div className="p-3 bg-white border border-amber-200 rounded-xl space-y-1">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 flex items-center gap-1">
                            <Tag className="w-3 h-3 text-amber-600" />
                            <span>Affected Products & Models</span>
                          </span>
                          <p className="text-xs sm:text-sm font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                            {recall.Product || recall.Title}
                          </p>
                        </div>

                        {recall.Issue && (
                          <div className="p-2.5 bg-red-50/80 border border-red-200 rounded-xl space-y-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-red-600" />
                              <span>Hazard</span>
                            </span>
                            <p className="text-xs text-red-950 font-medium leading-relaxed">
                              {recall.Issue}
                            </p>
                          </div>
                        )}

                        <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/70">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectRecall(recall);
                              onClose();
                            }}
                            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
                          >
                            <span>Open Full Notice</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>

                          {recall.URL && (
                            <a
                              href={recall.URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-slate-600 hover:text-amber-700 font-semibold flex items-center gap-1 underline underline-offset-2 transition-colors py-1"
                            >
                              <span>Official Notice</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bottom Actions Row */}
            <div className="pt-2 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleScanAnother}
                className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 active:scale-98"
              >
                <Camera className="w-4 h-4" />
                <span>Scan Another Item</span>
              </button>

              <button
                type="button"
                onClick={handleCopyReport}
                className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-xs sm:text-sm transition-all flex items-center gap-1.5 active:scale-98 border border-slate-200"
              >
                {copiedReport ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700 font-bold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Report</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
