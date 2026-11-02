-- Gielinor's Most Wanted — game rules
-- Every rule that matters runs here, inside one transaction per call.
-- Lock order everywhere: contract row first, then board slot, then replacement contract.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and not is_banned
  );
$$;

create or replace function public._require_admin()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function public._internal_on()
returns void language sql as $$
  select set_config('gmw.internal', 'on', true);
$$;

create or replace function public._log(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'));
$$;

create or replace function public._claim_limit(p_contract public.contracts)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p_contract.claim_limit, (select default_claim_limit from public.event_settings));
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- New auth user -> profile row
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Default reward from difficulty; guard lifecycle columns against direct edits
create or replace function public.contracts_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_internal boolean := coalesce(current_setting('gmw.internal', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.reputation is null then
      new.reputation := case new.difficulty when 'standard' then 20 when 'hard' then 30 else 40 end;
    end if;
    if not v_internal and (new.status in ('active', 'retired') or new.approved_count <> 0) then
      raise exception 'New contracts must start as draft, pool or disabled';
    end if;
    return new;
  end if;

  if not v_internal then
    if new.status is distinct from old.status
       and (old.status in ('active', 'retired') or new.status in ('active', 'retired')) then
      raise exception 'Use the board controls to put contracts live or retire them';
    end if;
    if new.approved_count <> old.approved_count
       or new.activated_at is distinct from old.activated_at
       or new.retired_at is distinct from old.retired_at then
      raise exception 'Claim counts and lifecycle dates are managed by the game';
    end if;
    if old.status = 'active' and new.category <> old.category then
      raise exception 'Cannot change the category of a live contract';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger contracts_guard
  before insert or update on public.contracts
  for each row execute function public.contracts_guard();

-- Audit admin edits to contracts
create or replace function public.contracts_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('gmw.internal', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public._log('contract.created', 'contract', new.id::text,
      jsonb_build_object('title', new.title, 'status', new.status));
  elsif tg_op = 'UPDATE' then
    perform public._log('contract.updated', 'contract', new.id::text,
      jsonb_build_object('title', new.title, 'status_from', old.status, 'status_to', new.status));
  elsif tg_op = 'DELETE' then
    perform public._log('contract.deleted', 'contract', old.id::text, jsonb_build_object('title', old.title));
  end if;
  return null;
end $$;

create trigger contracts_audit
  after insert or update or delete on public.contracts
  for each row execute function public.contracts_audit();

-- ---------------------------------------------------------------------------
-- Board internals (not callable from the website)
-- ---------------------------------------------------------------------------

-- Take a contract off the board. Closes its pending claims; empties its slot.
create or replace function public._deactivate_contract(p_contract uuid, p_new_status public.contract_status, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_slot int;
begin
  perform public._internal_on();
  update public.contracts c
     set status = p_new_status,
         retired_at = case when p_new_status = 'retired' then now() else null end,
         -- a contract sent back to the pool goes to the back of its queue
         pool_order = case when p_new_status = 'pool'
                           then (select coalesce(max(x.pool_order), 0) + 10 from public.contracts x
                                  where x.category = c.category and x.status = 'pool')
                           else c.pool_order end
   where c.id = p_contract;

  update public.submissions
     set status = 'closed', reviewed_at = now(), review_note = p_reason
   where contract_id = p_contract and status = 'pending';

  update public.board_slots
     set contract_id = null, state = 'awaiting', updated_at = now()
   where contract_id = p_contract
  returning id into v_slot;
  return v_slot;
end $$;

-- Put a contract into an empty slot: the chosen one, or the next in the pool.
create or replace function public._fill_slot(p_slot int, p_contract uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_slot public.board_slots;
  v_new  uuid;
begin
  perform public._internal_on();
  select * into v_slot from public.board_slots where id = p_slot for update;
  if not found then raise exception 'Slot % not found', p_slot; end if;
  if v_slot.contract_id is not null then raise exception 'Slot % is already occupied', p_slot; end if;

  if p_contract is not null then
    select id into v_new from public.contracts
     where id = p_contract and status = 'pool' and category = v_slot.category
     for update;
    if v_new is null then
      raise exception 'That contract is not in the % pool', v_slot.category;
    end if;
  else
    select id into v_new from public.contracts
     where status = 'pool' and category = v_slot.category and min_reputation = 0
     order by pool_order, created_at
     for update skip locked
     limit 1;
  end if;

  if v_new is null then
    update public.board_slots set state = 'awaiting', updated_at = now() where id = p_slot;
    return null;
  end if;

  update public.contracts set status = 'active', activated_at = now() where id = v_new;
  update public.board_slots
     set contract_id = v_new,
         state = case when v_slot.state = 'paused' then 'paused'::public.slot_state else 'active' end,
         updated_at = now()
   where id = p_slot;
  return v_new;
end $$;

-- Make the slot rows match the configured counts, then fill empty slots.
create or replace function public._sync_board_slots()
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.event_settings;
  r record;
  v_cat public.contract_category;
  v_want int;
begin
  select * into s from public.event_settings;
  foreach v_cat in array enum_range(null::public.contract_category) loop
    v_want := case v_cat when 'pvm' then s.slots_pvm when 'skilling' then s.slots_skilling else s.slots_special end;

    insert into public.board_slots (category, position)
    select v_cat, g from generate_series(1, v_want) g
    on conflict (category, position) do nothing;

    for r in select id, contract_id from public.board_slots where category = v_cat and position > v_want loop
      if r.contract_id is not null then
        perform public._deactivate_contract(r.contract_id, 'pool', 'Board slot removed by an admin');
      end if;
      delete from public.board_slots where id = r.id;
    end loop;
  end loop;

  for r in select id from public.board_slots where contract_id is null order by category, position loop
    perform public._fill_slot(r.id, null);
  end loop;
end $$;

-- A contract newly added to the pool fills an awaiting slot of its category
create or replace function public.contracts_fill_awaiting()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_slot int;
begin
  if new.status = 'pool' and new.min_reputation = 0
     and (tg_op = 'INSERT' or old.status in ('draft', 'disabled')) then
    select id into v_slot from public.board_slots
     where category = new.category and contract_id is null
     order by position limit 1;
    if v_slot is not null then
      perform public._fill_slot(v_slot, null);
    end if;
  end if;
  return null;
end $$;

create trigger contracts_fill_awaiting
  after insert or update of status on public.contracts
  for each row execute function public.contracts_fill_awaiting();

-- Slot counts changed -> resync; audit settings changes
create or replace function public.settings_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.slots_pvm, new.slots_skilling, new.slots_special)
     is distinct from (old.slots_pvm, old.slots_skilling, old.slots_special) then
    perform public._sync_board_slots();
  end if;
  perform public._log('event.settings_updated', 'event_settings', null,
    jsonb_strip_nulls(jsonb_build_object(
      'starts_at', case when new.starts_at <> old.starts_at then new.starts_at end,
      'ends_at',   case when new.ends_at <> old.ends_at then new.ends_at end,
      'is_paused', case when new.is_paused <> old.is_paused then new.is_paused end,
      'slots', case when (new.slots_pvm, new.slots_skilling, new.slots_special)
                      is distinct from (old.slots_pvm, old.slots_skilling, old.slots_special)
                    then jsonb_build_array(new.slots_pvm, new.slots_skilling, new.slots_special) end,
      'default_claim_limit', case when new.default_claim_limit <> old.default_claim_limit then new.default_claim_limit end,
      'codeword_changed', case when new.codeword <> old.codeword then true end)));
  return null;
end $$;

create or replace function public.settings_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger settings_touch before update on public.event_settings
  for each row execute function public.settings_touch();
create trigger settings_changed after update on public.event_settings
  for each row execute function public.settings_changed();

-- ---------------------------------------------------------------------------
-- Player actions
-- ---------------------------------------------------------------------------
create or replace function public.set_display_name(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if v_name !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,11}$' then
    raise exception 'Display names are 1–12 letters, numbers, spaces, hyphens or underscores';
  end if;
  begin
    update public.profiles set rs_name = v_name where id = auth.uid();
  exception when unique_violation then
    raise exception 'That display name is already registered';
  end;
end $$;

create or replace function public.submit_claim(
  p_submission_id uuid,
  p_contract_id   uuid,
  p_links         text[],
  p_files         text[],
  p_note          text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
  s         public.event_settings;
  c         public.contracts;
  v_state   public.slot_state;
  v_links   text[] := coalesce(p_links, '{}');
  v_files   text[] := coalesce(p_files, '{}');
  v_item    text;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.rs_name is null then raise exception 'Set your RuneScape display name first'; end if;
  if v_profile.is_banned then raise exception 'Your account cannot submit claims'; end if;

  select * into s from public.event_settings;
  if now() < s.starts_at then raise exception 'The event has not started yet'; end if;
  if now() > s.ends_at then raise exception 'The event has ended'; end if;
  if s.is_paused then raise exception 'The event is paused'; end if;

  select * into c from public.contracts where id = p_contract_id;
  if not found or c.status <> 'active' then raise exception 'This contract is not on the board'; end if;
  select state into v_state from public.board_slots where contract_id = c.id;
  if v_state = 'paused' then raise exception 'This contract is paused'; end if;
  if c.approved_count >= public._claim_limit(c) then raise exception 'This bounty has already been claimed'; end if;

  if cardinality(v_links) + cardinality(v_files) = 0 then raise exception 'Add at least one screenshot or link'; end if;
  if cardinality(v_links) > 3 or cardinality(v_files) > 3 then raise exception 'Up to 3 links and 3 screenshots'; end if;
  foreach v_item in array v_links loop
    if v_item !~* '^https://[^\s]+$' or char_length(v_item) > 500 then
      raise exception 'Evidence links must start with https://';
    end if;
  end loop;
  foreach v_item in array v_files loop
    if v_item not like v_uid::text || '/' || p_submission_id::text || '/%' then
      raise exception 'Invalid evidence file';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'evidence' and name = v_item) then
      raise exception 'Evidence upload not found — please try again';
    end if;
  end loop;

  begin
    insert into public.submissions (id, contract_id, player_id, evidence_links, evidence_files, player_note)
    values (p_submission_id, c.id, v_uid, v_links, v_files, left(coalesce(p_note, ''), 1000));
  exception when unique_violation then
    raise exception 'You already have a pending or approved claim on this contract';
  end;
  return p_submission_id;
end $$;

create or replace function public.withdraw_claim(p_submission_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.submissions set status = 'withdrawn', reviewed_at = now()
   where id = p_submission_id and player_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Only your own pending claims can be withdrawn'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------
create or replace function public.review_submission(p_submission_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin     uuid := public._require_admin();
  v_contract  uuid;
  c           public.contracts;
  sub         public.submissions;
  v_limit     int;
  v_count     int;
  v_slot      int;
  v_new       uuid;
  v_new_title text;
  s           public.event_settings;
begin
  select contract_id into v_contract from public.submissions where id = p_submission_id;
  if v_contract is null then raise exception 'Submission not found'; end if;

  -- 1. Lock the contract: approvals on the same contract run one at a time
  select * into c from public.contracts where id = v_contract for update;
  -- 2. Re-check the submission under the lock
  select * into sub from public.submissions where id = p_submission_id for update;
  if sub.status <> 'pending' then
    raise exception 'This claim is no longer pending (it is %)', sub.status;
  end if;
  if sub.player_id = v_admin then raise exception 'You cannot review your own claim'; end if;

  if not p_approve then
    update public.submissions
       set status = 'rejected', reviewed_by = v_admin, reviewed_at = now(), review_note = nullif(btrim(p_note), '')
     where id = sub.id;
    perform public._log('submission.rejected', 'submission', sub.id::text,
      jsonb_build_object('contract', c.title, 'player_id', sub.player_id, 'note', p_note));
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into s from public.event_settings;
  if now() > s.ends_at + make_interval(hours => s.review_grace_hours) then
    raise exception 'The review window for this event has closed';
  end if;
  if c.status <> 'active' then raise exception 'This contract is no longer on the board'; end if;

  -- 3. Count approved claims under the lock
  v_limit := public._claim_limit(c);
  select count(*) into v_count from public.submissions where contract_id = c.id and status = 'approved';
  if v_count >= v_limit then
    update public.submissions
       set status = 'closed', reviewed_by = v_admin, reviewed_at = now(), review_note = 'Bounty already claimed'
     where id = sub.id;
    return jsonb_build_object('status', 'closed');
  end if;

  -- 4. Approve and award (unique index rejects any duplicate award)
  perform public._internal_on();
  update public.submissions
     set status = 'approved', reviewed_by = v_admin, reviewed_at = now(), review_note = nullif(btrim(p_note), '')
   where id = sub.id;
  insert into public.reputation_events (player_id, amount, source, category, contract_id, submission_id, created_by)
  values (sub.player_id, c.reputation, 'claim', c.category, c.id, sub.id, v_admin);

  v_count := v_count + 1;
  update public.contracts set approved_count = v_count where id = c.id;
  perform public._log('submission.approved', 'submission', sub.id::text,
    jsonb_build_object('contract', c.title, 'player_id', sub.player_id, 'reputation', c.reputation, 'claims', v_count));

  -- 5. Final slot: retire and rotate in the same transaction
  if v_count >= v_limit then
    v_slot := public._deactivate_contract(c.id, 'retired', 'Bounty already claimed');
    perform public._log('contract.retired', 'contract', c.id::text, jsonb_build_object('title', c.title, 'slot', v_slot));
    if v_slot is not null then
      v_new := public._fill_slot(v_slot, null);
      select title into v_new_title from public.contracts where id = v_new;
      perform public._log(case when v_new is null then 'slot.awaiting' else 'slot.rotated' end,
        'board_slot', v_slot::text, jsonb_build_object('new_contract', v_new_title));
    end if;
    return jsonb_build_object('status', 'approved', 'retired', true, 'replacement', v_new_title);
  end if;

  return jsonb_build_object('status', 'approved', 'retired', false, 'claims', v_count, 'limit', v_limit);
end $$;

-- p_mode: 'retire' (archive the live contract), 'return' (send it back to the pool), 'fill' (slot is empty)
create or replace function public.rotate_slot(p_slot int, p_mode text, p_replacement uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public._require_admin();
  v_cur   uuid;
  v_check uuid;
  v_title text;
  v_new   uuid;
  v_new_title text;
begin
  if p_mode not in ('retire', 'return', 'fill') then raise exception 'Unknown rotation mode'; end if;
  select contract_id into v_cur from public.board_slots where id = p_slot;
  if not found then raise exception 'Slot not found'; end if;

  if v_cur is not null then
    if p_mode = 'fill' then raise exception 'That slot already has a contract'; end if;
    select title into v_title from public.contracts where id = v_cur for update;      -- contract first
    select contract_id into v_check from public.board_slots where id = p_slot for update;
    if v_check is distinct from v_cur then raise exception 'The board just changed — refresh and try again'; end if;
    perform public._deactivate_contract(v_cur,
      case when p_mode = 'retire' then 'retired' else 'pool' end::public.contract_status,
      case when p_mode = 'retire' then 'Contract retired by an admin' else 'Contract taken down by an admin' end);
  end if;

  v_new := public._fill_slot(p_slot, p_replacement);
  select title into v_new_title from public.contracts where id = v_new;
  perform public._log('slot.manual_rotate', 'board_slot', p_slot::text,
    jsonb_build_object('mode', p_mode, 'old_contract', v_title, 'new_contract', v_new_title));
  return jsonb_build_object('old', v_title, 'new', v_new_title);
end $$;

create or replace function public.set_slot_paused(p_slot int, p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public._require_admin();
begin
  update public.board_slots
     set state = case when p_paused then 'paused'::public.slot_state
                      when contract_id is null then 'awaiting'::public.slot_state
                      else 'active'::public.slot_state end,
         updated_at = now()
   where id = p_slot;
  if not found then raise exception 'Slot not found'; end if;
  perform public._log(case when p_paused then 'slot.paused' else 'slot.resumed' end, 'board_slot', p_slot::text);
end $$;

create or replace function public.sync_board_slots()
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public._require_admin();
begin
  perform public._sync_board_slots();
  perform public._log('board.synced', 'board', null);
end $$;

create or replace function public.adjust_reputation(p_player uuid, p_amount int, p_reason text, p_source public.rep_source default 'adjustment')
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public._require_admin();
begin
  if p_source = 'claim' then raise exception 'Claim awards come only from approvals'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for the adjustment'; end if;
  insert into public.reputation_events (player_id, amount, source, reason, created_by)
  values (p_player, p_amount, p_source, btrim(p_reason), v_admin);
  perform public._log('reputation.' || p_source::text, 'profile', p_player::text,
    jsonb_build_object('amount', p_amount, 'reason', p_reason));
end $$;

create or replace function public.set_player_role(p_player uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public._require_admin();
begin
  if p_player = v_admin and p_role <> 'admin' then raise exception 'You cannot remove your own admin role'; end if;
  update public.profiles set role = p_role where id = p_player;
  perform public._log('player.role_set', 'profile', p_player::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.set_player_banned(p_player uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public._require_admin();
begin
  if p_player = v_admin then raise exception 'You cannot ban yourself'; end if;
  update public.profiles set is_banned = p_banned where id = p_player;
  perform public._log(case when p_banned then 'player.banned' else 'player.unbanned' end, 'profile', p_player::text);
end $$;

-- ---------------------------------------------------------------------------
-- Read functions (public aggregates without exposing private rows)
-- ---------------------------------------------------------------------------
create or replace function public.get_board()
returns table (
  slot_id int, category public.contract_category, slot_position int, slot_state public.slot_state,
  contract_id uuid, title text, summary text, difficulty public.contract_difficulty,
  reputation int, claim_limit int, approved_count int, activated_at timestamptz,
  claimants text[], my_status public.submission_status
) language sql stable security definer set search_path = public as $$
  select bs.id, bs.category, bs.position, bs.state,
         c.id, c.title, c.summary, c.difficulty, c.reputation,
         case when c.id is null then null else public._claim_limit(c) end,
         c.approved_count, c.activated_at,
         coalesce((select array_agg(p.rs_name::text order by s.reviewed_at)
                     from public.submissions s join public.profiles p on p.id = s.player_id
                    where s.contract_id = c.id and s.status = 'approved'), '{}'),
         (select s.status from public.submissions s
           where s.contract_id = c.id and s.player_id = auth.uid()
           order by s.submitted_at desc limit 1)
    from public.board_slots bs
    left join public.contracts c on c.id = bs.contract_id
   order by bs.position, bs.category;
$$;

create or replace function public.get_leaderboard(p_category public.contract_category default null)
returns table (
  place bigint, player_id uuid, rs_name text, reputation bigint, claims bigint, rank_name text
) language sql stable security definer set search_path = public as $$
  with totals as (
    select e.player_id,
           sum(e.amount) filter (where p_category is null or e.category = p_category)  as rep,
           count(*) filter (where e.source = 'claim' and (p_category is null or e.category = p_category)) as claims,
           max(e.created_at) filter (where p_category is null or e.category = p_category) as last_at,
           sum(e.amount) as overall
      from public.reputation_events e
     group by e.player_id
  )
  select rank() over (order by t.rep desc, t.last_at asc),
         t.player_id, p.rs_name::text, t.rep, t.claims,
         (select r.name from public.ranks r where r.min_reputation <= greatest(t.overall, 0)
           order by r.min_reputation desc limit 1)
    from totals t
    join public.profiles p on p.id = t.player_id
   where t.rep is not null and t.rep <> 0 and not p.is_banned
   order by 1, p.rs_name;
$$;

create or replace function public.get_player_summary(p_player uuid default null)
returns table (
  player_id uuid, rs_name text, reputation bigint, claims bigint,
  rank_name text, next_rank_name text, next_rank_at int
) language sql stable security definer set search_path = public as $$
  with me as (select coalesce(p_player, auth.uid()) as id),
  tot as (
    select coalesce(sum(amount), 0) as rep,
           count(*) filter (where source = 'claim') as claims
      from public.reputation_events where player_id = (select id from me)
  )
  select p.id, p.rs_name::text, tot.rep, tot.claims,
         (select name from public.ranks where min_reputation <= greatest(tot.rep, 0) order by min_reputation desc limit 1),
         (select name from public.ranks where min_reputation > tot.rep order by min_reputation limit 1),
         (select min_reputation from public.ranks where min_reputation > tot.rep order by min_reputation limit 1)
    from public.profiles p, tot
   where p.id = (select id from me);
$$;

create or replace function public.get_archive()
returns table (
  contract_id uuid, title text, category public.contract_category, difficulty public.contract_difficulty,
  reputation int, summary text, activated_at timestamptz, retired_at timestamptz, claimants text[]
) language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.category, c.difficulty, c.reputation, c.summary, c.activated_at, c.retired_at,
         coalesce((select array_agg(p.rs_name::text order by s.reviewed_at)
                     from public.submissions s join public.profiles p on p.id = s.player_id
                    where s.contract_id = c.id and s.status = 'approved'), '{}')
    from public.contracts c
   where c.status = 'retired'
   order by c.retired_at desc;
$$;

-- Live updates for the board
do $$ begin
  alter publication supabase_realtime add table public.board_slots, public.contracts;
exception when undefined_object or duplicate_object then null;
end $$;
