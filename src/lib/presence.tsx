import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from './supabase';
import { useAuth } from './auth';

export interface OnlineVisitor {
  key: string;
  name: string | null;      // null for guests and players without a name yet
  admin: boolean;
  page: string;
  since: string;
}

const PresenceContext = createContext<OnlineVisitor[]>([]);

function guestKey() {
  try {
    let k = sessionStorage.getItem('gmw-guest');
    if (!k) { k = `guest-${Math.random().toString(36).slice(2, 10)}`; sessionStorage.setItem('gmw-guest', k); }
    return k;
  } catch { return `guest-${Math.random().toString(36).slice(2, 10)}`; }
}

/**
 * Who's on the site right now, using Supabase Realtime Presence: every open tab announces itself
 * on one shared channel and drops off automatically when closed. Nothing is stored in the database
 * (apart from a signed-in player's "last seen" time).
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { session, profile, isAdmin } = useAuth();
  const { pathname } = useLocation();
  const [online, setOnline] = useState<OnlineVisitor[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const joined = useRef(new Date().toISOString());
  const key = session?.user.id ?? guestKey();
  const name = profile?.rs_name ?? null;

  const payload = useMemo(() => ({ name, admin: isAdmin, page: pathname, since: joined.current }), [name, isAdmin, pathname]);
  const latest = useRef(payload);
  latest.current = payload;

  useEffect(() => {
    const channel = supabase.channel('gmw-online', { config: { presence: { key } } });
    channelRef.current = channel;
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Omit<OnlineVisitor, 'key'>>();
        const list: OnlineVisitor[] = Object.entries(state).map(([k, metas]) => {
          // One person may have several tabs open: show their most recent page
          const m = metas[metas.length - 1];
          return { key: k, name: m.name ?? null, admin: !!m.admin, page: m.page ?? '/', since: m.since ?? '' };
        });
        setOnline(list);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track(latest.current);
      });
    return () => { channelRef.current = null; supabase.removeChannel(channel); };
  }, [key]);

  // Update what we announce when the page or name changes
  useEffect(() => { channelRef.current?.track(payload); }, [payload]);

  // Signed-in players: record "last seen" now and every few minutes while the tab is open
  useEffect(() => {
    if (!session) return;
    const touch = () => { if (document.visibilityState === 'visible') supabase.rpc('touch_last_seen').then(() => undefined); };
    touch();
    const t = window.setInterval(touch, 4 * 60_000);
    return () => window.clearInterval(t);
  }, [session]);

  return <PresenceContext.Provider value={online}>{children}</PresenceContext.Provider>;
}

export function useOnline() {
  return useContext(PresenceContext);
}

/** Friendly page names for the "who's online" list. */
export function pageName(path: string) {
  if (path === '/') return 'the board';
  if (path.startsWith('/contracts/')) return 'a bounty';
  if (path.startsWith('/hunters/')) return `${decodeURIComponent(path.split('/')[2] ?? '')}'s profile`;
  if (path.startsWith('/admin')) return 'admin';
  const map: Record<string, string> = {
    '/tavern': 'the Tavern', '/gallery': 'the doodle gallery', '/leaderboard': 'the leaderboard', '/results': 'the results', '/archive': 'the archive',
    '/how-it-works': 'how it works', '/me': 'their bounties', '/login': 'sign in', '/welcome': 'welcome',
  };
  return map[path] ?? path;
}
