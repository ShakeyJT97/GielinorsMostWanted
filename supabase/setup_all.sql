-- Gielinor's Most Wanted: complete setup for a NEW project. Paste into the Supabase SQL Editor and run once.
-- Upgrading an existing project? See the README: run only the migration files you haven't run yet.

-- Gielinor's Most Wanted — schema
-- Run order: 0001_schema.sql, 0002_functions.sql, 0003_security.sql, then seed.sql

create extension if not exists citext;

create type public.contract_category   as enum ('pvm', 'skilling', 'special');
create type public.contract_difficulty as enum ('standard', 'hard', 'elite');
create type public.contract_status     as enum ('draft', 'pool', 'active', 'retired', 'disabled');
create type public.slot_state          as enum ('active', 'awaiting', 'paused');
create type public.submission_status   as enum ('pending', 'approved', 'rejected', 'closed', 'withdrawn');
create type public.user_role           as enum ('player', 'admin');
create type public.rep_source          as enum ('claim', 'bonus', 'adjustment');

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  rs_name     citext unique
              check (rs_name ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,11}$'),
  role        public.user_role not null default 'player',
  is_banned   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Event configuration (exactly one row)
-- ---------------------------------------------------------------------------
create table public.event_settings (
  id                   boolean primary key default true check (id),
  event_name           text not null default 'Gielinor''s Most Wanted',
  clan_name            text not null default 'UwU Girls',
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  review_grace_hours   int  not null default 48 check (review_grace_hours between 0 and 336),
  is_paused            boolean not null default false,
  slots_pvm            int  not null default 5 check (slots_pvm between 0 and 20),
  slots_skilling       int  not null default 5 check (slots_skilling between 0 and 20),
  slots_special        int  not null default 2 check (slots_special between 0 and 20),
  default_claim_limit  int  not null default 5 check (default_claim_limit between 1 and 50),
  codeword             text not null default 'bounty' check (char_length(codeword) between 1 and 40),
  updated_at           timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.ranks (
  id              serial primary key,
  name            text not null unique,
  min_reputation  int  not null unique check (min_reputation >= 0)
);

-- ---------------------------------------------------------------------------
-- Contracts
-- ---------------------------------------------------------------------------
create table public.contracts (
  id                     uuid primary key default gen_random_uuid(),
  title                  text not null check (char_length(title) between 3 and 80),
  category               public.contract_category not null,
  difficulty             public.contract_difficulty not null,
  reputation             int  not null check (reputation between 0 and 1000),
  summary                text not null default '' check (char_length(summary) <= 200),
  description            text not null default '',
  requirements           text not null default '',
  restrictions           text not null default '',
  evidence_instructions  text not null default '',
  claim_limit            int  check (claim_limit between 1 and 50),   -- null = event default
  min_reputation         int  not null default 0 check (min_reputation >= 0),
  pool_order             int  not null default 1000,
  status                 public.contract_status not null default 'draft',
  approved_count         int  not null default 0,                     -- display cache, maintained by functions
  activated_at           timestamptz,
  retired_at             timestamptz,
  created_by             uuid references public.profiles (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index contracts_pool_idx on public.contracts (category, pool_order, created_at) where status = 'pool';

-- ---------------------------------------------------------------------------
-- Board slots: fixed positions that each hold at most one live contract
-- ---------------------------------------------------------------------------
create table public.board_slots (
  id           serial primary key,
  category     public.contract_category not null,
  position     int  not null check (position >= 1),
  contract_id  uuid unique references public.contracts (id),   -- unique = no duplicate live contracts
  state        public.slot_state not null default 'awaiting',
  updated_at   timestamptz not null default now(),
  unique (category, position)
);

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------
create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references public.contracts (id),
  player_id       uuid not null references public.profiles (id),
  evidence_links  text[] not null default '{}',
  evidence_files  text[] not null default '{}',
  player_note     text not null default '' check (char_length(player_note) <= 1000),
  status          public.submission_status not null default 'pending',
  submitted_at    timestamptz not null default now(),
  reviewed_by     uuid references public.profiles (id),
  reviewed_at     timestamptz,
  review_note     text,
  check (cardinality(evidence_links) <= 3 and cardinality(evidence_files) <= 3),
  check (cardinality(evidence_links) + cardinality(evidence_files) >= 1)
);
-- One open-or-approved claim per player per contract
create unique index submissions_one_live_claim
  on public.submissions (contract_id, player_id)
  where status in ('pending', 'approved');
create index submissions_queue_idx  on public.submissions (status, submitted_at);
create index submissions_player_idx on public.submissions (player_id, submitted_at desc);

-- ---------------------------------------------------------------------------
-- Reputation ledger: totals are always summed from here
-- ---------------------------------------------------------------------------
create table public.reputation_events (
  id             bigserial primary key,
  player_id      uuid not null references public.profiles (id),
  amount         int  not null check (amount between -1000 and 1000 and amount <> 0),
  source         public.rep_source not null,
  category       public.contract_category,          -- null for bonuses/adjustments
  contract_id    uuid references public.contracts (id),
  submission_id  uuid unique references public.submissions (id),
  reason         text,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  check ((source = 'claim') = (contract_id is not null and submission_id is not null)),
  check (source = 'claim' or char_length(coalesce(reason, '')) >= 3)
);
-- A contract can never pay the same player twice
create unique index reputation_one_award_per_contract
  on public.reputation_events (player_id, contract_id)
  where source = 'claim';
create index reputation_player_idx on public.reputation_events (player_id);

-- ---------------------------------------------------------------------------
-- Audit log (insert-only)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigserial primary key,
  actor_id    uuid references public.profiles (id),
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
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
-- Gielinor's Most Wanted — row-level security, grants and evidence storage

alter table public.profiles          enable row level security;
alter table public.event_settings    enable row level security;
alter table public.ranks             enable row level security;
alter table public.contracts         enable row level security;
alter table public.board_slots       enable row level security;
alter table public.submissions       enable row level security;
alter table public.reputation_events enable row level security;
alter table public.audit_log         enable row level security;

-- Profiles: public names; players change their name only via set_display_name()
create policy profiles_read on public.profiles for select to anon, authenticated using (true);

-- Settings and ranks: everyone reads, admins edit
create policy settings_read  on public.event_settings for select to anon, authenticated using (true);
create policy settings_admin on public.event_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy ranks_read  on public.ranks for select to anon, authenticated using (true);
create policy ranks_admin on public.ranks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Contracts: live and retired are public; the pool, drafts and disabled are admin-only
create policy contracts_read on public.contracts for select to anon, authenticated
  using (status in ('active', 'retired') or public.is_admin());
create policy contracts_admin_insert on public.contracts for insert to authenticated
  with check (public.is_admin());
create policy contracts_admin_update on public.contracts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy contracts_admin_delete on public.contracts for delete to authenticated
  using (public.is_admin() and status in ('draft', 'pool', 'disabled'));

-- Board slots: public read; writes only through game functions
create policy slots_read on public.board_slots for select to anon, authenticated using (true);

-- Submissions and reputation: own rows or admin; writes only through game functions
create policy submissions_read on public.submissions for select to authenticated
  using (player_id = auth.uid() or public.is_admin());
create policy reputation_read on public.reputation_events for select to authenticated
  using (player_id = auth.uid() or public.is_admin());

-- Audit log: admins only
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());

-- Table privileges (RLS still applies on top)
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.event_settings, public.ranks, public.contracts,
                public.board_slots to anon, authenticated;
grant select on public.submissions, public.reputation_events, public.audit_log to authenticated;
grant update on public.event_settings to authenticated;
grant insert, update, delete on public.ranks to authenticated;
grant insert, update, delete on public.contracts to authenticated;
grant usage on all sequences in schema public to authenticated;

-- Function privileges: internals are never callable from the website
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(),
  public.get_board(),
  public.get_leaderboard(public.contract_category),
  public.get_player_summary(uuid),
  public.get_archive()
to anon, authenticated;

grant execute on function
  public.set_display_name(text),
  public.submit_claim(uuid, uuid, text[], text[], text),
  public.withdraw_claim(uuid),
  public.review_submission(uuid, boolean, text),
  public.rotate_slot(int, text, uuid),
  public.set_slot_paused(int, boolean),
  public.sync_board_slots(),
  public.adjust_reputation(uuid, int, text, public.rep_source),
  public.set_player_role(uuid, public.user_role),
  public.set_player_banned(uuid, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- Private evidence bucket: evidence/{player_id}/{submission_id}/{file}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy evidence_upload_own on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);

create policy evidence_read_own_or_admin on storage.objects for select to authenticated
  using (bucket_id = 'evidence'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
-- Gielinor's Most Wanted — public profiles, the Most Wanted tier, Discord posts
-- Safe to run on an existing install after 0001–0003.

-- ===========================================================================
-- 1. Public hunter profiles
-- ===========================================================================
create or replace function public.get_hunter(p_name text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'player_id', p.id,
    'rs_name', p.rs_name,
    'joined', p.created_at,
    'summary', (select to_jsonb(s) from public.get_player_summary(p.id) s),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
               'contract_id', c.id, 'title', c.title, 'category', c.category,
               'difficulty', c.difficulty, 'reputation', e.amount, 'claimed_at', e.created_at)
             order by e.created_at desc)
        from public.reputation_events e
        join public.contracts c on c.id = e.contract_id
       where e.player_id = p.id and e.source = 'claim'), '[]'::jsonb),
    'bonus_total', (select coalesce(sum(amount), 0) from public.reputation_events
                     where player_id = p.id and source <> 'claim')
  )
  from public.profiles p
  where p.rs_name = p_name::citext and not p.is_banned;
$$;

-- ===========================================================================
-- 2. Most Wanted tier: extra slots for contracts that need reputation to claim
-- ===========================================================================
do $$ begin
  create type public.slot_tier as enum ('main', 'wanted');
exception when duplicate_object then null; end $$;

alter table public.event_settings add column if not exists slots_wanted int not null default 2
  check (slots_wanted between 0 and 10);

alter table public.board_slots add column if not exists tier public.slot_tier not null default 'main';
alter table public.board_slots alter column category drop not null;
alter table public.board_slots drop constraint if exists board_slots_category_position_key;
alter table public.board_slots drop constraint if exists board_slots_tier_category_check;
alter table public.board_slots add constraint board_slots_tier_category_check
  check ((tier = 'main') = (category is not null));
create unique index if not exists board_slots_main_position_key
  on public.board_slots (category, position) where tier = 'main';
create unique index if not exists board_slots_wanted_position_key
  on public.board_slots (position) where tier = 'wanted';

-- Lifecycle guard: also stop a live contract switching between main board and Most Wanted
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
    if old.status = 'active' and (old.min_reputation = 0) <> (new.min_reputation = 0) then
      raise exception 'Take the contract off the board before moving it between the main board and Most Wanted';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Fill: main slots take main-board contracts of their category; Most Wanted slots take any
-- contract with a reputation requirement.
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
     where id = p_contract and status = 'pool'
       and ((v_slot.tier = 'main' and category = v_slot.category and min_reputation = 0)
         or (v_slot.tier = 'wanted' and min_reputation > 0))
     for update;
    if v_new is null then
      if v_slot.tier = 'main' then
        raise exception 'That contract is not in the % pool', v_slot.category;
      else
        raise exception 'That contract is not in the Most Wanted pool';
      end if;
    end if;
  else
    select id into v_new from public.contracts
     where status = 'pool'
       and ((v_slot.tier = 'main' and category = v_slot.category and min_reputation = 0)
         or (v_slot.tier = 'wanted' and min_reputation > 0))
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
    insert into public.board_slots (tier, category, position)
    select 'main', v_cat, g from generate_series(1, v_want) g
     where not exists (select 1 from public.board_slots b where b.tier = 'main' and b.category = v_cat and b.position = g);
    for r in select id, contract_id from public.board_slots where tier = 'main' and category = v_cat and position > v_want loop
      if r.contract_id is not null then
        perform public._deactivate_contract(r.contract_id, 'pool', 'Board slot removed by an admin');
      end if;
      delete from public.board_slots where id = r.id;
    end loop;
  end loop;

  insert into public.board_slots (tier, category, position)
  select 'wanted', null, g from generate_series(1, s.slots_wanted) g
   where not exists (select 1 from public.board_slots b where b.tier = 'wanted' and b.position = g);
  for r in select id, contract_id from public.board_slots where tier = 'wanted' and position > s.slots_wanted loop
    if r.contract_id is not null then
      perform public._deactivate_contract(r.contract_id, 'pool', 'Board slot removed by an admin');
    end if;
    delete from public.board_slots where id = r.id;
  end loop;

  for r in select id from public.board_slots where contract_id is null order by tier, category, position loop
    perform public._fill_slot(r.id, null);
  end loop;
end $$;

create or replace function public.contracts_fill_awaiting()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_slot int;
begin
  if new.status = 'pool' and (tg_op = 'INSERT' or old.status in ('draft', 'disabled')) then
    select id into v_slot from public.board_slots
     where contract_id is null
       and ((new.min_reputation = 0 and tier = 'main' and category = new.category)
         or (new.min_reputation > 0 and tier = 'wanted'))
     order by position limit 1;
    if v_slot is not null then
      perform public._fill_slot(v_slot, null);
    end if;
  end if;
  return null;
end $$;

create or replace function public.settings_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.slots_pvm, new.slots_skilling, new.slots_special, new.slots_wanted)
     is distinct from (old.slots_pvm, old.slots_skilling, old.slots_special, old.slots_wanted) then
    perform public._sync_board_slots();
  end if;
  perform public._log('event.settings_updated', 'event_settings', null,
    jsonb_strip_nulls(jsonb_build_object(
      'starts_at', case when new.starts_at <> old.starts_at then new.starts_at end,
      'ends_at',   case when new.ends_at <> old.ends_at then new.ends_at end,
      'is_paused', case when new.is_paused <> old.is_paused then new.is_paused end,
      'slots', case when (new.slots_pvm, new.slots_skilling, new.slots_special, new.slots_wanted)
                      is distinct from (old.slots_pvm, old.slots_skilling, old.slots_special, old.slots_wanted)
                    then jsonb_build_array(new.slots_pvm, new.slots_skilling, new.slots_special, new.slots_wanted) end,
      'default_claim_limit', case when new.default_claim_limit <> old.default_claim_limit then new.default_claim_limit end,
      'codeword_changed', case when new.codeword <> old.codeword then true end)));
  return null;
end $$;

-- Claims: same checks as before, plus the reputation requirement
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
  v_rep     bigint;
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

  if c.min_reputation > 0 then
    select coalesce(sum(amount), 0) into v_rep from public.reputation_events where player_id = v_uid;
    if v_rep < c.min_reputation then
      raise exception 'This Most Wanted bounty needs % reputation; you have %', c.min_reputation, v_rep;
    end if;
  end if;

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

-- Board read: adds tier and reputation requirement (return type changes, so drop first)
drop function if exists public.get_board();
create function public.get_board()
returns table (
  slot_id int, tier public.slot_tier, category public.contract_category, slot_position int, slot_state public.slot_state,
  contract_id uuid, title text, summary text, difficulty public.contract_difficulty,
  reputation int, claim_limit int, approved_count int, min_reputation int, activated_at timestamptz,
  claimants text[], my_status public.submission_status
) language sql stable security definer set search_path = public as $$
  select bs.id, bs.tier, coalesce(c.category, bs.category), bs.position, bs.state,
         c.id, c.title, c.summary, c.difficulty, c.reputation,
         case when c.id is null then null else public._claim_limit(c) end,
         c.approved_count, c.min_reputation, c.activated_at,
         coalesce((select array_agg(p.rs_name::text order by s.reviewed_at)
                     from public.submissions s join public.profiles p on p.id = s.player_id
                    where s.contract_id = c.id and s.status = 'approved'), '{}'),
         (select s.status from public.submissions s
           where s.contract_id = c.id and s.player_id = auth.uid()
           order by s.submitted_at desc limit 1)
    from public.board_slots bs
    left join public.contracts c on c.id = bs.contract_id
   order by bs.tier, bs.position, bs.category;
$$;

-- ===========================================================================
-- 3. Discord channel posts (via Supabase's pg_net extension)
-- ===========================================================================
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net is not available here; Discord posts are disabled';
end $$;

create table if not exists public.integration_settings (
  id                   boolean primary key default true check (id),
  discord_webhook_url  text check (discord_webhook_url is null
                                   or discord_webhook_url ~ '^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/'),
  notify_approvals     boolean not null default true,
  notify_retirements   boolean not null default true,
  notify_new_bounties  boolean not null default true,
  site_url             text,
  updated_at           timestamptz not null default now()
);
insert into public.integration_settings (id) values (true) on conflict do nothing;

alter table public.integration_settings enable row level security;
drop policy if exists integrations_admin_read on public.integration_settings;
drop policy if exists integrations_admin_update on public.integration_settings;
create policy integrations_admin_read on public.integration_settings for select to authenticated using (public.is_admin());
create policy integrations_admin_update on public.integration_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.integration_settings from anon, authenticated;
grant select, update on public.integration_settings to authenticated;

-- Send one message. Never raises: a Discord problem must not block an approval.
create or replace function public._discord_post(p_content text)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  select discord_webhook_url into v_url from public.integration_settings;
  if v_url is null or p_content is null then return; end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('content', left(p_content, 1900), 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then
    raise warning 'Discord post failed: %', sqlerrm;
  end;
end $$;

create or replace function public.audit_to_discord()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  i      public.integration_settings;
  v_name text;
  v_link text;
  v_msg  text;
begin
  select * into i from public.integration_settings;
  if i.discord_webhook_url is null then return null; end if;
  v_link := case when i.site_url is not null then ' <' || rtrim(i.site_url, '/') || '>' else '' end;

  if new.action = 'submission.approved' and i.notify_approvals then
    select rs_name into v_name from public.profiles where id = (new.details ->> 'player_id')::uuid;
    v_msg := format(':crossed_swords: **%s** claimed **%s** for %s reputation (claim %s).',
                    coalesce(v_name, 'A hunter'), new.details ->> 'contract', new.details ->> 'reputation',
                    new.details ->> 'claims');
  elsif new.action = 'contract.retired' and i.notify_retirements then
    v_msg := format(':scroll: **BOUNTY CLAIMED:** %s is off the board.', new.details ->> 'title');
  elsif new.action in ('slot.rotated', 'slot.manual_rotate') and i.notify_new_bounties
        and new.details ->> 'new_contract' is not null then
    v_msg := format(':pushpin: **New bounty posted:** %s%s', new.details ->> 'new_contract', v_link);
  end if;

  if v_msg is not null then
    perform public._discord_post(v_msg);
  end if;
  return null;
end $$;

drop trigger if exists audit_to_discord on public.audit_log;
create trigger audit_to_discord after insert on public.audit_log
  for each row execute function public.audit_to_discord();

create or replace function public.send_discord_test()
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public._require_admin();
begin
  if (select discord_webhook_url from public.integration_settings) is null then
    raise exception 'Save a Discord webhook address first';
  end if;
  perform public._discord_post(':wave: Test message from Gielinor''s Most Wanted. Bounty updates will appear here.');
end $$;

-- ===========================================================================
-- Privileges for the new and replaced functions
-- ===========================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_admin(),
  public.get_board(),
  public.get_leaderboard(public.contract_category),
  public.get_player_summary(uuid),
  public.get_archive(),
  public.get_hunter(text)
to anon, authenticated;
grant execute on function
  public.set_display_name(text),
  public.submit_claim(uuid, uuid, text[], text[], text),
  public.withdraw_claim(uuid),
  public.review_submission(uuid, boolean, text),
  public.rotate_slot(int, text, uuid),
  public.set_slot_paused(int, boolean),
  public.sync_board_slots(),
  public.adjust_reputation(uuid, int, text, public.rep_source),
  public.set_player_role(uuid, public.user_role),
  public.set_player_banned(uuid, boolean),
  public.send_discord_test()
to authenticated;

-- Create the Most Wanted slots on an existing install
select public._sync_board_slots();
-- Gielinor's Most Wanted — sign in with RuneScape name + passphrase
-- Safe to run on an existing install after 0001–0004.
--
-- How it works: Supabase Auth still does the real work (password hashing, sessions, rate limits),
-- but each player's "email" is a random placeholder like 3f9a1c0b7d2e4a68@players.gmw.invalid.
-- Nobody ever types or sees it: the site looks it up from the RuneScape name at sign-in.
-- `.invalid` is reserved and can never receive mail. In Supabase, "Confirm email" must be OFF.

create extension if not exists pgcrypto with schema extensions;

-- Optional join code (admin-only table, so players can't read it)
alter table public.integration_settings add column if not exists join_code text
  check (join_code is null or char_length(join_code) between 3 and 40);

-- ---------------------------------------------------------------------------
-- Sign-up checks (shared by the friendly pre-check and the enforcing trigger)
-- Returns null when fine, otherwise a message for the player.
-- ---------------------------------------------------------------------------
create or replace function public._clean_rs_name(p_name text)
returns text language sql immutable as $$
  select btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
$$;

create or replace function public._check_new_hunter(p_name text, p_code text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_name text := public._clean_rs_name(p_name);
  v_code text;
begin
  if v_name !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,11}$' then
    return 'RuneScape names are 1–12 letters, numbers, spaces, hyphens or underscores.';
  end if;
  if exists (select 1 from public.profiles where rs_name = v_name::citext) then
    return 'That RuneScape name is already registered. If it''s yours, ask an event admin.';
  end if;
  select join_code into v_code from public.integration_settings;
  if v_code is not null and lower(btrim(coalesce(p_code, ''))) <> lower(btrim(v_code)) then
    return 'That join code isn''t right. Ask in clan chat for the current code.';
  end if;
  return null;
end $$;

create or replace function public.check_signup(p_name text, p_code text default null)
returns text language sql stable security definer set search_path = public as $$
  select public._check_new_hunter(p_name, p_code);
$$;

create or replace function public.signup_needs_code()
returns boolean language sql stable security definer set search_path = public as $$
  select join_code is not null from public.integration_settings;
$$;

-- Sign-in: RuneScape name -> placeholder login address. Never returns a real email.
create or replace function public.login_email_for(p_name text)
returns text language sql stable security definer set search_path = public as $$
  select u.email::text
    from auth.users u
    join public.profiles p on p.id = u.id
   where p.rs_name = public._clean_rs_name(p_name)::citext
     and u.email like '%@players.gmw.invalid';
$$;

-- ---------------------------------------------------------------------------
-- Triggers on new auth users
-- ---------------------------------------------------------------------------
-- Before insert: enforce the checks for email/password sign-ups and drop the join code
-- from stored metadata. A failure here rejects the sign-up.
create or replace function public.auth_user_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') = 'email' then
    v_err := public._check_new_hunter(new.raw_user_meta_data ->> 'rs_name', new.raw_user_meta_data ->> 'join_code');
    if v_err is not null then
      raise exception '%', v_err;
    end if;
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'join_code';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_before_insert on auth.users;
create trigger on_auth_user_before_insert
  before insert on auth.users
  for each row execute function public.auth_user_before_insert();

-- After insert: create the profile, with the RuneScape name when one was given
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text := nullif(public._clean_rs_name(new.raw_user_meta_data ->> 'rs_name'), '');
begin
  insert into public.profiles (id, rs_name) values (new.id, v_name) on conflict do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Admin: reset a player's passphrase (the admin's browser generates it)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_passphrase(p_player uuid, p_passphrase text)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public._require_admin();
begin
  if char_length(coalesce(p_passphrase, '')) < 16 then
    raise exception 'Passphrases must be at least 16 characters';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_passphrase, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_player and email like '%@players.gmw.invalid';
  if not found then
    raise exception 'Only passphrase accounts can be reset here';
  end if;
  -- Sign the account out everywhere, so an old passphrase or stolen session stops working
  begin
    delete from auth.sessions where user_id = p_player;
  exception when undefined_table or insufficient_privilege then null;
  end;
  perform public._log('player.passphrase_reset', 'profile', p_player::text);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public._clean_rs_name(text), public._check_new_hunter(text, text),
  public.auth_user_before_insert(), public.admin_set_passphrase(uuid, text),
  public.check_signup(text, text), public.signup_needs_code(), public.login_email_for(text)
from public, anon, authenticated;

grant execute on function
  public.check_signup(text, text),
  public.signup_needs_code(),
  public.login_email_for(text)
to anon, authenticated;

grant execute on function public.admin_set_passphrase(uuid, text) to authenticated;

-- The auth service runs these triggers; make sure its role can execute them
do $$ begin
  grant execute on function public.auth_user_before_insert(), public.handle_new_user(),
    public._check_new_hunter(text, text), public._clean_rs_name(text) to supabase_auth_admin;
exception when undefined_object then null;
end $$;
-- Gielinor's Most Wanted — admins enter claims for players, and players see newly reviewed claims
-- Safe to run on an existing install after 0001–0005.

-- ===========================================================================
-- 1. Admin claim entry (for screenshots posted in Discord)
-- ===========================================================================

-- Admins may upload evidence into any player's folder
drop policy if exists evidence_upload_admin on storage.objects;
create policy evidence_upload_admin on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and public.is_admin());

-- Record a claim on a player's behalf. Same rules as a player's own claim, except:
--  * it can be dated back to when the player posted in Discord (within the event),
--  * it works while the event is paused or in the review window after the end,
--  * it can be approved in the same step.
create or replace function public.admin_submit_claim(
  p_submission_id uuid,
  p_player        uuid,
  p_contract_id   uuid,
  p_links         text[],
  p_files         text[],
  p_note          text default '',
  p_submitted_at  timestamptz default null,
  p_approve       boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin  uuid := public._require_admin();
  pl       public.profiles;
  s        public.event_settings;
  c        public.contracts;
  v_when   timestamptz := coalesce(p_submitted_at, now());
  v_rep    bigint;
  v_links  text[] := coalesce(p_links, '{}');
  v_files  text[] := coalesce(p_files, '{}');
  v_item   text;
  v_result jsonb;
begin
  if p_player = v_admin then
    raise exception 'Use the normal claim form for your own claims; another admin reviews them';
  end if;
  select * into pl from public.profiles where id = p_player;
  if not found or pl.rs_name is null then raise exception 'Player not found'; end if;
  if pl.is_banned then raise exception '% is banned', pl.rs_name; end if;

  select * into s from public.event_settings;
  if v_when > now() + interval '5 minutes' then raise exception 'The posted time can''t be in the future'; end if;
  if v_when < s.starts_at or v_when > s.ends_at then
    raise exception 'The posted time must be during the event';
  end if;
  if now() > s.ends_at + make_interval(hours => s.review_grace_hours) then
    raise exception 'The review window for this event has closed';
  end if;

  select * into c from public.contracts where id = p_contract_id;
  if not found or c.status <> 'active' then raise exception 'That contract is not on the board'; end if;
  if c.approved_count >= public._claim_limit(c) then raise exception 'That bounty has already been claimed'; end if;
  if c.min_reputation > 0 then
    select coalesce(sum(amount), 0) into v_rep from public.reputation_events where player_id = p_player;
    if v_rep < c.min_reputation then
      raise exception '% has % reputation; this Most Wanted bounty needs %', pl.rs_name, v_rep, c.min_reputation;
    end if;
  end if;

  if cardinality(v_links) + cardinality(v_files) = 0 then raise exception 'Add at least one screenshot or link'; end if;
  if cardinality(v_links) > 3 or cardinality(v_files) > 3 then raise exception 'Up to 3 links and 3 screenshots'; end if;
  foreach v_item in array v_links loop
    if v_item !~* '^https://[^\s]+$' or char_length(v_item) > 500 then
      raise exception 'Evidence links must start with https://';
    end if;
  end loop;
  foreach v_item in array v_files loop
    if v_item not like p_player::text || '/' || p_submission_id::text || '/%' then
      raise exception 'Invalid evidence file';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'evidence' and name = v_item) then
      raise exception 'Evidence upload not found — please try again';
    end if;
  end loop;

  begin
    insert into public.submissions (id, contract_id, player_id, evidence_links, evidence_files, player_note, submitted_at)
    values (p_submission_id, c.id, p_player, v_links, v_files,
            left('Entered by an admin from Discord. ' || coalesce(p_note, ''), 1000), v_when);
  exception when unique_violation then
    raise exception '% already has a pending or approved claim on this bounty', pl.rs_name;
  end;

  perform public._log('submission.entered_by_admin', 'submission', p_submission_id::text,
    jsonb_build_object('contract', c.title, 'player_id', p_player, 'posted_at', v_when));

  if p_approve then
    v_result := public.review_submission(p_submission_id, true, null);
    return v_result || jsonb_build_object('submission_id', p_submission_id);
  end if;
  return jsonb_build_object('status', 'pending', 'submission_id', p_submission_id);
end $$;

-- ===========================================================================
-- 2. "Your claim was reviewed" heads-up
-- ===========================================================================
alter table public.profiles add column if not exists reviews_seen_at timestamptz not null default now();

create or replace function public.my_unseen_reviews()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.submissions s
    join public.profiles p on p.id = s.player_id
   where s.player_id = auth.uid()
     and s.status in ('approved', 'rejected', 'closed')
     and s.reviewed_at > p.reviews_seen_at;
$$;

-- Returns the previous "seen" time so the page can mark which claims are new
create or replace function public.mark_reviews_seen()
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_prev timestamptz;
begin
  select reviews_seen_at into v_prev from public.profiles where id = auth.uid();
  update public.profiles set reviews_seen_at = now() where id = auth.uid();
  return v_prev;
end $$;

-- ===========================================================================
-- Privileges
-- ===========================================================================
revoke execute on function
  public.admin_submit_claim(uuid, uuid, uuid, text[], text[], text, timestamptz, boolean),
  public.my_unseen_reviews(), public.mark_reviews_seen()
from public, anon, authenticated;
grant execute on function
  public.admin_submit_claim(uuid, uuid, uuid, text[], text[], text, timestamptz, boolean),
  public.my_unseen_reviews(), public.mark_reviews_seen()
to authenticated;
-- Gielinor's Most Wanted — starting data
-- Placeholder dates: starts now, runs 14 days. Change them in Admin > Event settings.

insert into public.event_settings (starts_at, ends_at)
values (date_trunc('hour', now()), date_trunc('hour', now()) + interval '14 days')
on conflict (id) do nothing;

insert into public.ranks (name, min_reputation) values
  ('Unknown Adventurer', 0),
  ('Bounty Hunter', 100),
  ('Veteran Hunter', 250),
  ('Elite Hunter', 450),
  ('Public Enemy No. 1', 700)
on conflict do nothing;

-- pool_order 10 = on the board at launch; 100+ = waiting in the pool, lowest first
insert into public.contracts
  (title, category, difficulty, summary, description, requirements, restrictions, evidence_instructions, pool_order, status)
values
-- PvM ------------------------------------------------------------------------
('Royal Pain', 'pvm', 'standard',
 'Slay the Queen Black Dragon five times.',
 'The Queen Black Dragon has been spotted stirring beneath the Grand Exchange. Put her down five times.',
 'Access to the Queen Black Dragon lair.', '',
 'A screenshot of the loot or drop message for each of the 5 kills, with the codeword typed in clan chat.', 10, 'pool'),
('The Three Kings', 'pvm', 'standard',
 'Kill Dagannoth Rex, Prime and Supreme once each.',
 'The Dagannoth Kings rule Waterbirth Island. Prove you can topple all three.',
 'Access to the Dagannoth Kings lair.', '',
 'One drop or kill screenshot per king (3 total), codeword typed in clan chat.', 10, 'pool'),
('Barrows Bounty', 'pvm', 'standard',
 'Loot 10 Barrows chests.',
 'The brothers keep rising. Clear the crypts and loot the chest ten times.',
 '', '',
 'The chest reward screen for each of the 10 runs, codeword typed in clan chat.', 100, 'pool'),
('The Frozen Menace', 'pvm', 'hard',
 'Defeat Arch-Glacor five times in normal mode.',
 'Arch-Glacor stirs in the depths of the Glacor Cavern. Bring it down five times.',
 'Access to the Arch-Glacor encounter.', 'Normal mode or hard mode both count.',
 'Kill message or loot screenshot for each of the 5 kills, codeword typed in clan chat.', 10, 'pool'),
('Long Live the King', 'pvm', 'hard',
 'Kill the Kalphite King three times.',
 'The Kalphite King guards the Exiled Kalphite Hive. Dethrone him three times.',
 'Access to the Exiled Kalphite Hive.', 'Solo or group kills both count.',
 'A drop or kill screenshot for each of the 3 kills, codeword typed in clan chat.', 10, 'pool'),
('Gods of War', 'pvm', 'hard',
 'Kill Vindicta, Helwyr, the Twin Furies and Gregorovic once each.',
 'The four generals of the Heart of Gielinor must fall, one apiece.',
 'Access to the God Wars Dungeon 2 bosses.', '',
 'One kill screenshot per boss (4 total), codeword typed in clan chat.', 110, 'pool'),
('Web of Lies', 'pvm', 'hard',
 'Kill Araxxor or Araxxi three times.',
 'Something with too many legs lurks beneath Morytania. End it three times over.',
 'Access to Araxxor.', '',
 'The reward screen for each of the 3 kills, codeword typed in clan chat.', 120, 'pool'),
('Staff of Armadyl', 'pvm', 'hard',
 'Defeat Kerapac, the Bound once.',
 'Kerapac schemes at the edge of the world. Stop him.',
 'Access to the Kerapac encounter.', 'Normal mode or hard mode.',
 'Kill message or loot screenshot, codeword typed in clan chat.', 130, 'pool'),
('The First Necromancer', 'pvm', 'elite',
 'Defeat Rasial, the First Necromancer.',
 'Rasial waits at the heart of his citadel. Few have walked out.',
 'Access to the Rasial encounter.', '',
 'Kill message or loot screenshot, codeword typed in clan chat.', 10, 'pool'),
('Ancient Avenger', 'pvm', 'elite',
 'Defeat Vorago once, any rotation.',
 'Vorago sits atop Mount Firewake. Bring your strongest friends.',
 '', 'Group kills count for every member who submits.',
 'Kill or reward screenshot showing you in the group, codeword typed in clan chat.', 140, 'pool'),
('Lord of Chaos', 'pvm', 'elite',
 'Defeat Zamorak, Lord of Chaos once.',
 'The god of chaos himself. One kill earns a place on the wall.',
 'Access to the Zamorak encounter.', '',
 'Kill message or loot screenshot, codeword typed in clan chat.', 150, 'pool'),
-- Skilling -------------------------------------------------------------------
('The Master Smith', 'skilling', 'standard',
 'Mine runite ore and smith a full rune armour set.',
 'The town armoury needs a full set of rune: full helm, platebody, platelegs and kiteshield, from ore you mined yourself.',
 'Mining and Smithing levels for runite.', 'All ore must be mined by you; no bought ore or bars.',
 'Screenshot of runite ore in your inventory, then the four finished pieces, codeword typed in clan chat.', 10, 'pool'),
('Shark Supper', 'skilling', 'standard',
 'Catch and cook 100 sharks yourself.',
 'The tavern wants a hundred cooked sharks, caught and cooked by the same pair of hands.',
 '', 'Sharks must be caught by you.',
 'Start and end screenshots showing raw then cooked shark counts, codeword typed in clan chat.', 10, 'pool'),
('The Potion Master', 'skilling', 'standard',
 'Make 5 different potions using herbs you grew.',
 'The apothecary is out of stock. Grow your own herbs and brew five different potions.',
 'A herb patch and the Herblore levels for your chosen potions.', 'Herbs must come from your own farming patches.',
 'Screenshot of the herb harvest, then each potion made, codeword typed in clan chat.', 10, 'pool'),
('Orchard Keeper', 'skilling', 'standard',
 'Check the health of 5 fully grown fruit trees in one run.',
 'Tend the orchards of Gielinor: five fruit trees, checked in a single run.',
 'Five fruit tree patches.', 'All five on the same farming run.',
 'Each health-check message (5 total), codeword typed in clan chat.', 100, 'pool'),
('Leap of Faith', 'skilling', 'standard',
 'Complete 25 laps of the Hefin Agility Course.',
 'Run the elven rooftops of Prifddinas twenty-five times.',
 '77 Agility and access to Prifddinas.', '',
 'Lap count before and after, codeword typed in clan chat.', 110, 'pool'),
('Dig Deep', 'skilling', 'standard',
 'Excavate and restore 5 artefacts.',
 'The Archaeology Guild wants five artefacts unearthed and restored.',
 '', 'Any dig site.',
 'A screenshot of each restored artefact, codeword typed in clan chat.', 120, 'pool'),
('Golden Touch', 'skilling', 'hard',
 'Defeat Croesus once.',
 'The fungal titan Croesus can only be beaten with a gatherer''s tools.',
 'Access to Croesus.', '',
 'Kill message or reward screenshot, codeword typed in clan chat.', 10, 'pool'),
('Deep Sea Haul', 'skilling', 'hard',
 'Catch 100 sailfish.',
 'The fishmonger wants sailfish, and lots of them.',
 '97 Fishing and access to the Deep Sea Fishing hub.', '',
 'Start and end screenshots showing your sailfish count, codeword typed in clan chat.', 10, 'pool'),
('Death Becomes You', 'skilling', 'hard',
 'Craft 500 death runes from essence you mined.',
 'The Wizards'' Tower needs death runes, made from essence you mined yourself.',
 '65 Runecrafting.', 'Essence must be mined by you.',
 'Screenshots of your essence, then the runes at the start and end, codeword typed in clan chat.', 100, 'pool'),
('Elder Grove', 'skilling', 'hard',
 'Chop 100 elder logs.',
 'The carpenters'' guild wants a hundred elder logs.',
 '90 Woodcutting.', '',
 'Start and end screenshots showing your elder log count, codeword typed in clan chat.', 110, 'pool'),
('Overloaded', 'skilling', 'elite',
 'Make 10 overloads.',
 'The ultimate brew. Mix ten overloads.',
 '96 Herblore.', '',
 'Screenshot of the 10 overloads in your inventory, codeword typed in clan chat.', 120, 'pool'),
-- Special --------------------------------------------------------------------
('The Treasure Hunter', 'special', 'standard',
 'Complete 3 hard clue scrolls.',
 'Follow the trail. Three hard clues, three caskets.',
 '', '',
 'The reward casket screen for each of the 3 clues, codeword typed in clan chat.', 10, 'pool'),
('The Fashion Criminal', 'special', 'standard',
 'Defeat any boss in a full cosmetic outfit override.',
 'Wanted for crimes against fashion. Defeat any boss while wearing a full cosmetic outfit.',
 '', 'A full cosmetic outfit override must be visible on your character for the kill.',
 'Kill message with your character and outfit clearly visible, codeword typed in clan chat.', 10, 'pool'),
('Star Chaser', 'special', 'standard',
 'Mine a size 5 or larger shooting star until it collapses.',
 'A star has fallen. Find it and mine it out.',
 'The Mining level for the star''s size.', 'Size 5 or larger.',
 'The star''s size, then the collapse reward, codeword typed in clan chat.', 100, 'pool'),
('Root of All Evil', 'special', 'standard',
 'Help fell an evil tree and collect the reward.',
 'An evil tree has taken root. Bring an axe.',
 '', '',
 'The reward message, codeword typed in clan chat.', 110, 'pool'),
('Penguin Spy', 'special', 'standard',
 'Spot 5 penguins in Penguin Hide and Seek in one week.',
 'The penguins are watching. Watch them back.',
 '', 'All five in the same weekly reset.',
 'Each spotting message (5 total), codeword typed in clan chat.', 120, 'pool'),
('Unarmoured Assault', 'special', 'hard',
 'Kill the Kalphite Queen wearing no armour.',
 'Face the Kalphite Queen with nothing between you and her mandibles.',
 '', 'No armour in any slot. Weapons, ammunition and pocket slot are allowed.',
 'Your equipment screen, then the kill message, codeword typed in clan chat.', 130, 'pool'),
('Elite Treasure', 'special', 'hard',
 'Complete 1 elite clue scroll.',
 'An elite trail awaits.',
 '', '',
 'The reward casket screen, codeword typed in clan chat.', 140, 'pool'),
('Master of Clues', 'special', 'elite',
 'Complete 1 master clue scroll.',
 'The hardest trail in Gielinor.',
 '', '',
 'The reward casket screen, codeword typed in clan chat.', 150, 'pool');

-- Create the board slots and put the first contracts up
select public._sync_board_slots();
-- Gielinor's Most Wanted — sample Most Wanted contracts
-- These need reputation to claim and appear in the Most Wanted slots, not the main board.
-- Adding them to the pool fills any empty Most Wanted slot automatically.

insert into public.contracts
  (title, category, difficulty, summary, description, requirements, restrictions, evidence_instructions, min_reputation, pool_order, status)
values
('The Warden''s Fall', 'pvm', 'elite',
 'Defeat Telos, the Warden once.',
 'Telos guards the heart of Gielinor. Only proven hunters are sent after him.',
 'Access to the Telos encounter.', 'Any enrage counts.',
 'Kill message or loot screenshot, codeword typed in clan chat.', 250, 10, 'pool'),
('Angel of Death', 'pvm', 'elite',
 'Defeat Nex: Angel of Death once.',
 'The Angel of Death stirs in the Ancient Prison. Bring your best team.',
 'Access to Nex: Angel of Death.', 'Group kills count for every member who submits.',
 'Kill or reward screenshot showing you in the group, codeword typed in clan chat.', 250, 20, 'pool'),
('Master Tracker', 'special', 'elite',
 'Complete 3 master clue scrolls.',
 'Three master trails, back to back. Only the most dedicated need apply.',
 '', '',
 'The reward casket screen for each of the 3 clues, codeword typed in clan chat.', 250, 30, 'pool'),
('Grove Guardian', 'pvm', 'elite',
 'Defeat Solak once.',
 'Solak has poisoned the elven lands. End it.',
 'Access to Solak.', 'Group kills count for every member who submits.',
 'Kill or reward screenshot showing you in the group, codeword typed in clan chat.', 450, 40, 'pool');
