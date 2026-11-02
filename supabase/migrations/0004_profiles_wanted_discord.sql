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
