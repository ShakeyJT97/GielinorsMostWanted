import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loading, Notice } from '../../components/ui';
import { PassphraseReveal } from '../../components/PassphraseReveal';
import { generatePassphrase } from '../../lib/passphrase';
import { useAuth } from '../../lib/auth';
import { errorMessage, must, supabase } from '../../lib/supabase';
import type { Profile, ReputationEvent } from '../../lib/types';

export default function PlayersAdmin() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [adjusting, setAdjusting] = useState<Profile | null>(null);
  const [reset, setReset] = useState<{ name: string; passphrase: string } | null>(null);

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

  const rows = (players.data ?? []).filter((p) => !search || (p.rs_name ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <h1 className="mb-3 font-display text-2xl text-ink">Players</h1>
      <input className="field mb-4 max-w-sm" placeholder="Search display names" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search players" />
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
          <table className="table-ink min-w-[40rem]">
            <thead><tr><th>Display name</th><th>Reputation</th><th>Role</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.is_banned ? 'opacity-60' : ''}>
                  <td>{p.rs_name ?? <em>Not set yet</em>}{p.is_banned && ' (banned)'}</td>
                  <td>{totals.get(p.id) ?? 0}</td>
                  <td className="capitalize">{p.role}</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      <button className="btn btn-sm btn-ghost" onClick={() => setAdjusting(p)}>Adjust reputation</button>
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
