import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyPalette, GIFEncoder, quantize, type GifPalette } from 'gifenc';
import DropZone from '../components/ui/DropZone';
import { useLocaleSection } from '../localization';

const MAX_FILES = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

type FitMode = 'cover' | 'contain';
type BackgroundMode = 'transparent' | 'white' | 'black';

type ImageEntry = {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
};

type Result = {
  url: string;
  blob: Blob;
  frames: number;
};
type PageLocaleCopy = {
  title: string;
  subtitle: string;
  dropTitle: string;
  dropHint: string;
  preview: string;
  settings: string;
  width: string;
  height: string;
  delay: string;
  fit: string;
  cover: string;
  contain: string;
  colors: string;
  start: string;
  download: string;
  reset: string;
  source: string;
  output: string;
  frames: string;
  pending: string;
  errors: { oversize: string; unsupported: string; load: string; missing: string; process: string };
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fitRect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number, fit: FitMode) {
  const scale = fit === 'cover'
    ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

async function loadImage(file: File): Promise<ImageEntry> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      id: makeId(),
      file,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function createGif(
  entries: ImageEntry[],
  width: number,
  height: number,
  delay: number,
  colors: number,
  fit: FitMode,
  repeat: number,
  background: BackgroundMode,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas');

  const gif = GIFEncoder({ initialCapacity: Math.max(4096, width * height * entries.length) });
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const image = new Image();
    image.src = entry.url;
    await image.decode();
    const rect = fitRect(entry.width, entry.height, width, height, fit);

    ctx.clearRect(0, 0, width, height);
    if (fit === 'contain' && background !== 'transparent') {
      ctx.fillStyle = background === 'white' ? '#ffffff' : '#000000';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);

    const data = ctx.getImageData(0, 0, width, height).data;
    const palette = quantize(data, colors, { format: 'rgba4444', oneBitAlpha: true }) as GifPalette;
    const transparentIndex = palette.findIndex((color) => color.length === 4 && color[3]! < 128);
    gif.writeFrame(applyPalette(data, palette, 'rgba4444'), width, height, {
      palette,
      delay,
      repeat: index === 0 ? repeat : undefined,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
    });
  }
  gif.finish();

  const bytes = gif.bytes();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'image/gif' });
}

export default function ImagesToGifPage() {
  const copy = useLocaleSection<PageLocaleCopy>('images-to-gif');
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [width, setWidth] = useState(400);
  const [height, setHeight] = useState(400);
  const [isCustomSize, setIsCustomSize] = useState(false);
  const [delay, setDelay] = useState(500);
  const [fit, setFit] = useState<FitMode>('cover');
  const [colors, setColors] = useState(128);
  const [repeat, setRepeat] = useState(0);
  const [repeatCount, setRepeatCount] = useState(3);
  const [background, setBackground] = useState<BackgroundMode>('transparent');
  const [result, setResult] = useState<Result | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [previewAreaWidth, setPreviewAreaWidth] = useState(312);
  const entriesRef = useRef<ImageEntry[]>([]);
  const resultUrlRef = useRef('');
  const draggedIndexRef = useRef<number | null>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const delayPosition = delay <= 500
    ? ((delay - 25) / 475) * 50
    : 50 + ((delay - 500) / 2500) * 50;
  const changeDelayPosition = (position: number) => {
    const value = position <= 50
      ? 25 + (position / 50) * 475
      : 500 + ((position - 50) / 50) * 2500;
    setDelay(Math.round(value / 5) * 5);
  };

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    return () => {
      entriesRef.current.forEach((entry) => URL.revokeObjectURL(entry.url));
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const element = previewAreaRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPreviewAreaWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    setError('');
    setResult(null);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = '';

    const incoming = files.slice(0, MAX_FILES - entries.length);
    if (incoming.some((file) => file.size > MAX_FILE_SIZE)) {
      setError(copy.errors.oversize);
      return;
    }
    if (incoming.some((file) => !ACCEPTED_TYPES.includes(file.type))) {
      setError(copy.errors.unsupported);
      return;
    }

    try {
      const loaded = await Promise.all(incoming.map(loadImage));
      setEntries((current) => [...current, ...loaded]);
    } catch {
      setError(copy.errors.load);
    }
  }, [copy.errors.load, copy.errors.oversize, copy.errors.unsupported, entries.length]);

  const removeEntry = (id: string) => {
    setEntries((current) => {
      const removed = current.find((entry) => entry.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((entry) => entry.id !== id);
    });
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    setEntries((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const dropEntry = (targetIndex: number) => {
    const sourceIndex = draggedIndexRef.current;
    if (sourceIndex === null || sourceIndex === targetIndex) return;
    setEntries((current) => {
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      if (moved) next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const handleStart = async () => {
    if (entries.length < 2) {
      setError(copy.errors.missing);
      return;
    }
    setIsProcessing(true);
    setError('');
    setResult(null);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);

    try {
      const blob = await createGif(entries, width, height, delay, colors, fit, repeat ? repeatCount : 0, background);
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      setResult({ url, blob, frames: entries.length });
    } catch {
      setError(copy.errors.process);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = 'BEST4IMG-animation.gif';
    link.click();
  };

  const summary = useMemo(() => {
    if (!entries.length) return '';
    return `${result?.frames ?? entries.length} ${copy.frames} · ${width}×${height}${result ? ` · ${formatSize(result.blob.size)}` : ''}`;
  }, [copy.frames, entries.length, height, result, width]);
  const labels = useLocaleSection<{ upload: string; presets: string; custom: string; loop: string; infinite: string; times: string; quality: string; high: string; standard: string; compact: string; background: string; transparent: string; white: string; black: string; colorSuffix: string; moveUp: string; moveDown: string; delete: string }>('images-to-gif.ui');
  const previewInnerWidth = Math.max(1, previewAreaWidth - 32);
  const previewAreaHeight = Math.min(500, Math.max(previewAreaWidth, previewInnerWidth * height / width + 32));
  const previewScale = Math.min(1, previewInnerWidth / width, (previewAreaHeight - 32) / height);
  const previewWidth = Math.max(1, Math.round(width * previewScale));
  const previewHeight = Math.max(1, Math.round(height * previewScale));

  return (
    <main className="bg-[#f9fafc]">
      <section className="relative min-h-[500px] pt-7 pb-14">
        <div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold tracking-tighter text-slate-900 md:text-3xl">{copy.title}</h2>
            <p className="mt-2 text-base font-medium text-slate-500">{copy.subtitle}</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <section className="min-w-0 rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
              <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="min-w-0">
                  <p className="mb-3 text-lg font-bold tracking-tight text-slate-900">{labels.upload}</p>
                  {entries.length ? (
                    <>
                      <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                        {entries.map((entry, index) => (
                          <div
                            key={entry.id}
                            draggable
                            onDragStart={(event) => {
                              draggedIndexRef.current = index;
                              event.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              setDragOverIndex(index);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              dropEntry(index);
                              setDragOverIndex(null);
                            }}
                            onDragEnd={() => {
                              draggedIndexRef.current = null;
                              setDragOverIndex(null);
                            }}
                            className={`flex cursor-grab items-center gap-2 rounded-lg border bg-slate-50 p-2 active:cursor-grabbing ${dragOverIndex === index ? 'border-[#3525cd] bg-indigo-50' : 'border-slate-200'}`}
                          >
                            <span className="material-symbols-outlined text-[18px] text-slate-300">drag_indicator</span>
                            <span className="w-5 text-center text-xs font-bold text-slate-400">{index + 1}</span>
                            <img src={entry.url} alt="" className="h-12 w-12 rounded-md object-cover" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-slate-900" title={entry.file.name}>{entry.file.name}</p>
                              <p className="text-xs font-medium text-slate-400">{entry.width}×{entry.height}</p>
                            </div>
                            <button type="button" aria-label={labels.moveUp} className="material-symbols-outlined text-[18px] text-slate-400 hover:text-slate-700" onClick={() => moveEntry(index, -1)}>arrow_upward</button>
                            <button type="button" aria-label={labels.moveDown} className="material-symbols-outlined text-[18px] text-slate-400 hover:text-slate-700" onClick={() => moveEntry(index, 1)}>arrow_downward</button>
                            <button type="button" aria-label={labels.delete} className="material-symbols-outlined text-[18px] text-slate-400 hover:text-red-500" onClick={() => removeEntry(entry.id)}>delete</button>
                          </div>
                        ))}
                      </div>
                      <label className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-sm font-bold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600">
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        {copy.reset}
                        <input
                          type="file"
                          multiple
                          accept="image/jpeg,image/png,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={(event) => {
                            addFiles(Array.from(event.target.files ?? []));
                            event.target.value = '';
                          }}
                        />
                      </label>
                    </>
                  ) : (
                    <DropZone
                      onFilesSelect={addFiles}
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      maxFiles={MAX_FILES}
                      maxFileSize={MAX_FILE_SIZE}
                      isEasy={true}
                      copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }}
                    />
                  )}
                </div>

                <div className="min-w-0 border-t border-slate-200 pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-6">
                  <h3 className="text-lg font-bold tracking-tight text-slate-900">{copy.settings}</h3>

                  <p className="mt-5 text-sm font-bold text-slate-600">{labels.presets}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {([[400, 400], [480, 270], [720, 720]] as const).map(([presetWidth, presetHeight]) => (
                      <button
                        key={`${presetWidth}-${presetHeight}`}
                        type="button"
                        onClick={() => { setWidth(presetWidth); setHeight(presetHeight); setIsCustomSize(false); }}
                        className={`h-10 rounded-lg border px-2 text-xs font-bold transition-colors ${!isCustomSize && width === presetWidth && height === presetHeight ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'}`}
                      >
                        {presetWidth}×{presetHeight}
                      </button>
                    ))}
                    <button type="button" onClick={() => setIsCustomSize((current) => !current)} className={`h-10 rounded-lg border px-2 text-xs font-bold ${isCustomSize ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'}`}>
                      {labels.custom}
                    </button>
                  </div>

                  {isCustomSize && <div className="mt-4 grid grid-cols-2 gap-3">
                    <label>
                      <span className="text-sm font-bold text-slate-600">{copy.width}</span>
                      <input type="number" min={1} max={4000} value={width} onChange={(event) => setWidth(clamp(Number(event.target.value) || 1, 1, 4000))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none" />
                    </label>
                    <label>
                      <span className="text-sm font-bold text-slate-600">{copy.height}</span>
                      <input type="number" min={1} max={4000} value={height} onChange={(event) => setHeight(clamp(Number(event.target.value) || 1, 1, 4000))} className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none" />
                    </label>
                  </div>}

                  <div className="mt-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-slate-600">{copy.delay}</span>
                      <div className="flex h-9 w-28 items-center rounded-lg border border-slate-200 bg-white px-3">
                        <input type="number" min={25} max={3000} step={5} value={delay} onChange={(event) => setDelay(clamp(Number(event.target.value) || 25, 25, 3000))} className="min-w-0 flex-1 bg-transparent text-right text-sm font-bold text-slate-700 outline-none" />
                        <span className="ml-1 text-xs font-bold text-slate-400">ms</span>
                      </div>
                    </div>
                    <input type="range" min={0} max={100} step={1} value={delayPosition} onChange={(event) => changeDelayPosition(Number(event.target.value))} className="mt-3 w-full accent-[#3525cd]" />
                    <div className="mt-1 flex justify-between text-[11px] font-medium text-slate-400"><span>25ms</span><span>500ms</span><span>3000ms</span></div>
                  </div>

                  <p className="mt-5 text-sm font-bold text-slate-600">{labels.loop}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => setRepeat(0)} className={`h-10 rounded-lg border px-2 text-xs font-bold ${repeat === 0 ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500'}`}>{labels.infinite}</button>
                    <button type="button" onClick={() => setRepeat(1)} className={`h-10 rounded-lg border px-2 text-xs font-bold ${repeat === 1 ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500'}`}>{labels.times}</button>
                  </div>
                  {repeat === 1 && <input type="number" min={1} max={100} value={repeatCount} onChange={(event) => setRepeatCount(clamp(Number(event.target.value) || 1, 1, 100))} className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none" />}

                  <p className="mt-5 text-sm font-bold text-slate-600">{labels.quality}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {([256, 128, 64] as const).map((value) => (
                      <button key={value} type="button" onClick={() => setColors(value)} className={`h-10 rounded-lg border px-1 text-xs font-bold ${colors === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500'}`}>{value}{labels.colorSuffix}</button>
                    ))}
                  </div>

                  <p className="mt-5 text-sm font-bold text-slate-600">{copy.fit}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(['cover', 'contain'] as const).map((value) => (
                      <button key={value} type="button" onClick={() => setFit(value)} className={`h-10 rounded-lg border px-2 text-xs font-bold ${fit === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500'}`}>{value === 'cover' ? copy.cover : copy.contain}</button>
                    ))}
                  </div>

                  {fit === 'contain' && (
                    <>
                      <p className="mt-5 text-sm font-bold text-slate-600">{labels.background}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {(['transparent', 'white', 'black'] as const).map((value) => (
                          <button key={value} type="button" onClick={() => setBackground(value)} className={`h-10 rounded-lg border px-1 text-xs font-bold ${background === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500'}`}>{labels[value]}</button>
                        ))}
                      </div>
                    </>
                  )}

                {error && <div className="mt-5 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-500">{error}</div>}

                <button
                  type="button"
                  onClick={handleStart}
                  disabled={entries.length < 2 || isProcessing}
                  className={`mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold shadow-md transition-all ${entries.length >= 2 && !isProcessing ? 'cursor-pointer bg-[#3525cd] text-white hover:bg-[#24189d]' : 'cursor-not-allowed bg-slate-200 text-slate-400'}`}
                >
                  <span className="material-symbols-outlined text-[20px]">burst_mode</span>
                  {isProcessing ? `${copy.start}...` : copy.start}
                </button>
                </div>
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
              <div className="mb-3 flex items-center gap-2">
                <p className="text-lg font-bold tracking-tight text-slate-900">{copy.preview}</p>
                <span className="text-sm font-bold text-slate-500">{width}×{height}</span>
              </div>
              <div
                ref={previewAreaRef}
                className="flex w-full items-center justify-center overflow-hidden rounded-lg bg-slate-100 p-4 transition-[height] duration-150"
                style={{ height: previewAreaHeight }}
              >
                <div
                  className="bg-checkerboard relative shrink-0 overflow-hidden border-2 border-slate-300 transition-[width,height] duration-150"
                  style={{ width: previewWidth, height: previewHeight }}
                >
                  {result ? (
                    <img src={result.url} alt="" className="absolute inset-0 h-full w-full object-contain" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center px-5 text-center text-sm font-bold text-slate-400">{copy.pending}</div>
                  )}
                </div>
              </div>

              {summary && <p className="mt-4 text-sm font-medium leading-6 text-slate-500">{summary}</p>}
              <button
                type="button"
                onClick={handleDownload}
                disabled={!result}
                className={`mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold shadow-md transition-all ${result ? 'cursor-pointer bg-white text-[#3525cd] ring-1 ring-indigo-100 hover:bg-indigo-50' : 'cursor-not-allowed bg-white text-slate-300 ring-1 ring-slate-200'}`}
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
