import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Noticeboard } from '../components/board/Noticeboard';
import { CategoryKey } from '../components/board/CategoryKey';
import { ActivityTicker, Countdown } from '../components/board/BoardExtras';
import { Emblem } from '../components/board/Emblem';
import { DoodleLayer } from '../components/board/DoodleLayer';
import { Loading } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useBoard, useBoardRealtime, useEventPhase, usePlayerSummary, useSettings } from '../lib/queries';
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

const hunters = (n: number) => `${['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][n] ?? n} ${n === 1 ? 'hunter' : 'hunters'}`;

export default function BoardPage() {
  const board = useBoard();
  useBoardRealtime();
  const settings = useSettings().data;
  const { session, isAdmin } = useAuth();
  const { phase } = useEventPhase();
  const qc = useQueryClient();
  // When the event opens (or pauses/resumes), refetch so posters unseal without a reload
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['board'] });
    qc.invalidateQueries({ queryKey: ['activity'] });
  }, [phase, qc]);
  const summary = usePlayerSummary(session?.user.id).data;
  const myRep = session ? Number(summary?.reputation ?? 0) : null;
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [hideMine, setHideMine] = useState(() => {
    try { return localStorage.getItem('gmw-hide-mine') === '1'; } catch { return false; }
  });
  function toggleHideMine() {
    setHideMine((v) => { try { localStorage.setItem('gmw-hide-mine', v ? '0' : '1'); } catch { /* not saved */ } return !v; });
  }
  const isMine = (s: { my_status: string | null }) => s.my_status === 'approved' || s.my_status === 'pending';

  const slots = useMemo(
    () => (board.data ?? []).filter((s) => s.tier === 'main' && (filter === 'all' || s.category === filter) && !(session && hideMine && isMine(s))),
    [board.data, filter, hideMine, session],
  );
  const hiddenCount = session && hideMine ? (board.data ?? []).filter((s) => s.tier === 'main' && (filter === 'all' || s.category === filter) && isMine(s)).length : 0;
  const wanted = useMemo(() => (board.data ?? []).filter((s) => s.tier === 'wanted'), [board.data]);
  const now = Date.now();
  const notStarted = settings && now < new Date(settings.starts_at).getTime();
  const ended = settings && now > new Date(settings.ends_at).getTime();
  const boardRef = useRef<HTMLDivElement>(null);
  const layoutKey = `${board.isLoading}|${slots.map((s) => s.contract_id ?? s.slot_id).join()}|${wanted.map((s) => s.contract_id ?? s.slot_id).join()}|${notStarted}|${ended}|${!!session}`;

  return (
    <div className="board" ref={boardRef}>
      <Lantern side="left" />
      <Lantern side="right" />

      <div className="sign">
        <h1 className="carved font-display text-2xl leading-tight sm:text-4xl">{settings?.event_name ?? "Gielinor's Most Wanted"}</h1>
        <p className="mt-0.5 font-sc text-sm font-bold text-parchment-200/90 sm:text-base">
          {settings ? (
            notStarted ? `Bounties open ${fmtDay(settings.starts_at)}`
              : ended ? 'The hunt is over'
              : `${timeLeft(settings.ends_at)}. ${hunters(settings.default_claim_limit)} per bounty.`
          ) : 'Posted by the UwU Girls'}
        </p>
      </div>

      {settings && notStarted && <Countdown settings={settings} />}
      {settings && notStarted && isAdmin && (
        <p className="mx-auto mt-4 w-fit max-w-xl rounded bg-brass/90 px-4 py-2 text-center text-sm font-bold text-ink">
          Admin preview: players and guests see these posters sealed until the event starts.
        </p>
      )}
      {settings && ended && (
        <p className="mx-auto mt-5 w-fit rounded bg-oak-950/70 px-4 py-2 text-center text-parchment-100">
          The final bounty has been called. <Link to="/results" className="font-bold text-brass underline underline-offset-2">See the results</Link>
        </p>
      )}

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
            <span className="inline-flex items-center gap-1.5">
              {c !== 'all' && <Emblem category={c} className={`h-4 w-4 ${filter === c ? `cat-text-${c}` : ''}`} />}
              {c === 'all' ? 'All bounties' : CATEGORY_LABEL[c]}
            </span>
          </button>
        ))}
        {session && (
          <button onClick={toggleHideMine} aria-pressed={hideMine}
            className={`rounded-full px-3.5 py-1 font-sc text-sm font-bold shadow-[0_2px_4px_rgba(0,0,0,.4)] transition ${
              hideMine ? 'bg-brass text-ink' : 'bg-oak-900/70 text-parchment-100 hover:bg-oak-900'}`}>
            {hideMine ? 'Showing open to me' : 'Hide ones I\'ve claimed'}
          </button>
        )}
      </div>

      <DoodleLayer boardRef={boardRef} layoutKey={layoutKey} />

      <CategoryKey showMostWanted={wanted.length > 0} />
      {!notStarted && <ActivityTicker />}

      {!session && (
        <p className="mx-auto mt-4 max-w-xl rounded bg-oak-950/60 px-4 py-2 text-center text-sm text-parchment-100">
          You're browsing as a guest. <Link to="/login" className="font-bold text-brass underline underline-offset-2">Join or sign in</Link> to claim bounties and earn reputation, or read <Link to="/how-it-works" className="font-bold text-brass underline underline-offset-2">how it works</Link>.
        </p>
      )}

      <div className="mt-8 sm:mt-10">
        {board.isLoading ? <Loading label="Pinning up the posters…" />
          : board.error ? <p className="text-center text-parchment-100">Couldn't load the board: {(board.error as Error).message}</p>
          : <Noticeboard slots={slots} myReputation={myRep} eventPaused={phase === 'paused'} opensAt={settings?.starts_at}
              emptyText={hiddenCount > 0 ? `You've claimed or are waiting on every bounty here. Nice work.` : filter === 'all' ? undefined : 'No contracts of this kind on the board right now.'} />}
        {hiddenCount > 0 && slots.length > 0 && (
          <p className="mt-6 text-center text-sm text-parchment-200/80">{hiddenCount} you've claimed or are waiting on {hiddenCount === 1 ? 'is' : 'are'} hidden.</p>
        )}
      </div>

      {wanted.length > 0 && (
        <section aria-labelledby="most-wanted" className="mt-14 border-t-4 border-double border-black/40 pt-10">
          <div className="sign">
            <h2 id="most-wanted" className="carved font-display text-xl leading-tight sm:text-3xl">Most Wanted</h2>
            <p className="mt-0.5 font-sc text-sm font-bold text-parchment-200/90">Harder bounties for hunters who have proven themselves</p>
          </div>
          <div className="mt-8">
            <Noticeboard slots={wanted} myReputation={myRep} eventPaused={phase === 'paused'} opensAt={settings?.starts_at} />
          </div>
        </section>
      )}
    </div>
  );
}
