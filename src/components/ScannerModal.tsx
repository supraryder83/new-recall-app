import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Camera,
  Sparkles,
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
  FileText,
  Barcode,
  Keyboard
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import confetti from 'canvas-confetti';
import type { RecallItem, ScanMatchResult } from '../types/recall';
import {
  hasGeminiApiKey,
  analyzeProductImageWithGemini,
  setGeminiApiKey
} from '../services/gemini';
import { checkBarcodeRecalls } from '../services/barcodeRecall';
import { optimizeImage } from '../utils/imageOptimizer';
import { addScanToHistory } from '../services/scanHistory';
import { recordNotifiedRecall } from '../services/historyMonitor';

export type ScannerMode = 'barcode' | 'vision';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  recallsDataset: RecallItem[];
  onSelectRecall: (recall: RecallItem) => void;
  onApplySearchQuery?: (query: string) => void;
  initialMode?: ScannerMode;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  recallsDataset,
  onSelectRecall,
  onApplySearchQuery,
  initialMode = 'barcode'
}) => {
  // Current scanner mode: 'barcode' (Default, optical, 0% AI) or 'vision' (Gemini AI Vision for SN / model # / unboxed)
  const [scannerMode, setScannerMode] = useState<ScannerMode>(initialMode);

  // Barcode scanner reference & state
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const [barcodeScanningActive, setBarcodeScanningActive] = useState(false);
  const [barcodeProcessing, setBarcodeProcessing] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  // Manual barcode entry form state
  const [showManualCodeInput, setShowManualCodeInput] = useState(false);
  const [manualCode, setManualCode] = useState('');

  // AI Vision camera & stream state
  const visionVideoRef = useRef<HTMLVideoElement | null>(null);
  const visionStreamRef = useRef<MediaStream | null>(null);
  const [visionCameraActive, setVisionCameraActive] = useState(false);
  const [visionCameraError, setVisionCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // AI Vision photo analysis state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [visionError, setVisionError] = useState<string | null>(null);

  // Scan Verdict State
  const [scanResult, setScanResult] = useState<ScanMatchResult | null>(null);

  // Gemini API key state for Vision mode
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

  // Helper functions to identify camera facing
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

  // --------------------------------------------------------------------------
  // BARCODE SCANNER LOGIC (OPTICAL • ZERO AI)
  // --------------------------------------------------------------------------

  // Cleanly stops the optical barcode scanner
  const stopBarcodeScanner = useCallback(async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch (err) {
        console.warn('Barcode scanner stop error:', err);
      }
      html5QrCodeRef.current = null;
    }
    setBarcodeScanningActive(false);
  }, []);

  // Process a scanned or entered barcode without AI
  const handleProcessBarcode = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed || barcodeProcessing) return;

      // Haptic feedback if supported
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate(80);
        }
      } catch {}

      // Stop camera feed while showing result
      await stopBarcodeScanner();
      setBarcodeProcessing(true);
      setBarcodeError(null);
      setScanResult(null);

      try {
        const result = await checkBarcodeRecalls(trimmed, recallsDataset);
        setScanResult(result);

        // Save scan to persistent history log
        const savedItem = addScanToHistory({
          imagePreview: undefined,
          identifiedTitle: result.identifiedTitle || `Barcode: ${trimmed}`,
          verdict: result.verdict,
          matchReason: result.matchReason,
          matchedRecallsCount: result.matchedRecalls.length,
          extractedInfo: result.extractedInfo,
          matchedRecalls: result.matchedRecalls,
          similarProductRecalls: result.similarProductRecalls,
          relatedBrandRecalls: result.relatedBrandRecalls,
          searchKeywords: result.searchKeywords
        });

        // Record for 6-hour monitor
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

        if (result.verdict === 'NO_RECALL_FOUND') {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.65 }
          });
        }
      } catch (err: any) {
        console.error('Barcode recall check failed:', err);
        setBarcodeError('Failed to verify barcode against safety recalls. Please try again.');
      } finally {
        setBarcodeProcessing(false);
      }
    },
    [barcodeProcessing, recallsDataset, stopBarcodeScanner]
  );

  // Starts the optical barcode scanner
  const startBarcodeScanner = useCallback(async () => {
    await stopBarcodeScanner();
    setBarcodeError(null);

    // Wait a brief tick for the container DOM node to be rendered
    await new Promise((r) => setTimeout(r, 60));

    const viewport = document.getElementById('barcode-scanner-viewport');
    if (!viewport) return;

    try {
      const qrCode = new Html5Qrcode('barcode-scanner-viewport', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.CODABAR,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.DATA_MATRIX
        ],
        verbose: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      });

      html5QrCodeRef.current = qrCode;

      await qrCode.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: (viewfinderWidth: number, _viewfinderHeight: number) => {
            // Horizontal rectangular viewfinder tailored for standard product barcodes
            const boxWidth = Math.min(Math.round(viewfinderWidth * 0.85), 340);
            const boxHeight = Math.min(Math.round(boxWidth * 0.55), 200);
            return { width: boxWidth, height: boxHeight };
          }
        },
        (decodedText) => {
          handleProcessBarcode(decodedText);
        },
        () => {
          // Frame seek - normal behavior
        }
      );

      setBarcodeScanningActive(true);

      // Check torch capability
      try {
        const capabilities: any = qrCode.getRunningTrackCameraCapabilities();
        if (capabilities && capabilities.torchFeature && capabilities.torchFeature()) {
          setSupportsTorch(capabilities.torchFeature().isSupported());
        }
      } catch {}
    } catch (err: any) {
      console.warn('Barcode camera start error:', err);
      setBarcodeScanningActive(false);
      setBarcodeError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access, upload a photo, or enter the code manually.'
          : 'Unable to start optical barcode scanner. Try entering the code manually or switch to AI Vision.'
      );
    }
  }, [handleProcessBarcode, stopBarcodeScanner]);

  // Upload an image to scan for optical barcode
  const handleUploadBarcodeImage = async (file: File) => {
    if (!file) return;
    setBarcodeProcessing(true);
    setBarcodeError(null);

    try {
      if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode('barcode-scanner-viewport', false);
      }
      const decodedText = await html5QrCodeRef.current.scanFile(file, false);
      handleProcessBarcode(decodedText);
    } catch (err: any) {
      console.warn('Barcode not found in image, offering AI vision:', err);
      setBarcodeProcessing(false);
      setBarcodeError(
        'No optical barcode detected in this image. Try photographing the serial number or model number with AI Vision.'
      );
    }
  };

  // --------------------------------------------------------------------------
  // AI VISION RECOGNITION LOGIC (GEMINI AI • SN / MODEL # / UNBOXED ITEMS)
  // --------------------------------------------------------------------------

  // Cleanly stops the vision camera feed
  const stopVisionCamera = useCallback(() => {
    if (visionStreamRef.current) {
      visionStreamRef.current.getTracks().forEach((track) => track.stop());
      visionStreamRef.current = null;
    }
    setVisionCameraActive(false);
    setTorchOn(false);
    setSupportsTorch(false);
  }, []);

  // Starts the high-resolution vision camera feed for photographing items/labels
  const startVisionCamera = useCallback(
    async (targetDeviceId?: string, requestedFacing: 'environment' | 'user' = 'environment') => {
      stopVisionCamera();
      setVisionCameraError(null);

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

        // 2. Query available devices
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

        visionStreamRef.current = stream;
        if (visionVideoRef.current) {
          visionVideoRef.current.srcObject = stream;
          try {
            await visionVideoRef.current.play();
          } catch {}
        }

        setVisionCameraActive(true);
      } catch (err: any) {
        console.warn('Vision camera start error:', err);
        setVisionCameraError(
          err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Please allow camera access in browser settings.'
            : 'Unable to start camera feed. You can upload a photo of the product or serial number.'
        );
        setVisionCameraActive(false);
      }
    },
    [stopVisionCamera]
  );

  // Switch camera facing in vision mode
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

    await startVisionCamera(nextDeviceId, nextFacing);
  };

  // Toggle flashlight in vision mode
  const toggleTorch = async () => {
    if (!visionStreamRef.current) return;
    const track = visionStreamRef.current.getVideoTracks()[0];
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

  // Run Gemini photo analysis on captured image
  const runGeminiPhotoAnalysis = async (base64Image: string, mimeType: string) => {
    setAnalyzingPhoto(true);
    setVisionError(null);
    setScanResult(null);

    try {
      setAnalysisStep('Scanning photo for serial numbers, model code & product details...');
      await new Promise((r) => setTimeout(r, 200));
      setAnalysisStep('Identifying product brand, model & safety markings...');

      const result = await analyzeProductImageWithGemini({
        base64Data: base64Image,
        mimeType: mimeType || 'image/jpeg',
        recallsDataset
      });

      setAnalysisStep('Cross-referencing Canadian open safety registry...');
      await new Promise((r) => setTimeout(r, 200));

      setScanResult(result);

      // Save scan to persistent history log
      const savedItem = addScanToHistory({
        imagePreview: base64Image,
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

      // Record for 6-hour monitor
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

      if (result.verdict === 'NO_RECALL_FOUND') {
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.65 }
        });
      }
    } catch (err: any) {
      console.error('Vision analysis failed:', err);
      setVisionError(
        err?.message ||
          'Failed to analyze photo. Please try again with a clear photo of the model number, serial number, or item.'
      );
    } finally {
      setAnalyzingPhoto(false);
      setAnalysisStep('');
    }
  };

  // Capture snapshot from live in-app vision camera
  const handleSnapVisionPhoto = async () => {
    if (!visionVideoRef.current || !visionStreamRef.current) {
      setVisionError('Camera feed is not active. Please retry camera or choose a photo from gallery.');
      return;
    }
    try {
      const video = visionVideoRef.current;
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
      if (!ctx) throw new Error('Canvas context unavailable');

      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

      canvas.width = 0;
      canvas.height = 0;

      setImagePreview(dataUrl);
      stopVisionCamera();

      runGeminiPhotoAnalysis(dataUrl, 'image/jpeg');
    } catch (err: any) {
      console.error('Vision snapshot failed:', err);
      setVisionError('Failed to capture photo from live camera.');
    }
  };

  // Vision photo upload handler
  const handleVisionImageFile = async (file: File) => {
    if (!file) return;
    stopVisionCamera();
    setAnalyzingPhoto(true);
    setAnalysisStep('Optimizing photo for AI recognition...');
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

  // --------------------------------------------------------------------------
  // MODE SWITCHING & MODAL LIFECYCLE
  // --------------------------------------------------------------------------

  // Switch between Barcode mode and Vision mode
  const handleSwitchMode = async (targetMode: ScannerMode) => {
    setScannerMode(targetMode);
    setScanResult(null);
    setImagePreview(null);
    setBarcodeError(null);
    setVisionError(null);
    setShowManualCodeInput(false);

    if (targetMode === 'barcode') {
      stopVisionCamera();
      await startBarcodeScanner();
    } else {
      await stopBarcodeScanner();
      setHasKey(hasGeminiApiKey());
      await startVisionCamera(undefined, 'environment');
    }
  };

  // Reset scan to start scanning again in current mode
  const resetScan = async () => {
    setScanResult(null);
    setImagePreview(null);
    setBarcodeError(null);
    setVisionError(null);
    setShowManualCodeInput(false);

    if (scannerMode === 'barcode') {
      await startBarcodeScanner();
    } else {
      await startVisionCamera(undefined, 'environment');
    }
  };

  // Manage modal open/close lifecycle
  useEffect(() => {
    if (!isOpen) {
      stopBarcodeScanner();
      stopVisionCamera();
      setScanResult(null);
      setImagePreview(null);
      setBarcodeError(null);
      setVisionError(null);
      setShowManualCodeInput(false);
      setScannerMode(initialMode);
    } else {
      setScannerMode(initialMode);
      setScanResult(null);
      setImagePreview(null);
      if (initialMode === 'barcode') {
        startBarcodeScanner();
      } else {
        setHasKey(hasGeminiApiKey());
        startVisionCamera(undefined, 'environment');
      }
    }
    return () => {
      stopBarcodeScanner();
      stopVisionCamera();
    };
  }, [isOpen, initialMode, startBarcodeScanner, startVisionCamera, stopBarcodeScanner, stopVisionCamera]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 w-full h-full bg-black overflow-hidden flex flex-col animate-in fade-in duration-200">
      {/* =========================================================================
          CAMERA VIEWPORTS (Barcode HTML5Qrcode vs Vision Native Video)
         ========================================================================= */}
      <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden">
        {/* BARCODE SCANNER CONTAINER (Optical scanning • Zero AI) */}
        <div
          id="barcode-scanner-viewport"
          className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${
            scannerMode === 'barcode' && !scanResult && !imagePreview ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none -z-10'
          }`}
        />

        {/* AI VISION NATIVE CAMERA FEED */}
        <video
          ref={visionVideoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            scannerMode === 'vision' && visionCameraActive && !scanResult && !imagePreview
              ? 'opacity-100 z-10'
              : 'opacity-0 pointer-events-none -z-10'
          }`}
        />

        {/* CAPTURED / UPLOADED PHOTO PREVIEW */}
        {imagePreview && !scanResult && (
          <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center z-15">
            <img src={imagePreview} alt="Captured product" className="w-full h-full object-cover" />
          </div>
        )}

        {/* VISION CAMERA PAUSED FALLBACK */}
        {scannerMode === 'vision' && !visionCameraActive && !imagePreview && !visionCameraError && !scanResult && (
          <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-white bg-slate-950 z-20">
            <div className="p-4 bg-slate-900 rounded-3xl mb-3 text-slate-300 border border-slate-800 shadow-xl">
              <Camera className="w-8 h-8 text-red-500" />
            </div>
            <h4 className="text-base font-bold text-white">Live Camera Paused</h4>
            <p className="text-xs text-slate-400 max-w-xs mt-1 leading-relaxed">
              Take a photo of the product, serial number (SN), or model code to check recalls with AI Vision.
            </p>
            <button
              type="button"
              onClick={() => startVisionCamera(undefined, facingMode)}
              className="mt-4 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-lg active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Resume Camera</span>
            </button>
          </div>
        )}

        {/* CAMERA PERMISSION ERROR BANNER */}
        {(barcodeError || visionCameraError) && !scanResult && !analyzingPhoto && !barcodeProcessing && (
          <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-white bg-slate-950/95 z-30">
            <div className="p-4 bg-amber-500/10 rounded-3xl mb-3 border border-amber-500/30">
              <AlertTriangle className="w-10 h-10 text-amber-400" />
            </div>
            <h4 className="text-base font-bold text-white">Camera Access Notice</h4>
            <p className="text-xs text-slate-300 max-w-sm mt-1 leading-relaxed">
              {barcodeError || visionCameraError}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5 justify-center">
              {scannerMode === 'barcode' ? (
                <>
                  <button
                    type="button"
                    onClick={() => startBarcodeScanner()}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 shadow-md"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Scanner</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualCodeInput(true)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Keyboard className="w-3.5 h-3.5 text-amber-400" />
                    <span>Type Barcode</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('vision')}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-bold flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Switch to AI Vision</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => startVisionCamera(undefined, 'environment')}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-lg active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Camera</span>
                </button>
              )}
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

      {/* =========================================================================
          TOP FLOATING BAR (Mode Switcher Tabs, Flashlight, Switch Camera, Close)
         ========================================================================= */}
      <div className="absolute top-0 inset-x-0 z-30 pt-safe px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/85 via-black/45 to-transparent pointer-events-auto">
        {/* Left: Mode Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md p-1 rounded-full border border-white/20 shadow-lg">
          <button
            type="button"
            onClick={() => handleSwitchMode('barcode')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold transition-all ${
              scannerMode === 'barcode'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Barcode className="w-3.5 h-3.5" />
            <span>Scan Barcode</span>
            <span className="text-[9px] bg-white/20 text-white px-1 py-0.2 rounded font-mono font-normal">
              No AI
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSwitchMode('vision')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold transition-all ${
              scannerMode === 'vision'
                ? 'bg-gradient-to-r from-amber-500 to-rose-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>AI Vision</span>
          </button>
        </div>

        {/* Right Controls: Torch, Switch Camera, Close */}
        <div className="flex items-center gap-2">
          {supportsTorch && (
            <button
              type="button"
              onClick={toggleTorch}
              title={torchOn ? 'Turn off flash' : 'Turn on flash'}
              className={`p-2.5 rounded-full backdrop-blur-md transition-all border active:scale-90 shadow-lg flex items-center justify-center ${
                torchOn
                  ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-amber-400/40'
                  : 'bg-black/50 hover:bg-black/70 text-white border-white/20'
              }`}
            >
              <Flashlight className="w-4 h-4" />
            </button>
          )}

          {scannerMode === 'vision' && visionCameraActive && (
            <button
              type="button"
              onClick={toggleCameraFacing}
              title={`Switch to ${facingMode === 'environment' ? 'front' : 'rear'} camera`}
              className="p-2.5 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-all border border-white/20 active:scale-90 shadow-lg flex items-center justify-center group"
            >
              <SwitchCamera className="w-4 h-4 group-hover:rotate-180 transition-transform duration-300" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-2.5 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-all border border-white/20 active:scale-90 shadow-lg"
            title="Exit camera"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* =========================================================================
          VIEWFINDER OVERLAYS FOR ACTIVE SCANNING
         ========================================================================= */}
      {!scanResult && !imagePreview && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-25 p-4">
          {scannerMode === 'barcode' ? (
            /* BARCODE SCANNER RETICLE (Horizontal Box with Laser) */
            <div className="w-[85vw] max-w-[340px] h-[190px] relative rounded-3xl border-2 border-red-500/80 shadow-[0_0_40px_rgba(239,68,68,0.35)] flex flex-col items-center justify-between p-3 overflow-hidden">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-red-500 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-red-500 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-red-500 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-red-500 rounded-br-xl" />

              {/* Animated Red Laser Scan Line */}
              <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_#ef4444] animate-scan pointer-events-none" />

              {/* Top viewfinder tag */}
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-white bg-black/75 px-2.5 py-0.5 rounded-full backdrop-blur-md border border-red-500/40">
                Align Barcode Here
              </span>

              {/* Bottom viewfinder tag */}
              <span className="text-[10px] font-medium text-white/90 bg-black/60 px-2 py-0.5 rounded-full backdrop-blur-md">
                {barcodeScanningActive ? 'Optical Scanner Ready • 0% AI' : 'Instant • No AI Used'}
              </span>
            </div>
          ) : (
            /* AI VISION RETICLE (Square Box for Item / Serial Number / Model Plate) */
            <div className="w-[85vw] max-w-[320px] h-[320px] relative rounded-3xl border-2 border-amber-400/70 shadow-[0_0_40px_rgba(251,191,36,0.25)] flex flex-col items-center justify-between p-3.5">
              <div className="absolute top-0 left-0 w-7 h-7 border-t-4 border-l-4 border-amber-400 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-7 h-7 border-t-4 border-r-4 border-amber-400 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-7 h-7 border-b-4 border-l-4 border-amber-400 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-7 h-7 border-b-4 border-r-4 border-amber-400 rounded-br-xl" />

              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300 bg-black/75 px-3 py-1 rounded-full backdrop-blur-md border border-amber-400/40 flex items-center gap-1.5">
                <Sparkles className="w-3 royal-amber text-amber-400" />
                <span>Align Serial #, Model Code, or Item</span>
              </span>

              <span className="text-[10px] text-white/90 bg-black/60 px-3 py-1 rounded-full backdrop-blur-md text-center max-w-[260px] leading-tight">
                For unboxed products or items without barcodes
              </span>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          ANALYZING / PROCESSING OVERLAY
         ========================================================================= */}
      {(barcodeProcessing || analyzingPhoto) && (
        <div className="absolute inset-0 z-35 bg-black/75 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-red-600 to-amber-500 flex items-center justify-center shadow-[0_0_50px_rgba(239,68,68,0.6)] animate-pulse mb-4">
            {scannerMode === 'barcode' ? (
              <Barcode className="w-10 h-10 text-white animate-pulse" />
            ) : (
              <Sparkles className="w-10 h-10 text-white animate-spin" />
            )}
          </div>
          <h3 className="text-lg font-extrabold text-white tracking-tight">
            {scannerMode === 'barcode'
              ? 'Checking Barcode Against Recalls...'
              : 'Analyzing Product with AI Vision...'}
          </h3>
          <p className="text-xs text-slate-300 mt-1.5 max-w-xs font-medium animate-pulse">
            {scannerMode === 'barcode'
              ? 'Checking official Canadian safety registry (No AI used)...'
              : analysisStep || 'Inspecting brand, serial number, model plate, and hazards...'}
          </p>
        </div>
      )}

      {/* =========================================================================
          API KEY MISSING BANNER (Only shown in Vision mode if key is missing)
         ========================================================================= */}
      {scannerMode === 'vision' && !hasKey && !scanResult && (
        <div className="absolute top-20 inset-x-4 max-w-md mx-auto z-30 p-4 bg-slate-900/90 border border-amber-400/40 rounded-2xl text-left backdrop-blur-md shadow-2xl text-white space-y-2">
          <div className="flex items-start gap-2.5">
            <Key className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <h5 className="font-bold text-xs text-white">Gemini 3.5 Flash Lite Key Needed</h5>
              <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                To identify unboxed items by photo without a barcode, enter your Gemini API key:
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
                placeholder="Paste API key..."
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

      {/* =========================================================================
          ERROR MESSAGE TOAST
         ========================================================================= */}
      {visionError && !analyzingPhoto && (
        <div className="absolute top-20 inset-x-4 max-w-md mx-auto z-30 p-3.5 bg-red-950/90 border border-red-500/50 text-white rounded-2xl text-xs flex items-center gap-2 backdrop-blur-md shadow-xl text-left">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="flex-1">{visionError}</span>
          <button type="button" onClick={() => setVisionError(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* =========================================================================
          MANUAL BARCODE ENTRY MODAL (POPOVER)
         ========================================================================= */}
      {showManualCodeInput && (
        <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-5 text-white shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Barcode className="w-5 h-5 text-red-500" />
                <h4 className="font-extrabold text-sm text-white">Enter Barcode Manually</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowManualCodeInput(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Type the 8, 12, or 13 digit number printed underneath the barcode lines on the packaging (e.g. UPC or EAN).
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!manualCode.trim()) return;
                setShowManualCodeInput(false);
                handleProcessBarcode(manualCode.trim());
              }}
              className="space-y-3"
            >
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="e.g. 068274000216..."
                className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-base font-mono tracking-widest text-center text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!manualCode.trim()}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95"
                >
                  Check Recalls (No AI)
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualCodeInput(false)}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          BOTTOM CONTROLS BAR (Primary actions for Barcode vs Vision modes)
         ========================================================================= */}
      {!scanResult && (
        <div className="absolute bottom-0 inset-x-0 z-30 pb-safe px-5 pt-3 pb-6 bg-gradient-to-t from-black/95 via-black/80 to-transparent flex flex-col items-center gap-3.5 pointer-events-auto">
          {scannerMode === 'barcode' ? (
            /* BARCODE MODE CONTROLS:
               1. THE PROMINENT "IDENTIFY BY AI VISION" BUTTON (Requested by user)
               2. Manual code entry & Gallery image upload */
            <div className="w-full max-w-md flex flex-col items-center gap-3">
              {/* PRIMARY REQUESTED FEATURE: "Identify by AI Vision" button for items without a barcode */}
              <button
                type="button"
                onClick={() => handleSwitchMode('vision')}
                className="w-full p-3.5 bg-gradient-to-r from-amber-500 via-rose-600 to-red-600 hover:from-amber-600 hover:to-red-700 text-white rounded-2xl font-extrabold text-sm shadow-xl shadow-red-600/30 active:scale-98 transition-all flex items-center justify-between border border-white/20 group cursor-pointer"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Sparkles className="w-5 h-5 text-amber-200 animate-pulse" />
                  </div>
                  <div>
                    <span className="block font-black text-sm text-white">
                      No Barcode? Identify by AI Vision
                    </span>
                    <span className="block text-[11px] font-medium text-amber-100 leading-tight">
                      Photograph serial number (SN), model code, or unboxed item
                    </span>
                  </div>
                </div>
                <div className="px-2.5 py-1 bg-white/20 rounded-lg text-[10px] font-bold uppercase tracking-wider shrink-0">
                  AI Vision
                </div>
              </button>

              {/* Auxiliary Barcode options: Type Code & Upload Barcode photo */}
              <div className="w-full flex items-center justify-between gap-2.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => setShowManualCodeInput(true)}
                  className="flex-1 py-2.5 px-3 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/15 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <Keyboard className="w-4 h-4 text-amber-400" />
                  <span>Type Barcode</span>
                </button>

                <div className="flex-1">
                  <input
                    type="file"
                    id="barcode-image-upload"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadBarcodeImage(file);
                      e.target.value = '';
                    }}
                  />
                  <label
                    htmlFor="barcode-image-upload"
                    className="w-full py-2.5 px-3 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/15 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all text-center"
                  >
                    <Upload className="w-4 h-4 text-slate-300" />
                    <span>Upload Barcode</span>
                  </label>
                </div>
              </div>
            </div>
          ) : (
            /* AI VISION MODE CONTROLS:
               1. Shutter button for photographing item / SN / model #
               2. Gallery upload & Native camera */
            <div className="w-full max-w-md flex flex-col items-center gap-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300 bg-black/60 px-3 py-1 rounded-full backdrop-blur-md border border-amber-400/30">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Photograph serial number, model #, or unpackaged item</span>
              </div>

              <div className="w-full flex items-center justify-around pt-1">
                {/* Gallery Upload */}
                <div className="flex flex-col items-center">
                  <input
                    type="file"
                    id="vision-gallery-upload"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleVisionImageFile(file);
                      e.target.value = '';
                    }}
                  />
                  <label
                    htmlFor="vision-gallery-upload"
                    onClick={() => stopVisionCamera()}
                    className="w-13 h-13 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 backdrop-blur-md flex items-center justify-center cursor-pointer transition-all active:scale-90 shadow-lg text-white"
                    title="Upload photo of SN, model #, or product"
                  >
                    <Upload className="w-5 h-5" />
                  </label>
                  <span className="text-[10px] font-semibold text-white/90 mt-1">Gallery</span>
                </div>

                {/* Primary Shutter Button */}
                <div className="flex flex-col items-center">
                  {visionCameraActive ? (
                    <button
                      type="button"
                      onClick={handleSnapVisionPhoto}
                      disabled={analyzingPhoto}
                      className="w-20 h-20 rounded-full border-4 border-amber-400 flex items-center justify-center p-1 shadow-[0_0_30px_rgba(251,191,36,0.4)] active:scale-90 transition-transform disabled:opacity-50"
                      title="Take photo of serial # or item"
                    >
                      <div className="w-full h-full rounded-full bg-white hover:bg-amber-400 transition-colors shadow-inner" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startVisionCamera(undefined, facingMode)}
                      className="w-18 h-18 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-xl active:scale-95 transition-all"
                      title="Resume Camera"
                    >
                      <Camera className="w-8 h-8" />
                    </button>
                  )}
                  <span className="text-[11px] font-extrabold text-white mt-1.5 tracking-wide drop-shadow-md">
                    {visionCameraActive ? 'Snap Photo' : 'Resume'}
                  </span>
                </div>

                {/* Switch Back to Optical Barcode Scanner Button */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('barcode')}
                    className="w-13 h-13 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 backdrop-blur-md flex items-center justify-center transition-all active:scale-90 shadow-lg text-white"
                    title="Switch back to Barcode Scanner"
                  >
                    <Barcode className="w-5 h-5 text-red-400" />
                  </button>
                  <span className="text-[10px] font-semibold text-white/90 mt-1">Barcode</span>
                </div>
              </div>
            </div>
          )}

          {/* Non-Endorsement Disclaimer */}
          <p className="text-[9px] text-white/60 text-center max-w-sm mx-auto leading-tight pt-1">
            Disclaimer: Independent recall tool. Not endorsed by, affiliated with, or sponsored by Health Canada, CFIA, Transport Canada, or the Government of Canada.
          </p>
        </div>
      )}

      {/* =========================================================================
          VERDICT BOTTOM SHEET (Presented when a Barcode or AI Vision scan completes)
         ========================================================================= */}
      {scanResult && (
        <div className="absolute inset-x-0 bottom-0 max-h-[85vh] z-40 bg-white rounded-t-3xl shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-bottom duration-300">
          {/* Sheet Handle */}
          <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto my-3 shrink-0" />

          {/* Sheet Content */}
          <div className="px-5 pb-6 overflow-y-auto space-y-4 text-left flex-1">
            {/* Identified Product Spotlight Banner */}
            <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-md flex items-center justify-between gap-3 text-left">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">
                  <Tag className="w-3 h-3" />
                  <span>
                    {scanResult.searchType === 'barcode'
                      ? 'Scanned Barcode (No AI Used)'
                      : 'AI Vision Recognition'}
                  </span>
                </div>
                <h4 className="font-extrabold text-sm sm:text-base text-white truncate">
                  {scanResult.identifiedTitle || `Code: ${scanResult.query}`}
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

            {/* Verdict Banner */}
            <div
              className={`p-5 rounded-2xl border text-left shadow-sm ${
                scanResult.verdict === 'MATCH_FOUND'
                  ? 'bg-red-50 border-red-200 text-red-950'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-950'
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div
                  className={`p-3 rounded-2xl shrink-0 ${
                    scanResult.verdict === 'MATCH_FOUND'
                      ? 'bg-red-600 text-white shadow-lg shadow-red-500/30'
                      : 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30'
                  }`}
                >
                  {scanResult.verdict === 'MATCH_FOUND' ? (
                    <ShieldAlert className="w-6 h-6 animate-pulse" />
                  ) : (
                    <ShieldCheck className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <h4 className="font-extrabold text-base sm:text-lg">
                    {scanResult.verdict === 'MATCH_FOUND'
                      ? 'Exact Product Safety Recall Confirmed!'
                      : 'No Active Recall For This Product'}
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
                  {scanResult.extractedInfo.upcOrCode && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">Barcode / UPC</span>
                      <span className="font-mono font-bold text-slate-800">{scanResult.extractedInfo.upcOrCode}</span>
                    </div>
                  )}
                  {(scanResult.extractedInfo.modelOrLot || scanResult.extractedInfo.modelOrBatchNumber) && (
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-100">
                      <span className="text-slate-500 block text-[10px] font-semibold uppercase">Model / Serial #</span>
                      <span className="font-mono font-bold text-slate-800">
                        {scanResult.extractedInfo.modelOrLot || scanResult.extractedInfo.modelOrBatchNumber}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* If Barcode scan had NO recall, prompt user if they want to check with AI Vision for serial/model numbers */}
            {scanResult.searchType === 'barcode' && scanResult.verdict === 'NO_RECALL_FOUND' && (
              <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl flex items-center justify-between gap-3 text-left">
                <div>
                  <h5 className="font-bold text-xs text-amber-900 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    <span>Unboxed item or missing barcode?</span>
                  </h5>
                  <p className="text-[11px] text-amber-800 mt-0.5 leading-snug">
                    You can photograph the serial number, model code, or product with AI Vision.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('vision')}
                  className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-bold transition-all shrink-0 active:scale-95 shadow-sm"
                >
                  Use AI Vision
                </button>
              </div>
            )}

            {/* Matched Official Canadian Recall Notices */}
            {scanResult.matchedRecalls.length > 0 && (
              <div className="space-y-3.5 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-red-600 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Official Safety Notice Details ({scanResult.matchedRecalls.length})</span>
                  </span>
                  <span className="text-[11px] text-slate-500 font-semibold">Complete notices</span>
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
                            <span>Affected Product Description & Codes</span>
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
                            <p className="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                              {recall['What you should do']}
                            </p>
                          </div>
                        )}

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

            {/* Non-Endorsement Disclaimer */}
            <div className="p-3.5 bg-slate-50 border border-slate-200/90 rounded-2xl text-left space-y-1">
              <div className="flex items-center gap-1.5 text-slate-700 font-bold text-[10px] uppercase tracking-wider">
                <Shield className="w-3.5 h-3.5 text-slate-500" />
                <span>Non-Endorsement Disclaimer</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                This application is an independent safety search tool. It is not endorsed by, sponsored by, or affiliated with Health Canada, the Canadian Food Inspection Agency (CFIA), Transport Canada, or the Government of Canada.
              </p>
            </div>

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
                  <span>
                    {scannerMode === 'barcode' ? 'Scan Another Barcode' : 'Take Another Photo'}
                  </span>
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
