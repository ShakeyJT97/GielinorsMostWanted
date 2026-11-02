import { useAchievements } from '../lib/queries';
import { fmtDay } from '../lib/format';

/** Every badge there is, so a player can see what's left to earn. Keys match get_achievements(). */
export const ALL_BADGES: { key: string; label: string; description: string; icon: string }[] = [
  { key: 'first_blood', label: 'First Blood', description: 'Had the very first claim of the event approved', icon: '🩸' },
  { key: 'opening_shot', label: 'Opening Shot', description: 'First hunter to claim a fresh bounty', icon: '🏹' },
  { key: 'closer', label: 'The Closer', description: 'Took the last slot and brought a bounty down', icon: '🔨' },
  { key: 'sweep', label: 'Clean Sweep', description: 'Claimed a PvM, a Skilling and a Special bounty', icon: '🧹' },
  { key: 'elite', label: 'Elite Hunter', description: 'Completed an Elite bounty', icon: '💎' },
  { key: 'most_wanted', label: 'Most Wanted', description: 'Claimed a Most Wanted bounty', icon: '💰' },
  { key: 'ten', label: 'Tenacious', description: 'Ten bounties claimed', icon: '🔟' },
  { key: 'night_owl', label: 'Night Owl', description: 'Submitted a winning claim between midnight and 5am (UK time)', icon: '🦉' },
  { key: 'regular', label: 'Tavern Regular', description: 'Posted 25 messages in the Tavern', icon: '🍺' },
];

export function Badges({ playerId, showLocked = false, title = 'Badges' }: { playerId: string | undefined; showLocked?: boolean; title?: string }) {
  const q = useAchievements(playerId);
  const earned = new Map((q.data ?? []).map((a) => [a.key, a]));
  const list = ALL_BADGES.filter((b) => showLocked || earned.has(b.key));

  return (
    <section>
      <h2 className="font-display text-2xl text-ink">
        {title} <span className="font-serif text-base text-ink-soft">{earned.size} of {ALL_BADGES.length}</span>
      </h2>
      {q.isLoading ? null : list.length === 0 ? (
        <p className="mt-2">No badges yet.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {list.map((b) => {
            const got = earned.get(b.key);
            return (
              <li key={b.key} title={b.description}
                className={`flex items-start gap-2.5 rounded border-2 p-2.5 ${got ? 'border-brass/80 bg-brass/15' : 'border-dashed border-ink/20 opacity-60'}`}>
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl ${got ? 'bg-oak-900 ring-2 ring-brass' : 'bg-ink/10 grayscale'}`} aria-hidden>
                  {b.icon}
                </span>
                <span className="min-w-0">
                  <span className="block font-sc font-bold leading-tight">
                    {b.label}{got && got.times > 1 && <span className="ml-1 text-sm text-ink-soft">×{got.times}</span>}
                  </span>
                  <span className="block text-xs leading-snug text-ink-soft">{b.description}</span>
                  {got?.earned_at && <span className="block text-xs text-ink-soft">{fmtDay(got.earned_at)}</span>}
                  {!got && <span className="sr-only">Not earned yet</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
