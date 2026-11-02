import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { must, supabase } from './supabase';

/** 10000 board units = the board's full width (or, for poster points, the poster's width). */
export const UNITS = 10000;

export const PEN_COLOURS: { value: string; name: string }[] = [
  { value: '#f4ecd8', name: 'Chalk' },
  { value: '#1d1a17', name: 'Charcoal' },
  { value: '#b3261e', name: 'Red' },
  { value: '#e0b84f', name: 'Gold' },
  { value: '#4f8a3a', name: 'Green' },
  { value: '#3c5fa8', name: 'Blue' },
  { value: '#c2569b', name: 'Pink' },
];
export const PEN_SIZES: { value: number; name: string }[] = [
  { value: 15, name: 'Fine' }, { value: 30, name: 'Medium' }, { value: 65, name: 'Thick' },
];

export interface Stroke {
  id: number;
  player_id: string;
  color: string;
  width: number;
  points: number[];
  contract_id: string | null;
  poster_points: number[] | null;
  poster_box: number[] | null;
  created_at: string;
  erased_at: string | null;
  snapshot_id: number | null;
}

export interface Snapshot { id: number; name: string; taken_at: string; strokes: number }

export const DOODLE_CHANNEL = 'doodles-live';

/** Smooth SVG/canvas-friendly path through [x,y,x,y…] already in pixels. */
export function pathD(pts: number[]): string {
  if (pts.length < 2) return '';
  if (pts.length <= 4) {
    const [x, y] = pts; const x2 = pts[2] ?? x, y2 = pts[3] ?? y;
    return `M${x} ${y}L${x2 + (x2 === x && y2 === y ? 0.01 : 0)} ${y2}`;
  }
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2, my = (pts[i + 1] + pts[i + 3]) / 2;
    d += `Q${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  d += `L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
  return d;
}

export function tracePath(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length <= 4) { ctx.lineTo((pts[2] ?? pts[0]) + 0.01, pts[3] ?? pts[1]); return; }
  for (let i = 2; i < pts.length - 2; i += 2) {
    ctx.quadraticCurveTo(pts[i], pts[i + 1], (pts[i] + pts[i + 2]) / 2, (pts[i + 1] + pts[i + 3]) / 2);
  }
  ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
}

const SELECT = 'id, player_id, color, width, points, contract_id, poster_points, poster_box, created_at, erased_at, snapshot_id';

/** The doodles currently on the live board, kept up to date in real time. */
export function useLiveDoodles() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('board_strokes').select(SELECT)
      .is('erased_at', null).is('snapshot_id', null).order('id').limit(5000);
    if (!error) setStrokes((data ?? []) as Stroke[]);
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase.channel(`${DOODLE_CHANNEL}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_strokes' }, (p) => {
        const s = p.new as Stroke;
        if (s.erased_at || s.snapshot_id) return;
        setStrokes((cur) => (cur.some((x) => x.id === s.id) ? cur : [...cur, s]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board_strokes' }, () => refresh())
      .subscribe();
    // Erasing hides the row, which realtime can't always tell other browsers about, so admins also shout
    const shout = supabase.channel(DOODLE_CHANNEL).on('broadcast', { event: 'refresh' }, () => refresh()).subscribe();
    const poll = window.setInterval(refresh, 45_000);
    return () => { supabase.removeChannel(channel); supabase.removeChannel(shout); window.clearInterval(poll); };
  }, [refresh]);

  return { strokes, setStrokes, refresh };
}

/** Tell every open board to reload its doodles (after an erase or an archive). */
export async function shoutRefresh() {
  const ch = supabase.channel(DOODLE_CHANNEL);
  await new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, 2500);
    ch.subscribe((status) => { if (status === 'SUBSCRIBED') { window.clearTimeout(t); resolve(); } });
  });
  await ch.send({ type: 'broadcast', event: 'refresh', payload: {} });
  supabase.removeChannel(ch);
}

export function usePlayerNames(enabled = true) {
  return useQuery({
    queryKey: ['player-names'],
    enabled,
    staleTime: 120_000,
    queryFn: async () => new Map((must(await supabase.from('profiles').select('id, rs_name')) as { id: string; rs_name: string | null }[])
      .map((p) => [p.id, p.rs_name ?? 'New hunter'])),
  });
}

export function useSnapshots() {
  return useQuery({
    queryKey: ['board-snapshots'],
    queryFn: async () => must(await supabase.from('board_snapshots').select('id, name, taken_at, strokes').order('taken_at')) as Snapshot[],
  });
}

export function useContractDoodles(contractId: string | undefined) {
  return useQuery({
    queryKey: ['contract-doodles', contractId],
    enabled: !!contractId,
    queryFn: async () => (must(await supabase.from('board_strokes').select(SELECT).eq('contract_id', contractId!).order('id')) as Stroke[])
      .filter((s) => !s.erased_at),
  });
}

/** Every doodle that hasn't been erased, for the gallery. */
export function useAllDoodles() {
  return useQuery({
    queryKey: ['all-doodles'],
    queryFn: async () => {
      const out: Stroke[] = [];
      for (let from = 0; ; from += 1000) {
        const page = must(await supabase.from('board_strokes').select(SELECT).order('id').range(from, from + 999)) as Stroke[];
        out.push(...page);
        if (page.length < 1000) break;
      }
      return out.filter((s) => !s.erased_at);
    },
  });
}
