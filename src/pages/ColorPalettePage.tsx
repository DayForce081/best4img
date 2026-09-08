import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import DropZone from '../components/ui/DropZone';
import type { Locale, PageCopy } from '../i18n';
import { useLocaleSection } from '../localization';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type OutputMode = 'css' | 'tailwind';
type Copy = {
  title: string; subtitle: string; dropTitle: string; dropHint: string; preview: string; settings: string;
  count: string; colors: string; clickToCopy: string; copied: string; output: string; css: string;
  tailwind: string; copyCode: string; download: string; chooseAnother: string; invalid: string; oversized: string;
};

type Bucket = { colors: number[][] };

function average(colors: number[][]) {
  const sum = colors.reduce((result, color) => [result[0]! + color[0]!, result[1]! + color[1]!, result[2]! + color[2]!], [0, 0, 0]);
  return sum.map((value) => Math.round(value / colors.length));
}

function medianCut(colors: number[][], target: number) {
  if (!colors.length) return [];
  let buckets: Bucket[] = [{ colors }];
  while (buckets.length < target) {
    let selectedIndex = -1;
    let selectedChannel = 0;
    let largestScore = -1;
    buckets.forEach((bucket, bucketIndex) => {
      if (bucket.colors.length < 2) return;
      for (let channel = 0; channel < 3; channel += 1) {
        const values = bucket.colors.map((color) => color[channel]!);
        const range = Math.max(...values) - Math.min(...values);
        const score = range * Math.sqrt(bucket.colors.length);
        if (score > largestScore) { largestScore = score; selectedIndex = bucketIndex; selectedChannel = channel; }
      }
    });
    if (selectedIndex < 0) break;
    const [bucket] = buckets.splice(selectedIndex, 1);
    bucket!.colors.sort((a, b) => a[selectedChannel]! - b[selectedChannel]!);
    const middle = Math.ceil(bucket!.colors.length / 2);
    buckets.push({ colors: bucket!.colors.slice(0, middle) }, { colors: bucket!.colors.slice(middle) });
  }
  return buckets.map((bucket) => average(bucket.colors)).sort((a, b) => {
    const lightnessA = a[0]! * 0.299 + a[1]! * 0.587 + a[2]! * 0.114;
    const lightnessB = b[0]! * 0.299 + b[1]! * 0.587 + b[2]! * 0.114;
    return lightnessB - lightnessA;
  });
}

function toHex(color: number[]) {
  return `#${color.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function extractColors(image: ImageBitmap, count: number) {
  const longest = Math.max(image.width, image.height);
  const scale = Math.min(1, 320 / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors: number[][] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3]! < 128) continue;
    colors.push([pixels[index]!, pixels[index + 1]!, pixels[index + 2]!]);
  }
  const step = Math.max(1, Math.ceil(colors.length / 24000));
  return medianCut(colors.filter((_, index) => index % step === 0), count);
}

export default function ColorPalettePage() {
  const { locale } = useOutletContext<{ copy: PageCopy; locale: Locale }>();
  const copy = useLocaleSection<Copy>('color-palette');
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [colorCount, setColorCount] = useState(8);
  const [palette, setPalette] = useState<number[][]>([]);
  const [mode, setMode] = useState<OutputMode>('css');
  const [copiedValue, setCopiedValue] = useState('');
  const [error, setError] = useState('');

  const code = useMemo(() => {
    if (!palette.length) return '';
    if (mode === 'tailwind') {
      const rows = palette.map((color, index) => `        '${index + 1}': '${toHex(color)}',`).join('\n');
      return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        palette: {\n${rows}\n        },\n      },\n    },\n  },\n};`;
    }
    return `:root {\n${palette.map((color, index) => `  --color-${index + 1}: ${toHex(color)};`).join('\n')}\n}`;
  }, [mode, palette]);

  const selectFiles = useCallback(async (files: File[]) => {
    const next = files[0];
    if (!next) return;
    if (next.size > MAX_FILE_SIZE) { setError(copy.oversized); return; }
    if (!ACCEPTED_TYPES.includes(next.type)) { setError(copy.invalid); return; }
    try {
      const bitmap = await createImageBitmap(next);
      setImage((current) => { current?.close(); return bitmap; });
      setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(next); });
      setFile(next); setError('');
    } catch { setError(copy.invalid); }
  }, [copy.invalid, copy.oversized]);

  useEffect(() => {
    if (image) setPalette(extractColors(image, colorCount));
  }, [colorCount, image]);
  useEffect(() => () => { image?.close(); if (previewUrl) URL.revokeObjectURL(previewUrl); }, [image, previewUrl]);

  const copyText = useCallback(async (value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue(''), 1200);
  }, []);

  const downloadPalette = useCallback(() => {
    if (!palette.length) return;
    const columns = Math.min(8, palette.length);
    const rows = Math.ceil(palette.length / columns);
    const cellWidth = 140;
    const cellHeight = 110;
    const canvas = document.createElement('canvas');
    canvas.width = columns * cellWidth;
    canvas.height = rows * cellHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '600 16px sans-serif';
    palette.forEach((color, index) => {
      const x = index % columns * cellWidth;
      const y = Math.floor(index / columns) * cellHeight;
      context.fillStyle = toHex(color); context.fillRect(x, y, cellWidth, cellHeight);
      const lightness = color[0]! * 0.299 + color[1]! * 0.587 + color[2]! * 0.114;
      context.fillStyle = lightness > 150 ? '#111827' : '#FFFFFF';
      context.fillText(toHex(color), x + cellWidth / 2, y + cellHeight / 2);
    });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `${file?.name.replace(/\.[^.]+$/, '') ?? 'image'}-palette.png`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }, 'image/png');
  }, [file, palette]);

  return <main className="bg-[#f9fafc]">
    <section className="relative min-h-[500px] pt-7 pb-14"><div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
      <div className="mb-8 text-center"><h2 className="text-2xl font-bold tracking-tighter text-slate-900 md:text-3xl">{copy.title}</h2><p className="mt-2 text-base font-medium text-slate-500">{copy.subtitle}</p></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {image ? <section className="flex min-h-[24rem] flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold text-slate-500">{copy.preview}</p><h3 className="truncate text-lg font-bold tracking-tight text-slate-900" title={file?.name}>{file?.name}</h3></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:text-slate-900"><span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>{copy.chooseAnother}<input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={(event) => { selectFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} /></label></div>
          <div className="flex min-h-[36rem] flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-5"><img src={previewUrl} alt={file?.name ?? ''} className="max-h-[33rem] max-w-full rounded-lg object-contain shadow-sm" /></div>
        </section> : <div><DropZone onFilesSelect={selectFiles} accept={ACCEPTED_TYPES.join(',')} maxFiles={1} maxFileSize={MAX_FILE_SIZE} isEasy copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }} />{error && <p className="mt-3 text-center text-sm font-semibold text-rose-600">{error}</p>}</div>}

        <section className="rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
          <h3 className="text-lg font-bold tracking-tight text-slate-900">{copy.settings}</h3>
          <p className="mt-5 text-sm font-bold text-slate-700">{copy.count}</p><div className="mt-2 grid grid-cols-4 gap-2">{[4, 8, 16, 32].map((value) => <button key={value} type="button" disabled={!image} onClick={() => setColorCount(value)} className={`rounded-lg border py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${colorCount === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-600'}`}>{value}</button>)}</div>
          <div className="mt-6 flex items-end justify-between gap-3"><p className="text-sm font-bold text-slate-700">{copy.colors}</p><p className="text-xs font-medium text-slate-400">{copy.clickToCopy}</p></div>
          <div className="mt-2 grid grid-cols-2 gap-2">{palette.map((color) => { const hex = toHex(color); return <button key={hex} type="button" onClick={() => copyText(hex)} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-indigo-300"><span className="h-8 w-8 shrink-0 rounded-md border border-black/10" style={{ backgroundColor: hex }} /><span className="min-w-0"><span className="block text-xs font-bold text-slate-700">{copiedValue === hex ? copy.copied : hex}</span><span className="block truncate text-[10px] text-slate-400">{color.join(', ')}</span></span></button>; })}</div>
          <p className="mt-6 text-sm font-bold text-slate-700">{copy.output}</p><div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">{(['css', 'tailwind'] as OutputMode[]).map((value) => <button key={value} type="button" disabled={!image} onClick={() => setMode(value)} className={`rounded-md px-2 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${mode === value ? 'bg-white text-[#3525cd] shadow-sm' : 'text-slate-500'}`}>{copy[value]}</button>)}</div>
          <textarea readOnly value={code} className="mt-2 h-32 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[10px] leading-4 text-slate-600 outline-none" />
          <button type="button" disabled={!code} onClick={() => copyText(code)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"><span className="material-symbols-outlined text-[18px]">content_copy</span>{code && copiedValue === code ? copy.copied : copy.copyCode}</button>
          <button type="button" disabled={!palette.length} onClick={downloadPalette} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#3525cd] px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"><span className="material-symbols-outlined text-[18px]">download</span>{copy.download}</button>
        </section>
      </div>
    </div></section>
  </main>;
}
