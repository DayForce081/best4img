import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocaleSection } from '../localization';

type ToolCard = {
  title: string;
  body: string;
  icon: string;
  href: string;
  badge: string;
};

type HomeCopy = { title: string; subtitle: string; tools: ToolCard[] };
type HomeUi = {
  badges: { smartOptimize: string; newFeature: string; supportsAnimation: string; freshIdea: string };
  categories: Array<[string, string]>;
  gifTrim: ToolCard;
  directory: Array<{ title: string; links: Array<[string, string]> }>;
  commonTasks: Array<[string, string, string]>;
  splitRouteTitles: Record<string, string>;
  content: { introTitle: string; introBody: string; taskTitle: string; taskBody: string; directoryTitle: string; directoryBody: string };
  benefits: string[][];
  categoriesAria: string;
  noResults: string;
};

export default function HomePage() {
  const copy = useLocaleSection<HomeCopy>('home');
  const ui = useLocaleSection<HomeUi>('home.ui');
  const [category, setCategory] = useState('all');
  const categoryByHref: Record<string, string> = {
    compress: 'optimize', 'compress/svg': 'optimize', 'gif-compress': 'optimize', resize: 'edit', crop: 'edit',
    'avatar-crop': 'edit', 'id-photo-crop': 'edit', rotate: 'edit', convert: 'convert', 'convert-heic': 'convert',
    'images-to-gif': 'gif', 'gif-trim': 'gif', 'glitch-gif': 'gif', watermark: 'create', 'merge-images': 'create',
    base64: 'create', 'pixel-art': 'create', 'color-palette': 'create', 'glitch-image': 'create',
  };
  const allTools = useMemo(() => [...copy.tools, ui.gifTrim].sort((a, b) => Number(b.href === 'merge-images') - Number(a.href === 'merge-images')), [copy.tools, ui.gifTrim]);
  const visibleTools = allTools.filter((tool) => {
    const matchesCategory = category === 'all' || categoryByHref[tool.href] === category || (category === 'gif' && tool.href === 'gif-compress');
    return matchesCategory;
  });
  const toolTitle = (label: string, href: string) => allTools.find((tool) => tool.href === href)?.title ?? ui.splitRouteTitles[href] ?? label;

  return (
    <main className="bg-[#f9fafc]">
      <section>
        <div className="mx-auto max-w-[82rem] px-6 pb-5 pt-9 md:pb-6 md:pt-12">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">{copy.title}</h1>
            <p className="mx-auto mt-4 max-w-2xl text-base font-medium leading-7 text-slate-600 md:text-lg">{copy.subtitle}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto min-h-[500px] max-w-[82rem] px-6 pb-10 pt-4">
        <div className="mb-7 flex flex-wrap justify-center gap-2" aria-label={ui.categoriesAria}>
          {ui.categories.map(([key, label]) => <button key={key} type="button" onClick={() => setCategory(key)} className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${category === key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900'}`}>{label}</button>)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleTools.map((tool) => {
            const badge = tool.href === 'compress'
              ? { text: ui.badges.smartOptimize, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
              : tool.href === 'resize'
                ? { text: ui.badges.supportsAnimation, className: 'border-indigo-200 bg-indigo-50 text-indigo-700' }
              : tool.href === 'avatar-crop'
                ? { text: ui.badges.newFeature, className: 'border-amber-200 bg-amber-50 text-amber-700' }
              : tool.href === 'id-photo-crop'
                ? { text: ui.badges.newFeature, className: 'border-amber-200 bg-amber-50 text-amber-700' }
              : tool.href === 'glitch-image'
                ? { text: ui.badges.freshIdea, className: 'border-amber-200 bg-amber-50 text-amber-700' }
              : tool.href === 'merge-images' || tool.href === 'gif-trim' || tool.href === 'glitch-gif' || tool.href === 'compress/svg'
                ? { text: ui.badges.newFeature, className: 'border-amber-200 bg-amber-50 text-amber-700' }
                : null;
            const card = (
              <div className="group flex h-[12.5rem] flex-col rounded-lg border border-slate-200 bg-white p-5 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-indigo-300">
                <div>
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <span className="material-symbols-outlined home-tool-icon text-indigo-600 transition-transform group-hover:scale-105">
                      {tool.icon}
                    </span>
                    {badge && (
                      <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${badge.className}`}>
                        {badge.text}
                      </span>
                    )}
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-950">{tool.title}</h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{tool.body}</p>
                </div>
              </div>
            );

            return (
              <Link key={tool.title} to={tool.href} className="block">
                {card}
              </Link>
            );
          })}
        </div>
        {!visibleTools.length && <div className="border-y border-slate-200 py-16 text-center"><span className="material-symbols-outlined text-4xl text-slate-300">search_off</span><p className="mt-3 font-semibold text-slate-600">{ui.noResults}</p></div>}
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-[82rem] px-6 py-14 md:py-16">
          <div className="mx-auto max-w-4xl text-center"><h2 className="text-3xl font-semibold text-slate-950">{ui.content.introTitle}</h2><p className="mt-4 text-base leading-8 text-slate-600">{ui.content.introBody}</p></div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {ui.benefits.map(([icon, title, body]) => <article key={title} className="rounded-lg border border-slate-200 bg-[#f9fafc] p-6 text-center"><span className="material-symbols-outlined text-3xl text-indigo-600">{icon}</span><h3 className="mt-5 text-lg font-semibold text-slate-950">{title}</h3><p className="mt-2 text-sm leading-7 text-slate-600">{body}</p></article>)}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-[82rem] px-6 pb-16 pt-4 md:pb-20 md:pt-8">
          <div className="mx-auto max-w-3xl text-center"><h2 className="text-3xl font-semibold text-slate-950">{ui.content.taskTitle}</h2><p className="mt-4 leading-8 text-slate-600">{ui.content.taskBody}</p></div>
          <div className="mt-9 grid gap-4 md:grid-cols-2">
            {ui.commonTasks.map(([title, body, href]) => <Link key={title} to={href} className="group flex min-h-32 flex-col items-center rounded-lg border border-slate-200 bg-[#f9fafc] p-5 text-center transition-colors hover:border-slate-300 hover:bg-white"><span className="material-symbols-outlined text-2xl text-slate-400 group-hover:text-slate-600">arrow_outward</span><h3 className="mt-2 font-semibold text-slate-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></Link>)}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto max-w-[82rem] px-6 py-14">
          <div className="mx-auto mb-10 max-w-2xl text-center"><h2 className="text-2xl font-semibold">{ui.content.directoryTitle}</h2><p className="mt-3 text-sm leading-7 text-slate-400">{ui.content.directoryBody}</p></div>
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {ui.directory.map((group) => <div key={group.title}><h3 className="mb-4 text-sm font-semibold text-white">{group.title}</h3><ul className="space-y-3">{group.links.map(([label, href]) => <li key={href}><Link to={href} className="text-sm leading-6 text-slate-400 transition-colors hover:text-white">{toolTitle(label, href)}</Link></li>)}</ul></div>)}
          </div>
        </div>
      </section>
    </main>
  );
}
