import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { useLocaleSection } from '../localization';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/svg+xml';
const PREVIEW_MAX_HEIGHT = 560;

type LayerImage = {
  file: File;
  url: string;
  image: HTMLImageElement;
  width: number;
  height: number;
  hasAlpha: boolean;
};

type OverlayRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CanvasSize = {
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};
type PageLocaleCopy = {
  title: string;
  subtitle: string;
  preview: string;
  settings: string;
  background: string;
  overlay: string;
  chooseBackground: string;
  chooseOverlay: string;
  output: string;
  width: string;
  height: string;
  download: string;
  empty: string;
  errors: {
    oversize: string;
    unsupported: string;
    load: string;
    missing: string;
  };
};

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAccepted(file: File) {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.type);
}

function getDroppedImageUrl(dataTransfer: DataTransfer) {
  const html = dataTransfer.getData('text/html');
  if (html) {
    const source = new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.src;
    if (source) return source;
  }
  const uri = dataTransfer.getData('text/uri-list').split('\n').find((value) => value && !value.startsWith('#'));
  if (uri) return uri.trim();
  const text = dataTransfer.getData('text/plain').trim();
  return /^(https?:|data:image\/)/i.test(text) ? text : '';
}

function remoteFileName(url: string, type: string) {
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/svg+xml' ? 'svg' : 'jpg';
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'web-image');
    return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${extension}`;
  } catch {
    return `web-image.${extension}`;
  }
}

function detectAlpha(file: File, image: HTMLImageElement) {
  if (file.type === 'image/jpeg') return false;

  const canvas = document.createElement('canvas');
  const maxSize = 512;
  const scale = Math.min(1, maxSize / image.naturalWidth, maxSize / image.naturalHeight);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  try {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 255) < 255) return true;
    }
  } catch {
    return false;
  }

  return false;
}

function loadImage(file: File): Promise<LayerImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      resolve({
        file,
        url,
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        hasAlpha: detectAlpha(file, image),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load'));
    };
    image.src = url;
  });
}

function getInitialOverlay(canvasSize: CanvasSize, overlay: LayerImage): OverlayRect {
  const aspect = overlay.height / overlay.width;
  const maxWidth = Math.min(canvasSize.width * 0.5, canvasSize.height / aspect);
  const width = Math.min(overlay.width, maxWidth);
  const height = width * aspect;
  return {
    x: Math.round((canvasSize.width - width) / 2),
    y: Math.round((canvasSize.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCoverBox(image: LayerImage, canvasSize: CanvasSize, zoom: number, offset: Point) {
  const scale = Math.max(canvasSize.width / image.width, canvasSize.height / image.height) * zoom;
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (canvasSize.width - width) / 2 + offset.x,
    y: (canvasSize.height - height) / 2 + offset.y,
    width,
    height,
  };
}

function clampBackgroundOffset(image: LayerImage, canvasSize: CanvasSize, zoom: number, offset: Point) {
  const centered = getCoverBox(image, canvasSize, zoom, { x: 0, y: 0 });
  return {
    x: clamp(offset.x, -centered.x - centered.width + canvasSize.width, -centered.x),
    y: clamp(offset.y, -centered.y - centered.height + canvasSize.height, -centered.y),
  };
}

function drawCoverImage(context: CanvasRenderingContext2D, image: LayerImage, canvasSize: CanvasSize, zoom: number, offset: Point) {
  const box = getCoverBox(image, canvasSize, zoom, offset);
  context.drawImage(image.image, box.x, box.y, box.width, box.height);
}

export default function ImageMergePage() {
  const copy = useLocaleSection<PageLocaleCopy>('image-merge');
  const ui = useLocaleSection<{ previewScale: string; zoomOut: string; reset: string; zoomIn: string; remove: string }>('image-merge.ui');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; rect: OverlayRect } | null>(null);
  const backgroundDragRef = useRef<{ pointerX: number; pointerY: number; offset: Point } | null>(null);
  const backgroundRef = useRef<LayerImage | null>(null);
  const overlayRef = useRef<LayerImage | null>(null);
  const [background, setBackground] = useState<LayerImage | null>(null);
  const [overlay, setOverlay] = useState<LayerImage | null>(null);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 500, height: 500 });
  const [backgroundZoom, setBackgroundZoom] = useState(1);
  const [backgroundOffset, setBackgroundOffset] = useState<Point>({ x: 0, y: 0 });
  const [previewScale, setPreviewScale] = useState(1);
  const [error, setError] = useState('');
  const [dropTarget, setDropTarget] = useState<'background' | 'overlay' | null>(null);

  const revokeLayer = useCallback((layer: LayerImage | null) => {
    if (layer) URL.revokeObjectURL(layer.url);
  }, []);

  useEffect(() => {
    backgroundRef.current = background;
  }, [background]);

  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);

  useEffect(() => () => {
    revokeLayer(backgroundRef.current);
    revokeLayer(overlayRef.current);
  }, [revokeLayer]);

  const updatePreviewScale = useCallback(() => {
    if (!previewRef.current) {
      setPreviewScale(1);
      return;
    }

    const maxWidth = previewRef.current.clientWidth - 32;
    const scale = Math.min(1, maxWidth / canvasSize.width, PREVIEW_MAX_HEIGHT / canvasSize.height);
    setPreviewScale(scale || 1);
  }, [canvasSize]);

  useEffect(() => {
    updatePreviewScale();
    const observer = new ResizeObserver(updatePreviewScale);
    if (previewRef.current) observer.observe(previewRef.current);
    window.addEventListener('resize', updatePreviewScale);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePreviewScale);
    };
  }, [updatePreviewScale]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);

    if (background && !background.hasAlpha) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (background) {
      drawCoverImage(context, background, canvasSize, backgroundZoom, backgroundOffset);
    }

    if (overlay && overlayRect) {
      context.drawImage(overlay.image, overlayRect.x, overlayRect.y, overlayRect.width, overlayRect.height);
    }
  }, [background, overlay, overlayRect, canvasSize, backgroundZoom, backgroundOffset]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleFile = async (file: File | undefined, type: 'background' | 'overlay') => {
    if (!file) return;
    setError('');

    if (file.size > MAX_FILE_SIZE) {
      setError(copy.errors.oversize);
      return;
    }
    if (!isAccepted(file)) {
      setError(copy.errors.unsupported);
      return;
    }

    try {
      const next = await loadImage(file);

      if (type === 'background') {
        setBackground((previous) => {
          revokeLayer(previous);
          return next;
        });
        setBackgroundZoom(1);
        setBackgroundOffset({ x: 0, y: 0 });
      } else {
        setOverlay((previous) => {
          revokeLayer(previous);
          return next;
        });
        setOverlayRect(getInitialOverlay(canvasSize, next));
      }
    } catch {
      setError(copy.errors.load);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>, type: 'background' | 'overlay') => {
    event.preventDefault();
    setDropTarget(null);
    const localFile = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith('image/'));
    if (localFile) {
      await handleFile(localFile, type);
      return;
    }

    const source = getDroppedImageUrl(event.dataTransfer);
    if (!source) {
      setError(copy.errors.unsupported);
      return;
    }
    try {
      const response = await fetch(source, { mode: 'cors' });
      if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_FILE_SIZE) throw new Error('download');
      const blob = await response.blob();
      const file = new File([blob], remoteFileName(source, blob.type), { type: blob.type });
      await handleFile(file, type);
    } catch {
      setError(copy.errors.load);
    }
  };

  const updateCanvasSize = (key: keyof CanvasSize, value: number) => {
    const nextSize = { ...canvasSize, [key]: Math.round(clamp(value || 1, 1, 8000)) };
    setCanvasSize(nextSize);
    if (background) setBackgroundOffset((current) => clampBackgroundOffset(background, nextSize, backgroundZoom, current));
    if (overlay) setOverlayRect(getInitialOverlay(nextSize, overlay));
  };

  const changeBackgroundZoom = (direction: 1 | -1) => {
    if (!background) return;
    const nextZoom = Math.max(1, Math.round((backgroundZoom + direction * 0.05) * 100) / 100);
    setBackgroundZoom(nextZoom);
    setBackgroundOffset((current) => clampBackgroundOffset(background, canvasSize, nextZoom, current));
  };

  const resetBackground = () => {
    setBackgroundZoom(1);
    setBackgroundOffset({ x: 0, y: 0 });
  };

  const changeOverlayZoom = (direction: 1 | -1) => {
    if (!overlay || !overlayRect) return;
    const scale = direction === 1 ? 1.05 : 0.95;
    const aspect = overlay.height / overlay.width;
    const width = Math.max(1, overlayRect.width * scale);
    const height = width * aspect;
    setOverlayRect({
      x: Math.round(overlayRect.x + (overlayRect.width - width) / 2),
      y: Math.round(overlayRect.y + (overlayRect.height - height) / 2),
      width: Math.round(width),
      height: Math.round(height),
    });
  };

  const resetOverlay = () => {
    if (!overlay) return;
    setOverlayRect(getInitialOverlay(canvasSize, overlay));
  };

  const removeOverlay = () => {
    revokeLayer(overlay);
    setOverlay(null);
    setOverlayRect(null);
  };

  const handleBackgroundPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!background) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    backgroundDragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offset: backgroundOffset,
    };
  };

  const handleBackgroundPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!background || !backgroundDragRef.current) return;
    const dx = (event.clientX - backgroundDragRef.current.pointerX) / previewScale;
    const dy = (event.clientY - backgroundDragRef.current.pointerY) / previewScale;
    setBackgroundOffset(clampBackgroundOffset(background, canvasSize, backgroundZoom, {
      x: backgroundDragRef.current.offset.x + dx,
      y: backgroundDragRef.current.offset.y + dy,
    }));
  };

  const handleBackgroundPointerUp = () => {
    backgroundDragRef.current = null;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!overlayRect) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      rect: overlayRect,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!overlayRect || !dragRef.current) return;
    event.stopPropagation();
    const dx = (event.clientX - dragRef.current.pointerX) / previewScale;
    const dy = (event.clientY - dragRef.current.pointerY) / previewScale;
    setOverlayRect({
      ...overlayRect,
      x: Math.round(dragRef.current.rect.x + dx),
      y: Math.round(dragRef.current.rect.y + dy),
    });
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleDownload = () => {
    if (!background || !canvasRef.current) {
      setError(copy.errors.missing);
      return;
    }

    drawCanvas();
    canvasRef.current.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const baseName = background.file.name.replace(/\.[^.]+$/, '');
      const extension = background.hasAlpha ? 'png' : 'jpg';
      link.href = url;
      link.download = `${baseName}-merged.${extension}`;
      link.click();
      URL.revokeObjectURL(url);
    }, background.hasAlpha ? 'image/png' : 'image/jpeg', 0.92);
  };

  const canvasWidth = Math.round(canvasSize.width * previewScale);
  const canvasHeight = Math.round(canvasSize.height * previewScale);
  const canDownload = Boolean(background);
  const previewPercent = Math.round(previewScale * 100);
  const outputFormat = background?.hasAlpha ? 'PNG' : 'JPG';

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

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <section className="flex min-h-[36rem] min-w-0 flex-col rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-500">{copy.preview}</p>
                  <h3 className="truncate text-lg font-bold tracking-tight text-slate-900" title={background?.file.name}>
                    {background?.file.name ?? copy.output}
                  </h3>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
                  {canvasSize.width}×{canvasSize.height}
                  {previewScale < 1 && <> · {ui.previewScale} {previewPercent}%</>}
                </div>
              </div>

              <div ref={previewRef} className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-4">
                <div
                  className={`relative bg-checkerboard ${background ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  style={{ width: canvasWidth, height: canvasHeight }}
                  onPointerDown={handleBackgroundPointerDown}
                  onPointerMove={handleBackgroundPointerMove}
                  onPointerUp={handleBackgroundPointerUp}
                  onPointerCancel={handleBackgroundPointerUp}
                >
                  <canvas
                    ref={canvasRef}
                    className="block select-none"
                    style={{ width: canvasWidth, height: canvasHeight }}
                  />
                  {overlayRect && overlay && (
                    <div
                      className="absolute cursor-move"
                      style={{
                        left: overlayRect.x * previewScale,
                        top: overlayRect.y * previewScale,
                        width: overlayRect.width * previewScale,
                        height: overlayRect.height * previewScale,
                      }}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                    />
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur-[2px]">
              <h3 className="text-lg font-bold tracking-tight text-slate-900">{copy.settings}</h3>

              <div className="mt-5 grid grid-cols-2 gap-3">
                {([
                  ['width', copy.width],
                  ['height', copy.height],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="text-sm font-bold text-slate-600">{label}</span>
                    <input
                      type="number"
                      min={1}
                      max={8000}
                      value={canvasSize[key]}
                      onChange={(event) => updateCanvasSize(key, Number(event.target.value) || 1)}
                      className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-5 space-y-3">
                {([
                  ['background', copy.background, copy.chooseBackground, background],
                  ['overlay', copy.overlay, copy.chooseOverlay, overlay],
                ] as const).map(([type, label, button, layer]) => (
                  <div
                    key={type}
                    onDragEnter={(event) => { event.preventDefault(); setDropTarget(type); }}
                    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropTarget(type); }}
                    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
                    onDrop={(event) => { void handleDrop(event, type); }}
                    className={`rounded-lg border p-3 transition-colors ${dropTarget === type ? 'border-[#3525cd] bg-indigo-50' : 'border-slate-200 bg-white'}`}
                  >
                    <p className="text-sm font-bold text-slate-600">{label}</p>
                    <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900">
                      <span className="material-symbols-outlined text-[20px]">upload_file</span>
                      {button}
                      <input
                        type="file"
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(event) => {
                          handleFile(event.target.files?.[0], type);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                    {layer && (
                      <p className="mt-2 truncate text-xs font-medium text-slate-400" title={layer.file.name}>
                        {layer.file.name} · {layer.width}×{layer.height} · {formatSize(layer.file.size)}
                      </p>
                    )}
                    <div className={`mt-3 grid gap-2 ${type === 'overlay' ? 'grid-cols-4' : 'grid-cols-3'}`}>
                      {([
                        ['zoom_out', () => type === 'background' ? changeBackgroundZoom(-1) : changeOverlayZoom(-1), ui.zoomOut],
                        ['restart_alt', () => type === 'background' ? resetBackground() : resetOverlay(), ui.reset],
                        ['zoom_in', () => type === 'background' ? changeBackgroundZoom(1) : changeOverlayZoom(1), ui.zoomIn],
                        ...(type === 'overlay' ? [['delete', removeOverlay, ui.remove] as const] : []),
                      ] as const).map(([icon, onClick, label]) => (
                        <button
                          key={icon}
                          type="button"
                          aria-label={`${label}${type === 'background' ? copy.background : copy.overlay}`}
                          title={label}
                          disabled={!layer}
                          onClick={onClick}
                          className="flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-indigo-200 hover:text-[#3525cd] disabled:cursor-not-allowed disabled:text-slate-300"
                        >
                          <span className="material-symbols-outlined text-[21px]">{icon}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <div className="mt-5 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-500">
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={handleDownload}
                disabled={!canDownload}
                className={`mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold shadow-md transition-all ${
                  canDownload
                    ? 'cursor-pointer bg-[#3525cd] text-white hover:bg-[#24189d]'
                    : 'cursor-not-allowed bg-slate-200 text-slate-400'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">download</span>
                {copy.download} {outputFormat}
              </button>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
