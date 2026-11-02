import { Fragment, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CategoryChip, Loading, Notice, Sheet, StatusChip } from '../components/ui';
import { DifficultyMarks, WaxSeal } from '../components/board/Emblem';
import { useAuth } from '../lib/auth';
import { useBoard, useContract, useEventPhase, useMySubmissions, usePlayerSummary, useSettings } from '../lib/queries';
import { fmtDateTime as fmtWhen } from '../lib/format';
import { HunterLink } from './HunterPage';
import { errorMessage, supabase } from '../lib/supabase';
import { EvidenceInputs, uploadEvidence, useEvidence } from '../components/EvidenceInputs';
import { fmtDateTime } from '../lib/format';
import { DIFFICULTY_LABEL } from '../lib/types';


export default function ContractPage() {
  const { id } = useParams();
  const contractQ = useContract(id);
  const board = useBoard().data;
  const { session } = useAuth();
  const mySubs = useMySubmissions(session?.user.id).data?.filter((s) => s.contract_id === id) ?? [];
  const settings = useSettings().data;
  const myRep = Number(usePlayerSummary(session?.user.id).data?.reputation ?? 0);
  const { phase } = useEventPhase();

  if (contractQ.isLoading) return <Sheet><Loading /></Sheet>;
  const c = contractQ.data;
  if (!c && phase === 'before' && settings) {
    return (
      <Sheet className="mx-auto max-w-2xl">
        <h1 className="font-display text-2xl">Still sealed</h1>
        <p className="mt-2">The bounties are revealed when the hunt begins, {fmtWhen(settings.starts_at)}. <Link to="/">Back to the board</Link></p>
      </Sheet>
    );
  }
  if (!c) {
    return (
      <Sheet className="mx-auto max-w-2xl">
        <h1 className="font-display text-2xl">Bounty not found</h1>
        <p className="mt-2">It may have been taken down. <Link to="/">Back to the board</Link></p>
      </Sheet>
    );
  }

  const slot = board?.find((s) => s.contract_id === c.id);
  const limit = slot?.claim_limit ?? c.claim_limit ?? settings?.default_claim_limit ?? 5;
  const claimants = slot?.claimants ?? [];
  const live = c.status === 'active';
  const open = mySubs.find((s) => s.status === 'pending' || s.status === 'approved');

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_22rem]">
      <Sheet>
        <Link to="/" className="text-sm">Back to the board</Link>
        <div className="mt-4 flex items-start gap-4">
          <WaxSeal category={c.category} size={64} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryChip category={c.category} />
              <span className="flex items-center gap-1 text-sm"><DifficultyMarks difficulty={c.difficulty} /> {DIFFICULTY_LABEL[c.difficulty]}</span>
            </div>
            <h1 className="mt-1 font-display text-3xl leading-tight text-ink">{c.title}</h1>
            <p className="font-sc text-lg font-bold">{c.reputation} Reputation</p>
          </div>
        </div>

        {c.description && <p className="mt-5 text-lg italic">{c.description}</p>}

        <dl className="mt-6 space-y-4">
          {c.min_reputation > 0 && (
            <Detail term="Most Wanted">Only hunters with {c.min_reputation} reputation or more can claim this bounty.</Detail>
          )}
          <Detail term="The task">{c.summary}</Detail>
          {c.requirements && <Detail term="You will need">{c.requirements}</Detail>}
          {c.restrictions && <Detail term="Rules">{c.restrictions}</Detail>}
          <Detail term="Evidence">{c.evidence_instructions || 'Screenshots showing the task completed, with the codeword typed in clan chat.'}</Detail>
        </dl>

        <div className="mt-6 border-t-2 border-double border-ink/30 pt-4">
          <h2 className="font-sc text-lg font-bold">
            {live ? `${limit - claimants.length} of ${limit} claims left` : c.status === 'retired' ? 'Bounty claimed' : 'Not on the board'}
          </h2>
          {claimants.length > 0 && (
            <p className="mt-1">Claimed by {claimants.map((n, i) => <Fragment key={n}>{i > 0 && ', '}<HunterLink name={n} /></Fragment>)}.</p>
          )}
          {c.status === 'retired' && c.retired_at && <p className="mt-1 text-ink-soft">Retired {fmtDateTime(c.retired_at)}.</p>}
        </div>
      </Sheet>

      <aside className="space-y-6">
        <Sheet className="!p-5">
          {!session ? (
            <>
              <h2 className="font-sc text-lg font-bold">Claim this bounty</h2>
              <p className="mt-1">Join or sign in to submit your evidence. All you need is your RuneScape name.</p>
              <Link to="/login" className="btn btn-wax mt-3 w-full">Join or sign in</Link>
            </>
          ) : open ? (
            <>
              <h2 className="font-sc text-lg font-bold">Your claim</h2>
              <ClaimRow sub={open} />
            </>
          ) : live && phase === 'before' && settings ? (
            <>
              <h2 className="font-sc text-lg font-bold">Not open yet</h2>
              <p className="mt-1">Claims open {fmtWhen(settings.starts_at)}. Get it done in game after that, then come back with your screenshots.</p>
            </>
          ) : live && phase === 'ended' ? (
            <>
              <h2 className="font-sc text-lg font-bold">The hunt is over</h2>
              <p className="mt-1">Claims closed when the event ended. <Link to="/results">See the results</Link>.</p>
            </>
          ) : live && phase === 'paused' ? (
            <>
              <h2 className="font-sc text-lg font-bold">Event paused</h2>
              <p className="mt-1">The admins have paused new claims for now. Keep your screenshots; you can submit when it resumes.</p>
            </>
          ) : live && c.min_reputation > myRep ? (
            <>
              <h2 className="font-sc text-lg font-bold">Not unlocked yet</h2>
              <p className="mt-1">This Most Wanted bounty needs {c.min_reputation} reputation. You have {myRep}; claim main-board bounties to get there.</p>
            </>
          ) : live && slot?.slot_state !== 'paused' ? (
            <ClaimForm contractId={c.id} codeword={settings?.codeword} />
          ) : (
            <p>This bounty isn't taking claims right now.</p>
          )}
        </Sheet>

        {mySubs.filter((s) => s !== open).length > 0 && (
          <Sheet className="!p-5">
            <h2 className="font-sc text-lg font-bold">Earlier claims</h2>
            <ul className="mt-2 space-y-3">
              {mySubs.filter((s) => s !== open).map((s) => <li key={s.id}><ClaimRow sub={s} /></li>)}
            </ul>
          </Sheet>
        )}
      </aside>
    </div>
  );
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-sc font-bold">{term}</dt>
      <dd className="mt-0.5 whitespace-pre-line">{children}</dd>
    </div>
  );
}

function ClaimRow({ sub }: { sub: { id: string; status: import('../lib/types').SubmissionStatus; submitted_at: string; review_note: string | null } }) {
  const qc = useQueryClient();
  const withdraw = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('withdraw_claim', { p_submission_id: sub.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <div className="mt-1">
      <div className="flex items-center gap-2"><StatusChip status={sub.status} /><span className="text-sm text-ink-soft">{fmtDateTime(sub.submitted_at)}</span></div>
      {sub.review_note && <p className="mt-1 text-sm">Admin note: {sub.review_note}</p>}
      {sub.status === 'pending' && (
        <button className="btn btn-ghost btn-sm mt-2" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>Withdraw claim</button>
      )}
      {withdraw.error && <p className="mt-1 text-sm text-wax-pvm">{errorMessage(withdraw.error)}</p>}
    </div>
  );
}

function ClaimForm({ contractId, codeword }: { contractId: string; codeword?: string }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const ev = useEvidence();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      const uid = session!.user.id;
      const submissionId = crypto.randomUUID();
      const paths = await uploadEvidence(uid, submissionId, ev.files);
      const { error } = await supabase.rpc('submit_claim', {
        p_submission_id: submissionId,
        p_contract_id: contractId,
        p_links: ev.cleanLinks(),
        p_files: paths,
        p_note: note.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { setDone(true); qc.invalidateQueries(); },
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = ev.validate();
    if (problem) { setError(problem); return; }
    submit.mutate();
  }

  if (done) return <Notice tone="success">Claim submitted. An admin will review it soon; check its status under My bounties.</Notice>;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="font-sc text-lg font-bold">Claim this bounty</h2>
      {codeword && (
        <p className="rounded border border-dashed border-ink/40 px-3 py-2">
          Type the codeword <strong className="font-sc text-lg">{codeword}</strong> in <strong>clan chat</strong> before
          each screenshot, so your name shows next to it.
        </p>
      )}
      <EvidenceInputs ev={ev}
        filesHint="Up to 3 images. Large screenshots are shrunk automatically. Only you and the admins can see them."
        linksHint="Imgur, YouTube, RuneMetrics or similar." />
      <div>
        <label className="label" htmlFor="note">Note for the admins (optional)</label>
        <textarea id="note" className="field" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn btn-wax w-full" disabled={submit.isPending || ev.shrinking}>{submit.isPending ? 'Submitting…' : 'Submit claim'}</button>
      <p className="text-sm text-ink-soft">Rather post in Discord? Share your screenshots there and tag an event admin; they can add the claim for you.</p>
    </form>
  );
}
