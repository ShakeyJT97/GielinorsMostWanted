import { Link } from 'react-router-dom';
import { CategoryChip, Loading, PageTitle, Sheet } from '../components/ui';
import { useArchive } from '../lib/queries';
import { fmtDateTime } from '../lib/format';
import { DIFFICULTY_LABEL } from '../lib/types';
import { HunterLink } from './HunterPage';
import { Fragment } from 'react';

export default function ArchivePage() {
  const arc = useArchive();
  return (
    <Sheet className="mx-auto max-w-4xl">
      <PageTitle sub="Every bounty taken off the board, with the hunters who claimed it.">Claimed bounties</PageTitle>
      {arc.isLoading ? <Loading /> : (arc.data ?? []).length === 0 ? (
        <p>Nothing claimed yet. When five hunters finish a bounty, it's filed here.</p>
      ) : (
        <ul className="space-y-4">
          {arc.data!.map((a) => (
            <li key={a.contract_id} className="border-b border-ink/15 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <CategoryChip category={a.category} />
                <span className="text-sm">{DIFFICULTY_LABEL[a.difficulty]} · {a.reputation} rep</span>
                <span className="ml-auto text-sm text-ink-soft">Retired {fmtDateTime(a.retired_at)}</span>
              </div>
              <h2 className="mt-1 font-sc text-xl font-bold"><Link to={`/contracts/${a.contract_id}`}>{a.title}</Link></h2>
              <p className="text-ink-soft">{a.summary}</p>
              <p className="mt-1">
                {a.claimants.length ? <>Claimed by {a.claimants.map((n, i) => (
                  <Fragment key={n}>{i > 0 && ', '}<HunterLink name={n} /></Fragment>
                ))}</> : 'Retired by an admin before anyone claimed it'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
