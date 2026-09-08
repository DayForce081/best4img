import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js';
import { applyPalette, GIFEncoder, quantize, type GifPalette } from 'gifenc';
import DropZone from '../components/ui/DropZone';
import type { Locale, PageCopy } from '../i18n';
import { useLocaleSection } from '../localization';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_OUTPUT_FRAMES = 180;

type Result = {
  url: string;
  blob: Blob;
  width: number;
  height: number;
  frames: number;
};
type PageLocaleCopy = {
  title: string;
  subtitle: string;
  dropTitle: string;
  dropHint: string;
  preview: string;
  settings: string;
  scale: string;
  frames: string;
  colors: string;
  start: string;
  download: string;
  reset: string;
  original: string;
  output: string;
  ready: string;
  pending: string;
  errors: { oversize: string; unsupported: string; process: string; tooManyFrames: string };
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function outputName(name: string) {
  return `${name.replace(/\.[^.]+$/, '')}-compressed.gif`;
}

function sizeChangeLabel(original: number, next: number) {
  const percent = Math.round((1 - next / original) * 100);
  return percent >= 0 ? `-${percent}%` : `+${Math.abs(percent)}%`;
}

function drawGifPatch(ctx: CanvasRenderingContext2D, frame: ParsedFrame) {
  const { left, top, width, height } = frame.dims;
  const target = ctx.getImageData(left, top, width, height);
  for (let i = 0; i < frame.patch.length; i += 4) {
    if (frame.patch[i + 3] === 0) continue;
    target.data[i] = frame.patch[i]!;
    target.data[i + 1] = frame.patch[i + 1]!;
    target.data[i + 2] = frame.patch[i + 2]!;
    target.data[i + 3] = frame.patch[i + 3]!;
  }
  ctx.putImageData(target, left, top);
}

function hasAlpha(data: Uint8ClampedArray) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) return true;
  }
  return false;
}

async function compressGif(file: File, scale: number, frameStep: number, colors: number) {
  const parsed = parseGIF(await file.arrayBuffer());
  const frames = decompressFrames(parsed, true);
  if (Math.ceil(frames.length / frameStep) > MAX_OUTPUT_FRAMES) {
    throw new Error('too-many-frames');
  }

  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !outCtx) throw new Error('canvas');

  const encodedFrames: Array<{ data: Uint8ClampedArray; delay: number }> = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const restore = frame.disposalType === 3 ? ctx.getImageData(0, 0, width, height) : null;
    drawGifPatch(ctx, frame);

    if (index % frameStep === 0) {
      outCtx.clearRect(0, 0, outWidth, outHeight);
      outCtx.drawImage(canvas, 0, 0, outWidth, outHeight);
      encodedFrames.push({ data: outCtx.getImageData(0, 0, outWidth, outHeight).data, delay: 0 });
    }

    const current = encodedFrames[encodedFrames.length - 1];
    if (current) current.delay += frame.delay || 100;

    if (frame.disposalType === 2) {
      ctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    } else if (restore) {
      ctx.putImageData(restore, 0, 0);
    }
  }

  const gif = GIFEncoder({ initialCapacity: Math.max(4096, Math.floor(file.size * 0.8)) });
  encodedFrames.forEach((frame, index) => {
    const format = hasAlpha(frame.data) ? 'rgba4444' : 'rgb565';
    const palette = quantize(frame.data, colors, { format, oneBitAlpha: true }) as GifPalette;
    const transparentIndex = palette.findIndex((color) => color.length === 4 && color[3]! < 128);
    const indexed = applyPalette(frame.data, palette, format);
    gif.writeFrame(indexed, outWidth, outHeight, {
      palette,
      delay: Math.max(20, frame.delay),
      repeat: index === 0 ? 0 : undefined,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
    });
  });
  gif.finish();

  const bytes = gif.bytes();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return {
    blob: new Blob([buffer], { type: 'image/gif' }),
    width: outWidth,
    height: outHeight,
    frames: encodedFrames.length,
  };
}

export default function GifCompressPage() {
  const { locale } = useOutletContext<{ copy: PageCopy; locale: Locale }>();
  const copy = useLocaleSection<PageLocaleCopy>('gif-compress');
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [scale, setScale] = useState(0.5);
  const [frameStep, setFrameStep] = useState(2);
  const [colors, setColors] = useState(64);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const sourceUrlRef = useRef('');
  const resultUrlRef = useRef('');

  useEffect(() => {
    return () => {
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const ratio = useMemo(() => {
    if (!file || !result) return '';
    return `${formatSize(result.blob.size)} / ${sizeChangeLabel(file.size, result.blob.size)}`;
  }, [file, result]);

  const addFiles = useCallback((files: File[]) => {
    const next = files[0];
    if (!next) return;
    setError('');
    setResult(null);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = '';

    if (next.size > MAX_FILE_SIZE) {
      setError(copy.errors.oversize);
      return;
    }
    if (next.type !== 'image/gif' && !next.name.toLowerCase().endsWith('.gif')) {
      setError(copy.errors.unsupported);
      return;
    }

    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    const url = URL.createObjectURL(next);
    sourceUrlRef.current = url;
    setSourceUrl(url);
    setFile(next);
  }, [copy.errors.oversize, copy.errors.unsupported]);

  const handleStart = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError('');
    setResult(null);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);

    try {
      const compressed = await compressGif(file, scale, frameStep, colors);
      const url = URL.createObjectURL(compressed.blob);
      resultUrlRef.current = url;
      setResult({ ...compressed, url });
    } catch (err) {
      setError(err instanceof Error && err.message === 'too-many-frames' ? copy.errors.tooManyFrames : copy.errors.process);
    } finally {
      setIsProcessing(false);
    }
  }, [colors, copy.errors.process, copy.errors.tooManyFrames, file, frameStep, scale]);

  const handleDownload = useCallback(() => {
    if (!file || !result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = outputName(file.name);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [file, result]);

  const handleReset = useCallback(() => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    sourceUrlRef.current = '';
    resultUrlRef.current = '';
    setFile(null);
    setSourceUrl('');
    setResult(null);
    setError('');
  }, []);

  return (
    <main className="bg-[#f9fafc]">
      <section className="relative min-h-[500px] pt-7 pb-14">
        <div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold tracking-tighter text-slate-900 md:text-3xl">{copy.title}</h2>
            <p className="mt-2 text-base font-medium text-slate-500">{copy.subtitle}</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
            <div className="flex flex-col gap-5">
              {file ? (
                <section className="flex min-h-[24rem] flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-500">{copy.preview}</p>
                      <h3 className="truncate text-lg font-bold tracking-tight text-slate-900" title={file.name}>{file.name}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={handleReset}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:text-slate-900"
                    >
                      <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                      {copy.reset}
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-100 p-4">
                      <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{copy.original} · {formatSize(file.size)}</p>
                      <img src={sourceUrl} alt="" className="mx-auto max-h-[28rem] max-w-full object-contain" />
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-100 p-4">
                      <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{copy.output}{ratio ? ` · ${ratio}` : ''}</p>
                      {result ? (
                        <img src={result.url} alt="" className="mx-auto max-h-[28rem] max-w-full object-contain" />
                      ) : (
                        <div className="flex min-h-[16rem] items-center justify-center text-sm font-bold text-slate-400">{copy.pending}</div>
                      )}
                    </div>
                  </div>
                </section>
              ) : (
                <DropZone
                  onFilesSelect={addFiles}
                  accept="image/gif"
                  maxFiles={1}
                  maxFileSize={MAX_FILE_SIZE}
                  isEasy={true}
                  copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }}
                />
              )}
            </div>

            <section className="rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
              <h3 className="text-lg font-bold tracking-tight text-slate-900">{copy.settings}</h3>

              <label className="mt-5 block">
                <span className="text-sm font-bold text-slate-600">{copy.scale}</span>
                <select value={scale} onChange={(event) => setScale(Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none">
                  <option value={1}>100%</option>
                  <option value={0.75}>75%</option>
                  <option value={0.5}>50%</option>
                  <option value={0.33}>33%</option>
                </select>
              </label>

              <label className="mt-5 block">
                <span className="text-sm font-bold text-slate-600">{copy.frames}</span>
                <select value={frameStep} onChange={(event) => setFrameStep(Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none">
                  <option value={1}>100%</option>
                  <option value={2}>50%</option>
                  <option value={3}>33%</option>
                </select>
              </label>

              <label className="mt-5 block">
                <span className="text-sm font-bold text-slate-600">{copy.colors}</span>
                <select value={colors} onChange={(event) => setColors(Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none">
                  <option value={256}>256</option>
                  <option value={128}>128</option>
                  <option value={64}>64</option>
                </select>
              </label>

              {file && (
                <p className="mt-5 text-sm font-medium leading-6 text-slate-500">
                  {formatSize(file.size)}{result ? ` → ${formatSize(result.blob.size)} · ${sizeChangeLabel(file.size, result.blob.size)} · ${result.width}×${result.height} · ${result.frames} frames` : ''}
                </p>
              )}
              {error && <div className="mt-5 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-500">{error}</div>}

              <button
                type="button"
                onClick={handleStart}
                disabled={!file || isProcessing}
                className={`mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold shadow-md transition-all ${
                  file && !isProcessing
                    ? 'cursor-pointer bg-[#3525cd] text-white hover:bg-[#24189d]'
                    : 'cursor-not-allowed bg-slate-200 text-slate-400'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">gif</span>
                {isProcessing ? `${copy.start}...` : copy.start}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!result}
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold shadow-md transition-all ${
                  result
                    ? 'cursor-pointer bg-white text-[#3525cd] ring-1 ring-indigo-100 hover:bg-indigo-50'
                    : 'cursor-not-allowed bg-white text-slate-300 ring-1 ring-slate-200'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">download</span>
                {copy.download}
              </button>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
