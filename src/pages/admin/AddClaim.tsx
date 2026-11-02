import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EvidenceInputs, uploadEvidence, useEvidence } from '../../components/EvidenceInputs';
import { Notice } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useBoard, useSettings } from '../../lib/queries';
import { errorMessage, isolatedClient, must, supabase } from '../../lib/supabase';
import { generatePassphrase, newLoginEmail } from '../../lib/passphrase';
import { fromLocalInput, toLocalInput } from '../../lib/format';
import { CATEGORY_LABEL, type Profile } from '../../lib/types';

type Who = { kind: 'existing'; id: string } | { kind: 'new'; name: string };

/** Create a passphrase account for a player who only uses Discord. Returns their player id. */
async function createPlayer(name: string): Promise<string> {
  const check = await supabase.rpc('check_signup', { p_name: name, p_code: null });
  const joinCode = must(await supabase.from('integration_settings').select('join_code').single()) as { join_code: string | null };
  if (check.error) throw check.error;
  if (check.data && !/join code/.test(check.data as string)) {
    throw new Error(/already registered/.test(check.data as string)
      ? `${name.trim()} is already registered. Pick them from the player list instead.`
      : (check.data as string));
  }
  const iso = isolatedClient();
  const { data, error } = await iso.auth.signUp({
    email: newLoginEmail(),
    password: generatePassphrase(), // nobody needs it now; an admin can reset it if they ever want to sign in
    options: { data: { rs_name: name.trim(), join_code: joinCode.join_code } },
  });
  await iso.auth.signOut({ scope: 'local' }).catch(() => undefined);
  if (error || !data.user) throw new Error(`Couldn't create ${name.trim()}: ${error ? errorMessage(error) : 'no account returned'}`);
  return data.user.id;
}

export default function AddClaim() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const settings = useSettings().data;
  const board = useBoard();
  const players = useQuery({
    queryKey: ['admin-players'],
    queryFn: async () => must(await supabase.from('profiles').select('*').order('rs_name', { nullsFirst: false })) as Profile[],
  });

  const [who, setWho] = useState<Who | null>(null);
  const [search, setSearch] = useState('');
  const [contractId, setContractId] = useState('');
  const [postedAt, setPostedAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [note, setNote] = useState('');
  const [approve, setApprove] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const ev = useEvidence();

  const live = useMemo(() => (board.data ?? []).filter((s) => s.contract_id && s.slot_state !== 'paused'), [board.data]);
  const matches = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (players.data ?? []).filter((p) => p.rs_name && !p.is_banned && p.id !== session?.user.id && (!t || p.rs_name.toLowerCase().includes(t))).slice(0, 8);
  }, [players.data, search, session]);
  const exact = (players.data ?? []).find((p) => p.rs_name?.toLowerCase() === search.trim().toLowerCase());
  const chosen = who?.kind === 'existing' ? players.data?.find((p) => p.id === who.id) : null;

  const save = useMutation({
    mutationFn: async () => {
      const name = who!.kind === 'existing' ? chosen?.rs_name ?? 'The player' : who!.name.trim();
      const playerId = who!.kind === 'existing' ? who!.id : await createPlayer(who!.name);
      if (who!.kind === 'new') { setWho({ kind: 'existing', id: playerId }); await qc.invalidateQueries({ queryKey: ['admin-players'] }); } // don't recreate on retry
      const submissionId = crypto.randomUUID();
      const paths = await uploadEvidence(playerId, submissionId, ev.files);
      const { data, error } = await supabase.rpc('admin_submit_claim', {
        p_submission_id: submissionId,
        p_player: playerId,
        p_contract_id: contractId,
        p_links: ev.cleanLinks(),
        p_files: paths,
        p_note: note.trim(),
        p_submitted_at: fromLocalInput(postedAt),
        p_approve: approve,
      });
      if (error) throw error;
      return { name, ...(data as { status: string; retired?: boolean; replacement?: string | null; claims?: number; limit?: number }) };
    },
    onSuccess: (r) => {
      const name = r.name;
      const bounty = live.find((s) => s.contract_id === contractId)?.title ?? 'the bounty';
      setResult(
        r.status === 'pending' ? `Added ${name}'s claim on ${bounty}. It's waiting in the review queue.`
        : r.status === 'closed' ? `${bounty} filled up first, so ${name}'s claim was closed with no reputation.`
        : r.retired ? `Approved ${name}'s claim on ${bounty}. That was the last slot: it's retired${r.replacement ? ` and ${r.replacement} is now up` : ''}.`
        : `Approved ${name}'s claim on ${bounty} (${r.claims} of ${r.limit}).`,
      );
      ev.reset(); setContractId(''); setNote(''); setWho(null); setSearch('');
      qc.invalidateQueries();
    },
    onError: (e) => { setError(errorMessage(e)); qc.invalidateQueries({ queryKey: ['admin-players'] }); },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setResult(null);
    if (!who) { setError('Choose the player, or add them as a new player.'); return; }
    if (!contractId) { setError('Choose the bounty.'); return; }
    const problem = ev.validate();
    if (problem) { setError(problem); return; }
    save.mutate();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl text-ink">Add a claim from Discord</h1>
      <p className="mt-1 text-ink-soft">
        For players who post their screenshots in Discord instead of using the site. The claim counts exactly like one they
        submitted themselves.
      </p>
      {result && <div className="mt-4"><Notice tone="success">{result}</Notice></div>}

      <form onSubmit={onSubmit} className="mt-5 space-y-5">
        <fieldset>
          <legend className="label">Player</legend>
          {who ? (
            <div className="flex flex-wrap items-center gap-3 rounded border border-ink/30 bg-parchment-50/70 px-3 py-2">
              <span className="font-sc text-lg font-bold">{who.kind === 'existing' ? chosen?.rs_name : who.name.trim()}</span>
              {who.kind === 'new' && <span className="text-sm text-ink-soft">New player: an account is made for them when you save</span>}
              <button type="button" className="ml-auto text-sm underline" onClick={() => setWho(null)}>Change</button>
            </div>
          ) : (
            <>
              <input className="field" placeholder="Type their RuneScape name" value={search} maxLength={12}
                onChange={(e) => setSearch(e.target.value)} aria-label="Search players" autoComplete="off" />
              <ul className="mt-2 flex flex-wrap gap-2">
                {matches.map((p) => (
                  <li key={p.id}><button type="button" className="btn btn-sm btn-ghost" onClick={() => setWho({ kind: 'existing', id: p.id })}>{p.rs_name}</button></li>
                ))}
                {search.trim() && !exact && (
                  <li><button type="button" className="btn btn-sm btn-ink" onClick={() => setWho({ kind: 'new', name: search })}>Add "{search.trim()}" as a new player</button></li>
                )}
              </ul>
              {exact?.id === session?.user.id && <p className="hint">That's you. Use the normal claim form; another admin reviews your claims.</p>}
            </>
          )}
        </fieldset>

        <div>
          <label className="label" htmlFor="ac-bounty">Bounty</label>
          <select id="ac-bounty" className="field" value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">Choose a bounty on the board</option>
            {live.map((s) => (
              <option key={s.contract_id} value={s.contract_id!}>
                {s.tier === 'wanted' ? 'Most Wanted' : CATEGORY_LABEL[s.category!]}: {s.title} ({s.approved_count}/{s.claim_limit} claimed)
              </option>
            ))}
          </select>
        </div>

        <EvidenceInputs ev={ev} allowPaste
          filesHint="Save the image from Discord (right-click, Save image) and choose it here. Up to 3."
          linksHint="Optional: a link to their Discord message. Discord's own image links expire, so upload the screenshot too." />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ac-when">Posted in Discord at</label>
            <input id="ac-when" type="datetime-local" className="field" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} required />
            <p className="hint">Keeps the review queue in fair order. Must be during the event.</p>
          </div>
          <div>
            <label className="label" htmlFor="ac-note">Note (optional)</label>
            <input id="ac-note" className="field" maxLength={900} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Posted in #bounties" />
          </div>
        </div>

        {settings?.codeword && <p className="text-sm">Check the screenshot shows the codeword <strong className="font-sc">{settings.codeword}</strong> next to their name.</p>}

        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[#8e1f1f]" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
          <span>Approve it now <span className="text-ink-soft">(untick to send it to the review queue for another admin)</span></span>
        </label>

        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn btn-wax" disabled={save.isPending || ev.shrinking}>
          {save.isPending ? 'Saving…' : approve ? 'Add and approve' : 'Add to review queue'}
        </button>
      </form>
      <p className="mt-6 text-sm text-ink-soft">
        New players get an account with just their name. If they later want to sign in themselves, use <Link to="/admin/players">Players → Reset passphrase</Link> and send them the passphrase.
      </p>
    </div>
  );
}
