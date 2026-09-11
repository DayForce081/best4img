import { useState, useCallback, useEffect, useRef } from 'react';
import type { FileEntry, WorkerResponse } from '../../types';
import FileRow from './FileRow';
import DropZone from '../../components/ui/DropZone';
import JSZip from 'jszip';
import type { PageCopy } from '../../i18n';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 50;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
const SVG_TYPES = ['image/svg+xml'];

let idCounter = 0;
function nextId(): string {
  return `file-${++idCounter}-${Date.now()}`;
}

function getFileType(file: File) {
  return file.type || (/\.svg$/i.test(file.name) ? 'image/svg+xml' : '');
}

interface PseudoProgressProfile {
  preWorkerTarget: number;
  postWorkerTarget: number;
  tickMs: number;
}

function getPseudoProgressProfile(fileSize: number): PseudoProgressProfile {
  if (fileSize < 500 * 1024) {
    return { preWorkerTarget: 38, postWorkerTarget: 92, tickMs: 55 };
  }
  if (fileSize < 3 * 1024 * 1024) {
    return { preWorkerTarget: 32, postWorkerTarget: 88, tickMs: 80 };
  }
  if (fileSize < 8 * 1024 * 1024) {
    return { preWorkerTarget: 26, postWorkerTarget: 84, tickMs: 120 };
  }
  return { preWorkerTarget: 20, postWorkerTarget: 78, tickMs: 170 };
}

interface ImageCompressorProps {
  variant?: 'default' | 'easy';
  showHero?: boolean;
  copy?: PageCopy['compressor'];
  svgOnly?: boolean;
}

export default function ImageCompressor({
  variant = 'default',
  showHero = true,
  copy,
  svgOnly = false,
}: ImageCompressorProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [quality, setQuality] = useState(90);
  const [targetSizeKb, setTargetSizeKb] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const progressTimersRef = useRef<Map<string, number>>(new Map());
  const progressTargetsRef = useRef<Map<string, number>>(new Map());
  const isEasy = variant === 'easy';
  const acceptedTypes = svgOnly ? SVG_TYPES : ACCEPTED_TYPES;
  const accept = acceptedTypes.join(',');

  const stopPseudoProgress = useCallback((id: string) => {
    const timerId = progressTimersRef.current.get(id);
    if (timerId != null) {
      window.clearInterval(timerId);
      progressTimersRef.current.delete(id);
    }
    progressTargetsRef.current.delete(id);
  }, []);

  const startPseudoProgress = useCallback((id: string, fileSize: number) => {
    stopPseudoProgress(id);

    const profile = getPseudoProgressProfile(fileSize);
    progressTargetsRef.current.set(id, profile.preWorkerTarget);

    const timerId = window.setInterval(() => {
      const target = progressTargetsRef.current.get(id);
      if (target == null) return;

      setFiles((prev) =>
        prev.map((file) => {
          if (file.id !== id || file.status !== 'compressing') return file;
          if (file.progress >= target) return file;

          const nextProgress = Math.min(
            file.progress + Math.max(1, Math.ceil((target - file.progress) / 10)),
            target
          );
          return { ...file, progress: nextProgress };
        })
      );
    }, profile.tickMs);

    progressTimersRef.current.set(id, timerId);
  }, [stopPseudoProgress]);

  const advancePseudoProgress = useCallback((id: string, fileSize: number) => {
    const profile = getPseudoProgressProfile(fileSize);
    progressTargetsRef.current.set(id, profile.postWorkerTarget);
  }, []);

  // ─── Initialize Worker ──────────────────────────────────────────────
  useEffect(() => {
    const worker = new Worker(
      new URL('../../workers/compressor.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'progress':
          setFiles((prev) => {
            const currentFile = prev.find((f) => f.id === msg.id);
            if (currentFile) {
              advancePseudoProgress(msg.id, currentFile.originalSize);
            }
            return prev.map((f) =>
              f.id === msg.id
                ? {
                    ...f,
                    progress: Math.max(f.progress, msg.progress),
                    width: msg.width ?? f.width,
                    height: msg.height ?? f.height,
                  }
                : f
            );
          });
          break;
        case 'result': {
          stopPseudoProgress(msg.id);
          const blob = new Blob([msg.buffer], { type: msg.mimeType });
          const url = URL.createObjectURL(blob);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === msg.id
                ? {
                  ...f,
                  status: 'completed',
                  progress: 100,
                  compressedSize: msg.compressedSize,
                  compressedUrl: url,
                  compressedBuffer: new Uint8Array(msg.buffer),
                }
                : f
            )
          );
          break;
        }
        case 'error':
          stopPseudoProgress(msg.id);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === msg.id
                ? { ...f, status: 'error', errorMessage: msg.message }
                : f
            )
          );
          break;
      }
    };

    return () => {
      progressTimersRef.current.forEach((timerId) => window.clearInterval(timerId));
      progressTimersRef.current.clear();
      progressTargetsRef.current.clear();
      worker.terminate();
    };
  }, [advancePseudoProgress, stopPseudoProgress]);

  // ─── Queue Dispatcher: process one at a time ───────────────────────
  useEffect(() => {
    const isAnyCompressing = files.some((f) => f.status === 'compressing');
    if (isAnyCompressing) return;

    const nextWaiting = files.find((f) => f.status === 'waiting');
    if (!nextWaiting || !workerRef.current) return;

    // Mark as compressing
    setFiles((prev) =>
      prev.map((f) =>
        f.id === nextWaiting.id ? { ...f, status: 'compressing', progress: 5 } : f
      )
    );
    startPseudoProgress(nextWaiting.id, nextWaiting.originalSize);

    // Send raw bytes to the worker; decoding and profiling stay off the main thread.
    const processNext = async () => {
      try {
        const buffer = await nextWaiting.file.arrayBuffer();

        workerRef.current?.postMessage(
          {
            type: 'compress',
            id: nextWaiting.id,
            buffer,
            mimeType: getFileType(nextWaiting.file),
            fileName: nextWaiting.name,
            targetFormat: 'original',
            quality,
            targetBytes: targetSizeKb * 1024,
          },
          [buffer] // Transferable
        );
      } catch (err) {
        stopPseudoProgress(nextWaiting.id);
        const message = err instanceof Error
          ? err.message
          : copy?.errors.failedToProcess ?? 'Failed to process file';
        setFiles((prev) =>
          prev.map((f) =>
            f.id === nextWaiting.id ? { ...f, status: 'error', errorMessage: message } : f
          )
        );
      }
    };

    processNext();
  }, [files, quality, targetSizeKb, startPseudoProgress, stopPseudoProgress]);

  // ─── Add Files ─────────────────────────────────────────────────────
  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const remaining = MAX_FILES - prev.length;
      const toAdd = incoming.slice(0, Math.max(0, remaining));

      const newEntries: FileEntry[] = toAdd.map((file) => {
        const isOversize = file.size > MAX_FILE_SIZE;
        const isUnsupported = !acceptedTypes.includes(getFileType(file));
        const hasError = isOversize || isUnsupported;

        return {
          id: nextId(),
          file,
          name: file.name,
          originalSize: file.size,
          status: hasError ? 'error' : 'waiting',
          progress: 0,
          errorMessage: isOversize
            ? copy?.errors.exceedsLimit ?? 'Error: Exceeds 10MB limit'
            : isUnsupported
              ? copy?.errors.unsupportedFormat ?? 'Error: Unsupported format'
              : undefined,
        };
      });

      return [...prev, ...newEntries];
    });
  }, [acceptedTypes]);

  // ─── Drag & Drop Handlers ──────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      addFiles(droppedFiles);
    },
    [addFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files ? Array.from(e.target.files) : [];
      addFiles(selected);
      // Reset so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = '';
    },
    [addFiles]
  );

  // ─── Download Handlers ─────────────────────────────────────────────
  const handleDownload = useCallback((entry: FileEntry) => {
    if (!entry.compressedUrl) return;
    const a = document.createElement('a');
    a.href = entry.compressedUrl;
    a.download = entry.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleDownloadAll = useCallback(async () => {
    const completed = files.filter(
      (f) => f.status === 'completed' && f.compressedBuffer
    );
    if (completed.length === 0) return;

    const zip = new JSZip();
    for (const entry of completed) {
      if (entry.compressedBuffer) {
        zip.file(entry.name, entry.compressedBuffer);
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = copy?.zipName ?? 'best4img-compressed.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files]);

  const hasCompleted = files.some((f) => f.status === 'completed');

  return (
    <>
      {/* Hero + Drop Zone */}
      <section className="w-full flex flex-col gap-8">
        {showHero && (
          <div className={isEasy ? 'text-left' : 'text-center'}>
            <h2 className={`font-bold tracking-tighter text-slate-900 ${isEasy ? 'text-3xl md:text-4xl' : 'text-5xl md:text-6xl'}`}>
              {copy?.heroTitle ?? 'Image Compressor'}
            </h2>
            <p className="text-slate-500 font-medium mt-2">
              {copy?.heroSubtitle ?? 'Supports JPG, PNG, WebP, and SVG for Free'}
            </p>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="rounded-xl border border-slate-200/70 bg-white/72 p-6 shadow-sm backdrop-blur-[2px]">
            <h3 className="mb-6 text-base font-bold text-slate-900">
              {copy?.settings?.title ?? 'Compression settings'}
            </h3>
            <label className="block text-sm font-semibold text-slate-700">
              <span className="flex items-center justify-between">
                <span>{copy?.settings?.quality ?? 'Quality'}</span>
                <span className="text-[#3525cd]">{quality}%</span>
              </span>
              <input
                type="range"
                min="10"
                max="100"
                value={quality}
                onChange={(event) => setQuality(Number(event.target.value))}
                className="mt-3 w-full accent-[#3525cd]"
              />
              <span className="mt-2 block text-xs font-normal leading-5 text-slate-400">
                {copy?.settings?.qualityHint ?? 'Higher quality creates a larger file.'}
              </span>
            </label>
            <label className="mt-7 block text-sm font-semibold text-slate-700">
              {copy?.settings?.targetSize ?? 'Maximum file size'}
              <div className="mt-3 flex overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:border-indigo-400">
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={targetSizeKb || ''}
                  placeholder="0"
                  onChange={(event) => setTargetSizeKb(Math.max(0, Number(event.target.value) || 0))}
                  className="min-w-0 flex-1 px-3 py-2.5 font-normal outline-none"
                />
                <span className="border-l border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-500">KB</span>
              </div>
              <span className="mt-2 block text-xs font-normal leading-5 text-slate-400">
                {targetSizeKb === 0
                  ? copy?.settings?.unlimited ?? 'No size limit'
                  : copy?.settings?.targetSizeHint ?? 'The compressor will aim to stay under this size.'}
              </span>
            </label>
          </aside>
          <DropZone
            onFilesSelect={addFiles}
            accept={accept}
            maxFiles={MAX_FILES}
            maxFileSize={MAX_FILE_SIZE}
            isEasy={isEasy}
            copy={{ dropTitle: copy?.dropTitle, dropHint: copy?.dropHint }}
          />
        </div>
      </section>

      {/* Results List */}
      {files.length > 0 && (
        <section className={`w-full ${isEasy ? 'pt-3 md:pt-5' : ''}`}>
          <div className={isEasy ? 'space-y-3.5' : 'bg-white/60 backdrop-blur-md rounded-xl overflow-hidden border border-blue-100/30 shadow-sm'}>
            {isEasy ? (
              files.map((entry, i) => (
                <FileRow
                  key={entry.id}
                  entry={entry}
                  index={i}
                  onDownload={handleDownload}
                  variant={variant}
                  copy={copy}
                />
              ))
            ) : (
              <table className="w-full text-left border-separate border-spacing-0">
                <tbody className="font-medium text-xs">
                  {files.map((entry, i) => (
                    <FileRow
                      key={entry.id}
                      entry={entry}
                      index={i}
                      onDownload={handleDownload}
                      variant={variant}
                      copy={copy}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Action Buttons */}
          <div className={`mt-8 flex ${isEasy ? 'justify-start sm:justify-end' : 'justify-end'}`}>
            <button
              onClick={handleDownloadAll}
              disabled={!hasCompleted}
              className={`px-6 py-3 text-sm font-semibold rounded-lg shadow-md transition-all flex items-center gap-2 cursor-pointer ${
                isEasy ? 'bg-[#3525cd] text-white hover:bg-[#24189d]' : 'signature-gradient text-on-primary hover:opacity-90'
              } ${hasCompleted ? '' : 'opacity-50 cursor-not-allowed'}`}
            >
              <span className="material-symbols-outlined">folder_zip</span>
              {copy?.downloadAll ?? 'Download All .ZIP'}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
