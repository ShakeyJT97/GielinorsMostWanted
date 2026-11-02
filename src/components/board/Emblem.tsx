import type { Category, Difficulty } from '../../lib/types';

/** Original woodcut-style emblems drawn for this site. */
export function Emblem({ category, className = '' }: { category: Category; className?: string }) {
  const common = {
    viewBox: '0 0 64 64',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 3.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
  if (category === 'pvm') {
    // crossed swords
    return (
      <svg {...common}>
        <path d="M14 50 44 14l6-2-2 6-36 30" />
        <path d="M50 50 20 14l-6-2 2 6 36 30" />
        <path d="M11 41l12 12M53 41 41 53" />
        <path d="M8 56l5-5M56 56l-5-5" />
      </svg>
    );
  }
  if (category === 'skilling') {
    // pickaxe over hammer
    return (
      <svg {...common}>
        <path d="M12 22c9-9 23-11 34-6-11-2-22 2-30 10" />
        <path d="M30 18 52 54" />
        <path d="M44 12l10 10-4 4-10-10z" />
        <path d="M47 21 14 54" />
      </svg>
    );
  }
  // rolled scroll with an X marking the spot
  return (
    <svg {...common}>
      <path d="M16 14h30a6 6 0 0 1 6 6v30a6 6 0 0 1-6 6H18" />
      <path d="M16 14a6 6 0 0 0-6 6v4h12v-4a6 6 0 0 0-6-6zM18 56a6 6 0 0 1-6-6v-2h12v2a6 6 0 0 1-6 6" />
      <path d="M30 28l10 10M40 28 30 38" />
      <path d="M28 46h16" strokeDasharray="3 4" />
    </svg>
  );
}

export function WaxSeal({ category, size = 56 }: { category: Category; size?: number }) {
  return (
    <div className="seal shrink-0" style={{ width: size, height: size, ['--wax' as string]: `var(--wax-${category})` }}>
      <Emblem category={category} className="relative z-10 h-[55%] w-[55%]" />
    </div>
  );
}

/** Skull marks: one for Standard, two for Hard, three for Elite. */
export function DifficultyMarks({ difficulty }: { difficulty: Difficulty }) {
  const n = difficulty === 'standard' ? 1 : difficulty === 'hard' ? 2 : 3;
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <svg key={i} viewBox="0 0 20 20" className={`h-4 w-4 ${i < n ? 'text-ink' : 'text-ink/20'}`} fill="currentColor">
          <path d="M10 2C5.6 2 3 5 3 8.6c0 2.2 1 3.7 2.4 4.6V16a1 1 0 0 0 1 1h1.2v-1.6h1.2V17h2.4v-1.6h1.2V17h1.2a1 1 0 0 0 1-1v-2.8C16 12.3 17 10.8 17 8.6 17 5 14.4 2 10 2zm-3 9.2a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6zm6 0a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6z" />
        </svg>
      ))}
    </span>
  );
}
