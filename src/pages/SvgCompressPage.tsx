import { useOutletContext } from 'react-router-dom';
import ImageCompressor from './Compressor/ImageCompressor';
import type { Locale, PageCopy } from '../i18n';
import { useLocaleSection } from '../localization';

export default function SvgCompressPage() {
  const { copy, locale } = useOutletContext<{ copy: PageCopy; locale: Locale }>();
  const text = useLocaleSection<{ title: string; subtitle: string; drop: string; hint: string }>('svg-compress');
  const compressorCopy = { ...copy.compressor, heroTitle: text.title, heroSubtitle: text.subtitle, dropTitle: text.drop, dropHint: text.hint };

  return <main className="flex-1 bg-[#f9fafc]"><section className="relative min-h-[500px] px-6 pb-14 pt-7"><div className="mx-auto flex max-w-[72rem] flex-col items-center"><header className="mb-8 text-center"><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">{text.title}</h1><p className="mt-2 text-base font-medium text-slate-500">{text.subtitle}</p></header><div className="w-full"><ImageCompressor variant="easy" showHero={false} copy={compressorCopy} svgOnly /></div></div></section></main>;
}
