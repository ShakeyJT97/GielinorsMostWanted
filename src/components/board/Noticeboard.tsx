import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { BoardSlot } from '../../lib/types';
import { Poster } from './Poster';

const STAMP_MS = 2900;

/**
 * Lays out the posters and plays the BOUNTY CLAIMED stamp when a slot's
 * contract is retired and replaced while the page is open.
 */
export function Noticeboard({ slots, myReputation = null, emptyText, eventPaused = false, opensAt }: { slots: BoardSlot[]; myReputation?: number | null; emptyText?: string; eventPaused?: boolean; opensAt?: string }) {
  const prev = useRef<Map<number, BoardSlot> | null>(null);
  const [leaving, setLeaving] = useState<Record<number, BoardSlot>>({});
  const [entering, setEntering] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const before = prev.current;
    prev.current = new Map(slots.map((s) => [s.slot_id, s]));
    if (!before) return;

    for (const s of slots) {
      const old = before.get(s.slot_id);
      if (!old?.contract_id || old.contract_id === s.contract_id) continue;
      const slotId = s.slot_id;
      supabase.from('contracts').select('status, approved_count').eq('id', old.contract_id).maybeSingle()
        .then(({ data }) => {
          if (data?.status !== 'retired') {
            setEntering((e) => ({ ...e, [slotId]: true }));
            return;
          }
          const finalClaims = Math.max(data.approved_count ?? 0, old.approved_count ?? 0);
          const claimants = [...old.claimants];
          while (claimants.length < finalClaims) claimants.push('The final hunter');
          setLeaving((l) => ({ ...l, [slotId]: { ...old, approved_count: finalClaims, claimants } }));
          window.setTimeout(() => {
            setLeaving((l) => { const n = { ...l }; delete n[slotId]; return n; });
            setEntering((e) => ({ ...e, [slotId]: true }));
          }, STAMP_MS);
        });
    }
  }, [slots]);

  if (slots.length === 0) {
    return <p className="py-16 text-center text-parchment-100">{emptyText ?? 'The board is empty. An admin needs to set up the event.'}</p>;
  }

  return (
    <ul className="grid grid-cols-1 gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {slots.map((s) => (
        <li key={s.slot_id} className="flex flex-col [&>*]:flex-1"
          data-doodle-contract={!leaving[s.slot_id] && s.contract_id && !s.sealed ? s.contract_id : undefined}>
          {leaving[s.slot_id]
            ? <Poster slot={leaving[s.slot_id]} stamped myReputation={myReputation} />
            : <Poster key={s.contract_id ?? `empty-${s.slot_id}`} slot={s} entering={entering[s.slot_id]} myReputation={myReputation}
                eventPaused={eventPaused} opensAt={opensAt} />}
        </li>
      ))}
    </ul>
  );
}
