import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CategoryChip, Loading, Notice, StatusChip } from '../../components/ui';
import { Lightbox } from '../../components/Lightbox';
import { useAuth } from '../../lib/auth';
import { useSettings } from '../../lib/queries';
import { EVIDENCE_BUCKET, errorMessage, must, supabase } from '../../lib/supabase';
import { fmtDateTime } from '../../lib/format';
import { notificationsOn, setNotifications } from '../../components/ReviewAlerts';
import type { Category, SubmissionStatus } from '../../lib/types';

interface QueueRow {
  id: string;
  contract_id: string;
  player_id: string;
  evidence_links: string[];
  evidence_files: string[];
  player_note: string;
  status: SubmissionStatus;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  contract: { id: string; title: string; category: Category; reputation: number; status: string; approved_count: number; claim_limit: number | null; evidence_instructions: string } | null;
  player: { rs_name: string | null } | null;
}

export default function ReviewQueue() {
  const [view, setView] = useState<'pending' | 'reviewed'>('pending');
  const q = useQuery({
    queryKey: ['review', view],
    refetchInterval: view === 'pending' ? 30_000 : false,
    queryFn: async () => {
      let req = supabase.from('submissions')
        .select('*, contract:contracts(id, title, category, reputation, status, approved_count, claim_limit, evidence_instructions), player:profiles!submissions_player_id_fkey(rs_name)');
      req = view === 'pending'
        ? req.eq('status', 'pending').order('submitted_at', { ascending: true })
        : req.neq('status', 'pending').order('reviewed_at', { ascending: false, nullsFirst: false }).limit(100);
      return must(await req) as QueueRow[];
    },
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto font-display text-2xl text-ink">Review claims</h1>
        <button className={`btn btn-sm ${view === 'pending' ? 'btn-ink' : 'btn-ghost'}`} onClick={() => setView('pending')}>Pending, oldest first</button>
        <button className={`btn btn-sm ${view === 'reviewed' ? 'btn-ink' : 'btn-ghost'}`} onClick={() => setView('reviewed')}>Recently reviewed</button>
      </div>
      <NotifyToggle />
      {q.isLoading ? <Loading /> : q.error ? <Notice tone="error">{errorMessage(q.error)}</Notice>
        : (q.data ?? []).length === 0 ? <p>{view === 'pending' ? 'Nothing waiting. The queue is clear.' : 'No reviewed claims yet.'}</p>
        : <ul className="space-y-5">{q.data!.map((s) => <ReviewCard key={s.id} s={s} />)}</ul>}
    </div>
  );
}

const REASONS = [
  'Codeword not visible',
  'Name not visible next to the codeword',
  'Wrong boss or task',
  'Not enough shown (count or items)',
  'Screenshot too unclear to read',
];

function ReviewCard({ s }: { s: QueueRow }) {
  const { session } = useAuth();
  const codeword = useSettings().data?.codeword;
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const own = s.player_id === session?.user.id;

  const revoke = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('revoke_approval', { p_submission_id: s.id, p_reason: revokeReason.trim() });
      if (error) throw error;
      return data as { contract_status: string; claims: number; reputation_removed: number | null };
    },
    onSuccess: (r) => {
      setRevoking(false);
      setResult(`Approval revoked and ${r.reputation_removed ?? 0} reputation removed. ${r.contract_status === 'retired'
        ? 'The bounty had already retired, so it stays in the archive.' : `The bounty now has ${r.claims} approved claims and a slot free.`}`);
      setTimeout(() => qc.invalidateQueries(), 1500);
    },
  });

  const urls = useQuery({
    queryKey: ['evidence', s.id],
    enabled: s.evidence_files.length > 0,
    staleTime: 8 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrls(s.evidence_files, 600);
      if (error) throw error;
      return data.map((d) => d.signedUrl).filter(Boolean) as string[];
    },
  });

  const review = useMutation({
    mutationFn: async (approve: boolean) => {
      const { data, error } = await supabase.rpc('review_submission', { p_submission_id: s.id, p_approve: approve, p_note: note || null });
      if (error) throw error;
      return data as { status: string; retired?: boolean; replacement?: string | null; claims?: number; limit?: number };
    },
    onSuccess: (r) => {
      if (r.status === 'approved' && r.retired) {
        setResult(`Approved. ${s.contract?.title} is fully claimed and retired. ${r.replacement ? `${r.replacement} is now on the board.` : 'No replacement in the pool; the slot is awaiting a new contract.'}`);
      } else if (r.status === 'approved') setResult(`Approved (${r.claims} of ${r.limit} claims).`);
      else if (r.status === 'closed') setResult('The bounty was already full, so this claim was closed.');
      else setResult('Rejected.');
      setTimeout(() => qc.invalidateQueries(), 1500);
    },
  });

  const c = s.contract;
  return (
    <li className="rounded border border-ink/25 bg-parchment-50/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {c && <CategoryChip category={c.category} />}
        <Link to={`/contracts/${s.contract_id}`} className="font-sc text-lg font-bold">{c?.title}</Link>
        <span className="text-sm">{c?.reputation} rep</span>
        {c && <span className="text-sm text-ink-soft">{c.approved_count} of {c.claim_limit ?? 5} claimed</span>}
        <span className="ml-auto"><StatusChip status={s.status} /></span>
      </div>
      <p className="mt-1">
        <strong className="font-sc">{s.player?.rs_name ?? 'Unnamed'}</strong>
        <span className="text-sm text-ink-soft"> submitted {fmtDateTime(s.submitted_at)}</span>
      </p>
      {c?.evidence_instructions && <p className="mt-2 text-sm"><span className="font-sc font-bold">Needs:</span> {c.evidence_instructions}</p>}
      {codeword && s.status === 'pending' && <p className="text-sm"><span className="font-sc font-bold">Current codeword:</span> {codeword}</p>}
      {s.player_note && <p className="mt-2 italic">“{s.player_note}”</p>}

      {(urls.data?.length ?? 0) > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {urls.data!.map((u, i) => <EvidenceThumb key={i} url={u} label={`Evidence ${i + 1} from ${s.player?.rs_name ?? 'player'}`} onOpen={() => setViewing(i)} />)}
        </div>
      )}
      {viewing !== null && urls.data && (
        <Lightbox images={urls.data} start={viewing} onClose={() => setViewing(null)} caption={`${s.player?.rs_name ?? 'Player'}: ${c?.title ?? ''}`} />
      )}
      {urls.error && <p className="mt-2 text-sm text-wax-pvm">Couldn't load screenshots: {errorMessage(urls.error)}</p>}
      {s.evidence_links.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {s.evidence_links.map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer noopener" className="break-all">{l}</a></li>)}
        </ul>
      )}

      {s.status === 'pending' ? (
        result ? <div className="mt-3"><Notice tone="success">{result}</Notice></div> : own ? (
          <p className="mt-3 text-sm italic">This is your own claim; another admin needs to review it.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick rejection reasons">
                {REASONS.map((r) => (
                  <button key={r} type="button" onClick={() => setNote(r)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${note === r ? 'border-ink bg-ink text-parchment-50' : 'border-ink/30 hover:bg-ink/5'}`}>{r}</button>
                ))}
              </div>
              <label className="label text-sm" htmlFor={`note-${s.id}`}>Note to player (pick a reason above or write your own)</label>
              <input id={`note-${s.id}`} className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Codeword not visible in screenshot 2" />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" disabled={review.isPending} onClick={() => review.mutate(false)}>Reject</button>
              <button className="btn btn-wax" disabled={review.isPending} onClick={() => review.mutate(true)}>Approve</button>
            </div>
          </div>
        )
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-soft">Reviewed {fmtDateTime(s.reviewed_at)}{s.review_note ? `: ${s.review_note}` : ''}</p>
          {result && <div className="mt-2"><Notice tone="success">{result}</Notice></div>}
          {s.status === 'approved' && !result && (
            revoking ? (
              <form className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); revoke.mutate(); }}>
                <div className="flex-1">
                  <label className="label text-sm" htmlFor={`rv-${s.id}`}>Why are you revoking it? The player sees this.</label>
                  <input id={`rv-${s.id}`} className="field" required minLength={3} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder="e.g. Approved by mistake: wrong boss in the screenshot" />
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost" onClick={() => setRevoking(false)}>Cancel</button>
                  <button className="btn btn-wax" disabled={revoke.isPending}>Revoke approval</button>
                </div>
              </form>
            ) : (
              <button className="btn btn-sm btn-ghost mt-2" onClick={() => setRevoking(true)}>Revoke approval…</button>
            )
          )}
          {revoke.error && <div className="mt-2"><Notice tone="error">{errorMessage(revoke.error)}</Notice></div>}
        </>
      )}
      {review.error && <div className="mt-2"><Notice tone="error">{errorMessage(review.error)}</Notice></div>}
    </li>
  );
}

/** A screenshot thumbnail. If the browser can't show it as a picture, it says so instead of offering it. */
function EvidenceThumb({ url, label, onOpen }: { url: string; label: string; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="grid h-40 place-items-center rounded border-2 border-wax-pvm bg-wax-pvm/10 p-3 text-center text-sm font-bold text-[#6d1414]" role="alert">
        Not a real image. Don't download or open it; reject this claim.
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="block cursor-zoom-in overflow-hidden rounded border border-ink/30" aria-label={`View ${label} full size`}>
      <img src={url} alt={label} className="h-40 w-full bg-ink/10 object-cover" loading="lazy" onError={() => setBroken(true)} />
    </button>
  );
}

function NotifyToggle() {
  const [on, setOn] = useState(notificationsOn);
  const [msg, setMsg] = useState<string | null>(null);
  if (!('Notification' in window)) return null;
  return (
    <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <button className="btn btn-sm btn-ghost" onClick={async () => {
        const result = await setNotifications(!on);
        setOn(result);
        setMsg(!on && !result ? 'Your browser blocked notifications. Allow them for this site in the address bar, then try again.' : null);
      }}>
        {on ? 'Turn off pop-up alerts on this device' : 'Pop-up alert on this device when a claim comes in'}
      </button>
      <span className="text-ink-soft">{msg ?? (on ? 'On: you\'ll get a notification while the site is open in a tab.' : 'Works while the site is open in a tab. For alerts anywhere, set up the admin Discord channel under Event.')}</span>
    </p>
  );
}
