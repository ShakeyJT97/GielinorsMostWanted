import { useState } from 'react';
import { Loading, PageTitle, Sheet } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useLeaderboard } from '../lib/queries';
import { CATEGORIES, CATEGORY_LABEL, type Category } from '../lib/types';
import { HunterLink } from './HunterPage';

export default function LeaderboardPage() {
  const [cat, setCat] = useState<Category | null>(null);
  const lb = useLeaderboard(cat);
  const { session } = useAuth();

  return (
    <Sheet className="mx-auto max-w-3xl">
      <PageTitle sub="Reputation from approved bounties and admin bonuses. Ties go to whoever got there first.">Most wanted</PageTitle>

      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Leaderboard">
        {([null, ...CATEGORIES] as const).map((c) => (
          <button key={c ?? 'all'} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
            className={`btn btn-sm ${cat === c ? 'btn-ink' : 'btn-ghost'}`}>
            {c ? CATEGORY_LABEL[c] : 'Overall'}
          </button>
        ))}
      </div>

      {lb.isLoading ? <Loading /> : (lb.data ?? []).length === 0 ? (
        <p>No reputation earned{cat ? ` in ${CATEGORY_LABEL[cat]}` : ''} yet. The first approved claim puts a name here.</p>
      ) : (
        <ol className="divide-y divide-ink/15">
          {lb.data!.map((r) => {
            const me = r.player_id === session?.user.id;
            return (
              <li key={r.player_id} className={`flex items-center gap-4 py-2.5 ${me ? 'bg-brass/15 px-2 -mx-2 rounded' : ''}`}>
                <span className={`w-10 text-center font-display ${r.place <= 3 ? 'text-2xl text-wax-pvm' : 'text-xl text-ink-soft'}`}>{r.place}</span>
                <div className="flex-1">
                  <p className="font-sc text-lg font-bold leading-tight"><HunterLink name={r.rs_name} />{me && <span className="font-serif text-sm font-normal"> (you)</span>}</p>
                  <p className="text-sm text-ink-soft">{r.rank_name} · {r.claims} {Number(r.claims) === 1 ? 'bounty' : 'bounties'}</p>
                </div>
                <span className="font-display text-2xl text-ink">{r.reputation}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Sheet>
  );
}
