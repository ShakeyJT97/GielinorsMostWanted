import { Link } from 'react-router-dom';
import type { BoardSlot, SubmissionStatus } from '../../lib/types';
import { CATEGORY_LABEL, DIFFICULTY_LABEL } from '../../lib/types';
import { DifficultyMarks, Emblem, WaxSeal } from './Emblem';

const TILTS = [-1.6, 1.1, -0.6, 1.8, -1.2, 0.7, -1.9, 1.4, -0.4, 0.9, -1.4, 1.6];

const MY_STATUS: Partial<Record<SubmissionStatus, string>> = {
  pending: 'Your claim is pending',
  approved: 'You claimed this bounty',
  rejected: 'Your claim was rejected',
};

interface PosterProps {
  slot: BoardSlot;
  stamped?: boolean;
  entering?: boolean;
  /** The viewer's reputation, or null when signed out. Used for Most Wanted locks. */
  myReputation?: number | null;
  /** The whole event is paused by the admins. */
  eventPaused?: boolean;
  /** When the board unseals, for sealed posters. */
  opensAt?: string;
}

export function Poster({ slot, stamped = false, entering = false, myReputation = null, eventPaused = false, opensAt }: PosterProps) {
  const tilt = TILTS[(slot.slot_id * 7 + slot.slot_position) % TILTS.length];
  const wanted = slot.tier === 'wanted';

  if (slot.sealed) return <SealedPoster slot={slot} tilt={tilt} opensAt={opensAt} />;
  if (!slot.contract_id || !slot.title || !slot.difficulty || !slot.category) {
    return <EmptyPoster slot={slot} tilt={tilt} />;
  }

  const limit = slot.claim_limit ?? 5;
  const claimed = Math.min(slot.approved_count ?? 0, limit);
  const remaining = limit - claimed;
  const wear = Math.max(wanted ? 2 : 0, Math.min(4, Math.round((claimed / limit) * 4)));
  const slotPaused = slot.slot_state === 'paused';
  const paused = slotPaused || eventPaused;
  const mine = slot.my_status ? MY_STATUS[slot.my_status] : undefined;
  const need = slot.min_reputation ?? 0;
  const locked = wanted && need > 0 && (myReputation ?? 0) < need && !slot.my_status;

  return (
    <div
      className={`poster-wrap ${stamped ? 'poster-leave' : ''} ${entering ? 'poster-enter' : ''}`}
      style={{ ['--tilt' as string]: `${tilt}deg` }}
    >
      <span className="nail left-1/2 top-2 -translate-x-1/2" aria-hidden />
      <article
        className={`poster ${wanted ? "poster-wanted px-7" : "px-5"} flex h-full flex-col pb-5 pt-8 ${paused ? 'saturate-[.6]' : ''}`}
        data-wear={wear}
        aria-label={`${slot.title}, ${wanted ? 'Most Wanted' : CATEGORY_LABEL[slot.category]} bounty`}
      >
        {remaining === 1 && !stamped && !paused && (
          <div className="ribbon font-sc text-sm font-bold">Last claim</div>
        )}

        <p className={`text-center font-display leading-none tracking-wider ${wanted ? 'text-[1.45rem] text-[#6d1414]' : 'text-[1.7rem] text-ink'}`}>
          {wanted ? 'Most Wanted' : 'Bounty'}
        </p>
        <p className={`mt-1 text-center font-sc text-sm font-bold cat-text-${slot.category}`}>
          {CATEGORY_LABEL[slot.category]} contract
        </p>

        <div className={`cat-box cat-box-${slot.category} relative mx-auto my-3 grid h-24 w-28 place-items-center border-[3px] border-double`}>
          <Emblem category={slot.category} className="h-16 w-16" />
          {locked && <Padlock />}
        </div>

        <h3 className="text-center font-sc text-xl font-bold leading-tight text-ink">
          <Link to={`/contracts/${slot.contract_id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {slot.title}
          </Link>
        </h3>
        <p className="mt-2 flex-1 text-center text-[0.98rem] leading-snug text-ink-soft">{slot.summary}</p>

        {wanted && need > 0 && (
          <p className={`mt-3 rounded px-2 py-1 text-center font-sc text-sm font-bold ${locked ? 'bg-[#6d1414]/10 text-[#6d1414]' : 'bg-wax-skilling/15 text-[#244018]'}`}>
            {locked
              ? myReputation === null ? `For hunters with ${need} reputation` : `Unlocks at ${need} reputation (you have ${myReputation})`
              : `Open to you: ${need}+ reputation`}
          </p>
        )}

        <div className="mt-4 flex items-end justify-between gap-3 border-t-2 border-double border-ink/30 pt-3">
          <div>
            <div className="flex items-center gap-1.5 text-sm">
              <DifficultyMarks difficulty={slot.difficulty} />
              <span className="font-sc font-bold">{DIFFICULTY_LABEL[slot.difficulty]}</span>
            </div>
            <p className="font-display text-xl leading-tight text-ink">
              {slot.reputation} <span className="font-sc text-base font-bold">Reputation</span>
            </p>
          </div>
          <WaxSeal category={slot.category} size={50} />
        </div>

        <ClaimTally limit={limit} claimants={slot.claimants} />
        <p className="mt-1 text-center text-sm text-ink-soft">
          {paused ? 'Claims on hold' : remaining === 0 ? 'All claims taken' : `${remaining} of ${limit} claims left`}
        </p>
        {!paused && remaining > 0 && (slot.pending_count ?? 0) > 0 && (
          <p className={`text-center text-sm font-bold ${(slot.pending_count ?? 0) >= remaining ? 'text-[#7a1a1a]' : 'text-ink-soft'}`}>
            {slot.pending_count} waiting for review
          </p>
        )}
        {!paused && remaining > 0 && (slot.hunting_count ?? 0) > 0 && (
          <p className="text-center text-sm italic text-ink-soft">
            {slot.i_am_hunting
              ? (slot.hunting_count === 1 ? "You're on the trail" : `You and ${slot.hunting_count! - 1} other${slot.hunting_count === 2 ? '' : 's'} on the trail`)
              : `${slot.hunting_count} hunter${slot.hunting_count === 1 ? '' : 's'} on the trail`}
          </p>
        )}
        {mine && <p className="mt-1 text-center font-sc text-sm font-bold text-ink">{mine}</p>}
      </article>
      {paused && !stamped && <PausedSign whole={eventPaused && !slotPaused} />}
      {stamped && (
        <div className="stamp" role="status">
          <span>Bounty<br />claimed</span>
        </div>
      )}
    </div>
  );
}

function Padlock() {
  return (
    <svg viewBox="0 0 24 24" className="absolute -bottom-3 -right-3 h-8 w-8 drop-shadow" aria-hidden>
      <rect x="4" y="10" width="16" height="12" rx="2" fill="#3b3a39" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#3b3a39" strokeWidth="2.5" />
      <circle cx="12" cy="16" r="1.8" fill="#c99a2e" />
    </svg>
  );
}

function ClaimTally({ limit, claimants }: { limit: number; claimants: string[] }) {
  return (
    <ol className="mt-3 flex justify-center gap-1.5" aria-label={`${claimants.length} of ${limit} claims approved`}>
      {Array.from({ length: limit }, (_, i) => {
        const name = claimants[i];
        return (
          <li
            key={i}
            title={name ?? 'Unclaimed'}
            className={`grid h-7 w-7 place-items-center rounded-full font-sc text-xs font-bold ${
              name
                ? 'bg-[radial-gradient(circle_at_35%_30%,#e7bd57,#b0821f_60%,#7c5a12)] text-ink shadow-[0_1px_2px_rgba(0,0,0,.5)]'
                : 'border-2 border-dashed border-ink/35'
            }`}
          >
            {name ? name.slice(0, 1).toUpperCase() : ''}
            <span className="sr-only">{name ? `Claimed by ${name}` : 'Unclaimed'}</span>
          </li>
        );
      })}
    </ol>
  );
}

function EmptyPoster({ slot, tilt }: { slot: BoardSlot; tilt: number }) {
  const wanted = slot.tier === 'wanted' || !slot.category;
  return (
    <div className="poster-wrap opacity-90" style={{ ['--tilt' as string]: `${tilt}deg` }}>
      <span className="nail left-1/2 top-2 -translate-x-1/2" aria-hidden />
      <article className={`poster ${wanted ? 'poster-wanted' : ''} flex h-full min-h-[22rem] flex-col items-center justify-center px-6 pb-6 pt-8 text-center`} data-wear="3">
        {slot.category && !wanted ? <WaxSeal category={slot.category} size={48} /> : (
          <span className="font-display text-3xl text-[#6d1414]" aria-hidden>?</span>
        )}
        <p className="mt-4 font-display text-xl text-ink">Notice</p>
        <p className="mt-2 text-ink-soft">
          {wanted
            ? 'A new Most Wanted contract will be posted here soon.'
            : `A new ${CATEGORY_LABEL[slot.category!]} contract will be posted here soon.`}
        </p>
      </article>
    </div>
  );
}

/** A wooden "closed" sign hung over a poster on two strings. */
function PausedSign({ whole }: { whole: boolean }) {
  return (
    <div className="paused-sign" role="status">
      <span className="paused-sign-board">
        <span className="carved block font-display text-2xl leading-none tracking-wider">Paused</span>
        <span className="mt-1 block font-sc text-xs font-bold text-parchment-200">{whole ? 'The hunt is on hold' : 'Claims on hold'}</span>
      </span>
    </div>
  );
}

/** Before the event starts: a folded, sealed notice. The bounty itself isn't sent to the browser. */
function SealedPoster({ slot, tilt, opensAt }: { slot: BoardSlot; tilt: number; opensAt?: string }) {
  const when = opensAt ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(opensAt)) : null;
  const wanted = slot.tier === 'wanted' || !slot.category;
  return (
    <div className="poster-wrap" style={{ ['--tilt' as string]: `${tilt}deg` }}>
      <span className="nail left-1/2 top-2 -translate-x-1/2" aria-hidden />
      <article className={`poster poster-sealed ${wanted ? 'poster-wanted' : ''} flex h-full min-h-[24rem] flex-col items-center justify-center px-6 pb-6 pt-8 text-center`}
        data-wear="1" aria-label={`Sealed ${wanted ? 'Most Wanted' : CATEGORY_LABEL[slot.category!]} bounty`}>
        <p className={`font-sc text-sm font-bold ${wanted ? 'text-[#6d1414]' : `cat-text-${slot.category}`}`}>
          {wanted ? 'Most Wanted' : `${CATEGORY_LABEL[slot.category!]} contract`}
        </p>
        <div className="my-5">
          {wanted ? (
            <div className="seal grid h-[72px] w-[72px] place-items-center font-display text-3xl" style={{ ['--wax' as string]: '#6d1414' }} aria-hidden>
              <span className="relative z-10">?</span>
            </div>
          ) : <WaxSeal category={slot.category!} size={72} />}
        </div>
        <p className="font-display text-3xl leading-none text-ink">Sealed</p>
        <p className="mt-3 text-ink-soft">{when ? <>Opens {when}</> : 'Opens when the hunt begins'}</p>
      </article>
    </div>
  );
}
