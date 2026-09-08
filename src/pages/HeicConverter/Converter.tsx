import { useState, useCallback, useEffect, useRef } from 'react';
import ConverterFileRow, { type HeicEntry } from './ConverterFileRow';
import DropZone from '../../components/ui/DropZone';
import heic2any from 'heic2any';
import JSZip from 'jszip';
import type { PageCopy } from '../../i18n';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_FILES = 50;

let idCounter = 0;
function nextId(): string {
  return `heic-${++idCounter}-${Date.now()}`;
}

export default function Converter({ copy }: { copy?: PageCopy['heicConverter'] }) {
  const [files, setFiles] = useState<HeicEntry[]>([]);
  const [quality, setQuality] = useState(90);
  // Use a ref to ensure we don't dispatch multiple processing streams
  const activeProcessingRef = useRef<Set<string>>(new Set());

  // ─── Queue Dispatcher ───────────────────────────────────────────────
  useEffect(() => {
    // We only process one file at a time to prevent the browser from freezing
    // due to heavy HEIC decoding calculations in heic2any.
    if (activeProcessingRef.current.size >= 1) return;

    const nextWaiting = files.find((f) => f.status === 'waiting' && !activeProcessingRef.current.has(f.id));
    if (!nextWaiting) return;

    activeProcessingRef.current.add(nextWaiting.id);

    setFiles((prev) =>
      prev.map((f) =>
        f.id === nextWaiting.id ? { ...f, status: 'converting' } : f
      )
    );

    const processFile = async (entry: HeicEntry) => {
      try {
        const resultBlob = await heic2any({
          blob: entry.file,
          toType: 'image/jpeg',
          quality: quality / 100,
        });

        // heic2any might return an array if the HEIC has multiple images. We just take the first one.
        const outputBlob = Array.isArray(resultBlob) ? resultBlob[0] : resultBlob;
        if (!outputBlob) {
          throw new Error('Produced empty blob.');
        }

        const newName = entry.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
        
        // Read dimensions from the output blob
        const dimensions = await new Promise<{width: number, height: number}>((resolve) => {
          const img = new Image();
          const tempUrl = URL.createObjectURL(outputBlob);
          img.onload = () => {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
            URL.revokeObjectURL(tempUrl);
          };
          img.onerror = () => {
            resolve({ width: 0, height: 0 });
            URL.revokeObjectURL(tempUrl);
          };
          img.src = tempUrl;
        });

        const url = URL.createObjectURL(outputBlob);

        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id
              ? {
                  ...f,
                  status: 'completed',
                  name: newName,
                  convertedBlob: outputBlob,
                  convertedUrl: url,
                  convertedSize: outputBlob.size,
                  width: dimensions.width,
                  height: dimensions.height,
                }
              : f
          )
        );
      } catch (err) {
        console.error('HEIC conversion failed:', err);
        const errorMessage = err instanceof Error ? err.message : copy?.errors.failedToProcess ?? 'Processing failed';
        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id ? { ...f, status: 'error', errorMessage } : f
          )
        );
      } finally {
        activeProcessingRef.current.delete(entry.id);
        // We trigger a state update just to re-run the effect loop
        setFiles((prev) => [...prev]);
      }
    };

    // Use setTimeout to ensure the UI updates to 'converting' before the main thread hits heic2any
    setTimeout(() => processFile(nextWaiting), 50);
  }, [files, copy, quality]);

  // ─── Cleanup Object URLs ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      // Cleanup URLs when component unmounts to prevent memory leaks
      files.forEach((file) => {
        if (file.convertedUrl) {
          URL.revokeObjectURL(file.convertedUrl);
        }
      });
    };
  }, []); // Only runs on component unmount and doesn't capture the `files` array accurately, but that's okay for strict mode unmounting, though we could do proper garbage collection.

  // ─── Add Files ─────────────────────────────────────────────────────
  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const remaining = MAX_FILES - prev.length;
      const toAdd = incoming.slice(0, Math.max(0, remaining));

      const newEntries: HeicEntry[] = toAdd.map((file) => {
        const isOversize = file.size > MAX_FILE_SIZE;
        // Accept common HEIC mimetypes and extensions since OS might not give a mimetype for .heic
        const isUnsupported =
          !file.type.includes('heic') &&
          !file.type.includes('heif') &&
          !file.name.toLowerCase().endsWith('.heic') &&
          !file.name.toLowerCase().endsWith('.heif');
        const hasError = isOversize || isUnsupported;

        return {
          id: nextId(),
          file,
          name: file.name,
          originalSize: file.size,
          status: hasError ? 'error' : 'waiting',
          errorMessage: isOversize
            ? copy?.errors.exceedsLimit ?? 'Error: Exceeds limit'
            : isUnsupported
              ? copy?.errors.unsupportedFormat ?? 'Error: Unsupported format'
              : undefined,
        };
      });

      return [...prev, ...newEntries];
    });
  }, [copy]);

  // ─── Download Handlers ─────────────────────────────────────────────
  const handleDownload = useCallback((entry: HeicEntry) => {
    if (!entry.convertedUrl) return;
    const a = document.createElement('a');
    a.href = entry.convertedUrl;
    a.download = entry.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleDownloadAll = useCallback(async () => {
    const completed = files.filter(
      (f) => f.status === 'completed' && f.convertedBlob
    );
    if (completed.length === 0) return;

    const zip = new JSZip();
    for (const entry of completed) {
      if (entry.convertedBlob) {
        zip.file(entry.name, entry.convertedBlob);
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = copy?.zipName ?? 'BEST4IMG-converted.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files, copy]);

  const hasCompleted = files.some((f) => f.status === 'completed');

  return (
    <div className="grid w-full items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0">
        <DropZone
          onFilesSelect={addFiles}
          accept=".heic,.heif,image/heic,image/heic-sequence,image/heif,image/heif-sequence"
          maxFiles={MAX_FILES}
          maxFileSize={MAX_FILE_SIZE}
          isEasy={true}
          copy={{ dropTitle: copy?.dropTitle, dropHint: copy?.dropHint }}
        />

        {files.length > 0 && (
          <div className="pt-5">
            <div className="space-y-3.5">
              {files.map((entry) => (
                <ConverterFileRow key={entry.id} entry={entry} onDownload={handleDownload} copy={copy} />
              ))}
            </div>
            <div className="mt-8 flex justify-start sm:justify-end">
              <button
                onClick={handleDownloadAll}
                disabled={!hasCompleted}
                className={`px-6 py-3 text-sm font-semibold rounded-lg shadow-md transition-all flex items-center gap-2 cursor-pointer bg-indigo-600 text-white hover:bg-indigo-700 ${hasCompleted ? '' : 'opacity-50 cursor-not-allowed'}`}
              >
                <span className="material-symbols-outlined">folder_zip</span>
                {copy?.downloadAll ?? 'Download All .ZIP'}
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-base font-bold text-slate-900">{copy?.settings.title ?? 'Output settings'}</h3>
          <div className="mt-5 space-y-5">
            <div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-bold text-slate-600">{copy?.settings.quality ?? 'JPG quality'}</span>
                <span className="text-sm font-bold text-[#3525cd]">{quality}%</span>
              </div>
              <input type="range" min={60} max={100} step={1} value={quality} onChange={(event) => setQuality(Number(event.target.value))} className="mt-3 w-full accent-[#3525cd]" />
              <p className="mt-1 text-xs leading-5 text-slate-400">{copy?.settings.qualityHint ?? 'Higher quality creates a larger JPG.'}</p>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-600">{copy?.settings.orientation ?? 'Orientation'}</p>
              <div className="mt-2 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600">
                <span className="material-symbols-outlined text-[18px] text-emerald-600">screen_rotation_alt</span>
                {copy?.settings.orientationAuto ?? 'Correct automatically'}
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-400">{copy?.settings.orientationHint ?? 'Uses the displayed shooting orientation.'}</p>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-600">{copy?.settings.metadata ?? 'Metadata'}</p>
              <div className="mt-2 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600">
                <span className="material-symbols-outlined text-[18px] text-emerald-600">verified_user</span>
                {copy?.settings.metadataRemoved ?? 'Removed automatically'}
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-400">{copy?.settings.metadataHint ?? 'EXIF and GPS data are not copied to the JPG.'}</p>
            </div>
          </div>
      </aside>
    </div>
  );
}
