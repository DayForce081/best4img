import { useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import ImageCompressor from './ImageCompressor';
import type { Locale, PageCopy } from '../../i18n';

function ImageCompare({
  originalSrc = '/original.jpg',
  compressedSrc = '/tiny-compress.jpg',
  showLabels = true,
  defaultZoom = 1,
  cornerLabel = '',
  pixelated = false,
  splitMode = 'slider',
  containerClassName = 'h-[440px]',
  initialPan = { x: 0, y: 0 },
  draggable = true,
  copy,
}: {
  originalSrc?: string;
  compressedSrc?: string;
  showLabels?: boolean;
  defaultZoom?: number;
  cornerLabel?: string;
  pixelated?: boolean;
  splitMode?: 'slider' | 'side-by-side';
  containerClassName?: string;
  initialPan?: { x: number; y: number };
  draggable?: boolean;
  copy: PageCopy['compare'];
}) {
  const [sliderPos, setSliderPos] = useState(65);
  const [isDragging, setIsDragging] = useState(false);
  const [pan, setPan] = useState(initialPan);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!draggable) return;
    if (splitMode === 'side-by-side') {
      setDragStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y });
    }
    setIsDragging(true);
  };

  const handlePointerUp = () => setIsDragging(false);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !containerRef.current) return;

    if (splitMode === 'side-by-side') {
      setPan({
        x: dragStart.panX + (e.clientX - dragStart.x),
        y: dragStart.panY + (e.clientY - dragStart.y),
      });
    } else {
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      setSliderPos(Math.min(100, Math.max(0, x)));
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${containerClassName} overflow-hidden rounded-2xl select-none border border-white/10 ${draggable ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerMove={handlePointerMove}
    >
      {splitMode === 'side-by-side' ? (
        <div className="relative flex h-full w-full">
          <div className="bg-checkerboard relative h-full w-1/2 overflow-hidden border-r border-white/20">
            <div
              className="absolute inset-0 h-full w-full"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${defaultZoom})`,
                imageRendering: pixelated ? 'pixelated' : 'auto',
              }}
            >
              <img
                src={originalSrc}
                className="pointer-events-none absolute h-full w-[200%] max-w-none object-contain object-center"
                style={{ top: 'calc(var(--spacing) * -4)', left: '-25%' }}
                alt="Original"
              />
            </div>
            {showLabels && (
              <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded border border-white/20 bg-black/60 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white shadow-lg backdrop-blur-md md:text-[10px]">
                {copy.original}
              </div>
            )}
          </div>

          <div className="bg-checkerboard relative h-full w-1/2 overflow-hidden">
            <div
              className="absolute inset-0 h-full w-full"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${defaultZoom})`,
                imageRendering: pixelated ? 'pixelated' : 'auto',
              }}
            >
              <img
                src={compressedSrc}
                className="pointer-events-none absolute h-full w-[200%] max-w-none object-contain object-center"
                style={{ top: 'calc(var(--spacing) * -4)', left: '-25%' }}
                alt="Compressed"
              />
            </div>
            {showLabels && (
              <div className="pointer-events-none absolute right-2 bottom-2 z-20 rounded border border-white/20 bg-primary/60 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white shadow-lg backdrop-blur-md md:text-[10px]">
                {copy.compressed}
              </div>
            )}
          </div>

          {cornerLabel && (
            <div className="pointer-events-none absolute left-2 top-2 z-40 rounded border border-white/20 bg-black/60 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white shadow-lg backdrop-blur-md md:text-[10px]">
              {cornerLabel}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden">
            <img
              src={compressedSrc}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
              style={{ transform: `scale(${defaultZoom})`, imageRendering: pixelated ? 'pixelated' : 'auto' }}
              alt="Compressed"
            />
          </div>

          <div
            className="pointer-events-none absolute inset-0 z-10 h-full w-full"
            style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
          >
            <img
              src={originalSrc}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
              style={{ transform: `scale(${defaultZoom})`, imageRendering: pixelated ? 'pixelated' : 'auto' }}
              alt="Original"
            />
          </div>

          {cornerLabel && (
            <div className="pointer-events-none absolute right-3 top-3 z-40 rounded border border-white/20 bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white shadow-lg backdrop-blur-md md:text-sm">
              {cornerLabel}
            </div>
          )}

          <div
            className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-white"
            style={{ left: `${sliderPos}%` }}
          >
            <div className="absolute top-1/2 left-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-primary bg-white transition-transform duration-200">
              <span className="material-symbols-outlined rotate-90 select-none text-base text-primary">
                unfold_more
              </span>
            </div>
          </div>

          {showLabels && (
            <>
              <div className="pointer-events-none absolute bottom-6 left-6 z-30 flex flex-col gap-1">
                <div className="rounded-xl border border-white/20 bg-black/40 px-4 py-2 text-white shadow-2xl backdrop-blur-xl">
                  <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                    {copy.before}
                  </div>
                  <div className="text-lg font-bold">
                    1.7 MB <span className="ml-1 text-sm font-medium opacity-50">3024 x 1296</span>
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute right-6 bottom-6 z-30 flex flex-col gap-1 text-right">
                <div className="rounded-xl border border-white/20 bg-primary/40 px-4 py-2 text-white shadow-2xl backdrop-blur-xl">
                  <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                    {copy.after}
                  </div>
                  <div className="text-lg font-bold">
                    393 KB <span className="ml-1 font-extrabold text-emerald-400">(-77%)</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function CompressorPage() {
  const { copy } = useOutletContext<{ copy: PageCopy; locale: Locale }>();

  return (
    <>
      <section className="relative min-h-[500px] border-b border-slate-200 bg-[#f9fafc] pt-7 pb-14">
        <div className="relative mx-auto max-w-[72rem] px-6 flex flex-col items-center">
          <div className="text-center mb-8">
            <h2 className="font-bold tracking-tighter text-slate-900 text-2xl md:text-3xl">
              {copy.compressor.heroTitle}
            </h2>
            <p className="text-slate-500 font-medium mt-2 text-base">
              {copy.compressor.heroSubtitle}
            </p>
          </div>
          <div className="w-full">
            <ImageCompressor variant="easy" showHero={false} copy={copy.compressor} />
          </div>
        </div>
      </section>

      <main>
        <section className="content-bg overflow-hidden py-20">
          <div className="mx-auto max-w-[82rem] px-6">
            <section className="mb-24">
              <div className="mb-16 text-center">
                <h1 className="mb-3 text-4xl font-medium tracking-tight text-on-surface md:text-5xl">
                  {copy.hero.title.split('\n').map((line, index) => (
                    <span key={`${line}-${index}`} className="block">
                      {line}
                    </span>
                  ))}
                </h1>
                <p className="text-lg text-on-surface-variant">
                  {copy.hero.subtitle}
                </p>
              </div>

              <div className="mb-20 grid grid-cols-1 gap-12 md:grid-cols-2">
                <div className="flex h-full flex-col">
                  <h3 className="mb-3 text-xl font-bold text-on-surface">
                    <span className="material-symbols-outlined mr-2 align-middle text-primary" style={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
                      imagesmode
                    </span>
                    {copy.featureCards[0].title}
                  </h3>
                  <p className="mb-6 text-sm leading-relaxed text-on-surface-variant">
                    {copy.featureCards[0].body}
                  </p>

                  <ImageCompare
                    originalSrc="/text-original.png"
                    compressedSrc="/text-compress.png"
                    showLabels={true}
                    defaultZoom={3}
                    cornerLabel="300%"
                    pixelated={true}
                    splitMode="side-by-side"
                    containerClassName="mt-auto aspect-video min-h-[320px] w-full bg-surface-container-low"
                    initialPan={{ x: 410, y: 220 }}
                    draggable={false}
                    copy={copy.compare}
                  />
                </div>

                <div className="flex h-full flex-col">
                  <h3 className="mb-3 text-xl font-bold text-on-surface">
                    <span className="material-symbols-outlined mr-2 align-middle text-primary" style={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
                      enhanced_encryption
                    </span>
                    {copy.featureCards[1].title}
                  </h3>
                  <p className="mb-6 text-sm leading-relaxed text-on-surface-variant">
                    {copy.featureCards[1].body}
                  </p>

                  <div className="mt-auto flex aspect-video min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-low">
                    <img src="/local-security.jpg" alt="Secure local file processing" className="h-full w-full object-cover" />
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center">
                <div className="mb-8 max-w-2xl text-center">
                  <h3 className="mb-3 text-2xl font-bold text-on-surface">
                    <span className="material-symbols-outlined mr-2 align-middle text-primary" style={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
                      psychology
                    </span>
                    {copy.autopilot.title}
                  </h3>
                  <p className="mx-auto max-w-[720px] text-sm leading-relaxed text-on-surface-variant">
                    {copy.autopilot.body}
                  </p>
                </div>
                <div className="group/bleed relative mt-4 w-full">
                  <div className="bleed-container flex flex-col items-center justify-center">
                    <ImageCompare copy={copy.compare} containerClassName="h-[550px]" />
                  </div>
                </div>
              </div>
            </section>

            <section className="mb-20">
              <div className="mb-12 text-center">
                <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">{copy.underHood.eyebrow}</h2>
                <p className="text-2xl font-bold text-on-surface">
                  {copy.underHood.title}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {copy.underHood.cards.map((card) => (
                  <div key={card.title} className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-6 transition-colors hover:border-primary/30">
                    <h3 className="mb-2 text-lg font-bold text-on-surface">{card.title}</h3>
                    <p className="text-sm leading-relaxed text-on-surface-variant">{card.body}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </main>
    </>
  );
}
