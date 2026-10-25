/**
 * Memory-safe Client-side Image Optimization Utility
 * Prevents mobile Out-Of-Memory (OOM) crashes by:
 * 1. Inspecting image headers (first 64KB) to determine dimensions WITHOUT loading full bitmaps into RAM.
 * 2. Downsampling at native decode time via createImageBitmap (or async Image + ObjectURL).
 * 3. Scaling down to max 1280px maintaining original aspect ratio.
 * 4. Compressing to lightweight JPEG (quality 0.8) blob and base64.
 * 5. Immediately releasing all canvas dimensions, bitmaps, and object URLs.
 */

export interface OptimizedImageResult {
  blob: Blob;
  file: File;
  dataUrl: string;
  width: number;
  height: number;
  originalSize: number;
  optimizedSize: number;
}

export interface ImageOptimizerOptions {
  maxDimension?: number; // Default: 1280px
  quality?: number; // Default: 0.8
  fileName?: string;
}

/**
 * Fast header inspection to extract width and height from the first 64KB
 * without decoding the image into uncompressed RAM.
 */
export async function getImageDimensionsFromHeader(
  fileOrBlob: Blob
): Promise<{ width: number; height: number } | null> {
  try {
    const slice = fileOrBlob.slice(0, 65536);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 16) return null;

    // 1. PNG: \x89PNG\r\n\x1a\n
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes.length >= 24
    ) {
      const view = new DataView(buffer);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }

    // 2. GIF: GIF87a or GIF89a
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes.length >= 10
    ) {
      const view = new DataView(buffer);
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }

    // 3. WebP: RIFF....WEBP
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      // VP8X (Extended format)
      if (
        bytes[12] === 0x56 &&
        bytes[13] === 0x50 &&
        bytes[14] === 0x38 &&
        bytes[15] === 0x58 &&
        bytes.length >= 30
      ) {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width, height };
      }
      // VP8 (Lossy format)
      if (
        bytes[12] === 0x56 &&
        bytes[13] === 0x50 &&
        bytes[14] === 0x38 &&
        bytes[15] === 0x20 &&
        bytes.length >= 30
      ) {
        const width = ((bytes[27] & 0x3f) << 8) | bytes[26];
        const height = ((bytes[29] & 0x3f) << 8) | bytes[28];
        return { width, height };
      }
      // VP8L (Lossless format)
      if (
        bytes[12] === 0x56 &&
        bytes[13] === 0x50 &&
        bytes[14] === 0x38 &&
        bytes[15] === 0x4c &&
        bytes.length >= 25
      ) {
        if (bytes[20] === 0x2f) {
          const b1 = bytes[21],
            b2 = bytes[22],
            b3 = bytes[23],
            b4 = bytes[24];
          const width = 1 + (((b2 & 0x3f) << 8) | b1);
          const height = 1 + (((b4 & 0xf) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
          return { width, height };
        }
      }
    }

    // 4. JPEG: Starts with FF D8
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      const len = bytes.length;
      while (offset < len - 8) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xff) {
          offset++;
          continue;
        }
        if (marker === 0xda || marker === 0xd9) break; // SOS or EOI

        const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (segLen < 2) break;

        const isSOF =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);

        if (isSOF && offset + 8 < len) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          return { width, height };
        }

        offset += 2 + segLen;
      }
    }
  } catch (e) {
    console.warn('Image header dimension extraction failed:', e);
  }
  return null;
}

/**
 * Calculates proportional scaled dimensions bounded by maxDimension.
 */
export function calculateAspectRatioFit(
  srcWidth: number,
  srcHeight: number,
  maxDimension = 1280
): { width: number; height: number } {
  let targetWidth = srcWidth;
  let targetHeight = srcHeight;

  if (targetWidth > maxDimension || targetHeight > maxDimension) {
    if (targetWidth > targetHeight) {
      targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
      targetWidth = maxDimension;
    } else {
      targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
      targetHeight = maxDimension;
    }
  }

  // Ensure minimum dimensions of 1x1
  return {
    width: Math.max(1, targetWidth),
    height: Math.max(1, targetHeight)
  };
}

/**
 * Optimizes an image File or Blob for low memory usage.
 * Downscales to max 1280px (default) and encodes to JPEG (quality 0.8).
 */
export async function optimizeImage(
  fileOrBlob: File | Blob,
  options?: ImageOptimizerOptions
): Promise<OptimizedImageResult> {
  const maxDim = options?.maxDimension ?? 1280;
  const quality = options?.quality ?? 0.8;
  const originalSize = fileOrBlob.size;
  const baseName =
    options?.fileName ||
    (fileOrBlob instanceof File ? fileOrBlob.name : 'optimized-photo.jpg');
  const cleanName = baseName.replace(/\.[^/.]+$/, '') + '.jpg';

  // 1. Try pre-decode dimensions from header
  const headerDims = await getImageDimensionsFromHeader(fileOrBlob);
  let targetDims = headerDims
    ? calculateAspectRatioFit(headerDims.width, headerDims.height, maxDim)
    : null;

  // 2. Decode-time downsampling via createImageBitmap (Chromium, Firefox, Safari)
  if (typeof window !== 'undefined' && 'createImageBitmap' in window) {
    try {
      const bitmapOptions: ImageBitmapOptions = {
        resizeWidth: targetDims?.width || maxDim,
        resizeHeight: targetDims?.height,
        resizeQuality: 'medium',
        imageOrientation: 'from-image'
      };

      const bitmap = await createImageBitmap(fileOrBlob, bitmapOptions);
      const width = bitmap.width;
      const height = bitmap.height;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });

      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close(); // Immediately free native bitmap from RAM

        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        // Convert canvas to lightweight Blob
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new Error('Failed to generate image blob'));
            },
            'image/jpeg',
            quality
          );
        });

        // Immediately release canvas memory
        canvas.width = 0;
        canvas.height = 0;

        const file = new File([blob], cleanName, { type: 'image/jpeg' });

        return {
          blob,
          file,
          dataUrl,
          width,
          height,
          originalSize,
          optimizedSize: blob.size
        };
      }
      bitmap.close();
    } catch (err) {
      console.warn('createImageBitmap downsampling failed, falling back to ObjectURL:', err);
    }
  }

  // 3. Fallback via URL.createObjectURL and HTMLImageElement (Zero base64 string duplication)
  return new Promise((resolve, reject) => {
    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(fileOrBlob);
    } catch {
      return reject(new Error('Failed to create memory pointer for image.'));
    }

    const img = new Image();
    img.decoding = 'async';

    const cleanup = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }
      img.src = '';
    };

    img.onload = async () => {
      try {
        const naturalW = img.naturalWidth || img.width || maxDim;
        const naturalH = img.naturalHeight || img.height || maxDim;
        const { width, height } = calculateAspectRatioFit(naturalW, naturalH, maxDim);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });

        if (!ctx) {
          cleanup();
          return reject(new Error('Canvas 2D context unavailable'));
        }

        ctx.drawImage(img, 0, 0, width, height);
        cleanup(); // Free image from RAM as soon as drawn

        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        const blob = await new Promise<Blob>((resBlob, rejBlob) => {
          canvas.toBlob(
            (b) => {
              if (b) resBlob(b);
              else rejBlob(new Error('Canvas toBlob failed'));
            },
            'image/jpeg',
            quality
          );
        });

        // Release canvas memory immediately
        canvas.width = 0;
        canvas.height = 0;

        const file = new File([blob], cleanName, { type: 'image/jpeg' });

        resolve({
          blob,
          file,
          dataUrl,
          width,
          height,
          originalSize,
          optimizedSize: blob.size
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    img.onerror = () => {
      cleanup();
      reject(new Error('Unable to decode image file. Please check image format.'));
    };

    img.src = objectUrl;
  });
}
