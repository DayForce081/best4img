import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import JSZip from 'jszip';
import DropZone from '../components/ui/DropZone';
import BaseFileRow from '../components/ui/BaseFileRow';
import type { Locale, PageCopy } from '../i18n';
import { formatLocale, useLocaleSection } from '../localization';

const MAX_FILES = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Status = 'waiting' | 'processing' | 'completed' | 'error';
type Rotation = 0 | 90 | 180 | 270;

type RotateEntry = {
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
  rotate: string;
  flip: string;
  left: string;
  right: string;
  reset: string;
  horizontal: string;
  vertical: string;
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
  return `rotate-${idCounter}-${Date.now()}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function outputName(name: string, mime: string) {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return `${name.replace(/\.[^.]+$/, '')}-rotated.${ext}`;
}

function blobToArray(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function normalizeRotation(value: number): Rotation {
  return (((value % 360) + 360) % 360) as Rotation;
}

async function readImageSize(file: File) {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

async function rotateImage(entry: RotateEntry, rotation: Rotation, flipX: boolean, flipY: boolean) {
  const bitmap = await createImageBitmap(entry.file);
  const swapsSides = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swapsSides ? bitmap.height : bitmap.width;
  canvas.height = swapsSides ? bitmap.width : bitmap.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas is not available');
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, entry.file.type, 0.92));
  if (!blob) throw new Error('Unable to export image');

  return {
    blob,
    buffer: await blobToArray(blob),
    name: outputName(entry.name, entry.file.type),
  };
}

export default function RotatePage() {
  const { locale } = useOutletContext<{ copy: PageCopy; locale: Locale }>();
  const copy = useLocaleSection<PageLocaleCopy>('rotate');
  const previewCopy = useLocaleSection<{ preview: string; add: string; empty: string; summary: string }>('rotate.ui');
  const [previewRotation, setPreviewRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [files, setFiles] = useState<RotateEntry[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const urlsRef = useRef<Set<string>>(new Set());
  const rotation = normalizeRotation(previewRotation);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
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
  }, [flipX, flipY, rotation]);

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const next = incoming.slice(0, Math.max(0, MAX_FILES - prev.length)).map((file): RotateEntry => {
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
          .then((size) => {
            setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, ...size } : item));
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

  const handleStart = useCallback(async () => {
    for (const entry of files) {
      if (entry.status === 'error') continue;

      setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'processing' } : item));

      try {
        const result = await rotateImage(entry, rotation, flipX, flipY);
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
  }, [copy.errors.process, files, flipX, flipY, rotation]);

  const handleDownload = useCallback((entry: RotateEntry) => {
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
    a.download = 'BEST4IMG-rotated.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files]);

  const resetTransforms = () => {
    setPreviewRotation(0);
    setFlipX(false);
    setFlipY(false);
  };

  const hasProcessable = files.some((file) => file.status !== 'error');
  const hasCompleted = files.some((file) => file.status === 'completed');
  const isProcessing = files.some((file) => file.status === 'processing');
  const selectedEntry = useMemo(
    () => files.find((file) => file.id === selectedId) ?? files.find((file) => file.status !== 'error'),
    [files, selectedId]
  );
  const summary = useMemo(() => {
    const ready = files.filter((file) => file.status !== 'error').length;
    if (!ready) return copy.empty;
    return formatLocale(previewCopy.summary, { count: ready });
  }, [copy.empty, files, previewCopy.summary]);

  return (
    <main className="bg-[#f9fafc]">
      <section className="relative min-h-[500px] pt-7 pb-14">
        <div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold tracking-tighter text-slate-900 md:text-3xl">
              {copy.title}
            </h2>
            <p className="mt-2 text-base font-medium text-slate-500">
              {copy.subtitle}
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
            <div className="flex flex-col gap-5">
              {selectedEntry ? (
                <section className="flex min-h-[24rem] flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-500">{previewCopy.preview}</p>
                    <h3 className="truncate text-lg font-bold tracking-tight text-slate-900" title={selectedEntry.name}>
                      {selectedEntry.name}
                    </h3>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:text-slate-900">
                    <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                    {previewCopy.add}
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
                  <img
                    src={selectedEntry.url}
                    alt=""
                    className="max-h-[26rem] max-w-full object-contain shadow-sm transition-transform duration-200"
                    style={{
                      transform: `rotate(${previewRotation}deg) scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
                    }}
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
                            className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left ${
                              selectedEntry?.id === entry.id ? 'ring-2 ring-indigo-200' : ''
                            }`}
                          >
                            <img src={entry.url} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900" title={entry.name}>{entry.name}</p>
                              <p className={`text-xs font-medium ${isError ? 'text-red-400' : 'text-slate-400'}`}>
                                {isError
                                  ? entry.error
                                  : entry.width && entry.height
                                    ? `${entry.width}×${entry.height} · ${rotation}°${flipX ? ' · H' : ''}${flipY ? ' · V' : ''}`
                                    : copy.waiting}
                              </p>
                            </div>
                          </button>

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

              <p className="mt-5 text-sm font-bold text-slate-600">{copy.rotate}</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewRotation((value) => value - 90)}
                  className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-600 transition-colors hover:text-slate-900"
                >
                  <span className="material-symbols-outlined text-[20px]">rotate_left</span>
                  {copy.left}
                </button>
                <div className="flex items-center justify-center rounded-lg border border-[#3525cd] bg-indigo-50 px-3 py-3 text-sm font-bold text-[#3525cd]">
                  {rotation}°
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewRotation((value) => value + 90)}
                  className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-600 transition-colors hover:text-slate-900"
                >
                  {copy.right}
                  <span className="material-symbols-outlined text-[20px]">rotate_right</span>
                </button>
              </div>

              <p className="mt-5 text-sm font-bold text-slate-600">{copy.flip}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFlipX((value) => !value)}
                  className={`rounded-lg border px-3 py-3 text-sm font-bold transition-colors ${
                    flipX ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {copy.horizontal}
                </button>
                <button
                  type="button"
                  onClick={() => setFlipY((value) => !value)}
                  className={`rounded-lg border px-3 py-3 text-sm font-bold transition-colors ${
                    flipY ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {copy.vertical}
                </button>
              </div>

              <button
                type="button"
                onClick={resetTransforms}
                className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900"
              >
                {copy.reset}
              </button>

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
                <span className="material-symbols-outlined text-[20px]">rotate_right</span>
                {copy.start}
              </button>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
