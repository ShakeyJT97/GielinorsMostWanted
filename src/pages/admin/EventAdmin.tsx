import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loading, Notice } from '../../components/ui';
import { useRanks, useSettings } from '../../lib/queries';
import { errorMessage, must, supabase } from '../../lib/supabase';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../../lib/format';
import { downloadCsv, fetchAll, stamp, toCsv } from '../../lib/csv';
import type { AuditRow, EventSettings, IntegrationSettings, Rank } from '../../lib/types';

export function EventAdmin() {
  const settings = useSettings();
  const qc = useQueryClient();
  const [f, setF] = useState<EventSettings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => { if (settings.data) setF(settings.data); }, [settings.data]);

  const save = useMutation({
    mutationFn: async (patch: Partial<EventSettings>) => {
      const { error } = await supabase.from('event_settings').update(patch).eq('id', true);
      if (error) throw error;
    },
    onSuccess: () => { setMsg({ tone: 'success', text: 'Event settings saved.' }); qc.invalidateQueries(); },
    onError: (e) => setMsg({ tone: 'error', text: errorMessage(e) }),
  });

  if (!f) return <Loading />;
  const set = <K extends keyof EventSettings>(k: K, v: EventSettings[K]) => setF({ ...f, [k]: v });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { event_name, clan_name, starts_at, ends_at, review_grace_hours, slots_pvm, slots_skilling, slots_special, slots_wanted, default_claim_limit, codeword } = f!;
    save.mutate({ event_name, clan_name, starts_at, ends_at, review_grace_hours, slots_pvm, slots_skilling, slots_special, slots_wanted, default_claim_limit, codeword: codeword.trim() });
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="mr-auto font-display text-2xl text-ink">Event</h1>
          <button className={`btn ${f.is_paused ? 'btn-brass' : 'btn-wax'}`} disabled={save.isPending}
            onClick={() => save.mutate({ is_paused: !f.is_paused })}>
            {f.is_paused ? 'Resume event' : 'Pause event'}
          </button>
        </div>
        <p className="mb-4 text-ink-soft">Pausing stops new claims. Admins can still review claims already submitted.</p>
        {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}

        <form onSubmit={onSubmit} className="max-w-3xl space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor="start">Starts</label>
              <input id="start" type="datetime-local" className="field" required value={toLocalInput(f.starts_at)} onChange={(e) => set('starts_at', fromLocalInput(e.target.value))} /></div>
            <div><label className="label" htmlFor="end">Ends</label>
              <input id="end" type="datetime-local" className="field" required value={toLocalInput(f.ends_at)} onChange={(e) => set('ends_at', fromLocalInput(e.target.value))} /></div>
          </div>
          <p className="hint -mt-2">Times are in your browser's time zone.</p>
          <div className="grid gap-4 sm:grid-cols-4">
            <Num id="pvm" label="PvM slots" value={f.slots_pvm} min={0} max={20} onChange={(v) => set('slots_pvm', v)} />
            <Num id="sk" label="Skilling slots" value={f.slots_skilling} min={0} max={20} onChange={(v) => set('slots_skilling', v)} />
            <Num id="sp" label="Special slots" value={f.slots_special} min={0} max={20} onChange={(v) => set('slots_special', v)} />
            <Num id="mw" label="Most Wanted slots" value={f.slots_wanted} min={0} max={10} onChange={(v) => set('slots_wanted', v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Num id="limit" label="Claims per contract" value={f.default_claim_limit} min={1} max={50} onChange={(v) => set('default_claim_limit', v)}
              hint="Default completion slots; contracts can override." />
            <Num id="grace" label="Review grace (hours)" value={f.review_grace_hours} min={0} max={336} onChange={(v) => set('review_grace_hours', v)}
              hint="How long after the end admins can still approve." />
            <div><label className="label" htmlFor="code">Codeword</label>
              <input id="code" className="field" required maxLength={40} value={f.codeword} onChange={(e) => set('codeword', e.target.value)} />
              <p className="hint">Players type it in clan chat before screenshots. Shown to signed-in players; change it daily if you like.</p></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor="ename">Event name</label><input id="ename" className="field" value={f.event_name} onChange={(e) => set('event_name', e.target.value)} /></div>
            <div><label className="label" htmlFor="cname">Clan name</label><input id="cname" className="field" value={f.clan_name} onChange={(e) => set('clan_name', e.target.value)} /></div>
          </div>
          <button className="btn btn-wax" disabled={save.isPending}>Save settings</button>
        </form>
      </section>

      <BackupDownloads />
      <JoinCodeSettings />
      <DiscordSettings />
      <RanksEditor />
    </div>
  );
}

function Num({ id, label, value, min, max, onChange, hint }: { id: string; label: string; value: number; min: number; max: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} type="number" className="field" min={min} max={max} required value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function BackupDownloads() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function run(kind: 'claims' | 'reputation' | 'players') {
    setBusy(kind); setMsg(null);
    try {
      const players = await fetchAll('profiles', 'id, rs_name, role, is_banned, is_muted, created_at', 'created_at');
      const nameOf = new Map(players.map((p) => [p.id as string, p.rs_name as string | null]));
      if (kind === 'claims') {
        const rows = await fetchAll('submissions', '*, contract:contracts(title, category, reputation)', 'submitted_at');
        const flat = rows.map((r) => {
          const c = r.contract as { title: string; category: string; reputation: number } | null;
          return { ...r, player: nameOf.get(r.player_id as string), reviewer: nameOf.get(r.reviewed_by as string),
                   bounty: c?.title, category: c?.category, bounty_reputation: c?.reputation,
                   screenshots: (r.evidence_files as string[]).length };
        });
        downloadCsv(`gmw-claims-${stamp()}.csv`, toCsv(flat, [['submitted_at', 'Submitted'], ['player', 'Player'], ['bounty', 'Bounty'], ['category', 'Category'],
          ['bounty_reputation', 'Reward'], ['status', 'Status'], ['reviewed_at', 'Reviewed'], ['reviewer', 'Reviewed by'], ['review_note', 'Admin note'],
          ['player_note', 'Player note'], ['evidence_links', 'Links'], ['screenshots', 'Screenshots'], ['id', 'Claim ID']]));
        setMsg({ tone: 'success', text: `Downloaded ${flat.length} claims.` });
      } else if (kind === 'reputation') {
        const rows = await fetchAll('reputation_events', '*, contract:contracts(title)', 'created_at');
        const flat = rows.map((r) => ({ ...r, player: nameOf.get(r.player_id as string), by: nameOf.get(r.created_by as string),
                                        bounty: (r.contract as { title: string } | null)?.title }));
        downloadCsv(`gmw-reputation-${stamp()}.csv`, toCsv(flat, [['created_at', 'When'], ['player', 'Player'], ['amount', 'Amount'], ['source', 'Type'],
          ['category', 'Category'], ['bounty', 'Bounty'], ['reason', 'Reason'], ['by', 'Given by']]));
        setMsg({ tone: 'success', text: `Downloaded ${flat.length} reputation entries.` });
      } else {
        const { data, error } = await supabase.rpc('get_leaderboard', { p_category: null });
        if (error) throw error;
        const standing = new Map(((data ?? []) as { player_id: string; place: number; reputation: number; claims: number; rank_name: string }[]).map((r) => [r.player_id, r]));
        const flat = players.filter((p) => p.rs_name).map((p) => ({ ...p, ...(standing.get(p.id as string) ?? { reputation: 0, claims: 0 }) }));
        flat.sort((a, b) => Number(b.reputation) - Number(a.reputation));
        downloadCsv(`gmw-players-${stamp()}.csv`, toCsv(flat, [['place', 'Place'], ['rs_name', 'Player'], ['reputation', 'Reputation'], ['claims', 'Bounties'],
          ['rank_name', 'Rank'], ['role', 'Role'], ['is_banned', 'Banned'], ['is_muted', 'Muted'], ['created_at', 'Joined']]));
        setMsg({ tone: 'success', text: `Downloaded ${flat.length} players.` });
      }
    } catch (e) {
      setMsg({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h2 className="font-display text-xl text-ink">Backups</h2>
      <p className="mb-3 text-ink-soft">Download spreadsheets (CSV, opens in Excel or Google Sheets). Worth doing every few days during the event.</p>
      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('claims')}>{busy === 'claims' ? 'Preparing…' : 'Download claims'}</button>
        <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('reputation')}>{busy === 'reputation' ? 'Preparing…' : 'Download reputation'}</button>
        <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('players')}>{busy === 'players' ? 'Preparing…' : 'Download players and standings'}</button>
      </div>
    </section>
  );
}

function JoinCodeSettings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['integrations'],
    queryFn: async () => must(await supabase.from('integration_settings').select('*').single()) as IntegrationSettings,
  });
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => { if (q.data) setCode(q.data.join_code ?? ''); }, [q.data]);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('integration_settings').update({ join_code: code?.trim() || null }).eq('id', true);
      if (error) throw error;
    },
    onSuccess: () => { setMsg({ tone: 'success', text: code?.trim() ? 'Join code saved. New players need it to sign up.' : 'Join code removed. Anyone can sign up.' }); qc.invalidateQueries({ queryKey: ['integrations'] }); },
    onError: (e) => setMsg({ tone: 'error', text: /check constraint/.test(errorMessage(e)) ? 'Join codes are 3 to 40 characters.' : errorMessage(e) }),
  });
  if (code === null) return null;
  return (
    <section>
      <h2 className="font-display text-xl text-ink">Sign-up</h2>
      <p className="mb-3 text-ink-soft">Set a join code to stop people outside the clan registering. Share it in clan chat or Discord. Leave blank to let anyone sign up. Existing players aren't affected.</p>
      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <form className="flex max-w-xl flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <input className="field flex-1" aria-label="Join code" placeholder="No join code" maxLength={40} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn btn-wax" disabled={save.isPending}>Save join code</button>
      </form>
    </section>
  );
}

function DiscordSettings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['integrations'],
    queryFn: async () => must(await supabase.from('integration_settings').select('*').single()) as IntegrationSettings,
  });
  const [f, setF] = useState<IntegrationSettings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => { if (q.data) setF({ ...q.data, site_url: q.data.site_url ?? window.location.origin }); }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('integration_settings').update({
        discord_webhook_url: f!.discord_webhook_url?.trim() || null,
        notify_approvals: f!.notify_approvals,
        notify_retirements: f!.notify_retirements,
        notify_new_bounties: f!.notify_new_bounties,
        site_url: f!.site_url?.trim() || null,
        daily_post_hour: f!.daily_post_hour,
      }).eq('id', true);
      if (error) throw error;
    },
    onSuccess: () => { setMsg({ tone: 'success', text: 'Discord settings saved.' }); qc.invalidateQueries({ queryKey: ['integrations'] }); },
    onError: (e) => setMsg({ tone: 'error', text: /check constraint/.test(errorMessage(e)) ? 'That isn\'t a Discord webhook address. It should start with https://discord.com/api/webhooks/' : errorMessage(e) }),
  });
  const test = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('send_discord_test'); if (error) throw error; },
    onSuccess: () => setMsg({ tone: 'success', text: 'Test message sent. If it doesn\'t appear in Discord within a minute, check the webhook address.' }),
    onError: (e) => setMsg({ tone: 'error', text: errorMessage(e) }),
  });
  const standings = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('send_standings_now'); if (error) throw error; },
    onSuccess: () => setMsg({ tone: 'success', text: 'Current standings posted to Discord.' }),
    onError: (e) => setMsg({ tone: 'error', text: errorMessage(e) }),
  });

  if (q.error) return <section><h2 className="font-display text-xl text-ink">Discord</h2><Notice tone="error">{errorMessage(q.error)}</Notice></section>;
  if (!f) return null;
  const toggle = (k: 'notify_approvals' | 'notify_retirements' | 'notify_new_bounties', label: string) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" className="h-4 w-4 accent-[#8e1f1f]" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <section>
      <h2 className="font-display text-xl text-ink">Discord</h2>
      <p className="mb-3 text-ink-soft">
        Post bounty news to a clan channel. In Discord: channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL.
      </p>
      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <form className="max-w-3xl space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div>
          <label className="label" htmlFor="hook">Webhook address</label>
          <input id="hook" className="field" type="url" placeholder="https://discord.com/api/webhooks/…" autoComplete="off"
            value={f.discord_webhook_url ?? ''} onChange={(e) => setF({ ...f, discord_webhook_url: e.target.value })} />
          <p className="hint">Only admins can see this. Leave blank to turn Discord posts off.</p>
        </div>
        <div>
          <label className="label" htmlFor="site">Site address for links</label>
          <input id="site" className="field" type="url" value={f.site_url ?? ''} onChange={(e) => setF({ ...f, site_url: e.target.value })} />
        </div>
        <fieldset className="space-y-1">
          <legend className="label">Post when</legend>
          {toggle('notify_approvals', 'A claim is approved')}
          {toggle('notify_retirements', 'A bounty is fully claimed')}
          {toggle('notify_new_bounties', 'A new bounty goes up')}
        </fieldset>
        <div>
          <label className="label" htmlFor="daily">Daily standings</label>
          <select id="daily" className="field !w-auto" value={f.daily_post_hour ?? ''}
            onChange={(e) => setF({ ...f, daily_post_hour: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Off</option>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>Every day at {String(h).padStart(2, '0')}:00 (UK time)</option>)}
          </select>
          <p className="hint">Posts the top 5 once a day while the event runs, and the final standings when it ends.
            {f.last_daily_post_on && ` Last posted ${f.last_daily_post_on}.`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-wax" disabled={save.isPending}>Save Discord settings</button>
          <button type="button" className="btn btn-ghost" disabled={test.isPending || !q.data?.discord_webhook_url} onClick={() => test.mutate()}>Send test message</button>
          <button type="button" className="btn btn-ghost" disabled={standings.isPending || !q.data?.discord_webhook_url} onClick={() => standings.mutate()}>Post standings now</button>
        </div>
      </form>
    </section>
  );
}

function RanksEditor() {
  const ranks = useRanks();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [min, setMin] = useState(0);

  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => { const { error } = await fn(); if (error) throw error; },
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['ranks'] }); },
    onError: (e) => setErr(errorMessage(e)),
  });

  return (
    <section>
      <h2 className="font-display text-xl text-ink">Ranks</h2>
      <p className="mb-3 text-ink-soft">Titles players earn as their reputation grows.</p>
      {err && <div className="mb-3"><Notice tone="error">{err}</Notice></div>}
      <table className="table-ink max-w-xl">
        <thead><tr><th>Title</th><th>From reputation</th><th /></tr></thead>
        <tbody>
          {(ranks.data ?? []).map((r: Rank) => (
            <tr key={r.id}>
              <td><input className="field !py-1" defaultValue={r.name} aria-label="Rank title"
                onBlur={(e) => e.target.value !== r.name && run.mutate(() => supabase.from('ranks').update({ name: e.target.value }).eq('id', r.id))} /></td>
              <td><input type="number" min={0} className="field !w-28 !py-1" defaultValue={r.min_reputation} aria-label="Minimum reputation"
                onBlur={(e) => Number(e.target.value) !== r.min_reputation && run.mutate(() => supabase.from('ranks').update({ min_reputation: Number(e.target.value) }).eq('id', r.id))} /></td>
              <td>{r.min_reputation > 0 && <button className="btn btn-sm btn-ghost" onClick={() => run.mutate(() => supabase.from('ranks').delete().eq('id', r.id))}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="mt-3 flex max-w-xl flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate(() => supabase.from('ranks').insert({ name, min_reputation: min })); setName(''); }}>
        <input className="field flex-1" placeholder="New rank title" required value={name} onChange={(e) => setName(e.target.value)} aria-label="New rank title" />
        <input type="number" min={1} className="field !w-28" value={min} onChange={(e) => setMin(Number(e.target.value))} aria-label="New rank minimum reputation" />
        <button className="btn btn-ink">Add rank</button>
      </form>
    </section>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'submission.approved': 'Approved claim', 'submission.rejected': 'Rejected claim',
  'contract.created': 'Created contract', 'contract.updated': 'Edited contract', 'contract.deleted': 'Deleted contract',
  'contract.retired': 'Contract retired', 'slot.rotated': 'Slot rotated', 'slot.awaiting': 'Slot awaiting contract',
  'slot.manual_rotate': 'Manual rotation', 'slot.paused': 'Paused slot', 'slot.resumed': 'Resumed slot',
  'board.synced': 'Filled empty slots', 'event.settings_updated': 'Changed event settings',
  'reputation.bonus': 'Bonus reputation', 'reputation.adjustment': 'Reputation correction',
  'player.role_set': 'Changed role', 'player.passphrase_reset': 'Reset passphrase', 'submission.entered_by_admin': 'Added claim from Discord', 'submission.revoked': 'Revoked approval',
  'chat.deleted': 'Deleted Tavern message', 'player.muted': 'Muted player', 'player.unmuted': 'Unmuted player', 'player.banned': 'Banned player', 'player.unbanned': 'Unbanned player',
};

export function AuditLog() {
  const log = useQuery({
    queryKey: ['audit'],
    queryFn: async () => must(await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300)) as AuditRow[],
  });
  const names = useQuery({
    queryKey: ['admin-players'],
    queryFn: async () => must(await supabase.from('profiles').select('*')) as { id: string; rs_name: string | null }[],
  });
  const nameOf = (id: string | null | undefined) => (id ? names.data?.find((p) => p.id === id)?.rs_name ?? 'Unknown' : 'System');

  return (
    <div>
      <h1 className="mb-3 font-display text-2xl text-ink">Audit log</h1>
      <p className="mb-4 text-ink-soft">The latest 300 actions. Entries can't be edited or deleted.</p>
      {log.isLoading ? <Loading /> : (
        <div className="overflow-x-auto">
          <table className="table-ink min-w-[40rem] text-sm">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {(log.data ?? []).map((r) => {
                const d = r.details as Record<string, unknown>;
                const detail = Object.entries(d)
                  .map(([k, v]) => (k === 'player_id' ? `player: ${nameOf(v as string)}` : `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`))
                  .join('; ');
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td>{nameOf(r.actor_id)}</td>
                    <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td className="break-words">{detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
