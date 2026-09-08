import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import DropZone from '../components/ui/DropZone';
import type { Locale, PageCopy } from '../i18n';
import { useLocaleSection } from '../localization';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_OUTPUT_SIDE = 8192;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type PaletteKey = 'auto' | 'gameboy' | 'gray' | 'nes';
type Copy = {
  title: string; subtitle: string; dropTitle: string; dropHint: string; preview: string; settings: string;
  pixelSize: string; pixelHint: string; scale: string; colors: string; palette: string; auto: string;
  gameboy: string; gray: string; nes: string; output: string; download: string; chooseAnother: string;
  invalid: string; oversized: string;
};

const FIXED_PALETTES: Record<Exclude<PaletteKey, 'auto'>, number[][]> = {
  gameboy: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]],
  gray: [[20, 20, 24], [76, 76, 82], [142, 142, 148], [208, 208, 212], [248, 248, 248]],
  nes: [[0, 0, 0], [124, 124, 124], [248, 248, 248], [0, 88, 248], [60, 188, 252], [0, 168, 0], [184, 248, 24], [248, 184, 0], [248, 56, 0], [216, 0, 204], [88, 0, 168], [248, 120, 88], [252, 160, 68], [184, 184, 248], [104, 216, 252], [216, 248, 120]],
};

type ColorBucket = { colors: number[][] };

function averageColor(colors: number[][]) {
  const total = colors.reduce((sum, color) => [sum[0]! + color[0]!, sum[1]! + color[1]!, sum[2]! + color[2]!], [0, 0, 0]);
  return total.map((value) => Math.round(value / colors.length));
}

function medianCut(colors: number[][], target: number) {
  if (!colors.length) return [[0, 0, 0]];
  let buckets: ColorBucket[] = [{ colors }];
  while (buckets.length < target) {
    let bestIndex = -1;
    let bestRange = -1;
    let bestChannel = 0;
    buckets.forEach((bucket, index) => {
      if (bucket.colors.length < 2) return;
      for (let channel = 0; channel < 3; channel += 1) {
        const values = bucket.colors.map((color) => color[channel]!);
        const range = Math.max(...values) - Math.min(...values);
        if (range > bestRange) { bestRange = range; bestIndex = index; bestChannel = channel; }
      }
    });
    if (bestIndex < 0) break;
    const [bucket] = buckets.splice(bestIndex, 1);
    bucket!.colors.sort((a, b) => a[bestChannel]! - b[bestChannel]!);
    const middle = Math.ceil(bucket!.colors.length / 2);
    buckets.push({ colors: bucket!.colors.slice(0, middle) }, { colors: bucket!.colors.slice(middle) });
  }
  return buckets.map((bucket) => averageColor(bucket.colors));
}

function closestColor(red: number, green: number, blue: number, palette: number[][]) {
  let closest = palette[0]!;
  let distance = Number.POSITIVE_INFINITY;
  palette.forEach((color) => {
    const next = (red - color[0]!) ** 2 + (green - color[1]!) ** 2 + (blue - color[2]!) ** 2;
    if (next < distance) { distance = next; closest = color; }
  });
  return closest;
}

function quantize(imageData: ImageData, count: number, fixedPalette?: number[][]) {
  const samples: number[][] = [];
  for (let index = 0; index < imageData.data.length; index += 4) {
    if (imageData.data[index + 3]! > 16) samples.push([imageData.data[index]!, imageData.data[index + 1]!, imageData.data[index + 2]!]);
  }
  const step = Math.max(1, Math.ceil(samples.length / 12000));
  const palette = fixedPalette ?? medianCut(samples.filter((_, index) => index % step === 0), count);
  for (let index = 0; index < imageData.data.length; index += 4) {
    if (imageData.data[index + 3] === 0) continue;
    const color = closestColor(imageData.data[index]!, imageData.data[index + 1]!, imageData.data[index + 2]!, palette);
    imageData.data[index] = color[0]!; imageData.data[index + 1] = color[1]!; imageData.data[index + 2] = color[2]!;
  }
  return palette;
}

function getOutputSize(width: number, height: number, scale: number) {
  const requestedWidth = width * scale;
  const requestedHeight = height * scale;
  const limit = Math.min(1, MAX_OUTPUT_SIDE / Math.max(requestedWidth, requestedHeight));
  return { width: Math.round(requestedWidth * limit), height: Math.round(requestedHeight * limit) };
}

export default function PixelArtPage() {
  const { locale } = useOutletContext<{ copy: PageCopy; locale: Locale }>();
  const copy = useLocaleSection<Copy>('pixel-art');
  const common = useLocaleSection<{ original: string }>('common');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState('');
  const [pixelSize, setPixelSize] = useState(8);
  const [scale, setScale] = useState(1);
  const [colorCount, setColorCount] = useState(16);
  const [paletteKey, setPaletteKey] = useState<PaletteKey>('auto');
  const [palette, setPalette] = useState<number[][]>([]);

  const outputSize = useMemo(() => {
    if (!image) return null;
    return getOutputSize(image.width, image.height, scale);
  }, [image, scale]);

  const selectFiles = useCallback(async (files: File[]) => {
    const next = files[0];
    if (!next) return;
    if (next.size > MAX_FILE_SIZE) { setError(copy.oversized); return; }
    if (!ACCEPTED_TYPES.includes(next.type)) { setError(copy.invalid); return; }
    try {
      const bitmap = await createImageBitmap(next);
      setImage((current) => { current?.close(); return bitmap; });
      setFile(next); setError('');
    } catch { setError(copy.invalid); }
  }, [copy.invalid, copy.oversized]);

  useEffect(() => () => image?.close(), [image]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const width = Math.max(1, Math.ceil(image.width / pixelSize));
    const height = Math.max(1, Math.ceil(image.height / pixelSize));
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const nextPalette = quantize(imageData, colorCount, paletteKey === 'auto' ? undefined : FIXED_PALETTES[paletteKey]);
    context.putImageData(imageData, 0, 0);
    setPalette(nextPalette);
  }, [colorCount, image, paletteKey, pixelSize]);

  const download = useCallback(() => {
    const source = canvasRef.current;
    if (!source || !file || !outputSize) return;
    const output = document.createElement('canvas');
    output.width = outputSize.width; output.height = outputSize.height;
    const context = output.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, output.width, output.height);
    output.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${file.name.replace(/\.[^.]+$/, '')}-pixel-art.png`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }, 'image/png');
  }, [file, outputSize]);

  return <main className="bg-[#f9fafc]">
    <section className="relative min-h-[500px] pt-7 pb-14"><div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
      <div className="mb-8 text-center"><h2 className="text-2xl font-bold tracking-tighter text-slate-900 md:text-3xl">{copy.title}</h2><p className="mt-2 text-base font-medium text-slate-500">{copy.subtitle}</p></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {image ? <section className="flex min-h-[24rem] flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold text-slate-500">{copy.preview}</p><h3 className="truncate text-lg font-bold tracking-tight text-slate-900" title={file?.name}>{file?.name}</h3></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:text-slate-900"><span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>{copy.chooseAnother}<input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={(event) => { selectFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} /></label></div>
          <div className="flex min-h-[36rem] flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-5"><div className="relative max-h-[33rem] max-w-full overflow-hidden rounded-lg bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] shadow-sm" style={{ width: `min(100%, ${33 * image.width / image.height}rem)`, aspectRatio: `${image.width} / ${image.height}` }}><canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ imageRendering: 'pixelated' }} /></div></div>
        </section> : <div><DropZone onFilesSelect={selectFiles} accept={ACCEPTED_TYPES.join(',')} maxFiles={1} maxFileSize={MAX_FILE_SIZE} isEasy copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }} />{error && <p className="mt-3 text-center text-sm font-semibold text-rose-600">{error}</p>}</div>}
        <section className="rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
          <h3 className="text-lg font-bold tracking-tight text-slate-900">{copy.settings}</h3>
          <label className="mt-5 flex items-center justify-between text-sm font-bold text-slate-700"><span>{copy.pixelSize}</span><span className={image ? 'text-[#3525cd]' : 'text-slate-300'}>{pixelSize}px</span></label><input type="range" min="2" max="32" step="1" value={pixelSize} disabled={!image} onChange={(event) => setPixelSize(Number(event.target.value))} className="mt-3 w-full accent-[#3525cd] disabled:opacity-40" /><p className="mt-1 text-xs text-slate-400">{copy.pixelHint}</p>
          <p className="mt-6 text-sm font-bold text-slate-700">{copy.colors}</p><div className="mt-2 grid grid-cols-5 gap-2">{[4, 8, 16, 32, 64].map((value) => <button key={value} type="button" disabled={!image || paletteKey !== 'auto'} onClick={() => setColorCount(value)} className={`rounded-lg border py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${colorCount === value && paletteKey === 'auto' ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 text-slate-600'}`}>{value}</button>)}</div>
          <p className="mt-6 text-sm font-bold text-slate-700">{copy.palette}</p><div className="mt-2 grid grid-cols-2 gap-2">{(['auto', 'gameboy', 'gray', 'nes'] as PaletteKey[]).map((key) => <button key={key} type="button" disabled={!image} onClick={() => setPaletteKey(key)} className={`rounded-lg border px-2 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${paletteKey === key ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 text-slate-600'}`}>{copy[key]}</button>)}</div>
          <div className="mt-4 flex min-h-8 flex-wrap gap-1">{palette.map((color, index) => <span key={`${color.join('-')}-${index}`} className="h-6 w-6 rounded border border-black/10" style={{ backgroundColor: `rgb(${color.join(',')})` }} title={`rgb(${color.join(', ')})`} />)}</div>
          <p className="mt-6 text-sm font-bold text-slate-700">{copy.scale}</p><div className="mt-2 grid grid-cols-3 gap-2">{[1, 2, 4].map((value) => { const size = image ? getOutputSize(image.width, image.height, value) : null; return <button key={value} type="button" disabled={!image} onClick={() => setScale(value)} className={`rounded-lg border px-1 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${scale === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 text-slate-600'}`}>{value === 1 ? common.original : size ? `${size.width} × ${size.height}` : `${value}×`}</button>; })}</div>
          <button type="button" onClick={download} disabled={!image} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#3525cd] px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"><span className="material-symbols-outlined text-base">download</span>{copy.download}</button>
        </section>
      </div>
    </div></section>
  </main>;
}
