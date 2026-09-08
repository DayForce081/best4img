import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import DropZone from '../components/ui/DropZone';
import type { Locale, PageCopy, SupportedLocale } from '../i18n';
import { useLocaleSection } from '../localization';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
export type Effect = 'rgb' | 'shift' | 'blocks' | 'stripes' | 'noise' | 'wave' | 'mirror' | 'scanlines';
type ImageEntry = { id: string; file: File; url: string; image: HTMLImageElement };
type PageLocaleCopy = {
  title: string; subtitle: string; dropTitle: string; dropHint: string; preview: string; replace: string;
  settings: string; effectType: string; intensity: string; download: string;
  effects: Record<Effect, { title: string; body: string }>;
};

function randomAt(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function renderEffect(canvas: HTMLCanvasElement, image: HTMLImageElement, effect: Effect, intensity: number, width: number, height: number, seed: number) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: effect === 'rgb' })!;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const amount = intensity / 100;
  const rand = (value: number) => randomAt(value + seed);

  if (effect === 'rgb') {
    const original = ctx.getImageData(0, 0, width, height);
    const output = new ImageData(new Uint8ClampedArray(original.data), width, height);
    const redGap = Math.max(1, Math.round(width * (0.012 + rand(301) * 0.025) * amount));
    const blueGap = Math.max(1, Math.round(width * (0.012 + rand(307) * 0.025) * amount));
    const direction = rand(311) > 0.5 ? 1 : -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const target = (y * width + x) * 4;
        const red = (y * width + Math.max(0, Math.min(width - 1, x - redGap * direction))) * 4;
        const blue = (y * width + Math.max(0, Math.min(width - 1, x + blueGap * direction))) * 4;
        output.data[target] = original.data[red]!;
        output.data[target + 2] = original.data[blue + 2]!;
      }
    }
    ctx.putImageData(output, 0, 0);
    return;
  }

  if (effect === 'shift') {
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    source.getContext('2d')!.drawImage(image, 0, 0, width, height);
    const maxShift = Math.round(width * 0.12 * amount);
    ctx.clearRect(0, 0, width, height);
    for (let y = 0, index = 0; y < height; index += 1) {
      const band = Math.max(2, Math.round(height * (0.006 + rand(index) * 0.035)));
      const shift = rand(index + 31) > 0.62 ? Math.round((rand(index + 67) * 2 - 1) * maxShift) : 0;
      ctx.drawImage(source, 0, y, width, band, shift, y, width, band);
      if (shift > 0) ctx.drawImage(source, width - shift, y, shift, band, 0, y, shift, band);
      if (shift < 0) ctx.drawImage(source, 0, y, -shift, band, width + shift, y, -shift, band);
      y += band;
    }
    return;
  }

  if (effect === 'blocks') {
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    source.getContext('2d')!.drawImage(image, 0, 0, width, height);
    const count = Math.round(8 + amount * 30);
    for (let index = 0; index < count; index += 1) {
      const blockWidth = Math.round(width * (0.08 + rand(index + 3) * 0.28));
      const blockHeight = Math.round(height * (0.015 + rand(index + 7) * 0.1));
      const x = Math.round(rand(index + 11) * Math.max(0, width - blockWidth));
      const y = Math.round(rand(index + 19) * Math.max(0, height - blockHeight));
      const shift = Math.round((rand(index + 29) * 2 - 1) * width * 0.18 * amount);
      ctx.drawImage(source, x, y, blockWidth, blockHeight, x + shift, y, blockWidth, blockHeight);
    }
    return;
  }

  if (effect === 'stripes') {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const boosted = amount * amount;
    const count = Math.round(10 + amount * 30 + boosted * 55);
    for (let index = 0; index < count; index += 1) {
      const y = Math.round(rand(index + 43) * height);
      const stripeHeight = Math.max(1, Math.round(height * (0.001 + rand(index + 47) * (0.009 + boosted * 0.012))));
      const x = Math.round(rand(index + 53) * width * 0.88);
      const stripeWidth = Math.round(width * (0.025 + rand(index + 59) * 0.28));
      const hue = Math.round(rand(index + 71) * 360);
      const lightness = Math.round(38 + rand(index + 79) * 38);
      ctx.fillStyle = `hsla(${hue},${65 + Math.round(rand(index + 83) * 35)}%,${lightness}%,${0.14 + amount * 0.7})`;
      ctx.fillRect(x, y, stripeWidth, stripeHeight);
    }
    ctx.restore();
    return;
  }

  if (effect === 'noise') {
    const pixels = ctx.getImageData(0, 0, width, height);
    const boosted = amount * amount;
    const strength = 42 * amount + 105 * boosted;
    const badPixelChance = 0.008 + boosted * 0.12;
    for (let index = 0; index < pixels.data.length; index += 4) {
      const noise = (rand(index / 4) - 0.5) * strength;
      if (rand(index / 4 + 101) < badPixelChance) {
        pixels.data[index] = rand(index + 107) > 0.5 ? 255 : 0;
        pixels.data[index + 1] = Math.round(rand(index + 109) * 255);
        pixels.data[index + 2] = rand(index + 113) > 0.5 ? 255 : 0;
      } else {
        pixels.data[index] = Math.max(0, Math.min(255, pixels.data[index]! + noise));
        pixels.data[index + 1] = Math.max(0, Math.min(255, pixels.data[index + 1]! + noise * 0.8));
        pixels.data[index + 2] = Math.max(0, Math.min(255, pixels.data[index + 2]! - noise * 0.45));
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return;
  }

  if (effect === 'wave') {
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    source.getContext('2d')!.drawImage(image, 0, 0, width, height);
    ctx.clearRect(0, 0, width, height);
    const boosted = amount * amount;
    const amplitude = width * (0.035 * amount + 0.13 * boosted);
    const stripHeight = Math.max(1, Math.round(height / 420));
    for (let y = 0; y < height; y += stripHeight) {
      const wave = Math.sin(y * (0.038 + boosted * 0.025) + rand(211) * 6) + Math.sin(y * (0.009 + rand(223) * 0.012) + rand(227) * 6) * 0.65 + (rand(Math.floor(y / Math.max(2, height / 45))) - 0.5) * boosted * 1.5;
      const shift = Math.round(wave * amplitude);
      ctx.drawImage(source, 0, y, width, stripHeight, shift, y, width, stripHeight);
      if (shift > 0) ctx.drawImage(source, width - shift, y, shift, stripHeight, 0, y, shift, stripHeight);
      if (shift < 0) ctx.drawImage(source, 0, y, -shift, stripHeight, width + shift, y, -shift, stripHeight);
    }
    return;
  }

  if (effect === 'mirror') {
    const center = Math.round(width / 2);
    ctx.clearRect(0, 0, width, height);
    const mirrorRight = rand(401) > 0.5;
    const sourceX = mirrorRight ? image.naturalWidth / 2 : 0;
    ctx.drawImage(image, sourceX, 0, image.naturalWidth / 2, image.naturalHeight, 0, 0, center, height);
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(image, sourceX, 0, image.naturalWidth / 2, image.naturalHeight, 0, 0, width - center, height);
    ctx.restore();
    if (amount < 1) {
      ctx.globalAlpha = 1 - amount;
      ctx.drawImage(image, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(5, 8, 15, ${0.2 + amount * 0.45})`;
  const lineGap = Math.max(3, Math.round(9 - amount * 5 + rand(501) * 2));
  const lineHeight = Math.max(1, Math.round(lineGap * 0.34));
  const lineOffset = Math.round(rand(509) * lineGap);
  for (let y = lineOffset; y < height; y += lineGap) ctx.fillRect(0, y, width, lineHeight + (rand(y + 521) > 0.92 ? 1 : 0));
  ctx.restore();
}

export default function GlitchImagePage() {
  const { locale, routeLocale } = useOutletContext<{ copy: PageCopy; locale: Locale; routeLocale: SupportedLocale }>();
  const copy = useLocaleSection<PageLocaleCopy>('glitch-image');
  const common = useLocaleSection<{ intensity: { light: string; medium: string; strong: string }; tryAnother: string; invalidImages: string }>('common');
  const effectCanvasRef = useRef<HTMLCanvasElement>(null);
  const urlsRef = useRef(new Set<string>());
  const [files, setFiles] = useState<ImageEntry[]>([]);
  const [activeId, setActiveId] = useState('');
  const [effect, setEffect] = useState<Effect>('rgb');
  const [intensity, setIntensity] = useState(50);
  const [seed, setSeed] = useState(() => Math.random() * 100000);
  const [error, setError] = useState('');
  const active = files.find((entry) => entry.id === activeId) ?? files[0];

  useEffect(() => () => { urlsRef.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  const drawPreview = useCallback(() => {
    if (!active || !effectCanvasRef.current) return;
    const image = active.image;
    const scale = Math.min(760 / image.naturalWidth, 500 / image.naturalHeight, 1);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    renderEffect(effectCanvasRef.current, image, effect, intensity, width, height, seed);
  }, [active, effect, intensity, seed]);

  useEffect(drawPreview, [drawPreview]);

  const chooseFiles = useCallback((files: File[]) => {
    const accepted = files.slice(0, Math.max(0, 50 - urlsRef.current.size)).filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= MAX_FILE_SIZE);
    if (!accepted.length) return setError(common.invalidImages);
    accepted.forEach((file) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.add(url);
      const image = new Image();
      image.onload = () => {
        const entry = { id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, file, url, image };
        setFiles((current) => [...current, entry]);
        setActiveId((current) => current || entry.id);
        setError('');
      };
      image.onerror = () => { URL.revokeObjectURL(url); urlsRef.current.delete(url); };
      image.src = url;
    });
  }, [locale, routeLocale]);

  const download = () => {
    if (!active) return;
    const image = active.image;
    const canvas = document.createElement('canvas');
    renderEffect(canvas, image, effect, intensity, image.naturalWidth, image.naturalHeight, seed);
    const mime = active.file.type;
    const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    canvas.toBlob((blob) => {
      if (!blob) return;
      const outputUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = outputUrl;
      link.download = `${active.file.name.replace(/\.[^.]+$/, '')}-${effect}.${extension}`;
      link.click();
      URL.revokeObjectURL(outputUrl);
    }, mime, 0.92);
  };
  const intensityLabel = intensity <= 33 ? common.intensity.light : intensity <= 66 ? common.intensity.medium : common.intensity.strong;
  const ideaLabel = common.tryAnother;

  return (
    <main className="bg-[#f9fafc]">
      <section className="relative min-h-[500px] pt-7 pb-14">
        <div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
          <div className="mb-8 text-center"><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">{copy.title}</h1><p className="mt-2 text-base font-medium text-slate-500">{copy.subtitle}</p></div>
          <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
            {active ? (
              <section className="flex min-h-[34rem] flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold text-slate-500">{copy.preview}</p><h2 className="truncate text-lg font-bold text-slate-900">{active.file.name}</h2></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:text-slate-900"><span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>{copy.replace}<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { chooseFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} /></label></div>
                <div className="flex min-h-[25rem] flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-5"><canvas ref={effectCanvasRef} className="block max-h-[500px] max-w-full object-contain" /></div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">{files.map((entry, index) => <button key={entry.id} type="button" onClick={() => setActiveId(entry.id)} className={`flex min-w-0 items-center gap-2 rounded-lg border p-2 text-left ${entry.id === active.id ? 'border-[#3525cd] bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-200'}`}><img src={entry.url} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" /><span className="min-w-0"><span className="block text-xs font-bold text-slate-400">{index + 1}</span><span className="block truncate text-sm font-semibold text-slate-700">{entry.file.name}</span></span></button>)}</div>
              </section>
            ) : <DropZone onFilesSelect={chooseFiles} accept="image/jpeg,image/png,image/webp" maxFiles={50} maxFileSize={MAX_FILE_SIZE} isEasy copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }} />}
            <aside className="rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">{copy.settings}</h2>
              <p className="mt-5 text-sm font-bold text-slate-600">{copy.effectType}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">{(['rgb', 'shift', 'blocks', 'stripes', 'noise', 'wave', 'mirror', 'scanlines'] as Effect[]).map((value) => <button key={value} type="button" onClick={() => setEffect(value)} className={`min-h-[72px] rounded-lg border px-3 py-2 text-left transition-colors ${effect === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'}`}><span className="block text-sm font-bold">{copy.effects[value].title}</span><span className="mt-1 block text-xs font-medium text-slate-400">{copy.effects[value].body}</span></button>)}</div>
              <div className="mt-6 flex items-center justify-between"><label htmlFor="glitch-intensity" className="text-sm font-bold text-slate-600">{copy.intensity}</label><span className="text-sm font-bold text-slate-500">{intensityLabel} · {intensity}%</span></div>
              <input id="glitch-intensity" type="range" min="1" max="100" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} className="mt-3 w-full accent-[#3525cd]" />
              {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-500">{error}</p>}
              <div className="mt-6 flex gap-2">
                <button type="button" onClick={() => setSeed(Math.random() * 100000)} disabled={!active} title={ideaLabel} aria-label={ideaLabel} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-500 hover:bg-amber-100 disabled:border-slate-200 disabled:bg-white disabled:text-slate-300"><span className="material-symbols-outlined text-[23px]">lightbulb</span></button>
                <button type="button" onClick={download} disabled={!active} className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[#3525cd] px-5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"><span className="material-symbols-outlined text-[20px]">download</span>{copy.download}</button>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
