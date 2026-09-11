/// <reference lib="webworker" />

import type { ImageType, WorkerRequest } from '../types';

// Import @jsquash packages
import jpegEncode, { init as initJpegEnc } from '@jsquash/jpeg/encode';
import jpegDecode, { init as initJpegDec } from '@jsquash/jpeg/decode';
import pngEncode, { init as initPngEnc } from '@jsquash/png/encode';
import oxipngOptimise, { init as initOxipng } from '@jsquash/oxipng/optimise';
import webpEncode, { init as initWebp } from '@jsquash/webp/encode';

// imagequant does not support default wasm loading in Vite workers, so we import the bg module and manual init.
// @ts-ignore
import * as imagequantBg from 'imagequant/imagequant_bg.js';
const { Imagequant, ImagequantImage, __wbg_set_wasm: initImagequantWasm } = imagequantBg as any;

// SSIM functions are defined below

// Wasm files are now statically served from the /public/wasm/ directory
const jpegEncWasmUrl = '/wasm/mozjpeg_enc.wasm';
const jpegDecWasmUrl = '/wasm/mozjpeg_dec.wasm';
const pngWasmUrl = '/wasm/squoosh_png_bg.wasm';
const oxipngWasmUrl = '/wasm/squoosh_oxipng_bg.wasm';
const imagequantWasmUrl = '/wasm/imagequant_bg.wasm';
const webpEncWasmUrl = '/wasm/webp_enc.wasm';
const webpDecWasmUrl = '/wasm/webp_dec.wasm';

declare const self: DedicatedWorkerGlobalScope;

const PROFILE_SIZE = 64;
const GRAPHIC_COLOR_THRESHOLD = 300;

function minifySvgTag(tag: string): string {
  let result = '';
  let quote = '';
  let pendingSpace = false;

  for (const char of tag.trim()) {
    if (quote) {
      result += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      if (pendingSpace && result && !result.endsWith('=') && !result.endsWith(' ')) result += ' ';
      pendingSpace = false;
      quote = char;
      result += char;
      continue;
    }
    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }
    if (char === '=') {
      result = result.trimEnd();
      result += char;
      pendingSpace = false;
      continue;
    }
    if (pendingSpace && result && !result.endsWith('=')) result += ' ';
    pendingSpace = false;
    result += char;
  }

  return result;
}

function extractImageDataInWorker(
  originalBuffer: ArrayBuffer,
  mimeType: string
): Promise<ImageData> {
  return new Promise(async (resolve, reject) => {
    let imageBitmap: ImageBitmap | null = null;
    try {
      const blob = new Blob([originalBuffer], { type: mimeType });
      imageBitmap = await createImageBitmap(blob);

      const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error('OffscreenCanvas 2D context not supported');
      }

      ctx.drawImage(imageBitmap, 0, 0);
      resolve(ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height));
    } catch (error) {
      reject(error);
    } finally {
      imageBitmap?.close();
    }
  });
}

function profileImageData(imageData: ImageData): ImageType {
  const sourceCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) {
    return 'photo';
  }
  sourceCtx.putImageData(imageData, 0, 0);

  const sampleCanvas = new OffscreenCanvas(PROFILE_SIZE, PROFILE_SIZE);
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!sampleCtx) {
    return 'photo';
  }

  sampleCtx.drawImage(sourceCanvas, 0, 0, PROFILE_SIZE, PROFILE_SIZE);
  const sampled = sampleCtx.getImageData(0, 0, PROFILE_SIZE, PROFILE_SIZE).data;

  const colorSet = new Set<number>();
  for (let i = 0; i < sampled.length; i += 4) {
    if (sampled[i + 3] === 0) continue;

    const r = sampled[i]! >> 3;
    const g = sampled[i + 1]! >> 3;
    const b = sampled[i + 2]! >> 3;
    colorSet.add((r << 10) | (g << 5) | b);
  }

  return colorSet.size < GRAPHIC_COLOR_THRESHOLD ? 'graphic' : 'photo';
}

function hasTransparentPixels(imageData: ImageData): boolean {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) return true;
  }
  return false;
}

// ─── SSIM Calculation ───────────────────────────────────────────────────
function computeSSIM(
  imgA: { data: Uint8ClampedArray | Float32Array; width: number; height: number },
  imgB: { data: Uint8ClampedArray | Float32Array; width: number; height: number }
): number {
  const w = Math.min(imgA.width, imgB.width);
  const h = Math.min(imgA.height, imgB.height);
  const cropW = Math.min(w, 1024);
  const cropH = Math.min(h, 1024);
  const offX = Math.floor((w - cropW) / 2);
  const offY = Math.floor((h - cropH) / 2);

  const extractCrop = (data: Uint8ClampedArray | Float32Array, fullW: number): Float32Array => {
    if (data instanceof Float32Array) {
      if (cropW === fullW && offX === 0 && offY === 0) return data;
      const cropped = new Float32Array(cropW * cropH);
      for (let y = 0; y < cropH; y++) {
        for (let x = 0; x < cropW; x++) {
          cropped[y * cropW + x] = data[(offY + y) * fullW + (offX + x)]!;
        }
      }
      return cropped;
    }

    const cropped = new Float32Array(cropW * cropH);
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const srcIdx = ((offY + y) * fullW + (offX + x)) * 4;
        cropped[y * cropW + x] = 0.2126 * data[srcIdx]! + 0.7152 * data[srcIdx + 1]! + 0.0722 * data[srcIdx + 2]!;
      }
    }
    return cropped;
  };

  const lumaA = extractCrop(imgA.data, imgA.width);
  const lumaB = extractCrop(imgB.data, imgB.width);

  const L = 255;
  const C1 = (0.01 * L) ** 2;
  const C2 = (0.03 * L) ** 2;

  const blockSize = 8;
  const blocksX = Math.floor(cropW / blockSize);
  const blocksY = Math.floor(cropH / blockSize);

  let totalSSIM = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let sumA = 0, sumB = 0;
      const x0 = bx * blockSize;
      const y0 = by * blockSize;

      for (let i = 0; i < blockSize; i++) {
        for (let j = 0; j < blockSize; j++) {
          const idx = (y0 + i) * cropW + (x0 + j);
          sumA += lumaA[idx]!;
          sumB += lumaB[idx]!;
        }
      }

      const muA = sumA / 64;
      const muB = sumB / 64;

      let varA = 0, varB = 0, covAB = 0;
      for (let i = 0; i < blockSize; i++) {
        for (let j = 0; j < blockSize; j++) {
          const idx = (y0 + i) * cropW + (x0 + j);
          const valA = lumaA[idx]! - muA;
          const valB = lumaB[idx]! - muB;
          varA += valA * valA;
          varB += valB * valB;
          covAB += valA * valB;
        }
      }

      varA /= 64;
      varB /= 64;
      covAB /= 64;

      const ssim = ((2 * muA * muB + C1) * (2 * covAB + C2)) /
        ((muA * muA + muB * muB + C1) * (varA + varB + C2));
      totalSSIM += ssim;
    }
  }

  return totalSSIM / (blocksX * blocksY);
}

function imageDataToSSIMInput(imgParams: ImageData): { data: Float32Array, width: number, height: number } {
  const w = imgParams.width;
  const h = imgParams.height;
  const data = imgParams.data;
  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    luma[i] = 0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!;
  }
  return { data: luma, width: w, height: h };
}

// ─── Wasm Initialization ──────────────────────────────────────────────
let wasmReady = false;
let initPromise: Promise<void> | null = null;

async function fetchWasmAndInit(url: string, initFn: (module: WebAssembly.Module) => Promise<any>) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const module = await WebAssembly.compile(buffer);
  await initFn(module);
}

async function doInitWasm() {
  if (wasmReady) return;
  await Promise.all([
    fetchWasmAndInit(jpegEncWasmUrl, initJpegEnc),
    fetchWasmAndInit(jpegDecWasmUrl, initJpegDec),
    fetchWasmAndInit(pngWasmUrl, initPngEnc),
    fetchWasmAndInit(oxipngWasmUrl, initOxipng),

    // imagequant manual initialization:
    fetch(imagequantWasmUrl)
      .then(res => res.arrayBuffer())
      .then(buf => WebAssembly.instantiate(buf, { "./imagequant_bg.js": imagequantBg }))
      .then(result => initImagequantWasm(result.instance.exports)),
    fetchWasmAndInit(webpEncWasmUrl, initWebp),
  ]);
  wasmReady = true;
}

function initWasm() {
  if (!initPromise) {
    initPromise = doInitWasm();
  }
  return initPromise;
}

// ─── Robust PNG Compression Logic ────────────────────────────────────
async function robustPngCompress(
  imageData: ImageData,
  originalBuffer: ArrayBuffer,
  isGraphic: boolean,
  hasTransparency: boolean,
  quality: number
): Promise<ArrayBuffer> {
  // 核心逻辑：尝试有损量化 -> 尝试无损压实 -> 任何失败则退回原图
  try {
    const instance = new Imagequant();
    const image = new ImagequantImage(new Uint8Array(imageData.data.buffer), imageData.width, imageData.height, 0.0);
    
    const minimumQuality = Math.max(10, quality - (hasTransparency || isGraphic ? 30 : 40));
    instance.set_quality(minimumQuality, quality);
    instance.set_speed(3);

    const quantizedPng = instance.process(image);
    instance.free();

    try {
      const quantizedBuffer = quantizedPng.buffer as ArrayBuffer;
      return await oxipngOptimise(quantizedBuffer, { level: 4 });
    } catch (e) {
      console.warn('⚠️ oxipng optimize failed, returning quantized result.', e);
      return quantizedPng.buffer as ArrayBuffer;
    }

  } catch (crash) {
    console.warn('🔥 [Engine Safe Fallback] PNG compression engine crashed.');
    console.warn('Crash reason:', crash);
    console.warn('>>> Action: Returning the ORIGINAL image to ensure stability.');
    
    // 如果有损压缩崩了，我们还可以尝试只做一次无损 oxipng 优化作为最后的努力
    try {
      return await oxipngOptimise(originalBuffer, { level: 4 });
    } catch (e) {
      return originalBuffer;
    }
  }
}

// ─── Graphic JPEG (static params) ─────────────────────────────────────
async function compressJpegGraphic(imgData: ImageData, quality: number): Promise<ArrayBuffer> {
  // jsquash specific options mapping for mozjpeg
  return await jpegEncode(imgData, {
    quality,
    chroma_subsample: 1, // 4:4:4
    auto_subsample: false,
    smoothing: 0
  });
}

// ─── Photo JPEG (SSIM binary search) ──────────────────────────────────
async function mozjpegAutoSSIM(
  imgData: ImageData,
  config: { targetSSIM: number, chroma_subsampling: number, smoothing: number }
): Promise<ArrayBuffer> {
  let low = 60;
  let high = 95;
  let best: ArrayBuffer | null = null;
  const originalSSI = imageDataToSSIMInput(imgData);

  for (let i = 0; i < 6; i++) {
    const mid = Math.floor((low + high) / 2);
    const output = await jpegEncode(imgData, {
      quality: mid,
      chroma_subsample: config.chroma_subsampling,
      auto_subsample: false,
      smoothing: config.smoothing
    });

    const recodedData = await jpegDecode(output);
    const ssim = computeSSIM(originalSSI, imageDataToSSIMInput(recodedData));

    if (ssim >= config.targetSSIM) {
      best = output;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  if (!best) {
    best = await jpegEncode(imgData, {
      quality: high,
      chroma_subsample: config.chroma_subsampling,
      auto_subsample: false,
      smoothing: config.smoothing
    });
  }

  return best;
}

async function compressJpegPhoto(imgData: ImageData): Promise<ArrayBuffer> {
  return await mozjpegAutoSSIM(imgData, {
    targetSSIM: 0.96,
    chroma_subsampling: 2, // 4:2:0
    smoothing: 5
  });
}

// ─── Automatic Encoding Router ─────────────────────────────────────────
async function encodeImageAuto(
  imageData: ImageData,
  mimeType: string,
  isGraphic: boolean,
  hasTransparency: boolean,
  originalBuffer: ArrayBuffer,
  quality: number,
  targetBytes: number
): Promise<ArrayBuffer> {
  const encodeAtQuality = async (currentQuality: number): Promise<ArrayBuffer> => {
    switch (mimeType) {
      case 'image/webp':
        return webpEncode(imageData, { quality: currentQuality });
      case 'image/jpeg':
      case 'image/jpg':
        return compressJpegGraphic(imageData, currentQuality);
      case 'image/png':
        return robustPngCompress(imageData, originalBuffer, isGraphic, hasTransparency, currentQuality);
      default:
        throw new Error(`Unsupported format: ${mimeType}`);
    }
  };

  let encodedBuffer = await encodeAtQuality(quality);
  if (targetBytes > 0 && encodedBuffer.byteLength > targetBytes) {
    let low = 10;
    let high = quality - 1;
    let smallest = encodedBuffer;
    for (let attempt = 0; attempt < 6 && low <= high; attempt++) {
      const candidateQuality = Math.floor((low + high) / 2);
      const candidate = await encodeAtQuality(candidateQuality);
      if (candidate.byteLength < smallest.byteLength) smallest = candidate;
      if (candidate.byteLength <= targetBytes) {
        encodedBuffer = candidate;
        low = candidateQuality + 1;
      } else {
        high = candidateQuality - 1;
      }
    }
    if (encodedBuffer.byteLength > targetBytes) encodedBuffer = smallest;
  }

  // 终极防御 [Size Gatekeeper]：如果压缩后的体积 >= 原始体积，则直接返回原图
  if (encodedBuffer.byteLength >= originalBuffer.byteLength) {
    console.warn(`⚠️ [Size Guard] Reverse compression for ${mimeType}. Returning original file.`);
    return originalBuffer;
  }

  return encodedBuffer;
}

// ─── Message Handler ──────────────────────────────────────────────────
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type, id, buffer, mimeType, quality, targetBytes } = e.data;
  if (type !== 'compress') return;

  try {
    if (mimeType === 'image/svg+xml') {
      const source = new TextDecoder().decode(buffer);
      if (!/<svg\b/i.test(source)) throw new Error('Invalid SVG file');
      const optimized = source
        .replace(/<!--[^]*?-->/g, '')
        .replace(/<metadata\b[^]*?<\/metadata>/gi, '')
        .replace(/<\?xml[^>]*>/gi, '')
        .replace(/<([^>]+)>/g, (_, tag: string) => `<${minifySvgTag(tag)}>`)
        .trim();
      const compressed = new TextEncoder().encode(optimized);
      const result = compressed.byteLength < buffer.byteLength ? compressed : new Uint8Array(buffer);
      self.postMessage({ type: 'progress', id, progress: 70 });
      self.postMessage({ type: 'result', id, buffer: result.buffer, originalSize: buffer.byteLength, compressedSize: result.byteLength, mimeType }, [result.buffer]);
      return;
    }

    await initWasm();

    const imageData = await extractImageDataInWorker(buffer, mimeType);
    const imageType = profileImageData(imageData);
    const hasTransparency = mimeType === 'image/png' && hasTransparentPixels(imageData);

    // Progress update
    self.postMessage({
      type: 'progress',
      id,
      progress: 50,
      width: imageData.width,
      height: imageData.height,
    });

    const compressed = await encodeImageAuto(
      imageData,
      mimeType,
      imageType === 'graphic',
      hasTransparency,
      buffer,
      quality,
      targetBytes
    );

    self.postMessage({
      type: 'result',
      id,
      buffer: compressed,
      originalSize: buffer.byteLength,
      compressedSize: compressed.byteLength,
      mimeType,
    }, [compressed]);

  } catch (err) {
    console.error('Compression error:', err);
    self.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : 'Unknown error during compression',
    });
  }
};
