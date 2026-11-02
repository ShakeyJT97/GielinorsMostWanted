import { Link, useParams } from 'react-router-dom';
import { CategoryChip, Loading, Sheet } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useHunter } from '../lib/queries';
import { fmtDateTime, fmtDay } from '../lib/format';
import { CATEGORIES, CATEGORY_LABEL, DIFFICULTY_LABEL } from '../lib/types';

export default function HunterPage() {
  const { name } = useParams();
  const q = useHunter(name);
  const { profile } = useAuth();

  if (q.isLoading) return <Sheet className="mx-auto max-w-3xl"><Loading /></Sheet>;
  const h = q.data;
  if (!h) {
    return (
      <Sheet className="mx-auto max-w-md">
        <h1 className="font-display text-2xl">No hunter by that name</h1>
        <p className="mt-2"><Link to="/leaderboard">Back to the leaderboard</Link></p>
      </Sheet>
    );
  }

  const s = h.summary;
  const rep = Number(s?.reputation ?? 0);
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, h.claims.filter((x) => x.category === c)]));
  const isMe = profile?.rs_name?.toLowerCase() === h.rs_name.toLowerCase();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Sheet>
        <p className="text-sm text-ink-soft">Hunting since {fmtDay(h.joined)}</p>
        <h1 className="font-display text-4xl leading-tight text-ink">{h.rs_name}</h1>
        <p className="font-sc text-xl font-bold">{s?.rank_name ?? 'Unknown Adventurer'}</p>
        {isMe && <p className="mt-1 text-sm"><Link to="/me">See your claim history</Link></p>}

        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat term="Reputation" value={rep} big />
          {CATEGORIES.map((c) => (
            <Stat key={c} term={CATEGORY_LABEL[c]} value={byCat[c].length} />
          ))}
          {Number(h.bonus_total) !== 0 && <Stat term="Bonuses" value={Number(h.bonus_total)} />}
        </dl>
        {s?.next_rank_name && s.next_rank_at !== null && (
          <p className="mt-4 text-ink-soft">{s.next_rank_at - rep} reputation to {s.next_rank_name}.</p>
        )}
      </Sheet>

      <Sheet>
        <h2 className="font-display text-2xl text-ink">Bounties claimed</h2>
        {h.claims.length === 0 ? <p className="mt-2">No bounties claimed yet.</p> : (
          <ul className="mt-3 divide-y divide-ink/15">
            {h.claims.map((c) => (
              <li key={c.contract_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <CategoryChip category={c.category} />
                <Link to={`/contracts/${c.contract_id}`} className="font-sc text-lg font-bold">{c.title}</Link>
                <span className="text-sm text-ink-soft">{DIFFICULTY_LABEL[c.difficulty]}</span>
                <span className="ml-auto font-display text-lg">+{c.reputation}</span>
                <span className="w-full text-sm text-ink-soft sm:w-auto">{fmtDateTime(c.claimed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}

function Stat({ term, value, big = false }: { term: string; value: number; big?: boolean }) {
  return (
    <div>
      <dt className="font-sc font-bold text-ink-soft">{term}</dt>
      <dd className={`font-display leading-tight text-ink ${big ? 'text-4xl' : 'text-2xl'}`}>{value}</dd>
    </div>
  );
}

/** A display name that links to that hunter's public profile. */
export function HunterLink({ name, className = '' }: { name: string; className?: string }) {
  return <Link to={`/hunters/${encodeURIComponent(name)}`} className={className}>{name}</Link>;
}
