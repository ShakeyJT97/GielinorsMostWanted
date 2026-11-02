import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Noticeboard } from '../components/board/Noticeboard';
import { Loading } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useBoard, useBoardRealtime, usePlayerSummary, useSettings } from '../lib/queries';
import { fmtDay, timeLeft } from '../lib/format';
import { CATEGORIES, CATEGORY_LABEL, type Category } from '../lib/types';

function Lantern({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={`lantern hidden sm:block ${side === 'left' ? '-left-2 sm:left-6' : '-right-2 sm:right-6'}`} aria-hidden>
      <div className="glow" />
      <svg viewBox="0 0 34 64" className="relative h-full w-full">
        <path d="M17 0v8" stroke="#2b2a28" strokeWidth="2" />
        <path d="M10 8h14l3 6H7z" fill="#2f2e2c" />
        <rect x="9" y="14" width="16" height="30" rx="2" fill="#ffcf7a" opacity=".85" />
        <path d="M9 14h16v30H9z M17 14v30 M9 29h16" fill="none" stroke="#2b2a28" strokeWidth="2" />
        <path d="M7 44h20l-3 6H10z" fill="#2f2e2c" />
        <circle cx="17" cy="30" r="3.5" fill="#fff4d6" />
      </svg>
    </div>
  );
}

export default function BoardPage() {
  const board = useBoard();
  useBoardRealtime();
  const settings = useSettings().data;
  const { session } = useAuth();
  const summary = usePlayerSummary(session?.user.id).data;
  const myRep = session ? Number(summary?.reputation ?? 0) : null;
  const [filter, setFilter] = useState<Category | 'all'>('all');

  const slots = useMemo(
    () => (board.data ?? []).filter((s) => s.tier === 'main' && (filter === 'all' || s.category === filter)),
    [board.data, filter],
  );
  const wanted = useMemo(() => (board.data ?? []).filter((s) => s.tier === 'wanted'), [board.data]);
  const now = Date.now();
  const notStarted = settings && now < new Date(settings.starts_at).getTime();
  const ended = settings && now > new Date(settings.ends_at).getTime();

  return (
    <div className="board">
      <Lantern side="left" />
      <Lantern side="right" />

      <div className="sign">
        <h1 className="carved font-display text-2xl leading-tight sm:text-4xl">Gielinor's Most Wanted</h1>
        <p className="mt-0.5 font-sc text-sm font-bold text-parchment-200/90 sm:text-base">
          {settings ? (
            notStarted ? `Bounties open ${fmtDay(settings.starts_at)}`
              : ended ? 'The hunt is over'
              : `${timeLeft(settings.ends_at)}. Five hunters per bounty.`
          ) : 'Posted by the UwU Girls'}
        </p>
      </div>

      <div className="mx-auto mt-6 flex max-w-xl flex-wrap items-center justify-center gap-2" role="group" aria-label="Filter contracts">
        {(['all', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            aria-pressed={filter === c}
            className={`rounded-full px-3.5 py-1 font-sc text-sm font-bold shadow-[0_2px_4px_rgba(0,0,0,.4)] transition ${
              filter === c ? 'bg-parchment-100 text-ink' : 'bg-oak-900/70 text-parchment-100 hover:bg-oak-900'
            }`}
          >
            {c === 'all' ? 'All bounties' : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      {!session && (
        <p className="mx-auto mt-4 max-w-xl rounded bg-oak-950/60 px-4 py-2 text-center text-sm text-parchment-100">
          You're browsing as a guest. <Link to="/login" className="font-bold text-brass underline underline-offset-2">Join or sign in</Link> to claim bounties and earn reputation, or read <Link to="/how-it-works" className="font-bold text-brass underline underline-offset-2">how it works</Link>.
        </p>
      )}

      <div className="mt-8 sm:mt-10">
        {board.isLoading ? <Loading label="Pinning up the posters…" />
          : board.error ? <p className="text-center text-parchment-100">Couldn't load the board: {(board.error as Error).message}</p>
          : <Noticeboard slots={slots} myReputation={myRep} emptyText={filter === 'all' ? undefined : 'No contracts of this kind on the board right now.'} />}
      </div>

      {wanted.length > 0 && (
        <section aria-labelledby="most-wanted" className="mt-14 border-t-4 border-double border-black/40 pt-10">
          <div className="sign">
            <h2 id="most-wanted" className="carved font-display text-xl leading-tight sm:text-3xl">Most Wanted</h2>
            <p className="mt-0.5 font-sc text-sm font-bold text-parchment-200/90">Harder bounties for hunters who have proven themselves</p>
          </div>
          <div className="mt-8">
            <Noticeboard slots={wanted} myReputation={myRep} />
          </div>
        </section>
      )}
    </div>
  );
}
