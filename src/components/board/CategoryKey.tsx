import { Emblem } from './Emblem';
import { CATEGORY_LABEL, type Category } from '../../lib/types';

const ENTRIES: { category: Category; what: string }[] = [
  { category: 'pvm', what: 'Boss kills and combat' },
  { category: 'skilling', what: 'Gathering and making' },
  { category: 'special', what: 'Clues, exploring and oddities' },
];

/** The board's key: what each colour and emblem means. */
export function CategoryKey({ showMostWanted = false }: { showMostWanted?: boolean }) {
  return (
    <aside aria-label="Key" className="sheet mx-auto mt-5 w-fit max-w-full rounded px-4 py-3 shadow-[0_8px_16px_-6px_rgba(0,0,0,.7)]">
      <h2 className="sr-only">Key</h2>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-6">
        {ENTRIES.map(({ category, what }) => (
          <li key={category} className="flex items-center gap-2.5">
            <span className={`cat-box cat-box-${category} grid h-9 w-10 shrink-0 place-items-center border-2 border-double`} aria-hidden>
              <Emblem category={category} className="h-6 w-6" />
            </span>
            <span className="leading-tight">
              <span className={`block font-sc font-bold cat-text-${category}`}>{CATEGORY_LABEL[category]}</span>
              <span className="hidden text-sm text-ink-soft sm:block">{what}</span>
            </span>
          </li>
        ))}
        {showMostWanted && (
          <li className="flex items-center gap-2.5">
            <span className="grid h-9 w-10 shrink-0 place-items-center border-2 border-double border-[#6d1414]/60 font-display text-lg text-[#6d1414]" aria-hidden>!</span>
            <span className="leading-tight">
              <span className="block font-sc font-bold text-[#6d1414]">Most Wanted</span>
              <span className="hidden text-sm text-ink-soft sm:block">Needs reputation to claim</span>
            </span>
          </li>
        )}
      </ul>
    </aside>
  );
}
