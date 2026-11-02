import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CategoryChip, Loading, Notice } from '../../components/ui';
import { errorMessage, must, supabase } from '../../lib/supabase';
import {
  CATEGORIES, CATEGORY_LABEL, DIFFICULTIES, DIFFICULTY_LABEL, DIFFICULTY_REP,
  type Category, type Contract, type ContractStatus, type Difficulty,
} from '../../lib/types';

const STATUS_LABEL: Record<ContractStatus, string> = {
  draft: 'Draft', pool: 'In pool', active: 'Live', retired: 'Retired', disabled: 'Disabled',
};

function useAllContracts() {
  return useQuery({
    queryKey: ['admin-contracts'],
    queryFn: async () => must(await supabase.from('contracts').select('*').order('category').order('pool_order').order('created_at')) as Contract[],
  });
}

export function ContractsList() {
  const q = useAllContracts();
  const qc = useQueryClient();
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [status, setStatus] = useState<ContractStatus | 'all'>('all');
  const [err, setErr] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Contract> }) => {
      const { error } = await supabase.from('contracts').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { setErr(null); qc.invalidateQueries(); },
    onError: (e) => setErr(errorMessage(e)),
  });

  const rows = (q.data ?? []).filter((c) => (cat === 'all' || c.category === cat) && (status === 'all' || c.status === status));
  const counts = (q.data ?? []).reduce<Record<string, number>>((a, c) => {
    if (c.status === 'pool') { const k = c.min_reputation > 0 ? 'wanted' : c.category; a[k] = (a[k] ?? 0) + 1; }
    return a;
  }, {});

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto font-display text-2xl text-ink">Contracts</h1>
        <Link to="/admin/contracts/new" className="btn btn-wax btn-sm">New contract</Link>
      </div>
      <p className="mb-3 text-ink-soft">
        Waiting in the pool: {CATEGORIES.map((c) => `${CATEGORY_LABEL[c]} ${counts[c] ?? 0}`).join(', ')}, Most Wanted {counts.wanted ?? 0}.
        The lowest pool number goes up next.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="field !w-auto" value={cat} onChange={(e) => setCat(e.target.value as Category | 'all')} aria-label="Category">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <select className="field !w-auto" value={status} onChange={(e) => setStatus(e.target.value as ContractStatus | 'all')} aria-label="Status">
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_LABEL) as ContractStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      {err && <div className="mb-3"><Notice tone="error">{err}</Notice></div>}
      {q.isLoading ? <Loading /> : (
        <div className="overflow-x-auto">
          <table className="table-ink min-w-[44rem]">
            <thead><tr><th>Contract</th><th>Difficulty</th><th>Status</th><th>Pool no.</th><th>Claims</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <CategoryChip category={c.category} /> <Link to={`/admin/contracts/${c.id}`} className="font-bold">{c.title}</Link>
                    {c.min_reputation > 0 && <span className="chip ml-1 bg-[#6d1414]/15 text-[#6d1414]">Most Wanted, {c.min_reputation}+</span>}
                  </td>
                  <td className="whitespace-nowrap">{DIFFICULTY_LABEL[c.difficulty]}, {c.reputation}</td>
                  <td>
                    {c.status === 'active' || c.status === 'retired' ? STATUS_LABEL[c.status] : (
                      <select className="field !w-auto !py-1 text-sm" value={c.status} aria-label={`Status of ${c.title}`}
                        onChange={(e) => update.mutate({ id: c.id, patch: { status: e.target.value as ContractStatus } })}>
                        <option value="draft">Draft</option>
                        <option value="pool">In pool</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {c.status === 'pool' ? (
                      <input type="number" className="field !w-24 !py-1" defaultValue={c.pool_order} aria-label={`Pool number for ${c.title}`}
                        onBlur={(e) => { const v = Number(e.target.value); if (v !== c.pool_order) update.mutate({ id: c.id, patch: { pool_order: v } }); }} />
                    ) : ''}
                  </td>
                  <td>{c.approved_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const EMPTY: Partial<Contract> = {
  title: '', category: 'pvm', difficulty: 'standard', reputation: 20, summary: '', description: '',
  requirements: '', restrictions: '', evidence_instructions: '', claim_limit: null, min_reputation: 0, pool_order: 1000, status: 'draft',
};

export function ContractEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ['admin-contract', id],
    enabled: !isNew,
    queryFn: async () => must(await supabase.from('contracts').select('*').eq('id', id!).single()) as Contract,
  });
  const [f, setF] = useState<Partial<Contract>>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (existing.data) setF(existing.data); }, [existing.data]);
  const set = <K extends keyof Contract>(k: K, v: Contract[K]) => { setSaved(false); setF((x) => ({ ...x, [k]: v })); };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: f.title?.trim(), category: f.category, difficulty: f.difficulty, reputation: Number(f.reputation),
        summary: f.summary?.trim() ?? '', description: f.description ?? '', requirements: f.requirements ?? '',
        restrictions: f.restrictions ?? '', evidence_instructions: f.evidence_instructions ?? '',
        claim_limit: f.claim_limit ? Number(f.claim_limit) : null, pool_order: Number(f.pool_order ?? 1000),
        min_reputation: Math.max(0, Number(f.min_reputation ?? 0)),
        ...(f.status === 'active' || f.status === 'retired' ? {} : { status: f.status }),
      };
      if (isNew) {
        const r = await supabase.from('contracts').insert(body).select('id').single();
        if (r.error) throw r.error;
        return r.data.id as string;
      }
      const { error } = await supabase.from('contracts').update(body).eq('id', id!);
      if (error) throw error;
      return id!;
    },
    onSuccess: (newId) => { qc.invalidateQueries(); setSaved(true); setErr(null); if (isNew) nav(`/admin/contracts/${newId}`, { replace: true }); },
    onError: (e) => setErr(errorMessage(e)),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('contracts').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries(); nav('/admin/contracts'); },
    onError: (e) => setErr(e && /foreign key/i.test(errorMessage(e)) ? 'This contract has claims, so it can only be disabled, not deleted.' : errorMessage(e)),
  });

  if (!isNew && existing.isLoading) return <Loading />;
  const locked = f.status === 'active' || f.status === 'retired';

  function onSubmit(e: FormEvent) { e.preventDefault(); save.mutate(); }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-4">
      <Link to="/admin/contracts" className="text-sm">All contracts</Link>
      <h1 className="font-display text-2xl text-ink">{isNew ? 'New contract' : f.title}</h1>
      {locked && <Notice>This contract is {f.status === 'active' ? 'live on the board' : 'retired'}. You can fix its wording; use the Board tab to take it down.</Notice>}

      <div>
        <label className="label" htmlFor="title">Title</label>
        <input id="title" className="field" required minLength={3} maxLength={80} value={f.title ?? ''} onChange={(e) => set('title', e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="cat">Category</label>
          <select id="cat" className="field" value={f.category} disabled={f.status === 'active'} onChange={(e) => set('category', e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="diff">Difficulty</label>
          <select id="diff" className="field" value={f.difficulty}
            onChange={(e) => { const d = e.target.value as Difficulty; set('difficulty', d); set('reputation', DIFFICULTY_REP[d]); }}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]} ({DIFFICULTY_REP[d]})</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rep">Reputation reward</label>
          <input id="rep" className="field" type="number" min={0} max={1000} required value={f.reputation ?? 0} onChange={(e) => set('reputation', Number(e.target.value))} />
          {f.status === 'active' && <p className="hint">Changes apply to future approvals only.</p>}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="summary">Poster text</label>
        <input id="summary" className="field" maxLength={200} required value={f.summary ?? ''} onChange={(e) => set('summary', e.target.value)} />
        <p className="hint">One line shown on the poster, e.g. “Kill the Kalphite King three times.”</p>
      </div>
      <div>
        <label className="label" htmlFor="desc">Flavour text</label>
        <textarea id="desc" className="field" rows={2} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="req">Requirements</label>
          <textarea id="req" className="field" rows={3} value={f.requirements ?? ''} onChange={(e) => set('requirements', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="res">Restrictions</label>
          <textarea id="res" className="field" rows={3} value={f.restrictions ?? ''} onChange={(e) => set('restrictions', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="ev">Evidence required</label>
        <textarea id="ev" className="field" rows={3} required value={f.evidence_instructions ?? ''} onChange={(e) => set('evidence_instructions', e.target.value)} />
      </div>
      <div className="rounded border border-ink/25 p-3">
        <label className="label" htmlFor="minrep">Most Wanted: reputation needed to claim</label>
        <input id="minrep" className="field !w-32" type="number" min={0} max={10000} value={f.min_reputation ?? 0}
          disabled={f.status === 'active'} onChange={(e) => set('min_reputation', Number(e.target.value))} />
        <p className="hint">
          0 puts it on the main board for everyone. Anything higher makes it a Most Wanted contract: it goes up in the
          Most Wanted slots, and only players with that much reputation can claim it.
          {f.status === 'active' && ' Take it off the board to change this.'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="limit">Completion slots</label>
          <input id="limit" className="field" type="number" min={1} max={50} placeholder="Event default" value={f.claim_limit ?? ''}
            onChange={(e) => set('claim_limit', e.target.value ? Number(e.target.value) : null)} />
          <p className="hint">Leave blank for the event default.</p>
        </div>
        <div>
          <label className="label" htmlFor="order">Pool number</label>
          <input id="order" className="field" type="number" value={f.pool_order ?? 1000} onChange={(e) => set('pool_order', Number(e.target.value))} />
          <p className="hint">Lowest goes up next.</p>
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          {locked ? <p className="py-2">{STATUS_LABEL[f.status!]}</p> : (
            <select id="status" className="field" value={f.status} onChange={(e) => set('status', e.target.value as ContractStatus)}>
              <option value="draft">Draft (hidden)</option>
              <option value="pool">In pool (goes up when a slot opens)</option>
              <option value="disabled">Disabled</option>
            </select>
          )}
        </div>
      </div>

      {err && <Notice tone="error">{err}</Notice>}
      {saved && <Notice tone="success">Saved.</Notice>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-wax" disabled={save.isPending}>{isNew ? 'Create contract' : 'Save changes'}</button>
        {!isNew && !locked && (
          <button type="button" className="btn btn-ghost" onClick={() => window.confirm('Delete this contract permanently?') && del.mutate()}>Delete</button>
        )}
      </div>
    </form>
  );
}
