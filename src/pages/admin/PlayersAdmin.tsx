import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loading, Notice } from '../../components/ui';
import { PassphraseReveal } from '../../components/PassphraseReveal';
import { generatePassphrase } from '../../lib/passphrase';
import { useAuth } from '../../lib/auth';
import { errorMessage, must, supabase } from '../../lib/supabase';
import type { Profile, ReputationEvent } from '../../lib/types';
import { useOnline, pageName } from '../../lib/presence';
import { ago, fmtDateTime } from '../../lib/format';
import { shoutRefresh } from '../../lib/doodles';

type SortKey = 'name' | 'joined' | 'seen';

export default function PlayersAdmin() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [adjusting, setAdjusting] = useState<Profile | null>(null);
  const [reset, setReset] = useState<{ name: string; passphrase: string } | null>(null);
  const [sort, setSort] = useState<SortKey>('joined');
  const online = useOnline();
  const onlineById = useMemo(() => new Map(online.map((o) => [o.key, o])), [online]);

  const resetPassphrase = useMutation({
    mutationFn: async (p: Profile) => {
      const passphrase = generatePassphrase();
      const { error } = await supabase.rpc('admin_set_passphrase', { p_player: p.id, p_passphrase: passphrase });
      if (error) throw error;
      return { name: p.rs_name ?? 'this player', passphrase };
    },
    onSuccess: (r) => { setMsg(null); setReset(r); },
    onError: (e) => setMsg({ tone: 'error', text: errorMessage(e) }),
  });

  const players = useQuery({
    queryKey: ['admin-players'],
    queryFn: async () => must(await supabase.from('profiles').select('*').order('rs_name', { nullsFirst: false })) as Profile[],
  });
  const events = useQuery({
    queryKey: ['admin-rep'],
    queryFn: async () => must(await supabase.from('reputation_events').select('player_id, amount, source')) as Pick<ReputationEvent, 'player_id' | 'amount' | 'source'>[],
  });
  const seen = useQuery({
    queryKey: ['admin-seen'],
    refetchInterval: 60_000,
    queryFn: async () => new Map((must(await supabase.from('player_seen').select('player_id, last_seen_at')) as { player_id: string; last_seen_at: string }[])
      .map((r) => [r.player_id, r.last_seen_at])),
  });
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events.data ?? []) m.set(e.player_id, (m.get(e.player_id) ?? 0) + e.amount);
    return m;
  }, [events.data]);

  const act = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown> }) => {
      const { error } = await supabase.rpc(fn, args);
      if (error) throw error;
    },
    onSuccess: () => { setMsg({ tone: 'success', text: 'Saved.' }); qc.invalidateQueries(); },
    onError: (e) => setMsg({ tone: 'error', text: errorMessage(e) }),
  });

  const seenAt = (p: Profile) => (onlineById.has(p.id) ? new Date().toISOString() : seen.data?.get(p.id) ?? '');
  const rows = (players.data ?? [])
    .filter((p) => !search || (p.rs_name ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'name' ? (a.rs_name ?? '~').localeCompare(b.rs_name ?? '~')
      : sort === 'joined' ? b.created_at.localeCompare(a.created_at)
      : seenAt(b).localeCompare(seenAt(a)));
  const all = players.data ?? [];
  const weekAgo = Date.now() - 7 * 86_400_000;
  const newThisWeek = all.filter((p) => new Date(p.created_at).getTime() > weekAgo).length;
  const onlineNamed = online.filter((o) => o.name).length;

  return (
    <div>
      <h1 className="mb-3 font-display text-2xl text-ink">Players</h1>
      <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
        <div><dt className="text-sm text-ink-soft">Signed up</dt><dd className="font-display text-2xl">{all.length}</dd></div>
        <div><dt className="text-sm text-ink-soft">New this week</dt><dd className="font-display text-2xl">{newThisWeek}</dd></div>
        <div><dt className="text-sm text-ink-soft">Online now</dt><dd className="font-display text-2xl">{onlineNamed}<span className="ml-1 font-serif text-base text-ink-soft">+ {online.length - onlineNamed} guests</span></dd></div>
      </dl>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="field max-w-sm" placeholder="Search display names" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search players" />
        <label className="flex items-center gap-2 text-sm">Sort by
          <select className="field !w-auto !py-1" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="joined">Newest sign-ups</option>
            <option value="seen">Last seen</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {reset && (
        <div className="mb-4 max-w-xl space-y-2">
          <PassphraseReveal passphrase={reset.passphrase} label={`New passphrase for ${reset.name}`} />
          <p className="text-sm text-ink-soft">Send it to them privately (a Discord DM, not clan chat). They've been signed out everywhere; this is the only time it's shown.</p>
          <button className="btn btn-sm btn-ghost" onClick={() => setReset(null)}>Done</button>
        </div>
      )}
      {adjusting && <AdjustForm player={adjusting} onClose={() => setAdjusting(null)} onSave={(amount, reason, source) => {
        act.mutate({ fn: 'adjust_reputation', args: { p_player: adjusting.id, p_amount: amount, p_reason: reason, p_source: source } });
        setAdjusting(null);
      }} />}
      {players.isLoading ? <Loading /> : (
        <div className="overflow-x-auto">
          <table className="table-ink min-w-[52rem]">
            <thead><tr><th>Display name</th><th>Reputation</th><th>Role</th><th>Joined</th><th>Last seen</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.is_banned ? 'opacity-60' : ''}>
                  <td>{p.rs_name ?? <em>Not set yet</em>}{p.is_banned && ' (banned)'}{p.is_muted && ' (muted)'}{p.is_draw_banned && ' (no drawing)'}</td>
                  <td>{totals.get(p.id) ?? 0}</td>
                  <td className="capitalize">{p.role}</td>
                  <td className="whitespace-nowrap text-sm" title={fmtDateTime(p.created_at)}>{ago(p.created_at)}</td>
                  <td className="whitespace-nowrap text-sm">
                    {onlineById.has(p.id) ? (
                      <span className="font-bold text-[#2f5a1f]" title={`On ${pageName(onlineById.get(p.id)!.page)}`}>● Online now</span>
                    ) : seen.data?.get(p.id) ? (
                      <span title={fmtDateTime(seen.data.get(p.id)!)}>{ago(seen.data.get(p.id)!)}</span>
                    ) : <span className="text-ink-soft">Not recorded yet</span>}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      <button className="btn btn-sm btn-ghost" onClick={() => setAdjusting(p)}>Adjust reputation</button>
                      <button className="btn btn-sm btn-ghost"
                        onClick={() => window.confirm(`Erase every doodle ${p.rs_name ?? 'this player'} has drawn, including on saved boards in the gallery?`) &&
                          act.mutate({ fn: 'erase_player_strokes', args: { p_player: p.id } }, { onSuccess: () => shoutRefresh() })}>
                        Erase drawings
                      </button>
                      <button className="btn btn-sm btn-ghost" disabled={resetPassphrase.isPending}
                        onClick={() => window.confirm(`Give ${p.rs_name ?? 'this player'} a new passphrase? Their current one stops working and they're signed out everywhere.`) && resetPassphrase.mutate(p)}>
                        Reset passphrase
                      </button>
                      {p.id !== session?.user.id && <>
                        <button className="btn btn-sm btn-ghost" onClick={() => window.confirm(`${p.role === 'admin' ? 'Remove admin from' : 'Make admin:'} ${p.rs_name ?? 'this player'}?`) &&
                          act.mutate({ fn: 'set_player_role', args: { p_player: p.id, p_role: p.role === 'admin' ? 'player' : 'admin' } })}>
                          {p.role === 'admin' ? 'Remove admin' : 'Make admin'}
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => act.mutate({ fn: 'set_player_banned', args: { p_player: p.id, p_banned: !p.is_banned } })}>
                          {p.is_banned ? 'Unban' : 'Ban'}
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => act.mutate({ fn: 'set_player_muted', args: { p_player: p.id, p_muted: !p.is_muted } })}>
                          {p.is_muted ? 'Unmute in Tavern' : 'Mute in Tavern'}
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => act.mutate({ fn: 'set_player_draw_banned', args: { p_player: p.id, p_banned: !p.is_draw_banned } })}>
                          {p.is_draw_banned ? 'Allow drawing' : 'Stop drawing'}
                        </button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdjustForm({ player, onClose, onSave }: { player: Profile; onClose: () => void; onSave: (amount: number, reason: string, source: 'bonus' | 'adjustment') => void }) {
  const [amount, setAmount] = useState(10);
  const [reason, setReason] = useState('');
  const [source, setSource] = useState<'bonus' | 'adjustment'>('bonus');
  function submit(e: FormEvent) { e.preventDefault(); if (amount !== 0 && reason.trim().length >= 3) onSave(amount, reason.trim(), source); }
  return (
    <form onSubmit={submit} className="mb-5 rounded border border-ink/30 bg-parchment-50/70 p-4">
      <h2 className="font-sc text-lg font-bold">Adjust reputation for {player.rs_name ?? 'player'}</h2>
      <p className="text-sm text-ink-soft">Adds a ledger entry. Use a negative number to correct a mistake; past awards are never edited.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_10rem_1fr]">
        <div><label className="label" htmlFor="amt">Amount</label><input id="amt" type="number" className="field" min={-1000} max={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div><label className="label" htmlFor="src">Type</label>
          <select id="src" className="field" value={source} onChange={(e) => setSource(e.target.value as 'bonus' | 'adjustment')}>
            <option value="bonus">Bonus</option><option value="adjustment">Correction</option>
          </select>
        </div>
        <div><label className="label" htmlFor="why">Reason</label><input id="why" className="field" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. First to claim on day one" /></div>
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn btn-wax btn-sm">Add entry</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
