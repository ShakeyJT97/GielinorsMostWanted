import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

const NOTIFY_KEY = 'gmw-notify-claims';

/** How many claims are waiting for review. Admins only; updates the moment a claim arrives. */
export function usePendingCount() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase.channel(`review-alerts-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => {
        qc.invalidateQueries({ queryKey: ['pending-count'] });
        qc.invalidateQueries({ queryKey: ['review'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, qc]);
  return useQuery({
    queryKey: ['pending-count'],
    enabled: isAdmin,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      return count ?? 0;
    },
  });
}

export function notificationsOn() {
  try { return localStorage.getItem(NOTIFY_KEY) === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch { return false; }
}

/** Turn this browser's pop-up notifications for new claims on or off. */
export async function setNotifications(on: boolean): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (on && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return false;
  }
  try { localStorage.setItem(NOTIFY_KEY, on ? '1' : '0'); } catch { /* not saved */ }
  return on;
}

/** For admins, on every page: a count in the tab title, and a pop-up when a new claim comes in. */
export function ReviewAlerts() {
  const { isAdmin } = useAuth();
  const count = usePendingCount().data ?? 0;
  const { pathname } = useLocation();
  const last = useRef<number | null>(null);
  const [toast, setToast] = useState<number | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = count > 0 ? `(${count}) ${base}` : base;
  }, [count, isAdmin, pathname]);

  useEffect(() => {
    if (!isAdmin) return;
    const before = last.current;
    last.current = count;
    if (before === null || count <= before) return;
    if (pathname !== '/admin') setToast(count);
    if (notificationsOn() && document.visibilityState !== 'visible') {
      const n = new Notification('New claim to review', { body: `${count} waiting on Gielinor's Most Wanted`, tag: 'gmw-review', icon: '/favicon.svg' });
      n.onclick = () => { window.focus(); window.location.assign('/admin'); n.close(); };
    }
  }, [count, isAdmin, pathname]);

  useEffect(() => {
    if (toast === null) return;
    const t = window.setTimeout(() => setToast(null), 12_000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!isAdmin || toast === null) return null;
  return (
    <div role="status" className="sheet fixed left-1/2 top-20 z-50 flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 !p-3 shadow-[0_12px_30px_rgba(0,0,0,.6)]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-wax-pvm font-bold text-parchment-50">{toast}</span>
      <p className="flex-1 text-sm"><strong>New claim to review.</strong> {toast} waiting in the queue.</p>
      <Link to="/admin" className="btn btn-sm btn-wax" onClick={() => setToast(null)}>Review</Link>
      <button className="text-sm underline" onClick={() => setToast(null)} aria-label="Dismiss">Later</button>
    </div>
  );
}
