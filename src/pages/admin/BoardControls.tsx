import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CategoryChip, Loading, Notice } from '../../components/ui';
import { useBoard } from '../../lib/queries';
import { errorMessage, must, supabase } from '../../lib/supabase';
import { CATEGORY_LABEL, type BoardSlot, type Contract } from '../../lib/types';
import { shoutRefresh, useSnapshots } from '../../lib/doodles';
import { fmtDateTime } from '../../lib/format';

export default function BoardControls() {
  const board = useBoard();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const pool = useQuery({
    queryKey: ['pool'],
    queryFn: async () => must(await supabase.from('contracts').select('id, title, category, pool_order, min_reputation')
      .eq('status', 'pool').order('pool_order')) as Pick<Contract, 'id' | 'title' | 'category' | 'pool_order' | 'min_reputation'>[],
  });

  const act = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown; data?: unknown }>) => {
      const { error, data } = await fn();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const d = data as { old?: string | null; new?: string | null } | null;
      setMsg({ tone: 'success', text: d && 'new' in d ? `Done. ${d.new ? `${d.new} is now live.` : 'No pool contract was available; the slot is awaiting one.'}` : 'Done.' });
      qc.invalidateQueries();
    },
    onError: (e) => setMsg({ tone: 'error', text: errorMessage(e) }),
  });

  const rotate = (slot: number, mode: 'retire' | 'return' | 'fill', replacement?: string) =>
    act.mutate(() => supabase.rpc('rotate_slot', { p_slot: slot, p_mode: mode, p_replacement: replacement ?? null }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto font-display text-2xl text-ink">Board slots</h1>
        <button className="btn btn-sm btn-ghost" onClick={() => act.mutate(() => supabase.rpc('sync_board_slots'))}>Fill empty slots</button>
      </div>
      <p className="mb-4 text-ink-soft">
        Retire sends a contract to the archive. Return puts it back at the end of the pool, keeping its approved claims.
        Pending claims close either way. Most Wanted slots take contracts that have a reputation requirement.
      </p>
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {board.isLoading ? <Loading /> : (
        <div className="overflow-x-auto">
          <table className="table-ink min-w-[46rem]">
            <thead><tr><th>Slot</th><th>Contract</th><th>Claims</th><th>State</th><th>Actions</th></tr></thead>
            <tbody>
              {[...(board.data ?? [])].sort(slotOrder).map((s) => (
                <SlotRow key={s.slot_id} s={s} busy={act.isPending}
                  pool={(pool.data ?? []).filter((p) => s.tier === 'wanted' ? p.min_reputation > 0 : p.category === s.category && p.min_reputation === 0)}
                  onRotate={rotate} onPause={(p) => act.mutate(() => supabase.rpc('set_slot_paused', { p_slot: s.slot_id, p_paused: p }))} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DoodleArchive />
    </div>
  );
}

function DoodleArchive() {
  const snaps = useSnapshots();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('archive_board', { p_name: name });
      if (error) throw error;
    },
    onSuccess: () => {
      setMsg({ tone: 'success', text: 'Saved to the gallery and the board is wiped clean.' });
      setName('');
      shoutRefresh();
      qc.invalidateQueries({ queryKey: ['board-snapshots'] });
    },
    onError: (e) => setMsg({ tone: 'error', text: errorMessage(e) }),
  });
  return (
    <section className="mt-10 border-t-2 border-double border-ink/25 pt-6">
      <h2 className="font-display text-2xl text-ink">Doodles</h2>
      <p className="mb-3 max-w-2xl text-ink-soft">
        Archiving saves the board's doodles to the <Link to="/gallery">gallery</Link> under a name, then wipes the board clean.
        Doodles on posters stay with their posters. To remove a single line, use the Eraser while drawing on the board;
        to remove everything one player drew, use Admin → Players.
      </p>
      <form className="flex max-w-xl flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (window.confirm('Save the doodles to the gallery and wipe the board clean?')) archive.mutate();
      }}>
        <input className="field flex-1" maxLength={60} placeholder="Name, e.g. End of week one" value={name}
          onChange={(e) => setName(e.target.value)} aria-label="Name for this saved board" />
        <button className="btn btn-ink" disabled={archive.isPending}>Archive the board</button>
      </form>
      {msg && <div className="mt-3 max-w-xl"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {(snaps.data ?? []).length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {snaps.data!.map((s) => <li key={s.id}><strong>{s.name}</strong> · {fmtDateTime(s.taken_at)} · {s.strokes} lines</li>)}
        </ul>
      )}
    </section>
  );
}

const slotOrder = (a: BoardSlot, b: BoardSlot) =>
  (a.tier === b.tier ? 0 : a.tier === 'main' ? -1 : 1)
  || (a.tier === 'main' ? (a.category ?? '').localeCompare(b.category ?? '') : 0)
  || a.slot_position - b.slot_position;

function SlotRow({ s, pool, busy, onRotate, onPause }: {
  s: BoardSlot;
  pool: { id: string; title: string }[];
  busy: boolean;
  onRotate: (slot: number, mode: 'retire' | 'return' | 'fill', replacement?: string) => void;
  onPause: (paused: boolean) => void;
}) {
  const [pick, setPick] = useState('');
  const confirmAnd = (text: string, fn: () => void) => { if (window.confirm(text)) fn(); };
  return (
    <tr>
      <td className="whitespace-nowrap">
        {s.tier === 'wanted'
          ? <span className="chip bg-[#6d1414]/15 text-[#6d1414]">Most Wanted</span>
          : s.category && <CategoryChip category={s.category} />} {s.slot_position}
      </td>
      <td>
        {s.contract_id
          ? <><Link to={`/admin/contracts/${s.contract_id}`}>{s.title}</Link>{s.tier === 'wanted' && <span className="text-sm text-ink-soft"> ({s.min_reputation}+ rep)</span>}</>
          : <em>Awaiting a {s.tier === 'wanted' ? 'Most Wanted' : CATEGORY_LABEL[s.category!]} contract</em>}
      </td>
      <td>{s.contract_id ? `${s.approved_count} / ${s.claim_limit}` : ''}</td>
      <td className="capitalize">{s.slot_state}</td>
      <td>
        <div className="flex flex-wrap items-center gap-1.5">
          {s.contract_id && <>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => confirmAnd(`Retire “${s.title}” to the archive and rotate in the next contract?`, () => onRotate(s.slot_id, 'retire', pick || undefined))}>Retire</button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => confirmAnd(`Return “${s.title}” to the pool and rotate in the next contract?`, () => onRotate(s.slot_id, 'return', pick || undefined))}>Return</button>
          </>}
          {!s.contract_id && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onRotate(s.slot_id, 'fill', pick || undefined)}>Fill</button>}
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onPause(s.slot_state !== 'paused')}>{s.slot_state === 'paused' ? 'Resume' : 'Pause'}</button>
          <select className="field !w-auto !py-1 text-sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Replacement">
            <option value="">Next in pool</option>
            {pool.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      </td>
    </tr>
  );
}
