import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '../components/ui';
import { DifficultyMarks } from '../components/board/Emblem';
import { useAuth } from '../lib/auth';
import { useRanks, useSettings } from '../lib/queries';
import { fmtDateTime } from '../lib/format';
import { DIFFICULTIES, DIFFICULTY_LABEL, DIFFICULTY_REP } from '../lib/types';

export default function HowItWorksPage() {
  const settings = useSettings().data;
  const ranks = useRanks().data ?? [];
  const { session } = useAuth();
  const limit = settings?.default_claim_limit ?? 5;

  return (
    <Sheet className="mx-auto max-w-3xl">
      <h1 className="font-display text-4xl leading-tight text-ink">How the hunt works</h1>
      {settings && (
        <p className="mt-2 text-lg">
          {settings.event_name} runs from <strong>{fmtDateTime(settings.starts_at)}</strong> to <strong>{fmtDateTime(settings.ends_at)}</strong> (your local time).
          Complete bounties in game, prove it with a screenshot, and earn reputation.
        </p>
      )}

      <Section title="The board">
        <p>
          The board holds a mix of PvM, Skilling and Special bounties. Each bounty can be claimed by {limit} different hunters.
          When the {ordinal(limit)} claim is approved, the bounty is stamped <em>claimed</em>, comes down, and a new one goes up
          in its place. Claimed bounties are kept in the <Link to="/archive">archive</Link>.
        </p>
        <p>You can claim each bounty once. Use your own account, gear and supplies unless the bounty says otherwise.</p>
      </Section>

      <Section title="Claiming a bounty">
        <ol className="list-decimal space-y-2 pl-6">
          <li>Open a bounty and read what it asks for and what evidence it needs.</li>
          <li>
            Do it in game. Before each screenshot, type the event codeword in <strong>clan chat</strong>, so your name shows next to it.
            {session && settings?.codeword
              ? <> The current codeword is <strong className="font-sc">{settings.codeword}</strong>.</>
              : <> The current codeword is shown when you sign in.</>}
          </li>
          <li>Upload your screenshots (or links) on the bounty's page and submit.</li>
          <li>An admin checks it. You'll see the result, and any note from the admin, under <strong>My bounties</strong>; a red badge appears there when something's been reviewed.</li>
        </ol>
        <p>
          Prefer Discord? Post your screenshots there and tag an event admin. They can add the claim to the site for you, and
          it counts exactly the same.
        </p>
      </Section>

      <Section title="Who gets the last slot?">
        <p>
          <strong>Submitting doesn't reserve a slot. Approval does.</strong> Admins review claims oldest first, so the earliest valid
          claim usually wins, but if a submission is missing the codeword or the right evidence it'll be rejected and the next one
          gets the slot. When a bounty fills up, any claims still waiting on it close with no reputation.
        </p>
        <p>If your claim was rejected, you can fix the problem and submit again while the bounty is still up.</p>
      </Section>

      <Section title="Reputation">
        <p>Each bounty is worth reputation based on how hard it is:</p>
        <ul className="space-y-1">
          {DIFFICULTIES.map((d) => (
            <li key={d} className="flex items-center gap-2">
              <DifficultyMarks difficulty={d} />
              <span className="font-sc font-bold">{DIFFICULTY_LABEL[d]}</span>
              <span>{DIFFICULTY_REP[d]} reputation</span>
            </li>
          ))}
        </ul>
        <p>Some bounties may be set higher or lower; the poster always shows the real reward. Admins can also award bonuses.</p>
        {ranks.length > 0 && (
          <>
            <p>Your reputation earns you a title:</p>
            <table className="table-ink max-w-md">
              <thead><tr><th>Title</th><th>Reputation</th></tr></thead>
              <tbody>{ranks.map((r) => <tr key={r.id}><td className="font-sc font-bold">{r.name}</td><td>{r.min_reputation}+</td></tr>)}</tbody>
            </table>
          </>
        )}
        <p>Check where you stand on the <Link to="/leaderboard">leaderboard</Link>: overall, and for PvM, Skilling and Special.</p>
      </Section>

      <Section title="Most Wanted">
        <p>
          Below the main board are the Most Wanted bounties: tougher jobs for proven hunters. Anyone can see them, but you need a
          certain amount of reputation (shown on each poster) before you can claim one. Bonus reputation counts.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You sign in with your RuneScape name and a passphrase the site makes for you. No email, Discord or RuneScape password is
          ever asked for, and nobody from the event will ask for your RuneScape password. Your screenshots are only visible to
          you and the admins.
        </p>
        <p>Lost your passphrase? Ask an event admin for a new one. You can also get a new one yourself any time under My bounties.</p>
      </Section>

      {!session && (
        <p className="mt-8"><Link to="/login" className="btn btn-wax">Join the hunt</Link></p>
      )}
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 space-y-3">
      <h2 className="font-display text-2xl text-ink">{title}</h2>
      {children}
    </section>
  );
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
