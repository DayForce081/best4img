import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import JSZip from 'jszip';
import DropZone from '../components/ui/DropZone';
import BaseFileRow from '../components/ui/BaseFileRow';
import type { Locale, PageCopy, SupportedLocale } from '../i18n';
import { formatLocale, useLocaleSection } from '../localization';
import type { ParsedFrame, ParsedGif } from 'gifuct-js';
import type { GifPalette } from 'gifenc';

const MAX_FILES = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const GIF_ONLY_TYPES = ['image/gif'];

type Mode = 'percent' | 'longest';
type Status = 'waiting' | 'processing' | 'completed' | 'error';

type ResizeEntry = {
  id: string;
  file: File;
  name: string;
  url: string;
  width?: number;
  height?: number;
  status: Status;
  outputUrl?: string;
  outputBuffer?: Uint8Array;
  outputName?: string;
  outputSize?: number;
  error?: string;
};
type PageLocaleCopy = {
  title: string;
  subtitle: string;
  dropTitle: string;
  dropHint: string;
  settings: string;
  percent: string;
  longest: string;
  scale: string;
  longestSide: string;
  longestHelp: string;
  start: string;
  downloadAll: string;
  waiting: string;
  processing: string;
  completed: string;
  download: string;
  empty: string;
  errors: {
    oversize: string;
    unsupported: string;
    read: string;
    process: string;
  };
};

let idCounter = 0;

function nextId() {
  idCounter += 1;
  return `resize-${idCounter}-${Date.now()}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function targetDimensions(entry: ResizeEntry, mode: Mode, percent: number, longest: number) {
  if (!entry.width || !entry.height) return null;
  const scale = mode === 'percent'
    ? percent / 100
    : Math.min(1, longest / Math.max(entry.width, entry.height));

  return {
    width: Math.max(1, Math.round(entry.width * scale)),
    height: Math.max(1, Math.round(entry.height * scale)),
  };
}

function outputName(name: string, mime: string) {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg';
  return `${name.replace(/\.[^.]+$/, '')}-resized.${ext}`;
}

function blobToArray(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

async function readImageSize(file: File) {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function drawGifPatch(ctx: CanvasRenderingContext2D, frame: ParsedFrame) {
  const { left, top, width, height } = frame.dims;
  const target = ctx.getImageData(left, top, width, height);
  for (let index = 0; index < frame.patch.length; index += 4) {
    if (frame.patch[index + 3] === 0) continue;
    target.data[index] = frame.patch[index]!;
    target.data[index + 1] = frame.patch[index + 1]!;
    target.data[index + 2] = frame.patch[index + 2]!;
    target.data[index + 3] = frame.patch[index + 3]!;
  }
  ctx.putImageData(target, left, top);
}

function gifRepeat(parsed: ParsedGif) {
  const extension = parsed.frames.find((frame) => 'application' in frame && frame.application.id.startsWith('NETSCAPE'));
  if (!extension || !('application' in extension)) return undefined;
  const blocks = extension.application.blocks;
  return blocks[0] === 1 && blocks.length >= 3 ? blocks[1]! | (blocks[2]! << 8) : undefined;
}

async function resizeGif(entry: ResizeEntry, dimensions: { width: number; height: number }) {
  const [{ decompressFrames, parseGIF }, { applyPalette, GIFEncoder, quantize }] = await Promise.all([
    import('gifuct-js'),
    import('gifenc'),
  ]);
  const parsed = parseGIF(await entry.file.arrayBuffer());
  const frames = decompressFrames(parsed, true);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = parsed.lsd.width;
  sourceCanvas.height = parsed.lsd.height;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = dimensions.width;
  outputCanvas.height = dimensions.height;
  const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx || !outputCtx) throw new Error('Canvas is not available');

  const gif = GIFEncoder({ initialCapacity: Math.max(4096, entry.file.size) });
  frames.forEach((frame, index) => {
    const restore = frame.disposalType === 3
      ? sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
      : null;
    drawGifPatch(sourceCtx, frame);
    outputCtx.clearRect(0, 0, dimensions.width, dimensions.height);
    outputCtx.drawImage(sourceCanvas, 0, 0, dimensions.width, dimensions.height);
    const data = outputCtx.getImageData(0, 0, dimensions.width, dimensions.height).data;
    const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true }) as GifPalette;
    const transparentIndex = palette.findIndex((color) => color.length === 4 && color[3]! < 128);
    gif.writeFrame(applyPalette(data, palette, 'rgba4444'), dimensions.width, dimensions.height, {
      palette,
      delay: Math.max(20, frame.delay || 100),
      repeat: index === 0 ? gifRepeat(parsed) : undefined,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
    });

    if (frame.disposalType === 2) {
      sourceCtx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    } else if (restore) {
      sourceCtx.putImageData(restore, 0, 0);
    }
  });
  gif.finish();
  const bytes = gif.bytes();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: 'image/gif' });
  return { blob, buffer: new Uint8Array(buffer), name: outputName(entry.name, 'image/gif') };
}

async function resizeImage(entry: ResizeEntry, dimensions: { width: number; height: number }) {
  if (entry.file.type === 'image/gif') return resizeGif(entry, dimensions);
  const bitmap = await createImageBitmap(entry.file);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas is not available');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
  bitmap.close();

  const mime = entry.file.type;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
  if (!blob) throw new Error('Unable to export image');

  return {
    blob,
    buffer: await blobToArray(blob),
    name: outputName(entry.name, mime),
  };
}

export default function ResizePage({ fixedMode, gifOnly = false }: { fixedMode?: Mode; gifOnly?: boolean }) {
  const { locale, routeLocale } = useOutletContext<{ copy: PageCopy; locale: Locale; routeLocale: SupportedLocale }>();
  const copy = useLocaleSection<PageLocaleCopy>('resize');
  const ui = useLocaleSection<{ summaryPercent: string; summaryLongest: string; gifTitle: string; percentTitle: string; longestTitle: string; gifSubtitle: string; percentSubtitle: string; longestSubtitle: string; gifDropTitle: string; gifDropHint: string }>('resize.ui');
  const [mode, setMode] = useState<Mode>(fixedMode ?? 'percent');
  const [percent, setPercent] = useState(50);
  const [longest, setLongest] = useState(0);
  const [files, setFiles] = useState<ResizeEntry[]>([]);
  const urlsRef = useRef<Set<string>>(new Set());
  const acceptedTypes = gifOnly ? GIF_ONLY_TYPES : ACCEPTED_TYPES;

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
    };
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const next = incoming.slice(0, Math.max(0, MAX_FILES - prev.length)).map((file): ResizeEntry => {
        const hasError = file.size > MAX_FILE_SIZE || !acceptedTypes.includes(file.type);
        const url = URL.createObjectURL(file);
        urlsRef.current.add(url);

        return {
          id: nextId(),
          file,
          name: file.name,
          url,
          status: hasError ? 'error' : 'waiting',
          error: file.size > MAX_FILE_SIZE
            ? copy.errors.oversize
            : !acceptedTypes.includes(file.type)
              ? copy.errors.unsupported
              : undefined,
        };
      });

      next.forEach((entry) => {
        if (entry.status === 'error') return;
        readImageSize(entry.file)
          .then((size) => {
            setLongest((current) => current || Math.max(size.width, size.height));
            setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, ...size } : item));
          })
          .catch(() => {
            setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'error', error: copy.errors.read } : item));
          });
      });

      return [...prev, ...next];
    });
  }, [acceptedTypes, copy.errors.oversize, copy.errors.read, copy.errors.unsupported]);

  const handleStart = useCallback(async () => {
    for (const entry of files) {
      const dimensions = targetDimensions(entry, mode, percent, longest);
      if (entry.status === 'error' || !dimensions) continue;

      setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'processing' } : item));

      try {
        const result = await resizeImage(entry, dimensions);
        const outputUrl = URL.createObjectURL(result.blob);
        urlsRef.current.add(outputUrl);

        setFiles((current) => current.map((item) => {
          if (item.id !== entry.id) return item;
          if (item.outputUrl) {
            URL.revokeObjectURL(item.outputUrl);
            urlsRef.current.delete(item.outputUrl);
          }
          return {
            ...item,
            status: 'completed',
            outputUrl,
            outputBuffer: result.buffer,
            outputName: result.name,
            outputSize: result.blob.size,
          };
        }));
      } catch {
        setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'error', error: copy.errors.process } : item));
      }
    }
  }, [copy.errors.process, files, longest, mode, percent]);

  const handleDownload = useCallback((entry: ResizeEntry) => {
    if (!entry.outputUrl) return;
    const a = document.createElement('a');
    a.href = entry.outputUrl;
    a.download = entry.outputName ?? entry.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleDownloadAll = useCallback(async () => {
    const completed = files.filter((file) => file.status === 'completed' && file.outputBuffer);
    if (!completed.length) return;

    const zip = new JSZip();
    completed.forEach((file) => {
      if (file.outputBuffer) zip.file(file.outputName ?? file.name, file.outputBuffer);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'BEST4IMG-resized.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files]);

  const hasProcessable = files.some((file) => file.status !== 'error' && file.width && file.height);
  const hasCompleted = files.some((file) => file.status === 'completed');
  const isProcessing = files.some((file) => file.status === 'processing');
  const summary = useMemo(() => {
    const ready = files.filter((file) => file.status !== 'error' && file.width && file.height).length;
    if (!ready) return copy.empty;
    return formatLocale(mode === 'percent' ? ui.summaryPercent : ui.summaryLongest, { count: ready, percent, longest });
  }, [copy.empty, files, longest, mode, percent, ui.summaryLongest, ui.summaryPercent]);
  const pageTitle = gifOnly ? ui.gifTitle : fixedMode === 'percent' ? ui.percentTitle : fixedMode === 'longest' ? ui.longestTitle : copy.title;
  const pageSubtitle = gifOnly ? ui.gifSubtitle : fixedMode === 'percent' ? ui.percentSubtitle : fixedMode === 'longest' ? ui.longestSubtitle : copy.subtitle;

  return (
    <main className="bg-[#f9fafc]">
      <section className="relative min-h-[500px] pt-7 pb-14">
        <div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold tracking-tighter text-slate-900 md:text-3xl">
              {pageTitle}
            </h2>
            <p className="mt-2 text-base font-medium text-slate-500">
              {pageSubtitle}
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
            <div className="flex flex-col gap-5">
              <DropZone
                onFilesSelect={addFiles}
                accept={gifOnly ? 'image/gif' : 'image/jpeg,image/png,image/webp,image/gif'}
                maxFiles={MAX_FILES}
                maxFileSize={MAX_FILE_SIZE}
                isEasy={true}
                copy={{
                  dropTitle: gifOnly ? ui.gifDropTitle : copy.dropTitle,
                  dropHint: gifOnly ? ui.gifDropHint : copy.dropHint,
                }}
              />

              {files.length > 0 && (
                <section className="w-full">
                  <div className="space-y-3.5">
                    {files.map((entry) => {
                      const target = targetDimensions(entry, mode, percent, longest);
                      const isError = entry.status === 'error';
                      const isProcessingRow = entry.status === 'processing';
                      const isCompleted = entry.status === 'completed';

                      return (
                        <BaseFileRow
                          key={entry.id}
                          rowBgClass={isError ? 'bg-red-50' : 'bg-white hover:bg-slate-50'}
                          progressPercent={isProcessingRow ? 65 : undefined}
                          isError={isError}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <img src={entry.url} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900" title={entry.name}>{entry.name}</p>
                              <p className={`text-xs font-medium ${isError ? 'text-red-400' : 'text-slate-400'}`}>
                                {isError
                                  ? entry.error
                                  : entry.width && entry.height
                                    ? `${entry.width}×${entry.height}${target ? ` → ${target.width}×${target.height}` : ''}${entry.file.type === 'image/gif' ? ' · GIF' : ''}`
                                    : copy.waiting}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 sm:justify-end">
                            {isCompleted && entry.outputSize && (
                              <span className="w-[112px] text-left text-sm font-medium text-slate-600">
                                {copy.completed} · {formatSize(entry.outputSize)}
                              </span>
                            )}
                            {isProcessingRow && (
                              <span className="w-[112px] text-left text-sm font-medium text-blue-700">{copy.processing}</span>
                            )}
                            {entry.status === 'waiting' && (
                              <span className="w-[112px] text-left text-sm font-medium text-slate-400">{copy.waiting}</span>
                            )}
                            {isCompleted && (
                              <button
                                type="button"
                                onClick={() => handleDownload(entry)}
                                className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[5px] text-sm font-semibold uppercase text-[#3525cd] transition-colors hover:bg-primary-fixed hover:text-[#24189d]"
                              >
                                <span className="material-symbols-outlined text-[18px]">download</span>
                                <span>{copy.download}</span>
                              </button>
                            )}
                            {isError && (
                              <div className="inline-flex max-w-[240px] items-center gap-2 px-2 py-1 text-sm font-medium text-red-400">
                                <span className="material-symbols-outlined text-[18px]">error</span>
                                <span className="truncate whitespace-nowrap">{entry.error}</span>
                              </div>
                            )}
                          </div>
                        </BaseFileRow>
                      );
                    })}
                  </div>

                  <div className="mt-8 flex justify-start sm:justify-end">
                    <button
                      type="button"
                      onClick={handleDownloadAll}
                      disabled={!hasCompleted}
                      className={`flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold shadow-md transition-all ${
                        hasCompleted
                          ? 'cursor-pointer bg-[#3525cd] text-white hover:bg-[#24189d]'
                          : 'cursor-not-allowed bg-[#3525cd] text-white opacity-50'
                      }`}
                    >
                      <span className="material-symbols-outlined">folder_zip</span>
                      {copy.downloadAll}
                    </button>
                  </div>
                </section>
              )}
            </div>

            <section className="flex flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
              <h3 className="text-lg font-bold tracking-tight text-slate-900">{copy.settings}</h3>

              {!fixedMode && <div className="mt-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
                {([
                  ['percent', copy.percent],
                  ['longest', copy.longest],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`rounded-md px-3 py-2 text-sm font-bold transition-colors ${
                      mode === value ? 'bg-[#3525cd] text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>}

              {mode === 'percent' ? (
                <div className="mt-5">
                  <label className="text-sm font-bold text-slate-600" htmlFor="resize-percent">{copy.scale}</label>
                  <div className="mt-2 flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3">
                    <input
                      id="resize-percent"
                      type="number"
                      min="1"
                      max="500"
                      value={percent}
                      onChange={(event) => setPercent(Math.max(1, Number(event.target.value) || 1))}
                      className="h-12 w-full bg-transparent text-lg font-bold text-slate-900 outline-none"
                    />
                    <span className="text-sm font-bold text-slate-400">%</span>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {[25, 50, 75, 200].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPercent(value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-bold text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
                      >
                        {value}%
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-5">
                  <label className="text-sm font-bold text-slate-600" htmlFor="resize-longest">{copy.longestSide}</label>
                  <div className="mt-2 flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3">
                    <input
                      id="resize-longest"
                      type="number"
                      min="1"
                      value={longest || ''}
                      onChange={(event) => setLongest(event.target.value ? Math.max(1, Number(event.target.value)) : 0)}
                      className="h-12 w-full bg-transparent text-lg font-bold text-slate-900 outline-none"
                    />
                    <span className="text-sm font-bold text-slate-400">px</span>
                  </div>
                  <p className="mt-3 text-xs font-medium leading-5 text-slate-500">{copy.longestHelp}</p>
                </div>
              )}

              <p className="mt-8 text-sm font-medium leading-6 text-slate-500">{summary}</p>
              <button
                type="button"
                onClick={handleStart}
                disabled={!hasProcessable || isProcessing}
                className={`mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold shadow-md transition-all ${
                  hasProcessable && !isProcessing
                    ? 'cursor-pointer bg-[#3525cd] text-white hover:bg-[#24189d]'
                    : 'cursor-not-allowed bg-slate-200 text-slate-400'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">photo_size_select_large</span>
                {copy.start}
              </button>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
