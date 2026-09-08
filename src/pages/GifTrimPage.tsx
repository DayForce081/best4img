import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { parseGIF, decompressFrame, type ParsedGif } from 'gifuct-js';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import DropZone from '../components/ui/DropZone';
import type { Locale } from '../i18n';
import { useLocaleSection } from '../localization';

type PlaybackMode = 'forward' | 'reverse' | 'pingPong';

// Decode one patch at a time, retaining the composed canvas rather than every RGBA frame.
function* compose(parsed: ParsedGif, canvas: HTMLCanvasElement, end: number) {
  canvas.width = parsed.lsd.width;
  canvas.height = parsed.lsd.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames = parsed.frames.filter((frame) => 'image' in frame);
  const first = frames[0];
  const bg = parsed.gct?.[parsed.lsd.backgroundColorIndex];
  const transparent = first && 'gce' in first && first.gce?.extras.transparentColorGiven;
  const clear = (x: number, y: number, w: number, h: number) => {
    ctx.clearRect(x, y, w, h);
    if (!transparent && bg) { ctx.fillStyle = `rgb(${bg.join(',')})`; ctx.fillRect(x, y, w, h); }
  };
  clear(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < end; index++) {
    const raw = frames[index]!;
    if (!('image' in raw)) continue;
    const frame = decompressFrame(raw, parsed.gct, true);
    const { left, top, width, height } = frame.dims;
    const restore = frame.disposalType === 3 ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    const pixels = ctx.getImageData(left, top, width, height);
    for (let p = 0; p < frame.patch.length; p += 4) if (frame.patch[p + 3]) pixels.data.set(frame.patch.subarray(p, p + 4), p);
    ctx.putImageData(pixels, left, top);
    yield { index, delay: (raw.gce?.delay ?? 10) * 10, ctx };
    if (index === end - 1) return;
    if (frame.disposalType === 2) clear(left, top, width, height);
    else if (restore) ctx.putImageData(restore, 0, 0);
  }
}

export default function GifTrimPage() {
  const { locale } = useOutletContext<{ locale: Locale }>();
  const c = useLocaleSection<string[]>('gif-trim');
  const [source, setSource] = useState<{ file: File; parsed: ParsedGif; count: number }>();
  const [start, setStart] = useState('1');
  const [end, setEnd] = useState('1');
  const [cursor, setCursor] = useState(1);
  const [result, setResult] = useState('');
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [delays, setDelays] = useState<number[]>([]);
  const [batchDelay, setBatchDelay] = useState('100');
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('forward');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const token = useRef(0);
  const outputRef = useRef('');
  useEffect(() => () => { token.current++; URL.revokeObjectURL(outputRef.current); }, []);
  const clearResult = () => { URL.revokeObjectURL(outputRef.current); outputRef.current = ''; setResult(''); };
  const valid = !!source && Number.isInteger(+start) && Number.isInteger(+end) && +start >= 1 && +end >= +start && +end <= source.count;
  const selectedDelays = valid ? delays.slice(+start - 1, +end) : [];
  const outputDelays = playbackMode === 'pingPong' ? [...selectedDelays, ...selectedDelays.slice(1, -1).reverse()] : selectedDelays;
  const duration = outputDelays.reduce((sum, delay) => sum + delay, 0);
  const outputFrameCount = outputDelays.length;
  const ui = useLocaleSection<{ playbackOrder: string; forward: string; reverse: string; pingPong: string }>('gif-trim-ui');

  const choose = async (files: File[]) => {
    const file = files[0];
    if (!file || busy) return;
    const job = ++token.current;
    clearResult(); setError(''); setBusy(true); setSource(undefined); setThumbs([]); setDelays([]);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error();
      const buffer = await file.arrayBuffer();
      if (!/^GIF8[79]a$/.test(new TextDecoder().decode(buffer.slice(0, 6)))) throw new Error();
      const parsed = parseGIF(buffer);
      const count = parsed.frames.filter((f) => 'image' in f).length;
      if (!count || !parsed.lsd.width || !parsed.lsd.height || parsed.lsd.width * parsed.lsd.height > 16000000) throw new Error();
      if (job !== token.current) return;
      const frameDelays = parsed.frames.filter((f) => 'image' in f).map((frame) => 'gce' in frame ? Math.max(10, (frame.gce?.delay ?? 10) * 10) : 100);
      setSource({ file, parsed, count }); setDelays(frameDelays); setStart('1'); setEnd(String(count)); setCursor(1);
      const frameCanvas = document.createElement('canvas');
      const thumbCanvas = document.createElement('canvas');
      const previews: string[] = [];
      for (const frame of compose(parsed, frameCanvas, count)) {
        if (job !== token.current) return;
        const scale = Math.min(96 / frameCanvas.width, 72 / frameCanvas.height, 1);
        thumbCanvas.width = Math.max(1, Math.round(frameCanvas.width * scale));
        thumbCanvas.height = Math.max(1, Math.round(frameCanvas.height * scale));
        const thumbCtx = thumbCanvas.getContext('2d')!;
        thumbCtx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);
        thumbCtx.drawImage(frameCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        previews.push(thumbCanvas.toDataURL('image/webp', 0.72));
        if (frame.index % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (job === token.current) setThumbs(previews);
    } catch { if (job === token.current) setError(c[13]!); }
    finally { if (job === token.current) setBusy(false); }
  };

  useEffect(() => {
    if (!source || !canvasRef.current || result) return;
    let cancelled = false;
    const frameCanvas = document.createElement('canvas');
    const draw = async () => {
      try {
        for (const frame of compose(source.parsed, frameCanvas, cursor)) {
          if (cancelled) return;
          if (frame.index % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const scale = Math.min(1, 900 / frameCanvas.width, 500 / frameCanvas.height);
        canvas.width = Math.max(1, Math.round(frameCanvas.width * scale)); canvas.height = Math.max(1, Math.round(frameCanvas.height * scale));
        canvas.getContext('2d')!.drawImage(frameCanvas, 0, 0, canvas.width, canvas.height);
      } catch { if (!cancelled) setError(c[14]!); }
    };
    void draw();
    return () => { cancelled = true; };
  }, [source, cursor, result, c]);

  const generate = async () => {
    if (!source || !valid || busy) return;
    const job = ++token.current;
    setBusy(true); setError(''); clearResult();
    try {
      const gif = GIFEncoder();
      const canvas = document.createElement('canvas');
      const app = source.parsed.frames.find((f) => 'application' in f && /NETSCAPE|ANIMEXTS/.test(f.application.id));
      const blocks = app && 'application' in app ? app.application.blocks : undefined;
      const repeat = blocks && blocks.length >= 3 ? blocks[1]! | blocks[2]! << 8 : -1;
      const prepareFrame = (data: Uint8ClampedArray, delay: number) => {
        const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
        const transparentIndex = palette.findIndex((color) => color.length === 4 && color[3]! < 128);
        return { pixels: applyPalette(data, palette, 'rgba4444'), palette, delay, transparentIndex };
      };
      const writeFrame = (frame: ReturnType<typeof prepareFrame>, first: boolean) => {
        gif.writeFrame(frame.pixels, canvas.width, canvas.height, { palette: frame.palette, delay: frame.delay, repeat: first ? repeat : undefined, dispose: 2, transparent: frame.transparentIndex >= 0, transparentIndex: Math.max(0, frame.transparentIndex) });
      };
      if (playbackMode === 'forward') {
        let written = 0;
        for (const frame of compose(source.parsed, canvas, +end)) {
          if (job !== token.current) return;
          if (frame.index >= +start - 1) {
            writeFrame(prepareFrame(frame.ctx.getImageData(0, 0, canvas.width, canvas.height).data, delays[frame.index] ?? frame.delay), written === 0);
            written += 1;
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } else {
        const frames: Array<ReturnType<typeof prepareFrame>> = [];
        for (const frame of compose(source.parsed, canvas, +end)) {
          if (job !== token.current) return;
          if (frame.index >= +start - 1) frames.push(prepareFrame(frame.ctx.getImageData(0, 0, canvas.width, canvas.height).data, delays[frame.index] ?? frame.delay));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const ordered = playbackMode === 'reverse' ? [...frames].reverse() : [...frames, ...frames.slice(1, -1).reverse()];
        ordered.forEach((frame, index) => writeFrame(frame, index === 0));
      }
      gif.finish();
      if (job !== token.current) return;
      outputRef.current = URL.createObjectURL(new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' }));
      setResult(outputRef.current);
    } catch { if (job === token.current) setError(c[14]!); }
    finally { if (job === token.current) setBusy(false); }
  };
  const fieldClass = 'mt-2 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-indigo-400';
  return <main className="flex-1 bg-[#f9fafc]"><section className="mx-auto max-w-[82rem] px-6 pb-14 pt-7">
    <header className="mb-8 text-center"><h1 className="text-2xl font-bold text-slate-900 md:text-3xl">{c[0]}</h1><p className="mt-2 text-base text-slate-500">{c[1]}</p></header>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">{source ? <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold text-slate-500">{result ? c[15] : c[4]}</p><p className="max-w-[22rem] truncate font-semibold">{source.file.name}</p></div><label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">{c[5]}<input type="file" accept="image/gif" disabled={busy} className="hidden" onChange={(e) => { void choose(Array.from(e.target.files ?? [])); e.target.value = ''; }} /></label></div>
        <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-lg bg-slate-100 p-5">{result ? <img src={result} alt={c[15]} className="max-h-[500px] max-w-full bg-checkerboard object-contain" /> : <canvas ref={canvasRef} className="max-h-[500px] max-w-full bg-checkerboard object-contain" />}</div>
        <div className="mt-5 flex justify-between text-sm text-slate-500"><span>{c[16]} · {cursor} / {source.count}</span><span>{source.parsed.lsd.width} × {source.parsed.lsd.height}</span></div>
        <input aria-label={c[16]} type="range" min="1" max={source.count} value={cursor} disabled={busy} onChange={(e) => { clearResult(); setCursor(+e.target.value); }} className="mt-3 w-full accent-[#3525cd]" />
        <div className="mt-6 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-700">{c[18]}</h3><span className="text-xs text-slate-400">{source.count}</span></div>
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2">{thumbs.map((thumb, index) => {
          const frameNumber = index + 1;
          const selected = frameNumber >= +start && frameNumber <= +end;
          return <div key={frameNumber} className={`min-w-0 rounded-lg border p-2 ${cursor === frameNumber ? 'border-[#3525cd] bg-indigo-50' : selected ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-55'}`}>
            <button type="button" onClick={() => { clearResult(); setCursor(frameNumber); }} className="flex h-[72px] w-full items-center justify-center overflow-hidden rounded-md bg-checkerboard"><img src={thumb} alt={`${c[16]} ${frameNumber}`} className="max-h-full max-w-full object-contain" /></button>
            <div className="mt-2 flex items-center justify-between gap-1"><span className="text-xs font-bold text-slate-500">{frameNumber}</span><label className="flex min-w-0 items-center rounded-md border border-slate-200 bg-white px-1.5"><input aria-label={`${c[16]} ${frameNumber} ${c[19]}`} type="number" min="10" max="60000" step="10" value={delays[index] ?? 100} onChange={(e) => { const next = Math.max(10, Math.min(60000, Number(e.target.value) || 10)); setDelays((current) => current.map((value, i) => i === index ? next : value)); clearResult(); }} className="h-7 min-w-0 w-12 bg-transparent text-right text-xs font-semibold outline-none" /><span className="ml-1 text-[10px] text-slate-400">ms</span></label></div>
          </div>;
        })}</div>
      </section> : <DropZone onFilesSelect={(files) => { void choose(files); }} accept="image/gif" maxFiles={1} maxFileSize={20 * 1024 * 1024} isEasy copy={{ dropTitle: c[2]!, dropHint: c[3]! }} />}</div>
      <aside className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">{c[6]}</h2><div className="mt-5 grid grid-cols-2 gap-3">{[[c[7], start, true], [c[8], end, false]].map(([label, value, first]) => <label key={String(label)} className="text-sm font-semibold text-slate-600">{label}<input type="number" min="1" max={source?.count ?? 1} value={String(value)} disabled={!source || busy} onChange={(e) => { clearResult(); if (first) setStart(e.target.value); else setEnd(e.target.value); const n = +e.target.value; if (source && Number.isInteger(n) && n >= 1 && n <= source.count) setCursor(n); }} className={fieldClass} /></label>)}</div>
        <div className="mt-5 border-t border-slate-100 pt-5"><label className="text-sm font-semibold text-slate-600">{c[20]}<div className="mt-2 flex gap-2"><div className="flex min-w-0 flex-1 items-center rounded-lg border border-slate-200 bg-slate-50 px-3"><input type="number" min="10" max="60000" step="10" value={batchDelay} disabled={!source || busy} onChange={(e) => setBatchDelay(e.target.value)} className="h-10 min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" /><span className="text-xs text-slate-400">ms</span></div><button type="button" disabled={!valid || busy} onClick={() => { const value = Math.max(10, Math.min(60000, Number(batchDelay) || 10)); setBatchDelay(String(value)); setDelays((current) => current.map((delay, index) => index >= +start - 1 && index < +end ? value : delay)); clearResult(); }} className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 text-xs font-bold text-[#3525cd] disabled:text-slate-300">{c[21]}</button></div></label></div>
        <div className="mt-5 border-t border-slate-100 pt-5"><p className="text-sm font-semibold text-slate-600">{ui.playbackOrder}</p><div className="mt-2 grid grid-cols-3 gap-2">{(['forward', 'reverse', 'pingPong'] as const).map((mode) => <button key={mode} type="button" disabled={!source || busy} onClick={() => { setPlaybackMode(mode); clearResult(); }} className={`h-10 rounded-lg border px-1 text-xs font-bold ${playbackMode === mode ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-500'}`}>{ui[mode]}</button>)}</div></div>
        <dl className="mt-5 space-y-3 border-y border-slate-100 py-4 text-sm"><div className="flex justify-between"><dt className="text-slate-500">{c[9]}</dt><dd>{valid ? outputFrameCount : '—'}</dd></div><div className="flex justify-between"><dt className="text-slate-500">{c[17]}</dt><dd>{valid ? `${(duration / 1000).toFixed(2)} s` : '—'}</dd></div></dl>
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
        <button disabled={!valid || busy} onClick={() => { void generate(); }} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#3525cd] px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"><span className="material-symbols-outlined" aria-hidden="true">content_cut</span>{busy ? c[12] : c[10]}</button>
        {result && <a href={result} download={`${source?.file.name.replace(/\.gif$/i, '')}-frames-${start}-${end}.gif`} className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-indigo-100 py-3 text-sm font-semibold text-[#3525cd]"><span className="material-symbols-outlined" aria-hidden="true">download</span>{c[11]}</a>}
      </aside>
    </div>
  </section></main>;
}
