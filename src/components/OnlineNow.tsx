import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { pageName, useOnline } from '../lib/presence';

/** "5 online" in the header; click for the list. Admins also see which page each person is on. */
export function OnlineNow({ onNavigate }: { onNavigate?: () => void }) {
  const online = useOnline();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (online.length === 0) return null;
  const named = online.filter((o) => o.name).sort((a, b) => a.name!.localeCompare(b.name!));
  const guests = online.length - named.length;

  return (
    <div ref={ref} className="relative">
      <button className="flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 text-sm text-parchment-100 hover:bg-white/10"
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#6fbf4f] opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#6fbf4f]" />
        </span>
        {online.length} online
      </button>
      {open && (
        <div className="sheet absolute right-0 z-50 mt-2 w-72 !p-4 text-ink shadow-[0_12px_30px_rgba(0,0,0,.55)]" role="dialog" aria-label="Who's online">
          <h2 className="font-sc text-lg font-bold">On the site now</h2>
          {named.length === 0 ? <p className="mt-1 text-sm text-ink-soft">No signed-in hunters right now.</p> : (
            <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
              {named.map((o) => (
                <li key={o.key} className="flex items-baseline gap-2 text-sm">
                  <Link to={`/hunters/${encodeURIComponent(o.name!)}`} className="font-sc font-bold"
                    onClick={() => { setOpen(false); onNavigate?.(); }}>{o.name}</Link>
                  {o.admin && <span className="text-xs text-ink-soft">admin</span>}
                  {isAdmin && <span className="ml-auto truncate text-xs text-ink-soft">{pageName(o.page)}</span>}
                </li>
              ))}
            </ul>
          )}
          {guests > 0 && (
            <p className="mt-2 border-t border-ink/15 pt-2 text-sm text-ink-soft">
              …and {guests} {guests === 1 ? 'guest' : 'guests'} browsing
              {isAdmin && guests > 0 && (
                <span className="block text-xs">
                  {Object.entries(online.filter((o) => !o.name).reduce<Record<string, number>>((m, o) => {
                    const p = pageName(o.page); m[p] = (m[p] ?? 0) + 1; return m;
                  }, {})).map(([p, n]) => `${n} on ${p}`).join(', ')}
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
