import { Link } from 'react-router-dom';
import { Loading, Sheet } from '../components/ui';
import { Emblem } from '../components/board/Emblem';
import { useEventPhase, useEventStats } from '../lib/queries';
import { duration, fmtDay } from '../lib/format';
import { CATEGORIES, CATEGORY_LABEL, type LeaderboardRow } from '../lib/types';
import { HunterLink } from './HunterPage';

const PLACE = ['1st', '2nd', '3rd'];

export default function ResultsPage() {
  const stats = useEventStats();
  const { settings, phase } = useEventPhase();
  const final = phase === 'ended';

  if (stats.isLoading) return <Sheet className="mx-auto max-w-4xl"><Loading /></Sheet>;
  const s = stats.data;
  if (!s) return <Sheet className="mx-auto max-w-4xl"><p>Couldn't load the results.</p></Sheet>;

  // Podium order on wide screens: 2nd, 1st, 3rd
  const byPlace = (p: number) => s.podium.filter((r) => r.place === p);
  const podium: [number, LeaderboardRow[]][] = [[2, byPlace(2)], [1, byPlace(1)], [3, byPlace(3)]];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Sheet>
        <h1 className="font-display text-4xl leading-tight text-ink">{final ? 'Final results' : 'Standings so far'}</h1>
        <p className="mt-1 text-ink-soft">
          {final && settings ? `${settings.event_name} ended ${fmtDay(settings.ends_at)}. Well hunted, everyone.`
            : 'The event is still running. These update as claims are approved.'}
        </p>

        {s.podium.length === 0 ? (
          <p className="mt-6">No reputation earned yet. The first approved claim puts someone on the podium.</p>
        ) : (
          <ol className="mt-8 grid items-end gap-4 sm:grid-cols-3" aria-label="Podium">
            {podium.map(([place, rows]) => (
              <li key={place} className={`text-center ${place === 1 ? 'order-1 sm:order-2' : place === 2 ? 'order-2 sm:order-1' : 'order-3'}`}>
                {rows.length === 0 ? <div className="hidden sm:block" /> : (
                  <>
                    <p className="font-sc font-bold text-ink-soft">{PLACE[place - 1]}</p>
                    {rows.map((r) => (
                      <div key={r.player_id}>
                        <p className={`font-display leading-tight text-ink ${place === 1 ? 'text-3xl' : 'text-2xl'}`}><HunterLink name={r.rs_name} /></p>
                        <p className="text-sm text-ink-soft">{r.rank_name} · {r.reputation} reputation · {r.claims} {Number(r.claims) === 1 ? 'bounty' : 'bounties'}</p>
                      </div>
                    ))}
                    <div className={`mt-3 rounded-t border-2 border-b-0 border-ink/30 ${
                      place === 1 ? 'h-28 bg-brass/40' : place === 2 ? 'h-20 bg-ink/10' : 'h-14 bg-[#b07a46]/25'}`} aria-hidden />
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </Sheet>

      <Sheet>
        <h2 className="font-display text-2xl text-ink">Category champions</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {CATEGORIES.map((c) => {
            const winners = s.category_winners[c] ?? [];
            return (
              <li key={c} className="flex items-start gap-3">
                <span className={`cat-box cat-box-${c} grid h-12 w-14 shrink-0 place-items-center border-2 border-double`} aria-hidden>
                  <Emblem category={c} className="h-8 w-8" />
                </span>
                <div>
                  <p className={`font-sc font-bold cat-text-${c}`}>{CATEGORY_LABEL[c]}</p>
                  {winners.length === 0 ? <p className="text-ink-soft">Unclaimed</p> : winners.map((w) => (
                    <p key={w.player_id}><HunterLink name={w.rs_name} className="font-bold" /> <span className="text-sm text-ink-soft">{w.reputation} rep</span></p>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <Sheet>
        <h2 className="font-display text-2xl text-ink">The hunt in numbers</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat term="Claims approved" value={s.claims} />
          <Stat term="Hunters on the board" value={s.hunters} />
          <Stat term="Bounties fully claimed" value={s.bounties_claimed} />
          <Stat term="Reputation earned" value={s.reputation} />
        </dl>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {s.fastest && (
            <p><span className="block font-sc font-bold">Fastest to fill</span>
              <Link to={`/contracts/${s.fastest.contract_id}`}>{s.fastest.title}</Link> went from posted to fully claimed in {duration(s.fastest.seconds)}.</p>
          )}
          {s.busiest && (
            <p><span className="block font-sc font-bold">Most contested</span>
              <Link to={`/contracts/${s.busiest.contract_id}`}>{s.busiest.title}</Link> drew {s.busiest.attempts} claims.</p>
          )}
        </div>
        <p className="mt-6"><Link to="/leaderboard">Full leaderboard</Link> · <Link to="/archive">Every claimed bounty</Link></p>
      </Sheet>
    </div>
  );
}

function Stat({ term, value }: { term: string; value: number }) {
  return (
    <div>
      <dt className="font-sc text-sm font-bold text-ink-soft">{term}</dt>
      <dd className="font-display text-3xl text-ink">{Number(value).toLocaleString('en-GB')}</dd>
    </div>
  );
}
