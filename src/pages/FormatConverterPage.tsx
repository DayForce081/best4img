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

type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp';
type Status = 'waiting' | 'processing' | 'completed' | 'error';

type ConvertEntry = {
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
  targetFormat: string;
  jpgHelp: string;
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
  return `convert-${idCounter}-${Date.now()}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function outputName(name: string, mime: OutputFormat) {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return `${name.replace(/\.[^.]+$/, '')}.${ext}`;
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

async function convertImage(entry: ConvertEntry, format: OutputFormat) {
  const bitmap = await createImageBitmap(entry.file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas is not available');
  }

  if (format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, 0.92));
  if (!blob) throw new Error('Unable to export image');

  return {
    blob,
    buffer: await blobToArray(blob),
    name: outputName(entry.name, format),
  };
}

export default function FormatConverterPage({ fixedFormat }: { fixedFormat?: 'image/jpeg' | 'image/png' }) {
  const { locale, routeLocale } = useOutletContext<{ copy: PageCopy; locale: Locale; routeLocale: SupportedLocale }>();
  const copy = useLocaleSection<PageLocaleCopy>('format-converter');
  const ui = useLocaleSection<{ summary: string; fixedTitle: string; fixedSubtitle: string }>('format-converter.ui');
  const [format, setFormat] = useState<OutputFormat>(fixedFormat ?? 'image/jpeg');
  const [files, setFiles] = useState<ConvertEntry[]>([]);
  const urlsRef = useRef<Set<string>>(new Set());
  const autoProcessingRef = useRef(false);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
    };
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const next = incoming.slice(0, Math.max(0, MAX_FILES - prev.length)).map((file): ConvertEntry => {
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

      return [...prev, ...next];
    });
  }, [copy.errors.oversize, copy.errors.read, copy.errors.unsupported]);

  const handleStart = useCallback(async () => {
    for (const entry of files) {
      if (entry.status === 'error' || entry.status === 'completed' || entry.status === 'processing') continue;

      setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'processing' } : item));

      try {
        const result = await convertImage(entry, format);
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
  }, [copy.errors.process, files, format]);

  useEffect(() => {
    if (!fixedFormat || autoProcessingRef.current || !files.some((entry) => entry.status === 'waiting')) return;
    autoProcessingRef.current = true;
    void handleStart().finally(() => {
      autoProcessingRef.current = false;
      setFiles((current) => current.some((entry) => entry.status === 'waiting') ? [...current] : current);
    });
  }, [files, fixedFormat, handleStart]);

  const handleDownload = useCallback((entry: ConvertEntry) => {
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
    a.download = 'BEST4IMG-converted.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files]);

  const hasProcessable = files.some((file) => file.status !== 'error');
  const hasCompleted = files.some((file) => file.status === 'completed');
  const isProcessing = files.some((file) => file.status === 'processing');
  const summary = useMemo(() => {
    const ready = files.filter((file) => file.status !== 'error').length;
    if (!ready) return copy.empty;
    const label = format === 'image/png' ? 'PNG' : format === 'image/webp' ? 'WebP' : 'JPG';
    return formatLocale(ui.summary, { count: ready, format: label });
  }, [copy.empty, files, format, ui.summary]);
  const fixedLabel = fixedFormat === 'image/png' ? 'PNG' : 'JPG';
  const pageTitle = fixedFormat ? formatLocale(ui.fixedTitle, { format: fixedLabel }) : copy.title;
  const pageSubtitle = fixedFormat ? formatLocale(ui.fixedSubtitle, { format: fixedLabel }) : copy.subtitle;

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

          <div className={fixedFormat ? '' : 'grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start'}>
            <div className="flex flex-col gap-5">
              <DropZone
                onFilesSelect={addFiles}
                accept="image/jpeg,image/png,image/webp"
                maxFiles={MAX_FILES}
                maxFileSize={MAX_FILE_SIZE}
                isEasy={true}
                copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }}
              />

              {files.length > 0 && (
                <section className="w-full">
                  <div className="space-y-3.5">
                    {files.map((entry) => {
                      const isError = entry.status === 'error';
                      const isProcessingRow = entry.status === 'processing';
                      const isCompleted = entry.status === 'completed';
                      const outputLabel = format === 'image/png' ? 'PNG' : format === 'image/webp' ? 'WebP' : 'JPG';

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
                                    ? `${entry.width}×${entry.height} → ${outputLabel}`
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

            {!fixedFormat && <section className="flex flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
              <h3 className="text-lg font-bold tracking-tight text-slate-900">{copy.settings}</h3>
              <p className="mt-5 text-sm font-bold text-slate-600">{copy.targetFormat}</p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {([
                  ['image/jpeg', 'JPG'],
                  ['image/png', 'PNG'],
                  ['image/webp', 'WebP'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFormat(value)}
                    className={`rounded-lg border px-3 py-3 text-sm font-bold transition-colors ${
                      format === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {format === 'image/jpeg' && (
                <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium leading-5 text-slate-500">
                  {copy.jpgHelp}
                </p>
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
                <span className="material-symbols-outlined text-[20px]">sync_alt</span>
                {copy.start}
              </button>
            </section>}
          </div>
        </div>
      </section>
    </main>
  );
}
