import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import JSZip from 'jszip';
import DropZone from '../components/ui/DropZone';
import BaseFileRow from '../components/ui/BaseFileRow';
import type { Locale, PageCopy, SupportedLocale } from '../i18n';
import { formatLocale, useLocaleSection } from '../localization';

const MAX_FILES = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Status = 'waiting' | 'processing' | 'completed' | 'error';
type WatermarkType = 'text' | 'image';
type Position = 'tl' | 'tc' | 'tr' | 'cl' | 'cc' | 'cr' | 'bl' | 'bc' | 'br';
type Placement = 'position' | 'tile';

type WatermarkEntry = {
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
  text: string;
  image: string;
  watermarkText: string;
  chooseMark: string;
  size: string;
  opacity: string;
  color: string;
  position: string;
  start: string;
  downloadAll: string;
  waiting: string;
  processing: string;
  completed: string;
  download: string;
  empty: string;
  preview: string;
  addMore: string;
  errors: {
    oversize: string;
    unsupported: string;
    read: string;
    process: string;
    noWatermark: string;
  };
};

let idCounter = 0;

function nextId() {
  idCounter += 1;
  return `watermark-${idCounter}-${Date.now()}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function outputName(name: string, mime: string) {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return `${name.replace(/\.[^.]+$/, '')}-watermarked.${ext}`;
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

function getPosition(position: Position, width: number, height: number, markWidth: number, markHeight: number) {
  const margin = Math.max(16, Math.round(Math.min(width, height) * 0.04));
  const left = position.endsWith('l') ? margin : position.endsWith('r') ? width - markWidth - margin : (width - markWidth) / 2;
  const top = position.startsWith('t') ? margin : position.startsWith('b') ? height - markHeight - margin : (height - markHeight) / 2;
  return { left, top };
}

async function loadWatermarkBitmap(file: File | null) {
  return file ? createImageBitmap(file) : null;
}

function drawWatermark(
  ctx: CanvasRenderingContext2D,
  type: WatermarkType,
  text: string,
  watermarkImage: ImageBitmap | HTMLImageElement | null,
  color: string,
  size: number,
  opacity: number,
  position: Position,
  placement: Placement,
  tileGap: number,
  tileAngle: number,
) {
  const { width, height } = ctx.canvas;

  ctx.save();
  ctx.globalAlpha = opacity / 100;

  if (type === 'text' && text) {
    const fontSize = Math.max(14, Math.round(width * (size / 200)));
    ctx.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
    const metrics = ctx.measureText(text);
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = Math.max(2, fontSize * 0.08);
    if (placement === 'tile') {
      const gap = Math.max(12, Math.round(Math.min(width, height) * (tileGap / 100)));
      const diagonal = Math.hypot(width, height);
      ctx.translate(width / 2, height / 2);
      ctx.rotate(tileAngle * Math.PI / 180);
      for (let top = -diagonal; top <= diagonal; top += fontSize + gap) {
        for (let left = -diagonal; left <= diagonal; left += metrics.width + gap) {
          ctx.fillText(text, left, top + fontSize);
        }
      }
    } else {
      const { left, top } = getPosition(position, width, height, metrics.width, fontSize);
      ctx.fillText(text, left, top + fontSize);
    }
  } else if (type === 'image' && watermarkImage) {
    const sourceWidth = 'naturalWidth' in watermarkImage ? watermarkImage.naturalWidth : watermarkImage.width;
    const sourceHeight = 'naturalHeight' in watermarkImage ? watermarkImage.naturalHeight : watermarkImage.height;
    const markWidth = Math.round(width * (size / 100));
    const markHeight = Math.round(markWidth * (Number(sourceHeight) / Number(sourceWidth)));
    if (placement === 'tile') {
      const gap = Math.max(12, Math.round(Math.min(width, height) * (tileGap / 100)));
      const diagonal = Math.hypot(width, height);
      ctx.translate(width / 2, height / 2);
      ctx.rotate(tileAngle * Math.PI / 180);
      for (let top = -diagonal; top <= diagonal; top += markHeight + gap) {
        for (let left = -diagonal; left <= diagonal; left += markWidth + gap) {
          ctx.drawImage(watermarkImage, left, top, markWidth, markHeight);
        }
      }
    } else {
      const { left, top } = getPosition(position, width, height, markWidth, markHeight);
      ctx.drawImage(watermarkImage, left, top, markWidth, markHeight);
    }
  }

  ctx.restore();
}

async function addWatermark(
  entry: WatermarkEntry,
  type: WatermarkType,
  text: string,
  watermarkFile: File | null,
  color: string,
  size: number,
  opacity: number,
  position: Position,
  placement: Placement,
  tileGap: number,
  tileAngle: number,
) {
  const bitmap = await createImageBitmap(entry.file);
  const watermarkBitmap = await loadWatermarkBitmap(watermarkFile);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    bitmap.close();
    watermarkBitmap?.close();
    throw new Error('Canvas is not available');
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  drawWatermark(ctx, type, text, watermarkBitmap, color, size, opacity, position, placement, tileGap, tileAngle);
  watermarkBitmap?.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, entry.file.type, 0.92));
  if (!blob) throw new Error('Unable to export image');

  return {
    blob,
    buffer: await blobToArray(blob),
    name: outputName(entry.name, entry.file.type),
  };
}

export default function WatermarkPage() {
  const { locale, routeLocale } = useOutletContext<{ copy: PageCopy; locale: Locale; routeLocale: SupportedLocale }>();
  const copy = useLocaleSection<PageLocaleCopy>('watermark');
  const placementCopy = useLocaleSection<{ summary: string; layout: string; position: string; tile: string; gap: string; angle: string }>('watermark.ui');
  const [type, setType] = useState<WatermarkType>('text');
  const [text, setText] = useState('');
  const [watermarkFile, setWatermarkFile] = useState<File | null>(null);
  const [watermarkUrl, setWatermarkUrl] = useState('');
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(12);
  const [opacity, setOpacity] = useState(70);
  const [position, setPosition] = useState<Position>('br');
  const [placement, setPlacement] = useState<Placement>('position');
  const [tileGap, setTileGap] = useState(12);
  const [tileAngle, setTileAngle] = useState(-30);
  const [files, setFiles] = useState<WatermarkEntry[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [formError, setFormError] = useState('');
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const urlsRef = useRef<Set<string>>(new Set());
  const watermarkUrlRef = useRef('');

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      if (watermarkUrlRef.current) URL.revokeObjectURL(watermarkUrlRef.current);
      urlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setFiles((current) => current.map((item) => {
      if (item.status !== 'completed') return item;
      if (item.outputUrl) {
        URL.revokeObjectURL(item.outputUrl);
        urlsRef.current.delete(item.outputUrl);
      }
      return {
        ...item,
        status: 'waiting',
        outputUrl: undefined,
        outputBuffer: undefined,
        outputName: undefined,
        outputSize: undefined,
      };
    }));
  }, [color, opacity, placement, position, size, text, tileAngle, tileGap, type, watermarkFile]);

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const next = incoming.slice(0, Math.max(0, MAX_FILES - prev.length)).map((file): WatermarkEntry => {
        const hasError = file.size > MAX_FILE_SIZE || !ACCEPTED_TYPES.includes(file.type);
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
            : !ACCEPTED_TYPES.includes(file.type)
              ? copy.errors.unsupported
              : undefined,
        };
      });

      next.forEach((entry) => {
        if (entry.status === 'error') return;
        readImageSize(entry.file)
          .then((imageSize) => {
            setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, ...imageSize } : item));
          })
          .catch(() => {
            setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'error', error: copy.errors.read } : item));
          });
      });

      const nextFiles = [...prev, ...next];
      if (!selectedId) {
        const firstReady = nextFiles.find((file) => file.status !== 'error');
        if (firstReady) setSelectedId(firstReady.id);
      }
      return nextFiles;
    });
  }, [copy.errors.oversize, copy.errors.read, copy.errors.unsupported, selectedId]);

  const handleWatermarkFile = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFormError(copy.errors.unsupported);
      return;
    }
    if (watermarkUrlRef.current) URL.revokeObjectURL(watermarkUrlRef.current);
    const url = URL.createObjectURL(file);
    watermarkUrlRef.current = url;
    setWatermarkFile(file);
    setWatermarkUrl(url);
    setFormError('');
  }, [copy.errors.unsupported]);

  const handleStart = useCallback(async () => {
    const watermarkText = text.trim() || 'BEST4IMG';
    if (type === 'image' && !watermarkFile) {
      setFormError(copy.errors.noWatermark);
      return;
    }
    setFormError('');

    for (const entry of files) {
      if (entry.status === 'error') continue;

      setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'processing' } : item));

      try {
        const result = await addWatermark(entry, type, watermarkText, watermarkFile, color, size, opacity, position, placement, tileGap, tileAngle);
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
  }, [color, copy.errors.noWatermark, copy.errors.process, files, opacity, placement, position, size, text, tileAngle, tileGap, type, watermarkFile]);

  const handleDownload = useCallback((entry: WatermarkEntry) => {
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
    a.download = 'BEST4IMG-watermarked.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files]);

  const hasProcessable = files.some((file) => file.status !== 'error');
  const hasCompleted = files.some((file) => file.status === 'completed');
  const isProcessing = files.some((file) => file.status === 'processing');
  const selectedEntry = useMemo(
    () => files.find((file) => file.id === selectedId) ?? files.find((file) => file.status !== 'error'),
    [files, selectedId]
  );

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !selectedEntry?.width || !selectedEntry.height) return;

    let cancelled = false;
    const drawPreview = async () => {
      const image = new Image();
      image.src = selectedEntry.url;
      await image.decode();
      if (cancelled) return;

      let watermarkImage: HTMLImageElement | null = null;
      if (type === 'image' && watermarkUrl) {
        watermarkImage = new Image();
        watermarkImage.src = watermarkUrl;
        await watermarkImage.decode();
        if (cancelled) return;
      }

      const scale = Math.min(1, 720 / selectedEntry.width!, 416 / selectedEntry.height!);
      canvas.width = Math.max(1, Math.round(selectedEntry.width! * scale));
      canvas.height = Math.max(1, Math.round(selectedEntry.height! * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      drawWatermark(ctx, type, text.trim() || 'BEST4IMG', watermarkImage, color, size, opacity, position, placement, tileGap, tileAngle);
    };

    drawPreview().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [color, opacity, placement, position, selectedEntry, size, text, tileAngle, tileGap, type, watermarkUrl]);

  const summary = useMemo(() => {
    const ready = files.filter((file) => file.status !== 'error').length;
    if (!ready) return copy.empty;
    return formatLocale(placementCopy.summary, { count: ready });
  }, [copy.empty, files, placementCopy.summary]);

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
              {selectedEntry ? (
                <section className="flex min-h-[24rem] flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-500">{copy.preview}</p>
                    <h3 className="truncate text-lg font-bold tracking-tight text-slate-900" title={selectedEntry.name}>{selectedEntry.name}</h3>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:text-slate-900">
                    <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                    {copy.addMore}
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        addFiles(event.target.files ? Array.from(event.target.files) : []);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>

                <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-6">
                  <canvas
                    ref={previewCanvasRef}
                    className="max-h-[26rem] max-w-full rounded-lg object-contain shadow-sm"
                    aria-label={selectedEntry.name}
                  />
                </div>
                </section>
              ) : (
                <DropZone
                  onFilesSelect={addFiles}
                  accept="image/jpeg,image/png,image/webp"
                  maxFiles={MAX_FILES}
                  maxFileSize={MAX_FILE_SIZE}
                  isEasy={true}
                  copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }}
                />
              )}

              {files.length > 0 && (
                <section className="w-full">
                  <div className="space-y-3.5">
                    {files.map((entry) => {
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
                          <button
                            type="button"
                            onClick={() => setSelectedId(entry.id)}
                            className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left ${selectedEntry?.id === entry.id ? 'ring-2 ring-indigo-200' : ''}`}
                          >
                            <img src={entry.url} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900" title={entry.name}>{entry.name}</p>
                              <p className={`text-xs font-medium ${isError ? 'text-red-400' : 'text-slate-400'}`}>
                                {isError ? entry.error : entry.width && entry.height ? `${entry.width}×${entry.height}` : copy.waiting}
                              </p>
                            </div>
                          </button>

                          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 sm:justify-end">
                            {isCompleted && entry.outputSize && (
                              <span className="w-[112px] text-left text-sm font-medium text-slate-600">{copy.completed} · {formatSize(entry.outputSize)}</span>
                            )}
                            {isProcessingRow && <span className="w-[112px] text-left text-sm font-medium text-blue-700">{copy.processing}</span>}
                            {entry.status === 'waiting' && <span className="w-[112px] text-left text-sm font-medium text-slate-400">{copy.waiting}</span>}
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

              <div className="mt-5 grid grid-cols-2 gap-2">
                {(['text', 'image'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setType(value)}
                    className={`rounded-lg border px-3 py-3 text-sm font-bold transition-colors ${
                      type === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {value === 'text' ? copy.text : copy.image}
                  </button>
                ))}
              </div>

              {type === 'text' ? (
                <label className="mt-5 block">
                  <span className="text-sm font-bold text-slate-600">{copy.watermarkText}</span>
                  <input
                    type="text"
                    value={text}
                    placeholder="BEST4IMG"
                    onChange={(event) => setText(event.target.value)}
                    className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </label>
              ) : (
                <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm font-bold text-slate-600 transition-colors hover:text-slate-900">
                  <span className="material-symbols-outlined text-[20px]">image</span>
                  {copy.chooseMark}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      handleWatermarkFile(event.target.files?.[0]);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
              )}

              <div className="mt-5 grid grid-cols-[1fr_auto] items-center gap-3">
                <label className="text-sm font-bold text-slate-600">{copy.size}</label>
                <span className="text-sm font-bold text-slate-400">{size}%</span>
                <input type="range" min={4} max={40} value={size} onChange={(event) => setSize(Number(event.target.value))} className="col-span-2 accent-[#3525cd]" />
              </div>

              <div className="mt-5 grid grid-cols-[1fr_auto] items-center gap-3">
                <label className="text-sm font-bold text-slate-600">{copy.opacity}</label>
                <span className="text-sm font-bold text-slate-400">{opacity}%</span>
                <input type="range" min={10} max={100} value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} className="col-span-2 accent-[#3525cd]" />
              </div>

              {type === 'text' && (
                <label className="mt-5 flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-600">{copy.color}</span>
                  <input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-9 w-14 cursor-pointer rounded border border-slate-200 bg-white" />
                </label>
              )}

              <p className="mt-5 text-sm font-bold text-slate-600">{placementCopy.layout}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['position', 'tile'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPlacement(value)}
                    className={`rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${placement === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'}`}
                  >
                    {value === 'position' ? placementCopy.position : placementCopy.tile}
                  </button>
                ))}
              </div>

              {placement === 'position' ? (
                <div className="mt-4 grid w-24 grid-cols-3 gap-1">
                  {(['tl', 'tc', 'tr', 'cl', 'cc', 'cr', 'bl', 'bc', 'br'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPosition(value)}
                      aria-label={`${copy.position} ${value}`}
                      className={`h-7 rounded border transition-colors ${position === value ? 'border-[#3525cd] bg-[#3525cd]' : 'border-slate-200 bg-white hover:border-indigo-200'}`}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <label className="text-sm font-bold text-slate-600">{placementCopy.gap}</label>
                    <span className="text-sm font-bold text-slate-400">{tileGap}%</span>
                    <input type="range" min={4} max={40} value={tileGap} onChange={(event) => setTileGap(Number(event.target.value))} className="col-span-2 accent-[#3525cd]" />
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <label className="text-sm font-bold text-slate-600">{placementCopy.angle}</label>
                    <span className="text-sm font-bold text-slate-400">{tileAngle}°</span>
                    <input type="range" min={-60} max={60} step={5} value={tileAngle} onChange={(event) => setTileAngle(Number(event.target.value))} className="col-span-2 accent-[#3525cd]" />
                  </div>
                </div>
              )}

              <p className="mt-8 text-sm font-medium leading-6 text-slate-500">{summary}</p>
              {formError && <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-500">{formError}</p>}
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
                <span className="material-symbols-outlined text-[20px]">branding_watermark</span>
                {copy.start}
              </button>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
