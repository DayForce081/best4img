import { useOutletContext } from 'react-router-dom';
import Converter from './Converter';
import type { Locale, PageCopy } from '../../i18n';

export default function HeicConverterPage() {
  const { copy } = useOutletContext<{ copy: PageCopy; locale: Locale }>();
  
  const heicCopy = copy.heicConverter;

  return (
    <>
      <section className="relative min-h-[500px] border-b border-slate-200 bg-[#f9fafc] pt-7 pb-14">
        <div className="relative mx-auto max-w-[82rem] px-6 flex flex-col items-center">
          <div className="text-center mb-8">
            <h2 className="font-bold tracking-tighter text-slate-900 text-2xl md:text-3xl">
              {heicCopy?.heroTitle ?? 'HEIC to JPG'}
            </h2>
            <p className="text-slate-500 font-medium mt-2 text-base">
              {heicCopy?.heroSubtitle ?? 'Convert Apple HEIC photos quickly'}
            </p>
          </div>
          <div className="w-full">
            <Converter copy={heicCopy} />
          </div>
        </div>
      </section>

      <main>
        <section className="content-bg overflow-hidden py-20">
          <div className="mx-auto max-w-[82rem] px-6">
            <section className="mb-24">
              {/* Hero */}
              <div className="mb-16 text-center">
                <h1 className="mb-3 text-4xl font-medium tracking-tight text-on-surface md:text-5xl">
                  {heicCopy?.content?.hero?.title?.split('\n').map((line, index) => (
                    <span key={`${line}-${index}`} className="block">
                      {line}
                    </span>
                  ))}
                </h1>
                <p className="text-lg text-on-surface-variant max-w-2xl mx-auto">
                  {heicCopy?.content?.hero?.subtitle}
                </p>
              </div>

              {/* Feature Cards */}
              <div className="grid grid-cols-1 gap-8 md:grid-cols-3 mb-20">
                {heicCopy?.content?.featureCards?.map((card) => (
                  <div
                    key={card.title}
                    className="flex flex-col gap-4 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-6 transition-colors hover:border-primary/30"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                      <span className="material-symbols-outlined text-primary" style={{ fontSize: '22px' }}>
                        {card.icon}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-on-surface">{card.title}</h3>
                    <p className="text-sm leading-relaxed text-on-surface-variant">{card.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Under the Hood */}
            <section className="mb-20">
              <div className="mb-12 text-center">
                <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">
                  {heicCopy?.content?.underHood?.eyebrow}
                </h2>
                <p className="text-2xl font-bold text-on-surface">
                  {heicCopy?.content?.underHood?.title}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {heicCopy?.content?.underHood?.cards?.map((card) => (
                  <div
                    key={card.title}
                    className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-6 transition-colors hover:border-primary/30"
                  >
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
