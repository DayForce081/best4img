import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DropZone from '../components/ui/DropZone';
import { useLocaleSection } from '../localization';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

type Preset = {
  id: string;
  label: string;
  detail: string;
  width: number;
  height: number;
  circle: boolean;
  headTop: number;
  chin: number;
};
type IdPreset = Omit<Preset, 'circle'>;
type CircleCrop = { x: number; y: number; size: number };
type CircleDrag = { type: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; start: CircleCrop; scaleX: number; scaleY: number };

type PageLocaleCopy = {
  title: string; subtitle: string; dropTitle: string; dropHint: string; preview: string;
  replace: string; presets: string; guide: string; zoom: string; reset: string;
  export: string; download: string; ready: string; dragHint: string; unsupported: string; oversize: string;
};

function limits(source: { width: number; height: number }, preset: Preset, zoom: number) {
  const sourceRatio = source.width / source.height;
  const targetRatio = preset.width / preset.height;
  const widthRatio = sourceRatio > targetRatio ? sourceRatio / targetRatio : 1;
  const heightRatio = sourceRatio < targetRatio ? targetRatio / sourceRatio : 1;
  return { x: Math.max(0, (widthRatio * zoom - 1) / 2), y: Math.max(0, (heightRatio * zoom - 1) / 2) };
}

export function PortraitCropPage({ mode }: { mode: 'avatar' | 'id' }) {
  const copy = useLocaleSection<PageLocaleCopy>('avatar-crop');
  const ui = useLocaleSection<{ avatarTitle: string; idTitle: string; avatarSubtitle: string; idSubtitle: string; cropSettings: string; outputSize: string; preset: string; createDownload: string; avatarLabel: string; transparentPng: string; avatarPresets: Array<{ size: number; label: string }>; idPresets: IdPreset[]; presetNote: string; resizeCropArea: string }>('avatar-crop.ui');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [source, setSource] = useState<{ width: number; height: number } | null>(null);
  const [presetId, setPresetId] = useState('one-inch');
  const [avatarWidth, setAvatarWidth] = useState('800');
  const [circleCrop, setCircleCrop] = useState<CircleCrop | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [outputUrl, setOutputUrl] = useState('');
  const [error, setError] = useState('');
  const dragRef = useRef<{ x: number; y: number; offset: { x: number; y: number }; width: number; height: number } | null>(null);
  const circleDragRef = useRef<CircleDrag | null>(null);
  const avatarImageRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef('');
  const outputRef = useRef('');
  const avatarOutputWidth = Math.max(32, Math.min(4096, Number(avatarWidth) || 32));
  const idPresets = useMemo<Preset[]>(() => ui.idPresets.map((item) => ({ ...item, circle: false })), [ui.idPresets]);
  const defaultIdPreset = idPresets[0]!;
  const preset = useMemo<Preset>(() => mode === 'avatar'
    ? { id: 'avatar', label: ui.avatarLabel, detail: ui.transparentPng, width: avatarOutputWidth, height: avatarOutputWidth, circle: true, headTop: 0, chin: 0 }
    : idPresets.find((item) => item.id === presetId) ?? defaultIdPreset,
  [avatarOutputWidth, defaultIdPreset, idPresets, mode, presetId, ui.avatarLabel, ui.transparentPng]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (outputRef.current) URL.revokeObjectURL(outputRef.current);
  }, []);

  const clearOutput = useCallback(() => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current);
    outputRef.current = '';
    setOutputUrl('');
  }, []);

  const chooseFiles = useCallback((files: File[]) => {
    const next = files[0];
    if (!next) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) return setError(copy.unsupported);
    if (next.size > MAX_FILE_SIZE) return setError(copy.oversize);
    setError('');
    clearOutput();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const nextUrl = URL.createObjectURL(next);
    const image = new Image();
    image.onload = () => {
      setFile(next);
      setUrl(nextUrl);
      urlRef.current = nextUrl;
      setSource({ width: image.naturalWidth, height: image.naturalHeight });
      const size = Math.round(Math.min(image.naturalWidth, image.naturalHeight) * 0.72);
      setCircleCrop({ x: Math.round((image.naturalWidth - size) / 2), y: Math.round((image.naturalHeight - size) / 2), size });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    image.onerror = () => { URL.revokeObjectURL(nextUrl); setError(copy.unsupported); };
    image.src = nextUrl;
  }, [clearOutput, copy.oversize, copy.unsupported]);

  const clampOffset = useCallback((next: { x: number; y: number }, nextZoom = zoom) => {
    if (!source) return next;
    const max = limits(source, preset, nextZoom);
    return { x: Math.max(-max.x, Math.min(max.x, next.x)), y: Math.max(-max.y, Math.min(max.y, next.y)) };
  }, [preset, source, zoom]);

  const selectPreset = (id: string) => {
    setPresetId(id);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    clearOutput();
  };

  const changeAvatarWidth = (value: string) => {
    if (!/^\d*$/.test(value)) return;
    setAvatarWidth(value);
    clearOutput();
  };

  const changeZoom = (value: number) => {
    const next = Math.max(1, Math.min(4, value));
    setZoom(next);
    setOffset((current) => clampOffset(current, next));
    clearOutput();
  };

  const startCircleDrag = (event: React.PointerEvent, type: CircleDrag['type']) => {
    if (!circleCrop || !source || !avatarImageRef.current) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const rect = avatarImageRef.current.getBoundingClientRect();
    circleDragRef.current = { type, startX: event.clientX, startY: event.clientY, start: circleCrop, scaleX: source.width / rect.width, scaleY: source.height / rect.height };
  };

  const moveCircleDrag = (event: React.PointerEvent) => {
    const drag = circleDragRef.current;
    if (!drag || !source) return;
    const dx = (event.clientX - drag.startX) * drag.scaleX;
    const dy = (event.clientY - drag.startY) * drag.scaleY;
    if (drag.type === 'move') {
      setCircleCrop({ ...drag.start, x: Math.max(0, Math.min(source.width - drag.start.size, drag.start.x + dx)), y: Math.max(0, Math.min(source.height - drag.start.size, drag.start.y + dy)) });
    } else {
      const delta = drag.type === 'se' ? (dx + dy) / 2 : drag.type === 'nw' ? (-dx - dy) / 2 : drag.type === 'ne' ? (dx - dy) / 2 : (-dx + dy) / 2;
      const right = drag.start.x + drag.start.size;
      const bottom = drag.start.y + drag.start.size;
      const maxSize = drag.type === 'se' ? Math.min(source.width - drag.start.x, source.height - drag.start.y) : drag.type === 'nw' ? Math.min(right, bottom) : drag.type === 'ne' ? Math.min(source.width - drag.start.x, bottom) : Math.min(right, source.height - drag.start.y);
      const size = Math.max(32, Math.min(maxSize, drag.start.size + delta));
      setCircleCrop({ x: drag.type.includes('w') ? right - size : drag.start.x, y: drag.type.includes('n') ? bottom - size : drag.start.y, size });
    }
    clearOutput();
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!source) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = { x: event.clientX, y: event.clientY, offset, width: rect.width, height: rect.height };
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = { x: drag.offset.x + (event.clientX - drag.x) / drag.width, y: drag.offset.y + (event.clientY - drag.y) / drag.height };
    setOffset(clampOffset(next));
    clearOutput();
  };

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    if (source) {
      const size = Math.round(Math.min(source.width, source.height) * 0.72);
      setCircleCrop({ x: Math.round((source.width - size) / 2), y: Math.round((source.height - size) / 2), size });
    }
    clearOutput();
  };

  const createPng = useCallback(async () => {
    if (!source || !url || (mode === 'avatar' && !circleCrop)) return;
    const bitmap = await createImageBitmap(file!);
    const canvas = document.createElement('canvas');
    canvas.width = preset.width;
    canvas.height = preset.height;
    const ctx = canvas.getContext('2d')!;
    if (mode === 'avatar') {
      ctx.beginPath();
      ctx.arc(preset.width / 2, preset.height / 2, Math.min(preset.width, preset.height) / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, circleCrop!.x, circleCrop!.y, circleCrop!.size, circleCrop!.size, 0, 0, preset.width, preset.height);
    } else {
      const base = Math.max(preset.width / source.width, preset.height / source.height);
      const drawWidth = source.width * base * zoom;
      const drawHeight = source.height * base * zoom;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, (preset.width - drawWidth) / 2 + offset.x * preset.width, (preset.height - drawHeight) / 2 + offset.y * preset.height, drawWidth, drawHeight);
    }
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(), 'image/png'));
    clearOutput();
    const nextUrl = URL.createObjectURL(blob);
    outputRef.current = nextUrl;
    setOutputUrl(nextUrl);
    if (mode === 'avatar') {
      const link = document.createElement('a');
      link.href = nextUrl;
      link.download = `${file!.name.replace(/\.[^.]+$/, '')}-${preset.id}.png`;
      link.click();
    }
  }, [circleCrop, clearOutput, file, mode, offset.x, offset.y, preset, source, url, zoom]);

  const download = () => {
    if (!outputUrl || !file) return;
    const link = document.createElement('a');
    link.href = outputUrl;
    link.download = `${file.name.replace(/\.[^.]+$/, '')}-${preset.id}.png`;
    link.click();
  };

  const frameWidth = Math.min(500, 500 * (preset.width / preset.height));
  const frameStyle = { aspectRatio: `${preset.width} / ${preset.height}`, width: `min(100%, ${frameWidth}px)`, maxWidth: '100%' };
  const sourceRatio = source ? source.width / source.height : 1;
  const targetRatio = preset.width / preset.height;
  const imageWidth = sourceRatio > targetRatio ? `${(sourceRatio / targetRatio) * 100}%` : '100%';
  const imageHeight = sourceRatio < targetRatio ? `${(targetRatio / sourceRatio) * 100}%` : '100%';
  const imageStyle = {
    left: `${50 + offset.x * 100}%`,
    top: `${50 + offset.y * 100}%`,
    width: imageWidth,
    height: imageHeight,
    transform: `translate(-50%, -50%) scale(${zoom})`,
  };
  const circleStyle = circleCrop && source ? {
    left: `${(circleCrop.x / source.width) * 100}%`,
    top: `${(circleCrop.y / source.height) * 100}%`,
    width: `${(circleCrop.size / source.width) * 100}%`,
    aspectRatio: '1 / 1',
  } : undefined;

  return (
    <main className="bg-[#f9fafc]">
      <section className="relative min-h-[500px] pt-7 pb-14">
        <div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
              {mode === 'avatar' ? ui.avatarTitle : ui.idTitle}
            </h1>
            <p className="mt-2 text-base font-medium text-slate-500">
              {mode === 'avatar' ? ui.avatarSubtitle : ui.idSubtitle}
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
            {url && source ? (
              <section className="flex min-h-[34rem] flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="text-sm font-bold text-slate-500">{copy.preview}</p><h2 className="truncate text-lg font-bold text-slate-900">{file?.name}</h2></div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:text-slate-900">
                    <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>{copy.replace}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { chooseFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} />
                  </label>
                </div>
                <div className="flex flex-1 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 p-5">
                  <div className="flex h-full w-full items-center justify-center">
                    {mode === 'avatar' ? (
                      <div className="relative inline-block max-w-full overflow-hidden rounded-lg bg-checkerboard touch-none select-none" onPointerMove={moveCircleDrag} onPointerUp={() => { circleDragRef.current = null; }} onPointerCancel={() => { circleDragRef.current = null; }}>
                        <img ref={avatarImageRef} src={url} alt="" draggable={false} className="pointer-events-none block max-h-[500px] max-w-full object-contain" />
                        <div className="absolute cursor-move rounded-full border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]" style={circleStyle} onPointerDown={(event) => startCircleDrag(event, 'move')}>
                          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => <button key={corner} type="button" aria-label={ui.resizeCropArea} onPointerDown={(event) => startCircleDrag(event, corner)} className={`absolute h-4 w-4 rounded-full border-2 border-white bg-[#3525cd] shadow-sm ${corner === 'nw' ? '-left-2 -top-2 cursor-nwse-resize' : corner === 'ne' ? '-right-2 -top-2 cursor-nesw-resize' : corner === 'sw' ? '-bottom-2 -left-2 cursor-nesw-resize' : '-bottom-2 -right-2 cursor-nwse-resize'}`} />)}
                        </div>
                      </div>
                    ) : (
                      <div className="relative h-auto w-auto max-h-[500px] overflow-hidden rounded-sm bg-checkerboard touch-none select-none" style={frameStyle} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
                        <img src={url} alt="" draggable={false} className="pointer-events-none absolute max-w-none object-fill will-change-transform" style={imageStyle} />
                        <div className="pointer-events-none absolute inset-0 ring-inset ring-white/90" style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.9)' }} />
                        <svg className="pointer-events-none absolute inset-0 h-full w-full text-white/90" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                          <ellipse cx="50" cy={`${((preset.headTop + preset.chin) / 2) * 100}`} rx="21" ry={`${((preset.chin - preset.headTop) / 2) * 100}`} fill="none" stroke="currentColor" strokeWidth="0.55" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
                          <path d={`M43 ${preset.chin * 100} L43 72 Q28 74 18 88 M57 ${preset.chin * 100} L57 72 Q72 74 82 88`} fill="none" stroke="currentColor" strokeWidth="0.55" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
                          <path d="M18 88 Q50 77 82 88" fill="none" stroke="currentColor" strokeWidth="0.7" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
                        </svg>
                        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-bold text-white drop-shadow">{copy.dragHint}</div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            ) : <DropZone onFilesSelect={chooseFiles} accept="image/jpeg,image/png,image/webp" maxFiles={1} maxFileSize={MAX_FILE_SIZE} isEasy copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }} />}

            <aside className="rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">{mode === 'avatar' ? ui.cropSettings : copy.presets}</h2>
              {mode === 'avatar' ? (
                <div className="mt-4 space-y-5">
                  <label className="block"><span className="text-sm font-bold text-slate-600">{ui.outputSize}</span><div className="mt-2 flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3"><input type="number" min="32" max="4096" value={avatarWidth} onChange={(event) => changeAvatarWidth(event.target.value)} onBlur={() => setAvatarWidth(String(avatarOutputWidth))} className="h-11 w-full bg-transparent text-sm font-bold text-slate-900 outline-none" /><span className="text-sm font-bold text-slate-400">px</span></div><p className="mt-2 text-xs font-medium text-slate-400">{avatarOutputWidth} × {avatarOutputWidth} · PNG</p></label>
                  <div className="grid grid-cols-3 gap-2">
                    {ui.avatarPresets.map((item) => <button key={`${item.size}-${item.label}`} type="button" onClick={() => { setAvatarWidth(String(item.size)); clearOutput(); }} className={`min-h-14 rounded-lg border px-2 py-2 text-center transition-colors ${avatarOutputWidth === item.size ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'}`}><span className="block text-sm font-bold">{item.size} px</span><span className="mt-1 block truncate text-[10px] font-medium text-slate-400" title={item.label}>{item.label}</span></button>)}
                  </div>
                </div>
              ) : (
                <><div className="mt-4 grid grid-cols-2 gap-2">
                  {idPresets.map((item) => <button key={item.id} type="button" onClick={() => selectPreset(item.id)} className={`min-h-16 rounded-lg border px-3 py-2 text-left transition-colors ${preset.id === item.id ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'}`}><span className="block text-sm font-bold">{item.label}</span><span className="mt-1 block text-[11px] font-medium text-slate-400">{item.detail}</span></button>)}
                </div><p className="mt-3 text-xs leading-5 text-slate-400">{ui.presetNote}</p></>
              )}
              {mode === 'id' && <><div className="mt-6 flex items-center justify-between"><label htmlFor="avatar-zoom" className="text-sm font-bold text-slate-600">{copy.zoom}</label><span className="text-sm font-bold text-slate-500">{Math.round(zoom * 100)}%</span></div><input id="avatar-zoom" type="range" min="1" max="4" step="0.01" value={zoom} disabled={!source} onChange={(event) => changeZoom(Number(event.target.value))} className="mt-3 w-full accent-[#3525cd]" /><div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500"><span>{copy.guide}</span><span>{preset.width} × {preset.height}</span></div></>}
              {mode === 'id' && <button type="button" onClick={reset} disabled={!source} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 disabled:text-slate-300"><span className="material-symbols-outlined text-[18px]">restart_alt</span>{copy.reset}</button>}
              {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-500">{error}</p>}
              {mode === 'id' && outputUrl && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{copy.ready}</p>}
              <button type="button" onClick={createPng} disabled={!source} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#3525cd] px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"><span className="material-symbols-outlined text-[20px]">{mode === 'avatar' ? 'download' : 'crop_free'}</span>{mode === 'avatar' ? ui.createDownload : copy.export}</button>
              {mode === 'id' && <button type="button" onClick={download} disabled={!outputUrl} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-[#3525cd] ring-1 ring-indigo-100 disabled:text-slate-300 disabled:ring-slate-200"><span className="material-symbols-outlined text-[20px]">download</span>{copy.download}</button>}
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function AvatarCropPage() {
  return <PortraitCropPage mode="avatar" />;
}
