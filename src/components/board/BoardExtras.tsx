import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActivity } from '../../lib/queries';
import { ago } from '../../lib/format';
import type { ActivityRow, EventSettings } from '../../lib/types';

/** Live countdown to a moment, e.g. "2d 04h 12m 09s". */
export function useCountdown(targetIso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [targetIso]);
  if (!targetIso) return null;
  const ms = new Date(targetIso).getTime() - now;
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const parts = { d: Math.floor(s / 86_400), h: Math.floor((s % 86_400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
  return parts;
}

export function Countdown({ settings }: { settings: EventSettings }) {
  const before = useCountdown(settings.starts_at);
  if (!before) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const units: [string, string][] = [
    [String(before.d), before.d === 1 ? 'day' : 'days'], [pad(before.h), 'hours'], [pad(before.m), 'minutes'], [pad(before.s), 'seconds'],
  ];
  return (
    <div className="mx-auto mt-6 w-fit text-center" role="timer" aria-live="off" aria-label="Time until bounties open">
      <p className="font-sc text-sm font-bold text-parchment-200">The first bounties go up in</p>
      <div className="mt-2 flex justify-center gap-2 sm:gap-3">
        {units.map(([v, label]) => (
          <div key={label} className="sheet min-w-[4rem] rounded px-2 py-1.5 sm:min-w-[5rem]">
            <div className="font-display text-2xl leading-none text-ink sm:text-4xl">{v}</div>
            <div className="mt-1 font-sc text-xs font-bold text-ink-soft">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function activityText(a: ActivityRow) {
  const title = a.contract_id ? <Link to={`/contracts/${a.contract_id}`} className="font-bold underline-offset-2 hover:underline">{a.title}</Link> : <strong>{a.title}</strong>;
  const who = a.player ? <Link to={`/hunters/${encodeURIComponent(a.player)}`} className="font-bold underline-offset-2 hover:underline">{a.player}</Link> : 'A hunter';
  if (a.kind === 'claim') return <>{who} claimed {title}{a.reputation ? <> for {a.reputation} rep</> : null}</>;
  if (a.kind === 'retired') return <>{title} is fully claimed and off the board</>;
  return <>New bounty posted: {title}</>;
}

const ICON: Record<ActivityRow['kind'], string> = { claim: '⚔', retired: '✦', posted: '⚑' };

/** One line of recent news under the key, cycling through the latest few. */
export function ActivityTicker() {
  const activity = useActivity(6).data ?? [];
  const [i, setI] = useState(0);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (reduced || activity.length < 2) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % activity.length), 6000);
    return () => window.clearInterval(t);
  }, [activity.length, reduced]);
  if (activity.length === 0) return null;
  const a = activity[i % activity.length];
  return (
    <div className="mx-auto mt-4 flex max-w-2xl items-center gap-3 rounded bg-oak-950/70 px-4 py-2 text-sm text-parchment-100 shadow-[inset_0_1px_0_rgba(255,220,170,.08)]">
      <span className="shrink-0 font-sc font-bold text-brass">Town crier</span>
      <p key={`${a.at}-${i}`} className="min-w-0 flex-1 truncate motion-safe:animate-[fadein_.5s_ease-out]" aria-live="polite">
        <span aria-hidden className="mr-1.5">{ICON[a.kind]}</span>{activityText(a)} <span className="text-parchment-200/70">· {ago(a.at)}</span>
      </p>
      <Link to="/tavern" className="shrink-0 text-brass underline underline-offset-2">More</Link>
    </div>
  );
}
