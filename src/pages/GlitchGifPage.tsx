import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import DropZone from '../components/ui/DropZone';
import { renderEffect, type Effect } from './GlitchImagePage';
import type { Locale, SupportedLocale } from '../i18n';
import { useLocaleSection } from '../localization';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const effects: Effect[] = ['rgb', 'shift', 'blocks', 'stripes', 'noise', 'wave', 'mirror', 'scanlines'];
export default function GlitchGifPage() {
  const { locale, routeLocale } = useOutletContext<{ locale: Locale; routeLocale: SupportedLocale }>();
  const c = useLocaleSection<string[]>('glitch-gif');
  const common = useLocaleSection<{ intensity: { light: string; medium: string; strong: string }; tryAnother: string; originalSize: string }>('common');
  const effectCopy = useLocaleSection<Record<Effect, { title: string; body: string }>>('glitch-image.effects');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceUrl = useRef('');
  const outputUrl = useRef('');
  const animation = useRef(0);
  const [source, setSource] = useState<{ file: File; image: HTMLImageElement }>();
  const [effect, setEffect] = useState<Effect>('rgb');
  const [intensity, setIntensity] = useState(50);
  const [fps, setFps] = useState(12);
  const [duration, setDuration] = useState(2);
  const [maxSide, setMaxSide] = useState(0);
  const [seed, setSeed] = useState(() => Math.random() * 100000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const clearResult = () => { URL.revokeObjectURL(outputUrl.current); outputUrl.current = ''; };
  useEffect(() => () => { cancelAnimationFrame(animation.current); URL.revokeObjectURL(sourceUrl.current); URL.revokeObjectURL(outputUrl.current); }, []);

  const dimensions = useCallback(() => {
    if (!source) return { width: 1, height: 1 };
    const scale = maxSide > 0 ? maxSide / Math.max(source.image.naturalWidth, source.image.naturalHeight) : 1;
    return { width: Math.max(1, Math.round(source.image.naturalWidth * scale)), height: Math.max(1, Math.round(source.image.naturalHeight * scale)) };
  }, [maxSide, source]);

  const outputSizeLabel = (longestSide: number) => {
    if (longestSide === 0) return common.originalSize;
    if (!source) return `${longestSide}px`;
    const scale = longestSide / Math.max(source.image.naturalWidth, source.image.naturalHeight);
    return `${Math.max(1, Math.round(source.image.naturalWidth * scale))} × ${Math.max(1, Math.round(source.image.naturalHeight * scale))}`;
  };

  useEffect(() => {
    if (!source || busy) return;
    let last = 0;
    let frame = 0;
    const frameStep = 41 + seed % 173;
    const draw = (time: number) => {
      if (time - last >= 1000 / fps && canvasRef.current) {
        const size = dimensions();
        renderEffect(canvasRef.current, source.image, effect, intensity, size.width, size.height, frame * frameStep + seed);
        frame += 1;
        last = time;
      }
      animation.current = requestAnimationFrame(draw);
    };
    animation.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation.current);
  }, [busy, dimensions, effect, fps, intensity, seed, source]);

  const choose = (files: File[]) => {
    const file = files[0];
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_FILE_SIZE) return;
    clearResult(); setError(''); URL.revokeObjectURL(sourceUrl.current);
    const url = URL.createObjectURL(file); sourceUrl.current = url;
    const image = new Image(); image.onload = () => setSource({ file, image }); image.src = url;
  };

  const generate = async (seedValue = seed) => {
    if (!source || busy) return;
    setBusy(true); setError(''); clearResult();
    try {
      const size = dimensions();
      const canvas = document.createElement('canvas');
      const gif = GIFEncoder({ initialCapacity: Math.max(4096, size.width * size.height) });
      const count = fps * duration;
      const frameStep = 41 + seedValue % 173;
      for (let index = 0; index < count; index += 1) {
        renderEffect(canvas, source.image, effect, intensity, size.width, size.height, index * frameStep + seedValue);
        const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, size.width, size.height).data;
        const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
        const transparentIndex = palette.findIndex((color) => color.length === 4 && color[3]! < 128);
        gif.writeFrame(applyPalette(data, palette, 'rgba4444'), size.width, size.height, {
          palette,
          delay: Math.round(1000 / fps),
          repeat: index === 0 ? 0 : undefined,
          dispose: 2,
          transparent: transparentIndex >= 0,
          transparentIndex: Math.max(0, transparentIndex),
        });
        if (index % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      gif.finish();
      outputUrl.current = URL.createObjectURL(new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' }));
      const link = document.createElement('a');
      link.href = outputUrl.current;
      link.download = `${source.file.name.replace(/\.[^.]+$/, '')}-glitch.gif`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      const downloadedUrl = outputUrl.current;
      window.setTimeout(() => {
        URL.revokeObjectURL(downloadedUrl);
        if (outputUrl.current === downloadedUrl) outputUrl.current = '';
      }, 1000);
    } catch { setError(c[15]!); }
    finally { setBusy(false); }
  };

  const optionClass = (active: boolean) => `h-10 rounded-lg border text-xs font-bold ${active ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500'}`;
  const translatedEffect = (value: Effect) => effectCopy[value];
  const intensityLabel = intensity <= 33 ? common.intensity.light : intensity <= 66 ? common.intensity.medium : common.intensity.strong;
  const ideaLabel = common.tryAnother;
  return <main className="flex-1 bg-[#f9fafc]"><section className="mx-auto max-w-[82rem] px-6 pb-14 pt-7">
    <header className="mb-8 text-center"><h1 className="text-2xl font-bold text-slate-900 md:text-3xl">{c[0]}</h1><p className="mt-2 text-base text-slate-500">{c[1]}</p></header>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {source ? <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="mb-4 flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold text-slate-500">{c[4]}</p><h2 className="truncate text-lg font-bold">{source.file.name}</h2></div><label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600">{c[5]}<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => { choose(Array.from(e.target.files ?? [])); e.target.value = ''; }} /></label></div><div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-5"><canvas ref={canvasRef} className="max-h-[500px] max-w-full object-contain" /></div></section> : <DropZone onFilesSelect={choose} accept="image/jpeg,image/png,image/webp" maxFiles={1} maxFileSize={MAX_FILE_SIZE} isEasy copy={{ dropTitle: c[2]!, dropHint: c[3]! }} />}
      <aside className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">{c[6]}</h2><p className="mt-5 text-sm font-bold text-slate-600">{c[7]}</p><div className="mt-3 grid grid-cols-2 gap-2">{effects.map((value) => <button key={value} onClick={() => { setEffect(value); clearResult(); }} className={`min-h-[72px] rounded-lg border px-3 py-2 text-left ${effect === value ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-600'}`}><span className="block text-sm font-bold">{translatedEffect(value).title}</span><span className="mt-1 block text-xs font-medium text-slate-400">{translatedEffect(value).body}</span></button>)}</div>
        <div className="mt-5 flex justify-between text-sm font-bold text-slate-600"><label htmlFor="gif-glitch-intensity">{c[8]}</label><span>{intensityLabel} · {intensity}%</span></div><input id="gif-glitch-intensity" type="range" min="1" max="100" value={intensity} onChange={(e) => { setIntensity(+e.target.value); clearResult(); }} className="mt-3 w-full accent-[#3525cd]" />
        <p className="mt-5 text-sm font-bold text-slate-600">{c[9]}</p><div className="mt-2 grid grid-cols-3 gap-2">{[8, 12, 16].map((value) => <button key={value} onClick={() => { setFps(value); clearResult(); }} className={optionClass(fps === value)}>{value} FPS</button>)}</div>
        <p className="mt-5 text-sm font-bold text-slate-600">{c[10]}</p><div className="mt-2 grid grid-cols-3 gap-2">{[1, 2, 3].map((value) => <button key={value} onClick={() => { setDuration(value); clearResult(); }} className={optionClass(duration === value)}>{value}s</button>)}</div>
        <p className="mt-5 text-sm font-bold text-slate-600">{c[11]}</p><div className="mt-2 grid grid-cols-3 gap-2">{[0, 400, 600].map((value) => <button key={value} onClick={() => { setMaxSide(value); clearResult(); }} className={optionClass(maxSide === value)}>{outputSizeLabel(value)}</button>)}</div>
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}<div className="mt-6 flex gap-2"><button type="button" disabled={!source || busy} onClick={() => { setSeed(Math.random() * 100000); clearResult(); }} title={ideaLabel} aria-label={ideaLabel} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-500 hover:bg-amber-100 disabled:border-slate-200 disabled:bg-white disabled:text-slate-300"><span className="material-symbols-outlined text-[23px]">lightbulb</span></button><button disabled={!source || busy} onClick={() => void generate()} className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[#3525cd] text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"><span className="material-symbols-outlined">download</span>{busy ? c[13] : c[14]}</button></div>
      </aside>
    </div>
  </section></main>;
}
