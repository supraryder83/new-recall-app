import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
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
  FileText
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
              width: { ideal: 1920 },
              height: { ideal: 1080 }
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
                  width: { ideal: 1920 },
                  height: { ideal: 1080 }
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
              width: { ideal: 1920 },
              height: { ideal: 1080 }
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
              width: { ideal: 1920 },
              height: { ideal: 1080 }
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
          ? 'Camera permission was denied. Please allow camera access in browser settings, or upload a photo.'
          : 'Unable to start camera feed. You can take a photo or upload an image from your gallery.'
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
      setAnalysisStep('Sending photo to Gemini 2.5 Flash Lite...');
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
    <div className="fixed inset-0 z-50 w-full h-full bg-black overflow-hidden flex flex-col animate-in fade-in duration-200">
      {/* FULL-SCREEN CAMERA / PREVIEW BACKGROUND */}
      <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden">
        {/* Live video feed */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            cameraActive ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Captured / Uploaded photo preview (full-screen) */}
        {!cameraActive && imagePreview && (
          <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center">
            <img
              src={imagePreview}
              alt="Captured preview"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Camera inactive fallback (e.g. paused or stopped) */}
        {!cameraActive && !imagePreview && !cameraError && (
          <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-white bg-slate-950">
            <div className="p-4 bg-slate-900 rounded-3xl mb-3 text-slate-300 border border-slate-800 shadow-xl">
              <Camera className="w-8 h-8 text-red-500" />
            </div>
            <h4 className="text-base font-bold text-white">Live Camera Paused</h4>
            <p className="text-xs text-slate-400 max-w-xs mt-1 leading-relaxed">
              Snap a photo or upload an image from your gallery to identify any product and check Canadian recalls.
            </p>
            <button
              type="button"
              onClick={() => startCamera(undefined, facingMode)}
              className="mt-4 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-lg active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Resume Camera Feed</span>
            </button>
          </div>
        )}

        {/* Camera Error / Permission Screen */}
        {cameraError && (
          <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-white bg-slate-950/95 z-30">
            <div className="p-4 bg-amber-500/10 rounded-3xl mb-3 border border-amber-500/30">
              <AlertTriangle className="w-10 h-10 text-amber-400" />
            </div>
            <h4 className="text-base font-bold text-white">Camera Permission Notice</h4>
            <p className="text-xs text-slate-300 max-w-sm mt-1 leading-relaxed">{cameraError}</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => startCamera(undefined, 'environment')}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-lg active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Camera</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FLOATING TOP BAR OVERLAY */}
      <div className="absolute top-0 inset-x-0 z-30 pt-safe px-4 py-4 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-auto">
        {/* Left: Camera Mode Badge */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white bg-black/50 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/15 flex items-center gap-1.5 shadow-md">
            <Camera className="w-3.5 h-3.5 text-red-500" />
            <span>{facingMode === 'environment' ? 'Rear Camera' : 'Front Camera'}</span>
          </span>
          <span className="hidden sm:inline-flex text-[11px] font-semibold text-amber-300 bg-amber-500/20 border border-amber-400/30 px-2.5 py-1 rounded-full backdrop-blur-md">
            Gemini 2.5 Flash Lite
          </span>
        </div>

        {/* Right Controls: Torch, Switch Facing, Close */}
        <div className="flex items-center gap-2">
          {cameraActive && supportsTorch && (
            <button
              type="button"
              onClick={toggleTorch}
              title={torchOn ? 'Turn off flash' : 'Turn on flash'}
              className={`p-3 rounded-full backdrop-blur-md transition-all border active:scale-90 shadow-lg flex items-center justify-center ${
                torchOn
                  ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-amber-400/40'
                  : 'bg-black/50 hover:bg-black/70 text-white border-white/20'
              }`}
            >
              <Flashlight className="w-4 h-4" />
            </button>
          )}

          {cameraActive && (
            <button
              type="button"
              onClick={toggleCameraFacing}
              title={`Switch to ${facingMode === 'environment' ? 'front' : 'rear'} camera`}
              className="p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-all border border-white/20 active:scale-90 shadow-lg flex items-center justify-center group"
            >
              <SwitchCamera className="w-4 h-4 group-hover:rotate-180 transition-transform duration-300" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-all border border-white/20 active:scale-90 shadow-lg"
            title="Exit camera"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* API Key Missing Banner (Floating if needed) */}
      {!hasKey && (
        <div className="absolute top-20 inset-x-4 max-w-md mx-auto z-30 p-4 bg-slate-900/90 border border-amber-400/40 rounded-2xl text-left backdrop-blur-md shadow-2xl text-white space-y-2">
          <div className="flex items-start gap-2.5">
            <Key className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <h5 className="font-bold text-xs text-white">Gemini API Key Needed</h5>
              <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                Configure <code className="font-mono text-amber-300">VITE_GEMINI_API_KEY</code> in <code className="font-mono">.env</code> or paste your key:
              </p>
            </div>
          </div>

          {!showKeyForm ? (
            <button
              type="button"
              onClick={() => setShowKeyForm(true)}
              className="w-full py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Paste API Key</span>
            </button>
          ) : (
            <form onSubmit={handleSaveQuickKey} className="space-y-2 pt-1">
              <input
                type="password"
                value={quickApiKey}
                onChange={(e) => setQuickApiKey(e.target.value)}
                placeholder="Paste Gemini API key (AIzaSy...)"
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!quickApiKey.trim()}
                  className="flex-1 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-colors"
                >
                  Save Key
                </button>
                <button
                  type="button"
                  onClick={() => setShowKeyForm(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ANALYZING OVERLAY (Full-Screen Glow) */}
      {analyzingPhoto && (
        <div className="absolute inset-0 z-35 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-red-600 to-amber-500 flex items-center justify-center shadow-[0_0_50px_rgba(239,68,68,0.6)] animate-pulse mb-4">
            <Sparkles className="w-10 h-10 text-white animate-spin" />
          </div>
          <h3 className="text-lg font-extrabold text-white tracking-tight">
            Analyzing Product with Gemini AI...
          </h3>
          <p className="text-xs text-slate-300 mt-1.5 max-w-xs font-medium animate-pulse">
            {analysisStep || 'Inspecting brand, product name, and packaging...'}
          </p>
        </div>
      )}

      {/* ERROR MESSAGE TOAST */}
      {visionError && !analyzingPhoto && (
        <div className="absolute top-20 inset-x-4 max-w-md mx-auto z-30 p-3.5 bg-red-950/90 border border-red-500/50 text-white rounded-2xl text-xs flex items-center gap-2 backdrop-blur-md shadow-xl text-left">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="flex-1">{visionError}</span>
          <button
            type="button"
            onClick={() => setVisionError(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* BOTTOM CONTROLS BAR (Full-Screen Camera Shutter) */}
      {!scanResult && (
        <div className="absolute bottom-0 inset-x-0 z-30 pb-safe px-6 py-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center justify-around pointer-events-auto">
          {/* Gallery Upload Button */}
          <div className="flex flex-col items-center">
            <input
              type="file"
              id="fullscreen-gallery-upload"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleVisionImageFile(file);
                e.target.value = '';
              }}
            />
            <label
              htmlFor="fullscreen-gallery-upload"
              onClick={() => stopCamera()}
              className="w-13 h-13 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 backdrop-blur-md flex items-center justify-center cursor-pointer transition-all active:scale-90 shadow-lg text-white"
              title="Upload photo from device gallery"
            >
              <Upload className="w-5 h-5" />
            </label>
            <span className="text-[10px] font-semibold text-white/90 mt-1">Gallery</span>
          </div>

          {/* PRIMARY CAMERA SHUTTER BUTTON (Large Circular Shutter) */}
          <div className="flex flex-col items-center">
            {cameraActive ? (
              <button
                type="button"
                onClick={handleSnapLivePhoto}
                disabled={analyzingPhoto}
                className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center p-1 shadow-[0_0_30px_rgba(255,255,255,0.4)] active:scale-90 transition-transform disabled:opacity-50"
                title="Take Photo and Check Recalls"
              >
                <div className="w-full h-full rounded-full bg-white hover:bg-red-500 transition-colors shadow-inner" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startCamera(undefined, facingMode)}
                className="w-18 h-18 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-xl active:scale-95 transition-all"
                title="Resume Camera"
              >
                <Camera className="w-8 h-8" />
              </button>
            )}
            <span className="text-[11px] font-extrabold text-white mt-1.5 tracking-wide drop-shadow-md">
              {cameraActive ? 'Take Photo' : 'Resume Camera'}
            </span>
          </div>

          {/* Device Camera Intent Button */}
          <div className="flex flex-col items-center">
            <input
              type="file"
              id="fullscreen-native-camera"
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
              htmlFor="fullscreen-native-camera"
              onClick={() => stopCamera()}
              className="w-13 h-13 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 backdrop-blur-md flex items-center justify-center cursor-pointer transition-all active:scale-90 shadow-lg text-white"
              title="Take photo with native camera app"
            >
              <Camera className="w-5 h-5" />
            </label>
            <span className="text-[10px] font-semibold text-white/90 mt-1">App Camera</span>
          </div>
        </div>
      )}

      {/* VERDICT BOTTOM SHEET (Slides up when scan is completed) */}
      {scanResult && (
        <div className="absolute inset-x-0 bottom-0 max-h-[85vh] z-40 bg-white rounded-t-3xl shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-bottom duration-300">
          {/* Sheet Handle */}
          <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto my-3 shrink-0" />

          {/* Sheet Scrollable Content */}
          <div className="px-5 pb-6 overflow-y-auto space-y-4 text-left flex-1">
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
                <div className="mt-4 pt-3.5 border-t border-slate-200/60 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {scanResult.extractedInfo.brand && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">Brand</span>
                      <span className="font-bold text-slate-800">{scanResult.extractedInfo.brand}</span>
                    </div>
                  )}
                  {scanResult.extractedInfo.productName && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">Product Line</span>
                      <span className="font-bold text-slate-800">{scanResult.extractedInfo.productName}</span>
                    </div>
                  )}
                  {scanResult.extractedInfo.flavorOrVariant && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">Flavor / Variant</span>
                      <span className="font-bold text-slate-800">{scanResult.extractedInfo.flavorOrVariant}</span>
                    </div>
                  )}
                  {scanResult.extractedInfo.packageSize && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">Size / Format</span>
                      <span className="font-bold text-slate-800">{scanResult.extractedInfo.packageSize}</span>
                    </div>
                  )}
                  {(scanResult.extractedInfo.modelOrLot || scanResult.extractedInfo.modelOrBatchNumber) && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">Batch / Lot / Code</span>
                      <span className="font-mono font-bold text-slate-800">
                        {scanResult.extractedInfo.modelOrLot || scanResult.extractedInfo.modelOrBatchNumber}
                      </span>
                    </div>
                  )}
                  {scanResult.extractedInfo.upcOrCode && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">UPC / Barcode</span>
                      <span className="font-mono font-bold text-slate-800">{scanResult.extractedInfo.upcOrCode}</span>
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

            {/* Matched Recalls with ALL DETAILS */}
            {scanResult.matchedRecalls.length > 0 && (
              <div className="space-y-3.5 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-red-600 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Official Safety Notice Details ({scanResult.matchedRecalls.length})</span>
                  </span>
                  <span className="text-[11px] text-slate-500 font-semibold">
                    Complete government notices
                  </span>
                </div>

                <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                  {scanResult.matchedRecalls.map((recall, index) => {
                    const recallClass = (recall['Recall class'] || '').trim();
                    const isClass1 = recallClass.toLowerCase().includes('class 1') || recallClass.toLowerCase().includes('type i');
                    const isClass2 = recallClass.toLowerCase().includes('class 2') || recallClass.toLowerCase().includes('type ii');

                    return (
                      <div
                        key={recall.NID || index}
                        className="p-4 sm:p-5 bg-slate-50 border-2 border-red-200 hover:border-red-400 rounded-2xl shadow-sm text-left space-y-3.5 transition-all"
                      >
                        {/* Top Badges */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {recallClass && (
                            <span
                              className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase tracking-wider ${
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
                            <span className="bg-white text-slate-700 border border-slate-200 text-[10px] font-bold px-2 py-0.5 rounded">
                              {recall.Organization}
                            </span>
                          )}
                          {recall.Category && (
                            <span className="bg-white text-slate-600 border border-slate-200 text-[10px] font-medium px-2 py-0.5 rounded">
                              {recall.Category}
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

                        {/* Full Official Title (No truncation) */}
                        <h4 className="font-extrabold text-sm sm:text-base text-slate-900 leading-snug">
                          {recall.Title}
                        </h4>

                        {/* Affected Product & Specific Codes Box */}
                        <div className="p-3 bg-white border border-slate-200/90 rounded-xl space-y-1">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                            <Tag className="w-3 h-3 text-slate-400" />
                            <span>Affected Product Description & Codes</span>
                          </span>
                          <p className="text-xs sm:text-sm font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                            {recall.Product || recall.Title}
                          </p>
                        </div>

                        {/* Safety Hazard / Defect Box */}
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

                        {/* What You Should Do Box */}
                        {recall['What you should do'] && (
                          <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-1">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-emerald-600" />
                              <span>What You Should Do (Official Consumer Action)</span>
                            </span>
                            <p className="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                              {recall['What you should do']}
                            </p>
                          </div>
                        )}

                        {/* Actions Row */}
                        <div className="pt-1 flex flex-wrap items-center gap-2">
                          {recall.URL && (
                            <a
                              href={recall.URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 active:scale-95"
                            >
                              <span>Canada.ca Official Notice</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              onSelectRecall(recall);
                              onClose();
                            }}
                            className="py-2 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center justify-center gap-1.5 active:scale-95"
                          >
                            <FileText className="w-3.5 h-3.5 text-slate-500" />
                            <span>Full Details & Share</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Safety guidance when no recall */}
            {scanResult.verdict === 'NO_RECALL_FOUND' && (
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-left text-xs text-slate-600 space-y-1.5">
                <p className="font-semibold text-slate-800">Safety & Verification Tips:</p>
                <p>• Verify the exact batch code or expiry date printed on your product packaging.</p>
                <p>• Canadian recall notices are updated daily from CFIA, Health Canada, and Transport Canada.</p>
                <p>• If you suspect a product hazard or illness, report it directly to Health Canada.</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 pt-2">
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
                  className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-md active:scale-98"
                >
                  <Search className="w-4 h-4" />
                  <span>View in Full Canadian Recall Database</span>
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={resetScan}
                  className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors border border-slate-200 active:scale-95"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Take Another Photo</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors active:scale-95"
                >
                  <X className="w-4 h-4" />
                  <span>Close</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
