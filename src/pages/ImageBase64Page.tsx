import { useCallback, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import BaseFileRow from '../components/ui/BaseFileRow';
import DropZone from '../components/ui/DropZone';
import type { Locale, PageCopy } from '../i18n';
import { useLocaleSection } from '../localization';

const MAX_FILES = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_DECODED_SIZE = 20 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

type Base64Entry = { id: string; file: File; name: string; size: number; type: string; dataUrl?: string; error?: string };
type Copy = {
  title: string; subtitle: string; encode: string; decode: string; dropTitle: string; dropHint: string;
  settings: string; output: string; dataUrl: string; raw: string; cssUrl: string; copy: string; copied: string;
  empty: string; decodeInput: string; decodePlaceholder: string; preview: string; decodeHint: string;
  invalid: string; tooLarge: string; download: string; detected: string;
  errors: { oversize: string; unsupported: string; read: string };
};

function nextId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function detectImageType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: 'image/jpeg', extension: 'jpg', label: 'JPG' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: 'image/png', extension: 'png', label: 'PNG' };
  const six = String.fromCharCode(...bytes.slice(0, 6));
  if (six === 'GIF87a' || six === 'GIF89a') return { mime: 'image/gif', extension: 'gif', label: 'GIF' };
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { mime: 'image/webp', extension: 'webp', label: 'WebP' };
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return { mime: 'image/svg+xml', extension: 'svg', label: 'SVG' };
  return null;
}
function decodeImageBase64(value: string) {
  let input = value.trim();
  if (!input) return null;
  const cssMatch = input.match(/^url\(\s*(["']?)(.*?)\1\s*\)$/is);
  if (cssMatch?.[2]) input = cssMatch[2];
  const dataMatch = input.match(/^data:([^;,]+);base64,(.*)$/is);
  const declaredMime = dataMatch?.[1]?.toLowerCase();
  let encoded = (dataMatch?.[2] ?? input).replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!encoded || !/^[a-z0-9+/]*={0,2}$/i.test(encoded)) return null;
  encoded += '='.repeat((4 - encoded.length % 4) % 4);
  const binary = atob(encoded);
  if (binary.length > MAX_DECODED_SIZE) throw new Error('too-large');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const detected = detectImageType(bytes);
  if (!detected) return null;
  const mime = declaredMime?.startsWith('image/') ? declaredMime : detected.mime;
  return { bytes, mime, extension: detected.extension, label: detected.label, dataUrl: `data:${mime};base64,${encoded}` };
}

export default function ImageBase64Page() {
  const { locale } = useOutletContext<{ copy: PageCopy; locale: Locale }>();
  const copy = useLocaleSection<Copy>('image-base64');
  const [direction, setDirection] = useState<'encode' | 'decode'>('encode');
  const [files, setFiles] = useState<Base64Entry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'dataUrl' | 'raw' | 'css'>('dataUrl');
  const [copied, setCopied] = useState(false);
  const [decodeInput, setDecodeInput] = useState('');
  const selected = useMemo(() => files.find((file) => file.id === selectedId) ?? files[0], [files, selectedId]);
  const outputValue = selected?.dataUrl ? mode === 'raw' ? selected.dataUrl.split(',')[1] ?? '' : mode === 'css' ? `url("${selected.dataUrl}")` : selected.dataUrl : '';
  const outputSize = outputValue ? formatBytes(new TextEncoder().encode(outputValue).length) : '';
  const decoded = useMemo(() => {
    try { return { image: decodeImageBase64(decodeInput), error: '' }; }
    catch (error) { return { image: null, error: error instanceof Error && error.message === 'too-large' ? copy.tooLarge : copy.invalid }; }
  }, [copy.invalid, copy.tooLarge, decodeInput]);

  const addFiles = useCallback((incoming: File[]) => {
    const entries = incoming.slice(0, MAX_FILES).map((file): Base64Entry => {
      const error = file.size > MAX_FILE_SIZE ? copy.errors.oversize : !ACCEPTED_TYPES.includes(file.type) ? copy.errors.unsupported : undefined;
      return { id: nextId(), file, name: file.name, size: file.size, type: file.type, error };
    });
    setFiles((current) => [...current, ...entries].slice(0, MAX_FILES));
    if (!selectedId && entries[0]) setSelectedId(entries[0].id);
    entries.forEach((entry) => {
      if (entry.error) return;
      readAsDataUrl(entry.file)
        .then((dataUrl) => setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, dataUrl } : item)))
        .catch(() => setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, error: copy.errors.read } : item)));
    });
  }, [copy.errors, selectedId]);
  const handleCopy = useCallback(async () => {
    if (!outputValue) return;
    await navigator.clipboard.writeText(outputValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [outputValue]);
  const handleDownload = useCallback(() => {
    if (!decoded.image) return;
    const url = URL.createObjectURL(new Blob([decoded.image.bytes], { type: decoded.image.mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `base64-image.${decoded.image.extension}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [decoded.image]);

  return <main className="bg-[#f9fafc]">
    <section className="relative min-h-[500px] pt-7 pb-14">
      <div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
        <div className="mb-6 text-center"><h2 className="text-2xl font-bold text-slate-900 md:text-3xl">{copy.title}</h2><p className="mt-2 text-base font-medium text-slate-500">{copy.subtitle}</p></div>
        <div className="mx-auto mb-6 grid w-full max-w-md grid-cols-2 gap-1 rounded-lg bg-slate-200 p-1">
          {(['encode', 'decode'] as const).map((item) => <button key={item} type="button" onClick={() => setDirection(item)} className={`rounded-md px-4 py-2.5 text-sm font-bold ${direction === item ? 'bg-white text-[#3525cd] shadow-sm' : 'text-slate-500'}`}>{copy[item]}</button>)}
        </div>

        {direction === 'encode' ? <div className="grid gap-5 lg:grid-cols-[26rem_1fr] lg:items-start">
          <div className="flex flex-col gap-5">
            <DropZone onFilesSelect={addFiles} accept={ACCEPTED_TYPES.join(',')} maxFiles={MAX_FILES} maxFileSize={MAX_FILE_SIZE} isEasy={true} copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }} />
            {files.length > 0 && <section className="space-y-3.5">{files.map((entry) => <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id)} className="block w-full text-left">
              <BaseFileRow isError={Boolean(entry.error)} rowBgClass={selected?.id === entry.id ? 'bg-indigo-50' : 'bg-white hover:bg-slate-50'}><div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><span className="material-symbols-outlined">image</span></div>
                <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{entry.name}</p><p className="mt-1 text-xs font-medium text-slate-500">{entry.error ?? `${formatBytes(entry.size)} · ${entry.type || 'image'}`}</p></div>
              </div></BaseFileRow>
            </button>)}</section>}
          </div>
          <section className="rounded-xl border border-slate-200/70 bg-white p-5">
            <h3 className="text-lg font-bold text-slate-900">{copy.settings}</h3>
            <div className="mt-5 grid grid-cols-3 gap-2 rounded-lg bg-slate-100 p-1">{(['dataUrl', 'raw', 'css'] as const).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`rounded-md px-3 py-2 text-sm font-bold ${mode === item ? 'bg-white text-[#3525cd] shadow-sm' : 'text-slate-500'}`}>{item === 'css' ? copy.cssUrl : copy[item]}</button>)}</div>
            <label className="mt-5 flex items-baseline gap-2 text-sm font-bold text-slate-700" htmlFor="base64-output"><span>{copy.output}</span>{outputSize && <span className="text-xs font-semibold text-slate-400">{outputSize}</span>}</label>
            <textarea id="base64-output" readOnly value={outputValue || copy.empty} className="mt-2 h-72 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs leading-5 text-slate-700 outline-none" />
            <button type="button" onClick={handleCopy} disabled={!outputValue} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#3525cd] px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"><span className="material-symbols-outlined text-base">content_copy</span>{copied ? copy.copied : copy.copy}</button>
          </section>
        </div> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
          <section className="rounded-xl border border-slate-200/70 bg-white p-5">
            <label className="text-lg font-bold text-slate-900" htmlFor="base64-input">{copy.decodeInput}</label><p className="mt-1 text-sm font-medium text-slate-500">{copy.decodeHint}</p>
            <textarea id="base64-input" value={decodeInput} onChange={(event) => setDecodeInput(event.target.value)} placeholder={copy.decodePlaceholder} spellCheck={false} className="mt-5 h-[26rem] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-5 text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white" />
            {decodeInput && !decoded.image && <p className="mt-3 text-sm font-semibold text-rose-600">{decoded.error || copy.invalid}</p>}
          </section>
          <section className="rounded-xl border border-slate-200/70 bg-white p-5">
            <div className="flex items-baseline justify-between gap-3"><h3 className="text-lg font-bold text-slate-900">{copy.preview}</h3>{decoded.image && <span className="text-xs font-semibold text-slate-400">{copy.detected} {decoded.image.label} · {formatBytes(decoded.image.bytes.length)}</span>}</div>
            <div className="mt-5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]">
              {decoded.image ? <img src={decoded.image.dataUrl} alt={copy.preview} className="max-h-full max-w-full object-contain" /> : <span className="material-symbols-outlined text-5xl text-slate-300">image</span>}
            </div>
            <button type="button" onClick={handleDownload} disabled={!decoded.image} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#3525cd] px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"><span className="material-symbols-outlined text-base">download</span>{copy.download}</button>
          </section>
        </div>}
      </div>
    </section>
  </main>;
}
