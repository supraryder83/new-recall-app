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
import { Html5Qrcode } from 'html5-qrcode';
import type { RecallItem, ScanMatchResult } from '../types/recall';
import { findRecallsByCodeOrQuery } from '../services/recallData';
import {
  hasGeminiApiKey,
  analyzeProductImageWithGemini,
  resolveBarcodeWithGemini,
  setGeminiApiKey
} from '../services/gemini';
import { optimizeImage } from '../utils/imageOptimizer';

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
  onApplySearchQuery?: (query: string) => void;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  recallsDataset,
  onSelectRecall,
  onApplySearchQuery
}) => {
  const [activeTab, setActiveTab] = useState<'barcode' | 'vision'>('barcode');

  // Camera & stream state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<any>(null);
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

  // Manual code input
  const [manualCode, setManualCode] = useState('');

  // Vision & Barcode Photo Analysis State
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [visionError, setVisionError] = useState<string | null>(null);
  const [barcodeFallbackImage, setBarcodeFallbackImage] = useState<string | null>(null);

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
          : 'Unable to start camera feed. You can upload a photo or enter the barcode manually.'
      );
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
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
      setBarcodeFallbackImage(null);
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

  // Pause or resume barcode scanning loop based on active tab
  // Barcode scanning loop using Native BarcodeDetector on live video frames
  const startBarcodeScanningLoop = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

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

    const scanFrame = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2 || !streamRef.current) {
        return;
      }

      if (barcodeDetector) {
        try {
          const barcodes = await barcodeDetector.detect(videoRef.current);
          if (barcodes && barcodes.length > 0) {
            const detectedValue = barcodes[0].rawValue;
            if (detectedValue) {
              if (scanIntervalRef.current) {
                clearInterval(scanIntervalRef.current);
                scanIntervalRef.current = null;
              }
              handleBarcodeDetected(detectedValue);
              return;
            }
          }
        } catch {
          // ignore detection frame errors
        }
      }
    };

    scanIntervalRef.current = setInterval(scanFrame, 300);
  };

  // Pause or resume barcode scanning loop based on active tab
  useEffect(() => {
    if (isOpen && activeTab === 'barcode' && cameraActive) {
      startBarcodeScanningLoop();
    } else {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    }
  }, [isOpen, activeTab, cameraActive]);

  // Called when barcode is scanned or entered: resolves product name via Gemini & matches recalls
  const handleBarcodeDetected = async (code: string) => {
    try {
      if (navigator.vibrate) navigator.vibrate(100);
    } catch {}

    stopCamera();
    setAnalyzingPhoto(true);
    setAnalysisStep(`Looking up product for barcode ${code}...`);
    setVisionError(null);

    try {
      const result = await resolveBarcodeWithGemini(code, recallsDataset);
      setScanResult(result);
      if (result.verdict === 'NO_RECALL_FOUND') {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.6 }
        });
      }
    } catch (err: any) {
      console.warn('Barcode lookup warning:', err);
      const matches = findRecallsByCodeOrQuery(recallsDataset, code);
      setScanResult({
        verdict: matches.length > 0 ? 'MATCH_FOUND' : 'NO_RECALL_FOUND',
        query: code,
        searchType: 'barcode',
        identifiedTitle: `Barcode #${code}`,
        searchKeywords: code,
        matchedRecalls: matches,
        matchReason: matches.length > 0
          ? `Product barcode ${code} matched ${matches.length} active Canadian safety notice(s).`
          : `Barcode ${code} checked against ${recallsDataset.length.toLocaleString()} Canadian safety recalls.`
      });
    } finally {
      setAnalyzingPhoto(false);
      setAnalysisStep('');
    }
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleBarcodeDetected(manualCode.trim());
  };

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

      if (activeTab === 'barcode') {
        // Convert to blob and process via html5-qrcode
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], 'snapshot.jpg', { type: 'image/jpeg' });
        await handleBarcodeImageFile(file);
      } else {
        runGeminiPhotoAnalysis(dataUrl, 'image/jpeg');
      }
    } catch (err: any) {
      console.error('Live photo snap failed:', err);
      setVisionError('Failed to capture photo from live camera.');
    }
  };

  // Barcode photo upload handler (downsamples first, then scans with html5-qrcode)
  const handleBarcodeImageFile = async (file: File) => {
    if (!file) return;
    stopCamera();
    setAnalyzingPhoto(true);
    setAnalysisStep('Downscaling & scanning image for barcodes...');
    setVisionError(null);
    setBarcodeFallbackImage(null);

    try {
      const optimized = await optimizeImage(file, { maxDimension: 1280, quality: 0.8 });
      setImagePreview(optimized.dataUrl);

      let detectedBarcode: string | null = null;

      // 1. Try scanning barcode with html5-qrcode from optimized File
      try {
        const html5QrCode = new Html5Qrcode('html5-qrcode-hidden-anchor', false);
        const decodedText = await html5QrCode.scanFile(optimized.file, false);
        if (decodedText && decodedText.trim()) {
          detectedBarcode = decodedText.trim();
        }
        try {
          await html5QrCode.clear();
        } catch {}
      } catch {
        console.log('html5-qrcode scanFile did not detect barcode, trying BarcodeDetector fallback...');
      }

      // 2. BarcodeDetector fallback
      if (!detectedBarcode && typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          const detector = new window.BarcodeDetector!({
            formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code']
          });
          const img = new Image();
          img.src = optimized.dataUrl;
          await new Promise((res) => {
            img.onload = res;
            img.onerror = res;
          });
          const barcodes = await detector.detect(img);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            detectedBarcode = barcodes[0].rawValue;
          }
        } catch {}
      }

      if (detectedBarcode) {
        await handleBarcodeDetected(detectedBarcode);
      } else {
        // No barcode detected: offer immediate switch to Gemini Photo AI
        setBarcodeFallbackImage(optimized.dataUrl);
        setVisionError(
          'No barcode detected in this photo. Would you like to identify the product using Gemini Photo AI?'
        );
      }
    } catch (err: any) {
      console.error('Barcode photo processing failed:', err);
      setVisionError(err?.message || 'Failed to scan image for barcode.');
    } finally {
      setAnalyzingPhoto(false);
      setAnalysisStep('');
    }
  };

  // Vision photo upload handler (downsamples with imageOptimizer, then calls Gemini)
  const handleVisionImageFile = async (file: File) => {
    if (!file) return;
    stopCamera();
    setAnalyzingPhoto(true);
    setAnalysisStep('Optimizing image for Gemini AI...');
    setVisionError(null);
    setBarcodeFallbackImage(null);

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
      setAnalysisStep('Sending image to Gemini 2.5 Flash...');
      await new Promise((r) => setTimeout(r, 300));
      setAnalysisStep('Inspecting product labels, logos, and packaging text...');

      const result = await analyzeProductImageWithGemini({
        base64Data: base64Image,
        mimeType: mimeType || 'image/jpeg',
        recallsDataset
      });

      setAnalysisStep('Cross-referencing Canadian open safety registry...');
      await new Promise((r) => setTimeout(r, 300));

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
    let mockKeywords = '';

    if (sampleType === 'food') {
      mockBrand = 'Plantropy';
      mockProduct = "Jack'd Up Bites Crispy Protein Bites";
      mockCategory = 'Food';
      mockModel = 'Jalapeno';
      mockKeywords = 'Plantropy Jack’d Up Bites';
    } else if (sampleType === 'heater') {
      mockBrand = 'JKMAX';
      mockProduct = 'Heated Blanket';
      mockCategory = 'Consumer Products';
      mockModel = 'JKMAX Heated Blankets and Heating Pads';
      mockKeywords = 'JKMAX Heated Blanket';
    } else {
      mockBrand = 'Ford';
      mockProduct = 'F-150 Steering Gear';
      mockCategory = 'Vehicles';
      mockModel = '2024 F-150';
      mockKeywords = 'Ford F-150';
    }

    const simulatedExtracted = {
      brand: mockBrand,
      productName: mockProduct,
      category: mockCategory,
      modelOrLot: mockModel,
      searchKeywords: mockKeywords,
      confidenceNotes: `Demo sample recognition for ${mockBrand} ${mockProduct}`
    };

    const matches = recallsDataset.filter((item) => {
      const text = `${item.Title} ${item.Product}`.toLowerCase();
      return text.includes(mockBrand.toLowerCase()) || text.includes(mockProduct.toLowerCase());
    });

    const isMatch = matches.length > 0;
    const identified = `${mockBrand} ${mockProduct}`;
    setScanResult({
      verdict: isMatch ? 'MATCH_FOUND' : 'NO_RECALL_FOUND',
      query: mockKeywords,
      searchType: 'vision',
      identifiedTitle: identified,
      searchKeywords: mockKeywords,
      extractedInfo: simulatedExtracted,
      matchedRecalls: matches.slice(0, 10),
      matchReason: isMatch
        ? `Identified: ${identified} — matched ${matches.length} active Canadian safety notice(s).`
        : `Identified: ${identified}. No active safety recalls found in the Canadian open data registry.`
    });
  };

  const resetScan = () => {
    setScanResult(null);
    setImagePreview(null);
    setVisionError(null);
    setBarcodeFallbackImage(null);
    setManualCode('');
    setFacingMode('environment');
    setCurrentDeviceId(null);
    startCamera(undefined, 'environment');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200">
      {/* Hidden DOM anchor required for html5-qrcode scanFile */}
      <div id="html5-qrcode-hidden-anchor" className="hidden" aria-hidden="true" />

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
              <p className="text-xs text-slate-400">Barcode detection & Gemini Multimodal AI recognition</p>
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
                setImagePreview(null);
                setVisionError(null);
                setBarcodeFallbackImage(null);
                if (!cameraActive) {
                  startCamera(undefined, 'environment');
                }
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
                setScanResult(null);
                setImagePreview(null);
                setVisionError(null);
                setBarcodeFallbackImage(null);
                if (!cameraActive) {
                  startCamera(undefined, 'environment');
                }
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
                  <p className="font-semibold text-slate-800">Verification Tips:</p>
                  <p>• Verify the exact batch code or expiration date on your packaging.</p>
                  <p>• Canadian recall notices are updated daily from CFIA, Health Canada, and Transport Canada.</p>
                  <p>• If you suspect a product illness or hazard, report it directly to Health Canada.</p>
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
                  <span>Scan Another Product</span>
                </button>
              </div>
            </div>
          ) : (
            /* ACTIVE CAMERA VIEWFINDER & CONTROLS */
            <div className="space-y-4">
              {/* API Key Missing Guidance Banner (shown on vision tab if key missing) */}
              {activeTab === 'vision' && !hasKey && (
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

              {/* Camera Viewfinder */}
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

                {/* If photo captured or selected, display it in the frame */}
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
                          setBarcodeFallbackImage(null);
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

                {/* If camera is inactive and no image preview and no error */}
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

                {/* Viewfinder Controls & Overlays */}
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

                    {/* Viewfinder Target / Laser overlay */}
                    {activeTab === 'barcode' ? (
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
                    ) : (
                      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                        <div className="w-64 h-44 sm:w-72 sm:h-48 border-2 border-dashed border-amber-400/80 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
                          <div className="absolute -top-1 -left-1 w-5 h-5 border-t-3 border-l-3 border-amber-400 rounded-tl" />
                          <div className="absolute -top-1 -right-1 w-5 h-5 border-t-3 border-r-3 border-amber-400 rounded-tr" />
                          <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-3 border-l-3 border-amber-400 rounded-bl" />
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-3 border-r-3 border-amber-400 rounded-br" />
                        </div>
                        <span className="text-[11px] font-medium text-white/95 bg-black/60 px-3 py-1 rounded-full mt-3 backdrop-blur-sm">
                          Align product packaging or label inside frame
                        </span>
                      </div>
                    )}
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

              {/* CONTROLS PER TAB */}
              {activeTab === 'barcode' ? (
                <div className="space-y-3 pt-1">
                  {/* Barcode Camera Snap Action */}
                  {cameraActive && (
                    <button
                      type="button"
                      onClick={handleSnapLivePhoto}
                      disabled={analyzingPhoto}
                      className="w-full py-3.5 px-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2.5 shadow-md shadow-red-600/30 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      <div className="w-5 h-5 rounded-full border-2 border-white flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-white" />
                      </div>
                      <span>Snap Barcode Frame & Lookup</span>
                    </button>
                  )}

                  {/* Dual Barcode Photo Actions: Camera vs Gallery */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Take Photo with Camera */}
                    <div>
                      <input
                        type="file"
                        id="barcode-photo-camera"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleBarcodeImageFile(file);
                          e.target.value = '';
                        }}
                      />
                      <label
                        htmlFor="barcode-photo-camera"
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
                        id="barcode-photo-gallery"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleBarcodeImageFile(file);
                          e.target.value = '';
                        }}
                      />
                      <label
                        htmlFor="barcode-photo-gallery"
                        onClick={() => stopCamera()}
                        className="w-full py-3 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all border border-slate-200/80 active:scale-95 text-center"
                      >
                        <Upload className="w-4 h-4 text-slate-500 shrink-0" />
                        <span>Gallery Barcode</span>
                      </label>
                    </div>
                  </div>

                  {/* Barcode Fallback Prompt to Gemini Photo AI if no barcode detected */}
                  {barcodeFallbackImage && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-left space-y-2 animate-in fade-in">
                      <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                        <Sparkles className="w-4 h-4 text-amber-600" />
                        <span>Barcode not clearly visible?</span>
                      </div>
                      <p className="text-[11px] text-amber-800 leading-relaxed">
                        Gemini Vision can recognize the brand name, product description, and labels directly from your photo.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('vision');
                          setVisionError(null);
                          setBarcodeFallbackImage(null);
                          runGeminiPhotoAnalysis(barcodeFallbackImage, 'image/jpeg');
                        }}
                        className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Identify Product with Gemini AI</span>
                      </button>
                    </div>
                  )}

                  {/* Resume Live Camera if inactive */}
                  {!cameraActive && !analyzingPhoto && (
                    <button
                      type="button"
                      onClick={() => {
                        setImagePreview(null);
                        setVisionError(null);
                        setBarcodeFallbackImage(null);
                        startCamera(undefined, facingMode);
                      }}
                      className="w-full py-2.5 px-3 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-200"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                      <span>Switch Back to Live Camera Viewfinder</span>
                    </button>
                  )}

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
                /* GEMINI PHOTO RECALL CHECK CONTROLS */
                <div className="space-y-3 pt-1">
                  {/* Primary Shutter Action: Snap live photo directly from in-app camera when active */}
                  {cameraActive && (
                    <button
                      type="button"
                      onClick={handleSnapLivePhoto}
                      disabled={analyzingPhoto}
                      className="w-full py-3.5 px-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2.5 shadow-md shadow-red-600/30 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      <div className="w-5 h-5 rounded-full border-2 border-white flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-white" />
                      </div>
                      <span>Snap Photo & Verify with Gemini AI</span>
                    </button>
                  )}

                  {/* Dual Action: Take New Photo (Native Camera) or Choose from Gallery */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Take Photo with Camera (capture="environment") */}
                    <div>
                      <input
                        type="file"
                        id="gemini-photo-camera"
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
                        htmlFor="gemini-photo-camera"
                        onClick={() => stopCamera()}
                        className="w-full py-3 px-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm active:scale-95 text-center"
                      >
                        <Camera className="w-4 h-4 shrink-0" />
                        <span>Take Photo</span>
                      </label>
                    </div>

                    {/* Choose Existing Photo from Gallery (NO capture attribute) */}
                    <div>
                      <input
                        type="file"
                        id="gemini-photo-upload"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleVisionImageFile(file);
                          e.target.value = '';
                        }}
                      />
                      <label
                        htmlFor="gemini-photo-upload"
                        onClick={() => stopCamera()}
                        className="w-full py-3 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all border border-slate-200/80 active:scale-95 text-center"
                      >
                        <Upload className="w-4 h-4 text-slate-500 shrink-0" />
                        <span>Choose Gallery Photo</span>
                      </label>
                    </div>
                  </div>

                  {/* If camera is not active and not analyzing, button to resume live camera */}
                  {!cameraActive && !analyzingPhoto && (
                    <button
                      type="button"
                      onClick={() => {
                        setImagePreview(null);
                        setVisionError(null);
                        setBarcodeFallbackImage(null);
                        startCamera(undefined, facingMode);
                      }}
                      className="w-full py-2.5 px-3 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-200"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                      <span>Switch Back to Live Camera Viewfinder</span>
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
