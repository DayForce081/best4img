import { useOutletContext } from 'react-router-dom';
import { Link } from 'react-router-dom';
import type { PageCopy, SupportedLocale } from '../i18n';
import { useLocaleSection } from '../localization';

type PageKind = 'about' | 'terms' | 'privacy';
type Section = { title: string; paragraphs: string[] };
type InfoCopy = { title: string; intro: string; updated?: string; sections: Section[] };
type InfoUi = { eyebrow: string; highlights: Record<PageKind, string[][]>; tagline: string; explore: string };

export default function InfoPage({ kind }: { kind: PageKind }) {
  const { routeLocale } = useOutletContext<{ copy: PageCopy; routeLocale: SupportedLocale }>();
  const copy = useLocaleSection<InfoCopy>(`info.${kind}`);
  const ui = useLocaleSection<InfoUi>('info.ui');
  const highlights = ui.highlights[kind];

  return (
    <main className="flex-1 bg-white">
      <div className="border-b border-slate-200 bg-[#f9fafc]">
        <div className="mx-auto max-w-4xl px-6">
          <header className="py-10 md:py-12">
            <p className="mb-4 text-xs font-semibold text-slate-500">BEST4IMG · {ui.eyebrow}</p>
            <h1 className="text-3xl font-bold text-slate-950 md:text-4xl">{copy.title}</h1>
            <p className="mt-5 text-base leading-8 text-slate-600 md:text-lg">{copy.intro}</p>
            {copy.updated && <p className="mt-5 text-xs text-slate-500">{copy.updated}</p>}
          </header>
          <div className="grid gap-4 pb-10 md:grid-cols-3">
            {highlights.map(([icon, title, detail], index) => <div key={title} className="flex h-full flex-col items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-6 text-center"><span aria-hidden="true" className={`material-symbols-outlined ${index === 0 ? 'text-emerald-600' : index === 1 ? 'text-[#3525cd]' : 'text-amber-600'}`}>{icon}</span><div><p className="text-sm font-semibold text-slate-900">{title}</p><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p></div></div>)}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-6 py-10 lg:py-14">
        <article className="min-w-0">
          {copy.sections.map((section, index) => <section id={`${kind}-${index}`} key={section.title} className="scroll-mt-8 border-b border-slate-200 pb-8 mb-8 last:mb-0"><div className="flex items-baseline gap-3"><span className="text-sm font-semibold text-[#3525cd]">{String(index + 1).padStart(2, '0')}</span><h2 className="text-xl font-bold text-slate-900">{section.title}</h2></div>{section.paragraphs.map((paragraph) => <p key={paragraph} className="mt-4 text-base leading-8 text-slate-600">{paragraph}</p>)}</section>)}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-8"><p className="text-sm text-slate-500">{ui.tagline}</p><Link to={`/${routeLocale}`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#3525cd]">{ui.explore}<span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span></Link></div>
        </article>
      </div>
    </main>
  );
}
