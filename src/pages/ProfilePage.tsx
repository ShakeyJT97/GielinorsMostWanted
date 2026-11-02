import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { PassphraseReveal } from '../components/PassphraseReveal';
import { generatePassphrase } from '../lib/passphrase';
import { errorMessage, supabase } from '../lib/supabase';
import { CategoryChip, Loading, Notice, PageTitle, Sheet, StatusChip } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useMySubmissions, usePlayerSummary } from '../lib/queries';
import { fmtDateTime } from '../lib/format';

export default function ProfilePage() {
  const { session, profile } = useAuth();
  const uid = session?.user.id;
  const summary = usePlayerSummary(uid).data;
  const subs = useMySubmissions(uid);
  const qc = useQueryClient();
  const marked = useRef(false);
  const [seenBefore, setSeenBefore] = useState<number | null>(null);

  // Opening this page counts as seeing your reviews; remember the previous time to mark what's new
  useEffect(() => {
    if (!uid || marked.current) return;
    marked.current = true;
    supabase.rpc('mark_reviews_seen').then(({ data }) => {
      if (data) setSeenBefore(new Date(data as string).getTime());
      qc.invalidateQueries({ queryKey: ['unseen-reviews'] });
    });
  }, [uid, qc]);

  if (!session) return <Navigate to="/login" replace />;

  const rep = Number(summary?.reputation ?? 0);
  const nextAt = summary?.next_rank_at ?? null;
  const approved = (subs.data ?? []).filter((s) => s.status === 'approved');
  const counts = (subs.data ?? []).reduce<Record<string, number>>((a, s) => ({ ...a, [s.status]: (a[s.status] ?? 0) + 1 }), {});

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Sheet>
        <PageTitle sub={<>{profile?.rs_name && <><Link to={`/hunters/${encodeURIComponent(profile.rs_name)}`}>View your public profile</Link> · </>}<Link to="/welcome">Change display name</Link></>}>{profile?.rs_name ?? 'New hunter'}</PageTitle>
        <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="text-center sm:text-left">
            <p className="font-display text-5xl leading-none text-ink">{rep}</p>
            <p className="font-sc font-bold">Reputation</p>
          </div>
          <div>
            <p className="font-sc text-xl font-bold">{summary?.rank_name ?? 'Unknown Adventurer'}</p>
            {nextAt !== null ? (
              <>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-ink/15" role="progressbar" aria-valuemin={0} aria-valuemax={nextAt} aria-valuenow={rep}
                  aria-label={`Progress to ${summary?.next_rank_name}`}>
                  <div className="h-full bg-brass" style={{ width: `${Math.min(100, (rep / nextAt) * 100)}%` }} />
                </div>
                <p className="mt-1 text-sm text-ink-soft">{nextAt - rep} more to become {summary?.next_rank_name}</p>
              </>
            ) : <p className="mt-1 text-sm text-ink-soft">The highest rank there is.</p>}
          </div>
        </div>
        <p className="mt-5 text-ink-soft">
          {approved.length} bounties claimed · {counts.pending ?? 0} pending · {counts.rejected ?? 0} rejected
        </p>
      </Sheet>

      <Sheet>
        <h2 className="font-display text-2xl text-ink">Your claims</h2>
        {subs.isLoading ? <Loading /> : (subs.data ?? []).length === 0 ? (
          <p className="mt-3">No claims yet. <Link to="/">Pick a bounty from the board</Link> to get started.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="table-ink min-w-[34rem]">
              <thead><tr><th>Bounty</th><th>Submitted</th><th>Status</th><th>Admin note</th></tr></thead>
              <tbody>
                {subs.data!.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.contract ? <Link to={`/contracts/${s.contract.id}`}>{s.contract.title}</Link> : 'Unknown'}
                      {s.contract && <div className="mt-0.5"><CategoryChip category={s.contract.category} /> <span className="text-sm">{s.contract.reputation} rep</span></div>}
                    </td>
                    <td className="whitespace-nowrap text-sm">{fmtDateTime(s.submitted_at)}</td>
                    <td>
                      <StatusChip status={s.status} />
                      {seenBefore !== null && s.reviewed_at && s.status !== 'withdrawn' && new Date(s.reviewed_at).getTime() > seenBefore && (
                        <span className="chip ml-1 bg-wax-pvm text-parchment-50">New</span>
                      )}
                    </td>
                    <td className="text-sm">{s.review_note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>
      <Sheet>
        <ChangePassphrase />
      </Sheet>
    </div>
  );
}

function ChangePassphrase() {
  const [next, setNext] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function confirm() {
    if (!next) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) { setMsg({ tone: 'error', text: errorMessage(error) }); return; }
    setMsg({ tone: 'success', text: 'Passphrase changed. Use the new one next time you sign in.' });
    setNext(null); setSaved(false);
  }

  return (
    <div>
      <h2 className="font-display text-2xl text-ink">Passphrase</h2>
      <p className="mt-1 text-ink-soft">Think someone else knows yours? Get a new one; the old one stops working.</p>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {!next ? (
        <button className="btn btn-ghost mt-3" onClick={() => { setNext(generatePassphrase()); setMsg(null); }}>Get a new passphrase</button>
      ) : (
        <div className="mt-3 max-w-lg space-y-3">
          <PassphraseReveal passphrase={next} label="Your new passphrase" />
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-[#8e1f1f]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I've saved it
          </label>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setNext(null)}>Cancel</button>
            <button className="btn btn-wax" disabled={!saved || busy} onClick={confirm}>Switch to this passphrase</button>
          </div>
        </div>
      )}
    </div>
  );
}
