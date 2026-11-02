import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, must } from './supabase';
import type {
  Achievement, ActivityRow, ArchiveRow, BoardSlot, EventStats, Category, Contract, EventSettings, HunterProfile, LeaderboardRow, PlayerSummary, Rank, Submission,
} from './types';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => must(await supabase.from('event_settings').select('*').single()) as EventSettings,
    staleTime: 60_000,
  });
}

export function useRanks() {
  return useQuery({
    queryKey: ['ranks'],
    queryFn: async () => must(await supabase.from('ranks').select('*').order('min_reputation')) as Rank[],
    staleTime: 300_000,
  });
}

export function useBoard() {
  return useQuery({
    queryKey: ['board'],
    queryFn: async () => must(await supabase.rpc('get_board')) as BoardSlot[],
    refetchInterval: 60_000,
  });
}

/** Refetch the board whenever a slot or contract changes, for every open browser. */
export function useBoardRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('board-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_slots' }, () =>
        qc.invalidateQueries({ queryKey: ['board'] }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contracts' }, () => {
        qc.invalidateQueries({ queryKey: ['board'] });
        qc.invalidateQueries({ queryKey: ['activity'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: ['contract', id],
    enabled: !!id,
    queryFn: async () => must(await supabase.from('contracts').select('*').eq('id', id!).maybeSingle()) as Contract | null,
  });
}

export function useMySubmissions(uid: string | undefined) {
  return useQuery({
    queryKey: ['my-submissions', uid],
    enabled: !!uid,
    queryFn: async () =>
      must(await supabase.from('submissions')
        .select('*, contract:contracts(id, title, category, difficulty, reputation)')
        .eq('player_id', uid!)
        .order('submitted_at', { ascending: false })) as (Submission & {
        contract: Pick<Contract, 'id' | 'title' | 'category' | 'difficulty' | 'reputation'> | null;
      })[],
  });
}

export function usePlayerSummary(uid: string | undefined) {
  return useQuery({
    queryKey: ['summary', uid],
    enabled: !!uid,
    queryFn: async () => {
      const rows = must(await supabase.rpc('get_player_summary', { p_player: uid })) as PlayerSummary[];
      return rows[0] ?? null;
    },
  });
}

export function useLeaderboard(category: Category | null) {
  return useQuery({
    queryKey: ['leaderboard', category],
    queryFn: async () => must(await supabase.rpc('get_leaderboard', { p_category: category })) as LeaderboardRow[],
    refetchInterval: 120_000,
  });
}

export function useArchive() {
  return useQuery({
    queryKey: ['archive'],
    queryFn: async () => must(await supabase.rpc('get_archive')) as ArchiveRow[],
  });
}

export function useHunter(name: string | undefined) {
  return useQuery({
    queryKey: ['hunter', name?.toLowerCase()],
    enabled: !!name,
    queryFn: async () => must(await supabase.rpc('get_hunter', { p_name: name })) as HunterProfile | null,
  });
}

export function useUnseenReviews(uid: string | undefined) {
  return useQuery({
    queryKey: ['unseen-reviews', uid],
    enabled: !!uid,
    refetchInterval: 60_000,
    queryFn: async () => Number(must(await supabase.rpc('my_unseen_reviews')) ?? 0),
  });
}

export function useAchievements(playerId: string | undefined) {
  return useQuery({
    queryKey: ['achievements', playerId],
    enabled: !!playerId,
    queryFn: async () => must(await supabase.rpc('get_achievements', { p_player: playerId })) as Achievement[],
    staleTime: 60_000,
  });
}

export function useHunters(contractId: string | undefined) {
  return useQuery({
    queryKey: ['hunters', contractId],
    enabled: !!contractId,
    queryFn: async () => must(await supabase.rpc('get_hunters', { p_contract_id: contractId })) as { rs_name: string; started_at: string }[],
    refetchInterval: 60_000,
  });
}

export function useActivity(limit = 15) {
  return useQuery({
    queryKey: ['activity', limit],
    queryFn: async () => must(await supabase.rpc('get_activity', { p_limit: limit })) as ActivityRow[],
    refetchInterval: 45_000,
  });
}

export function useEventStats() {
  return useQuery({
    queryKey: ['event-stats'],
    queryFn: async () => must(await supabase.rpc('get_event_stats')) as EventStats,
    refetchInterval: 120_000,
  });
}

/** Where the event is right now, re-checked every 30 seconds. */
export function useEventPhase() {
  const settings = useSettings().data;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  if (!settings) return { settings, phase: 'loading' as const };
  const phase = now < new Date(settings.starts_at).getTime() ? 'before' as const
    : now > new Date(settings.ends_at).getTime() ? 'ended' as const
    : settings.is_paused ? 'paused' as const : 'live' as const;
  return { settings, phase };
}
