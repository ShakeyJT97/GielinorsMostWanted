import type { ReactNode } from 'react';
import type { Category, SubmissionStatus } from '../lib/types';
import { CATEGORY_LABEL } from '../lib/types';

export function Sheet({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`sheet p-5 sm:p-8 ${className}`}>{children}</section>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-3xl leading-tight text-ink sm:text-4xl">{children}</h1>
      {sub && <p className="mt-1 text-ink-soft">{sub}</p>}
    </header>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const cls = {
    info: 'border-ink/30 bg-parchment-50/70',
    error: 'border-wax-pvm/60 bg-wax-pvm/10 text-[#6d1414]',
    success: 'border-wax-skilling/60 bg-wax-skilling/10 text-[#244018]',
  }[tone];
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded border-l-4 px-4 py-3 ${cls}`}>{children}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="py-10 text-center italic opacity-80" role="status">{label}</p>;
}

export function CategoryChip({ category }: { category: Category }) {
  return <span className={`chip chip-${category}`}>{CATEGORY_LABEL[category]}</span>;
}

const STATUS_STYLE: Record<SubmissionStatus, string> = {
  pending: 'bg-brass/25 text-[#5a4210]',
  approved: 'bg-wax-skilling/20 text-[#244018]',
  rejected: 'bg-wax-pvm/15 text-[#6d1414]',
  closed: 'bg-ink/10 text-ink-soft',
  withdrawn: 'bg-ink/10 text-ink-soft',
};
const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', closed: 'Bounty filled', withdrawn: 'Withdrawn',
};

export function StatusChip({ status }: { status: SubmissionStatus }) {
  return <span className={`chip ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}
