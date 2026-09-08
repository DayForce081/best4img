import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { parseGIF, decompressFrame, type ParsedGif } from 'gifuct-js';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import DropZone from '../components/ui/DropZone';
import type { Locale, PageCopy, SupportedLocale } from '../i18n';
import { useLocaleSection } from '../localization';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

type Crop = { x: number; y: number; width: number; height: number };
type DragType = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type RatioKey = 'original' | '1:1' | '3:4' | '16:9' | '4:3' | '9:16' | '2:3' | '3:2';
type DragState = {
  type: DragType;
  startX: number;
  startY: number;
  startCrop: Crop;
  scaleX: number;
  scaleY: number;
};
type PageLocaleCopy = {
  title: string;
  subtitle: string;
  dropTitle: string;
  dropHint: string;
  settings: string;
  cropBox: string;
  width: string;
  height: string;
  ratios: { original: string };
  reset: string;
  crop: string;
  download: string;
  replace: string;
  ready: string;
  errors: {
    oversize: string;
    unsupported: string;
    read: string;
    crop: string;
};
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function defaultCrop(width: number, height: number): Crop {
  const cropWidth = Math.round(width * 0.8);
  const cropHeight = Math.round(height * 0.8);
  return {
    x: Math.round((width - cropWidth) / 2),
    y: Math.round((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

function outputName(name: string, mime: string) {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg';
  return `${name.replace(/\.[^.]+$/, '')}-cropped.${ext}`;
}

function* composeGif(parsed: ParsedGif, canvas: HTMLCanvasElement) {
  canvas.width = parsed.lsd.width;
  canvas.height = parsed.lsd.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames = parsed.frames.filter((frame) => 'image' in frame);
  const first = frames[0];
  const bg = parsed.gct?.[parsed.lsd.backgroundColorIndex];
  const transparent = first && 'gce' in first && first.gce?.extras.transparentColorGiven;
  const clear = (x: number, y: number, width: number, height: number) => {
    ctx.clearRect(x, y, width, height);
    if (!transparent && bg) {
      ctx.fillStyle = `rgb(${bg.join(',')})`;
      ctx.fillRect(x, y, width, height);
    }
  };
  clear(0, 0, canvas.width, canvas.height);

  for (const raw of frames) {
    if (!('image' in raw)) continue;
    const frame = decompressFrame(raw, parsed.gct, true);
    const { left, top, width, height } = frame.dims;
    const restore = frame.disposalType === 3 ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    const pixels = ctx.getImageData(left, top, width, height);
    for (let index = 0; index < frame.patch.length; index += 4) {
      if (frame.patch[index + 3]) pixels.data.set(frame.patch.subarray(index, index + 4), index);
    }
    ctx.putImageData(pixels, left, top);
    yield { ctx, delay: Math.max(10, (raw.gce?.delay ?? 10) * 10) };
    if (frame.disposalType === 2) clear(left, top, width, height);
    else if (restore) ctx.putImageData(restore, 0, 0);
  }
}

function fitRatioSize(width: number, height: number, maxWidth: number, maxHeight: number, ratio: number) {
  let nextWidth = width;
  let nextHeight = height;

  if (width / height > ratio) {
    nextHeight = width / ratio;
  } else {
    nextWidth = height * ratio;
  }

  if (nextWidth > maxWidth) {
    nextWidth = maxWidth;
    nextHeight = nextWidth / ratio;
  }
  if (nextHeight > maxHeight) {
    nextHeight = maxHeight;
    nextWidth = nextHeight * ratio;
  }

  return {
    width: clamp(nextWidth, 1, maxWidth),
    height: clamp(nextHeight, 1, maxHeight),
  };
}

function getRatio(key: RatioKey, dimensions: { width: number; height: number }) {
  if (key === 'original') return dimensions.width / dimensions.height;
  if (key === '1:1') return 1;
  if (key === '3:4') return 3 / 4;
  if (key === '4:3') return 4 / 3;
  if (key === '9:16') return 9 / 16;
  if (key === '2:3') return 2 / 3;
  if (key === '3:2') return 3 / 2;
  return 16 / 9;
}

function fitCropToRatio(crop: Crop, dimensions: { width: number; height: number }, ratio: number): Crop {
  const fitted = fitRatioSize(crop.width, crop.height, dimensions.width, dimensions.height, ratio);
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;

  return {
    x: clamp(centerX - fitted.width / 2, 0, dimensions.width - fitted.width),
    y: clamp(centerY - fitted.height / 2, 0, dimensions.height - fitted.height),
    width: fitted.width,
    height: fitted.height,
  };
}

export default function CropPage({ gifOnly = false }: { gifOnly?: boolean }) {
  const { locale, routeLocale } = useOutletContext<{ copy: PageCopy; locale: Locale; routeLocale: SupportedLocale }>();
  const baseCopy = useLocaleSection<PageLocaleCopy>('crop');
  const gifCopy = useLocaleSection<Pick<PageLocaleCopy, 'title' | 'subtitle' | 'dropTitle' | 'dropHint'>>('crop-gif');
  const copy = gifOnly ? { ...baseCopy, ...gifCopy } : baseCopy;
  const acceptedTypes = gifOnly ? ['image/gif'] : ACCEPTED_TYPES;
  const accept = gifOnly ? 'image/gif' : 'image/jpeg,image/png,image/webp,image/gif';
  const imageRef = useRef<HTMLImageElement>(null);
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const topMaskRef = useRef<HTMLDivElement>(null);
  const rightMaskRef = useRef<HTMLDivElement>(null);
  const bottomMaskRef = useRef<HTMLDivElement>(null);
  const leftMaskRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingCropRef = useRef<Crop | null>(null);
  const frameRef = useRef<number | null>(null);
  const urlRef = useRef<string | null>(null);
  const outputUrlRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [outputUrl, setOutputUrl] = useState('');
  const [outputNameValue, setOutputNameValue] = useState('');
  const [error, setError] = useState('');
  const [selectedRatio, setSelectedRatio] = useState<RatioKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const updateCrop = useCallback((next: Crop) => {
    if (!dimensions) return;
    const width = clamp(next.width, 1, dimensions.width);
    const height = clamp(next.height, 1, dimensions.height);
    setCrop({
      x: clamp(next.x, 0, dimensions.width - width),
      y: clamp(next.y, 0, dimensions.height - height),
      width,
      height,
    });
  }, [dimensions]);

  const addFiles = useCallback((files: File[]) => {
    const nextFile = files[0];
    if (!nextFile) return;

    setError('');
    setOutputUrl('');
    setOutputNameValue('');
    if (outputUrlRef.current) {
      URL.revokeObjectURL(outputUrlRef.current);
      outputUrlRef.current = null;
    }

    if (nextFile.size > MAX_FILE_SIZE) {
      setError(copy.errors.oversize);
      return;
    }
    if (!acceptedTypes.includes(nextFile.type)) {
      setError(copy.errors.unsupported);
      return;
    }

    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(nextFile);
    urlRef.current = url;
    setFile(nextFile);
    setImageUrl(url);

    const img = new Image();
    img.onload = () => {
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      setDimensions(size);
      setCrop(defaultCrop(size.width, size.height));
      setSelectedRatio(null);
    };
    img.onerror = () => setError(copy.errors.read);
    img.src = url;
  }, [acceptedTypes, copy.errors.oversize, copy.errors.read, copy.errors.unsupported]);

  const startDrag = useCallback((event: React.PointerEvent, type: DragType) => {
    if (!crop || !imageRef.current || !dimensions) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = imageRef.current.getBoundingClientRect();
    dragRef.current = {
      type,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: crop,
      scaleX: dimensions.width / rect.width,
      scaleY: dimensions.height / rect.height,
    };
  }, [crop, dimensions]);

  const applyCropToDom = useCallback((next: Crop) => {
    if (!dimensions) return;
    const left = (next.x / dimensions.width) * 100;
    const top = (next.y / dimensions.height) * 100;
    const width = (next.width / dimensions.width) * 100;
    const height = (next.height / dimensions.height) * 100;
    if (cropBoxRef.current) Object.assign(cropBoxRef.current.style, { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` });
    if (topMaskRef.current) Object.assign(topMaskRef.current.style, { height: `${top}%` });
    if (bottomMaskRef.current) Object.assign(bottomMaskRef.current.style, { top: `${top + height}%` });
    if (leftMaskRef.current) Object.assign(leftMaskRef.current.style, { top: `${top}%`, width: `${left}%`, height: `${height}%` });
    if (rightMaskRef.current) Object.assign(rightMaskRef.current.style, { top: `${top}%`, left: `${left + width}%`, height: `${height}%` });
  }, [dimensions]);

  const calculateDragCrop = useCallback((drag: DragState, clientX: number, clientY: number) => {
    if (!dimensions) return null;
    const dx = (clientX - drag.startX) * drag.scaleX;
    const dy = (clientY - drag.startY) * drag.scaleY;
    if (drag.type === 'move') {
      return {
        ...drag.startCrop,
        x: clamp(drag.startCrop.x + dx, 0, dimensions.width - drag.startCrop.width),
        y: clamp(drag.startCrop.y + dy, 0, dimensions.height - drag.startCrop.height),
      };
    }

    let nextLeft = drag.startCrop.x;
    let nextTop = drag.startCrop.y;
    let nextRight = drag.startCrop.x + drag.startCrop.width;
    let nextBottom = drag.startCrop.y + drag.startCrop.height;

    if (drag.type.includes('w')) nextLeft = nextLeft + dx;
    if (drag.type.includes('n')) nextTop = nextTop + dy;
    if (drag.type.includes('e')) nextRight = nextRight + dx;
    if (drag.type.includes('s')) nextBottom = nextBottom + dy;

    if (selectedRatio) {
      const ratio = getRatio(selectedRatio, dimensions);
      const anchorLeft = drag.type.includes('e') ? drag.startCrop.x : nextRight;
      const anchorTop = drag.type.includes('s') ? drag.startCrop.y : nextBottom;
      const maxWidth = drag.type.includes('e') ? dimensions.width - anchorLeft : anchorLeft;
      const maxHeight = drag.type.includes('s') ? dimensions.height - anchorTop : anchorTop;
      const fitted = fitRatioSize(Math.abs(nextRight - nextLeft), Math.abs(nextBottom - nextTop), maxWidth, maxHeight, ratio);

      nextLeft = drag.type.includes('w') ? anchorLeft - fitted.width : anchorLeft;
      nextTop = drag.type.includes('n') ? anchorTop - fitted.height : anchorTop;
      nextRight = drag.type.includes('e') ? anchorLeft + fitted.width : anchorLeft;
      nextBottom = drag.type.includes('s') ? anchorTop + fitted.height : anchorTop;
    } else {
      if (drag.type.includes('w')) nextLeft = clamp(nextLeft, 0, nextRight - 1);
      if (drag.type.includes('n')) nextTop = clamp(nextTop, 0, nextBottom - 1);
      if (drag.type.includes('e')) nextRight = clamp(nextRight, nextLeft + 1, dimensions.width);
      if (drag.type.includes('s')) nextBottom = clamp(nextBottom, nextTop + 1, dimensions.height);
    }

    return {
      x: nextLeft,
      y: nextTop,
      width: nextRight - nextLeft,
      height: nextBottom - nextTop,
    };
  }, [dimensions, selectedRatio]);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = calculateDragCrop(drag, event.clientX, event.clientY);
    if (!next) return;
    pendingCropRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingCropRef.current) applyCropToDom(pendingCropRef.current);
    });
  }, [applyCropToDom, calculateDragCrop]);

  const stopDrag = useCallback(() => {
    const finalCrop = pendingCropRef.current;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (finalCrop) {
      applyCropToDom(finalCrop);
      setCrop(finalCrop);
    }
    pendingCropRef.current = null;
    dragRef.current = null;
  }, [applyCropToDom]);

  const handleNumberChange = useCallback((key: 'width' | 'height', value: number) => {
    if (!crop || !dimensions) return;
    if (!selectedRatio) {
      updateCrop({ ...crop, [key]: value });
      return;
    }

    const ratio = getRatio(selectedRatio, dimensions);
    if (key === 'width') {
      const width = clamp(value, 1, Math.min(dimensions.width - crop.x, (dimensions.height - crop.y) * ratio));
      updateCrop({ ...crop, width, height: width / ratio });
    } else {
      const height = clamp(value, 1, Math.min(dimensions.height - crop.y, (dimensions.width - crop.x) / ratio));
      updateCrop({ ...crop, width: height * ratio, height });
    }
  }, [crop, dimensions, selectedRatio, updateCrop]);

  const handleRatioClick = useCallback((key: RatioKey) => {
    if (selectedRatio === key) {
      setSelectedRatio(null);
      return;
    }
    setSelectedRatio(key);
    if (crop && dimensions) updateCrop(fitCropToRatio(crop, dimensions, getRatio(key, dimensions)));
  }, [crop, dimensions, selectedRatio, updateCrop]);

  const handleReset = useCallback(() => {
    if (dimensions) {
      const nextCrop = defaultCrop(dimensions.width, dimensions.height);
      setCrop(selectedRatio ? fitCropToRatio(nextCrop, dimensions, getRatio(selectedRatio, dimensions)) : nextCrop);
      setOutputUrl('');
      setOutputNameValue('');
      if (outputUrlRef.current) {
        URL.revokeObjectURL(outputUrlRef.current);
        outputUrlRef.current = null;
      }
    }
  }, [dimensions, selectedRatio]);

  const handleCrop = useCallback(async () => {
    if (!file || !crop || busy) return;

    try {
      setBusy(true);
      let blob: Blob | null;
      if (file.type === 'image/gif') {
        const parsed = parseGIF(await file.arrayBuffer());
        const sourceCanvas = document.createElement('canvas');
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = crop.width;
        outputCanvas.height = crop.height;
        const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
        if (!outputContext) throw new Error('Canvas is not available');
        const gif = GIFEncoder({ initialCapacity: Math.max(4096, file.size) });
        const app = parsed.frames.find((frame) => 'application' in frame && /NETSCAPE|ANIMEXTS/.test(frame.application.id));
        const blocks = app && 'application' in app ? app.application.blocks : undefined;
        const repeat = blocks && blocks.length >= 3 ? blocks[1]! | blocks[2]! << 8 : -1;
        let frameIndex = 0;

        for (const frame of composeGif(parsed, sourceCanvas)) {
          outputContext.clearRect(0, 0, crop.width, crop.height);
          outputContext.drawImage(sourceCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
          const data = outputContext.getImageData(0, 0, crop.width, crop.height).data;
          const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
          const transparentIndex = palette.findIndex((color) => color.length === 4 && color[3]! < 128);
          gif.writeFrame(applyPalette(data, palette, 'rgba4444'), crop.width, crop.height, {
            palette,
            delay: frame.delay,
            repeat: frameIndex === 0 ? repeat : undefined,
            dispose: 2,
            transparent: transparentIndex >= 0,
            transparentIndex: Math.max(0, transparentIndex),
          });
          frameIndex += 1;
          if (frameIndex % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        gif.finish();
        blob = new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' });
      } else {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = crop.width;
      canvas.height = crop.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available');

      ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      bitmap.close();

        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.92));
      }
      if (!blob) throw new Error('Unable to export image');

      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
      const url = URL.createObjectURL(blob);
      outputUrlRef.current = url;
      setOutputUrl(url);
      setOutputNameValue(outputName(file.name, file.type));
      setError('');
    } catch {
      setError(copy.errors.crop);
    } finally {
      setBusy(false);
    }
  }, [busy, copy.errors.crop, crop, file]);

  const handleDownload = useCallback(() => {
    if (!outputUrl) return;
    const a = document.createElement('a');
    a.href = outputUrl;
    a.download = outputNameValue || 'BEST4IMG-cropped';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [outputNameValue, outputUrl]);

  const boxStyle = crop && dimensions
    ? {
        left: `${(crop.x / dimensions.width) * 100}%`,
        top: `${(crop.y / dimensions.height) * 100}%`,
        width: `${(crop.width / dimensions.width) * 100}%`,
        height: `${(crop.height / dimensions.height) * 100}%`,
      }
    : undefined;

  const cornerHandles: Array<{ type: DragType; className: string }> = [
    { type: 'nw', className: '-left-2 -top-2 cursor-nw-resize' },
    { type: 'ne', className: '-right-2 -top-2 cursor-ne-resize' },
    { type: 'sw', className: '-left-2 -bottom-2 cursor-sw-resize' },
    { type: 'se', className: '-right-2 -bottom-2 cursor-se-resize' },
  ];
  const common = useLocaleSection<{ preview: string; processing: string; resizeCropBox: string }>('common');
  const previewTitle = common.preview;

  return (
    <main className="bg-[#f9fafc]">
      <section className="relative min-h-[500px] pt-7 pb-14">
        <div className="relative mx-auto flex max-w-[82rem] flex-col px-6">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold tracking-tighter text-slate-900 md:text-3xl">
              {copy.title}
            </h2>
            <p className="mt-2 text-base font-medium text-slate-500">
              {copy.subtitle}
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
            {imageUrl && dimensions && crop ? (
              <section className="flex min-h-[24rem] flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-500">{previewTitle}</p>
                    <h3 className="truncate text-lg font-bold tracking-tight text-slate-900" title={file?.name}>
                      {file?.name}
                    </h3>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:text-slate-900">
                    <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                    {copy.replace}
                    <input
                      type="file"
                      accept={accept}
                      disabled={busy}
                      className="hidden"
                      onChange={(event) => {
                        addFiles(event.target.files ? Array.from(event.target.files) : []);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>

                <div className="flex flex-1 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 p-4">
                  <div
                    className="relative inline-block max-w-full overflow-hidden rounded-lg bg-checkerboard shadow-sm"
                    onPointerMove={handlePointerMove}
                    onPointerUp={stopDrag}
                    onPointerCancel={stopDrag}
                  >
                    <img
                      ref={imageRef}
                      src={imageUrl}
                      alt={file?.name ?? ''}
                      className="block max-h-[34rem] max-w-full select-none object-contain"
                      draggable={false}
                    />
                    <div ref={topMaskRef} className="pointer-events-none absolute inset-x-0 top-0 bg-black/60" style={{ height: boxStyle?.top }} />
                    <div ref={bottomMaskRef} className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60" style={{ top: `calc(${boxStyle?.top ?? '0%'} + ${boxStyle?.height ?? '0%'})` }} />
                    <div ref={leftMaskRef} className="pointer-events-none absolute left-0 bg-black/60" style={{ top: boxStyle?.top, width: boxStyle?.left, height: boxStyle?.height }} />
                    <div ref={rightMaskRef} className="pointer-events-none absolute right-0 bg-black/60" style={{ top: boxStyle?.top, left: `calc(${boxStyle?.left ?? '0%'} + ${boxStyle?.width ?? '0%'})`, height: boxStyle?.height }} />
                    <div
                      ref={cropBoxRef}
                      className="absolute cursor-move touch-none border-2 border-white will-change-[left,top,width,height]"
                      style={boxStyle}
                      onPointerDown={(event) => startDrag(event, 'move')}
                    >
                      <div className="pointer-events-none absolute inset-0 bg-white/10" />
                      {cornerHandles.map((handle) => (
                        <button
                          key={handle.type}
                          type="button"
                          aria-label={common.resizeCropBox}
                          className={`absolute h-5 w-5 rounded-full border-2 border-white bg-[#3525cd] ${handle.className}`}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            startDrag(event, handle.type);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              <DropZone
                onFilesSelect={addFiles}
                accept={accept}
                maxFiles={1}
                maxFileSize={MAX_FILE_SIZE}
                isEasy={true}
                copy={{ dropTitle: copy.dropTitle, dropHint: copy.dropHint }}
              />
            )}

            <section className="rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
              <h3 className="text-lg font-bold tracking-tight text-slate-900">{copy.settings}</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">{copy.cropBox}</p>

              <div className="mt-5 flex flex-wrap gap-2">
                {(['original', '1:1', '3:4', '16:9', '4:3', '9:16', '2:3', '3:2'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleRatioClick(key)}
                    disabled={!crop}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:text-slate-300 ${
                      selectedRatio === key
                        ? 'border-[#3525cd] bg-indigo-50 text-[#3525cd]'
                        : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {key === 'original' ? copy.ratios.original : key}
                  </button>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-3 items-end gap-3">
                {([
                  ['width', copy.width],
                  ['height', copy.height],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="text-sm font-bold text-slate-600">{label}</span>
                    <input
                      type="number"
                      min={1}
                      value={crop?.[key] ?? ''}
                      disabled={!crop}
                      onChange={(event) => handleNumberChange(key, Number(event.target.value) || 0)}
                      className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none disabled:text-slate-300"
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!crop}
                  className="h-11 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  {copy.reset}
                </button>
              </div>

              {error && (
                <div className="mt-5 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-500">
                  {error}
                </div>
              )}
              {outputUrl && !error && (
                <div className="mt-5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                  {copy.ready}
                </div>
              )}

              <button
                type="button"
                onClick={handleCrop}
                disabled={!file || !crop || busy}
                className={`mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold shadow-md transition-all ${
                  file && crop && !busy
                    ? 'cursor-pointer bg-[#3525cd] text-white hover:bg-[#24189d]'
                    : 'cursor-not-allowed bg-slate-200 text-slate-400'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">crop</span>
                {busy ? common.processing : copy.crop}
              </button>

              <button
                type="button"
                onClick={handleDownload}
                disabled={!outputUrl}
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold shadow-md transition-all ${
                  outputUrl
                    ? 'cursor-pointer bg-white text-[#3525cd] ring-1 ring-indigo-100 hover:bg-indigo-50'
                    : 'cursor-not-allowed bg-white text-slate-300 ring-1 ring-slate-200'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">download</span>
                {copy.download}
              </button>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
