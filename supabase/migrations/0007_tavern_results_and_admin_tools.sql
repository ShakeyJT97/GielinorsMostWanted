-- Gielinor's Most Wanted — Tavern chat, activity feed, results, revoking approvals, daily Discord standings
-- Safe to run on an existing install after 0001–0006.

-- ===========================================================================
-- 1. Revoke an approval made by mistake
-- ===========================================================================
-- Removes the reputation award, frees the slot (if the bounty is still up), tells the player
-- why, and logs it. A bounty that already retired stays retired: its slot has moved on.
create or replace function public.revoke_approval(p_submission_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin    uuid := public._require_admin();
  v_contract uuid;
  c          public.contracts;
  sub        public.submissions;
  v_amount   int;
  v_count    int;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for revoking'; end if;
  select contract_id into v_contract from public.submissions where id = p_submission_id;
  if v_contract is null then raise exception 'Submission not found'; end if;

  select * into c from public.contracts where id = v_contract for update;
  select * into sub from public.submissions where id = p_submission_id for update;
  if sub.status <> 'approved' then raise exception 'Only approved claims can be revoked'; end if;

  perform public._internal_on();
  delete from public.reputation_events where submission_id = sub.id returning amount into v_amount;
  update public.submissions
     set status = 'rejected', reviewed_by = v_admin, reviewed_at = now(),
         review_note = 'Approval revoked: ' || btrim(p_reason)
   where id = sub.id;
  select count(*) into v_count from public.submissions where contract_id = c.id and status = 'approved';
  update public.contracts set approved_count = v_count where id = c.id;

  perform public._log('submission.revoked', 'submission', sub.id::text,
    jsonb_build_object('contract', c.title, 'player_id', sub.player_id, 'reputation', v_amount,
                       'reason', btrim(p_reason), 'contract_status', c.status));
  return jsonb_build_object('contract_status', c.status, 'claims', v_count, 'reputation_removed', v_amount);
end $$;

-- ===========================================================================
-- 2. Board: show how many claims are waiting for review on each poster
-- ===========================================================================
drop function if exists public.get_board();
create function public.get_board()
returns table (
  slot_id int, tier public.slot_tier, category public.contract_category, slot_position int, slot_state public.slot_state,
  contract_id uuid, title text, summary text, difficulty public.contract_difficulty,
  reputation int, claim_limit int, approved_count int, min_reputation int, activated_at timestamptz,
  claimants text[], my_status public.submission_status, pending_count int
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
           order by s.submitted_at desc limit 1),
         (select count(*)::int from public.submissions s where s.contract_id = c.id and s.status = 'pending')
    from public.board_slots bs
    left join public.contracts c on c.id = bs.contract_id
   order by bs.tier, bs.position, bs.category;
$$;

-- ===========================================================================
-- 3. Public activity feed (claims approved, bounties claimed, new bounties)
-- ===========================================================================
create or replace function public.get_activity(p_limit int default 15)
returns table (at timestamptz, kind text, player text, contract_id uuid, title text, reputation int)
language sql stable security definer set search_path = public as $$
  select a.created_at,
         case a.action when 'submission.approved' then 'claim' when 'contract.retired' then 'retired' else 'posted' end,
         p.rs_name::text,
         coalesce(s.contract_id, ret.id, posted.id),
         coalesce(cs.title, ret.title, a.details ->> 'new_contract'),
         case when a.action = 'submission.approved' then (a.details ->> 'reputation')::int end
    from public.audit_log a
    left join public.submissions s on a.action = 'submission.approved' and s.id::text = a.entity_id
    left join public.contracts cs on cs.id = s.contract_id
    left join public.profiles p on p.id = s.player_id
    left join public.contracts ret on a.action = 'contract.retired' and ret.id::text = a.entity_id
    left join lateral (
      select c2.id from public.contracts c2
       where a.action in ('slot.rotated', 'slot.manual_rotate')
         and c2.title = a.details ->> 'new_contract' and c2.status in ('active', 'retired')
       order by c2.activated_at desc nulls last limit 1
    ) posted on true
   where a.action in ('submission.approved', 'contract.retired', 'slot.rotated', 'slot.manual_rotate')
     and (a.action not in ('slot.rotated', 'slot.manual_rotate') or a.details ->> 'new_contract' is not null)
     and (a.action <> 'submission.approved' or s.status = 'approved')   -- revoked claims drop out
   order by a.created_at desc
   limit least(greatest(coalesce(p_limit, 15), 1), 50);
$$;

-- ===========================================================================
-- 4. Results and event stats
-- ===========================================================================
create or replace function public.get_event_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_podium   jsonb;
  v_cats     jsonb := '{}'::jsonb;
  v_cat      public.contract_category;
  v_fastest  jsonb;
  v_busiest  jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(l) order by l.place, l.rs_name), '[]') into v_podium
    from public.get_leaderboard(null) l where l.place <= 3;

  foreach v_cat in array enum_range(null::public.contract_category) loop
    v_cats := v_cats || jsonb_build_object(v_cat::text,
      (select coalesce(jsonb_agg(to_jsonb(l) order by l.rs_name), '[]') from public.get_leaderboard(v_cat) l where l.place = 1));
  end loop;

  select jsonb_build_object('contract_id', c.id, 'title', c.title, 'category', c.category,
                            'seconds', extract(epoch from c.retired_at - c.activated_at)::int)
    into v_fastest
    from public.contracts c
   where c.status = 'retired' and c.approved_count > 0 and c.activated_at is not null
   order by c.retired_at - c.activated_at limit 1;

  select jsonb_build_object('title', c.title, 'contract_id', c.id, 'attempts', count(*))
    into v_busiest
    from public.submissions s join public.contracts c on c.id = s.contract_id
   where s.status <> 'withdrawn'
   group by c.id, c.title order by count(*) desc, c.title limit 1;

  return jsonb_build_object(
    'podium', v_podium,
    'category_winners', v_cats,
    'claims', (select count(*) from public.submissions where status = 'approved'),
    'hunters', (select count(distinct player_id) from public.reputation_events where source = 'claim'),
    'reputation', (select coalesce(sum(amount), 0) from public.reputation_events),
    'bounties_claimed', (select count(*) from public.contracts where status = 'retired' and approved_count > 0),
    'fastest', v_fastest,
    'busiest', v_busiest
  );
end $$;

-- ===========================================================================
-- 5. The Tavern: event chat
-- ===========================================================================
alter table public.profiles add column if not exists is_muted boolean not null default false;

create table if not exists public.chat_messages (
  id          bigserial primary key,
  player_id   uuid not null references public.profiles (id),
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id)
);
create index if not exists chat_messages_player_idx on public.chat_messages (player_id, created_at desc);

alter table public.chat_messages enable row level security;
drop policy if exists chat_read on public.chat_messages;
create policy chat_read on public.chat_messages for select to anon, authenticated
  using (deleted_at is null or public.is_admin());
revoke all on public.chat_messages from anon, authenticated;
grant select on public.chat_messages to anon, authenticated;

create or replace function public.post_chat(p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  pl     public.profiles;
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[\r\n]{3,}', E'\n\n', 'g'));
  v_id   bigint;
begin
  if v_uid is null then raise exception 'Sign in to join the conversation'; end if;
  select * into pl from public.profiles where id = v_uid;
  if pl.rs_name is null then raise exception 'Set your RuneScape name first'; end if;
  if pl.is_banned then raise exception 'Your account cannot post'; end if;
  if pl.is_muted then raise exception 'An admin has muted you in the Tavern'; end if;
  if char_length(v_body) = 0 then raise exception 'Say something first'; end if;
  if char_length(v_body) > 500 then raise exception 'Keep it under 500 characters'; end if;
  if (select count(*) from public.chat_messages where player_id = v_uid and created_at > now() - interval '15 seconds') >= 4 then
    raise exception 'Slow down, hunter. Try again in a few seconds.';
  end if;
  if exists (select 1 from public.chat_messages where player_id = v_uid and body = v_body
              and created_at > now() - interval '1 minute' and deleted_at is null) then
    raise exception 'You just said that';
  end if;
  insert into public.chat_messages (player_id, body) values (v_uid, v_body) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_chat(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  m     public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_id;
  if not found or m.deleted_at is not null then raise exception 'Message not found'; end if;
  -- players can delete their own messages; admins can delete anyone's
  if m.player_id <> coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid) and not public.is_admin() then
    raise exception 'You can only delete your own messages';
  end if;
  update public.chat_messages set deleted_at = now(), deleted_by = v_uid where id = p_id;
  if m.player_id <> v_uid then
    perform public._log('chat.deleted', 'chat_message', p_id::text,
      jsonb_build_object('player_id', m.player_id, 'message', left(m.body, 200)));
  end if;
end $$;

create or replace function public.set_player_muted(p_player uuid, p_muted boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public._require_admin();
begin
  if p_player = v_admin then raise exception 'You cannot mute yourself'; end if;
  update public.profiles set is_muted = p_muted where id = p_player;
  perform public._log(case when p_muted then 'player.muted' else 'player.unmuted' end, 'profile', p_player::text);
end $$;

create or replace function public.get_chat(p_before bigint default null, p_limit int default 60)
returns table (id bigint, player_id uuid, rs_name text, rank_name text, is_admin boolean, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with msgs as (
    select m.* from public.chat_messages m
     where m.deleted_at is null and (p_before is null or m.id < p_before)
     order by m.id desc
     limit least(greatest(coalesce(p_limit, 60), 1), 100)
  ), reps as (
    select player_id, sum(amount) as rep from public.reputation_events
     where player_id in (select player_id from msgs) group by player_id
  )
  select m.id, m.player_id, p.rs_name::text,
         (select r.name from public.ranks r where r.min_reputation <= greatest(coalesce(reps.rep, 0), 0)
           order by r.min_reputation desc limit 1),
         p.role = 'admin', m.body, m.created_at
    from msgs m
    join public.profiles p on p.id = m.player_id
    left join reps on reps.player_id = m.player_id
   order by m.id;
$$;

do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when undefined_object or duplicate_object then null;
end $$;

-- ===========================================================================
-- 6. Daily standings (and a final post) in Discord
-- ===========================================================================
alter table public.integration_settings
  add column if not exists daily_post_hour int check (daily_post_hour between 0 and 23),
  add column if not exists last_daily_post_on date,
  add column if not exists final_posted boolean not null default false;

create or replace function public._standings_text(p_top int default 5)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(
           case l.place when 1 then ':first_place:' when 2 then ':second_place:' when 3 then ':third_place:' else l.place::text || '.' end
           || ' **' || l.rs_name || '**: ' || l.reputation || ' reputation', E'\n' order by l.place, l.rs_name),
         'No reputation earned yet.')
    from public.get_leaderboard(null) l where l.place <= p_top;
$$;

-- Runs hourly from pg_cron. Posts once a day at the chosen London hour while the event is on,
-- and once more when it ends. p_force posts the current standings immediately.
create or replace function public.post_daily_leaderboard(p_force boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  s       public.event_settings;
  i       public.integration_settings;
  v_local timestamp := now() at time zone 'Europe/London';
  v_day   int;
  v_days  int;
  v_today int;
  v_link  text;
begin
  select * into s from public.event_settings;
  select * into i from public.integration_settings;
  if i.discord_webhook_url is null then return 'no webhook'; end if;
  v_link := case when i.site_url is not null then E'\n<' || rtrim(i.site_url, '/') || '/leaderboard>' else '' end;

  if not p_force then
    if now() < s.starts_at then return 'not started'; end if;
    if now() > s.ends_at then
      if i.final_posted then return 'final already posted'; end if;
      perform public._discord_post(':crossed_swords: **The hunt is over!** Final standings:' || E'\n' || public._standings_text(5)
        || case when i.site_url is not null then E'\n<' || rtrim(i.site_url, '/') || '/results>' else '' end);
      update public.integration_settings set final_posted = true;
      return 'final posted';
    end if;
    if i.daily_post_hour is null then return 'daily post off'; end if;
    if extract(hour from v_local)::int <> i.daily_post_hour then return 'not the hour'; end if;
    if i.last_daily_post_on = v_local::date then return 'already posted today'; end if;
  end if;

  v_day  := greatest(1, floor(extract(epoch from now() - s.starts_at) / 86400)::int + 1);
  v_days := greatest(1, ceil(extract(epoch from s.ends_at - s.starts_at) / 86400)::int);
  select count(*) into v_today from public.reputation_events
   where source = 'claim' and created_at > now() - interval '24 hours';

  perform public._discord_post(':scroll: **Standings, day ' || least(v_day, v_days) || ' of ' || v_days || '**'
    || E'\n' || public._standings_text(5)
    || E'\n' || v_today || ' ' || case when v_today = 1 then 'claim' else 'claims' end || ' approved in the last 24 hours.' || v_link);
  update public.integration_settings set last_daily_post_on = v_local::date;
  return 'posted';
end $$;

create or replace function public.send_standings_now()
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public._require_admin();
begin
  if (select discord_webhook_url from public.integration_settings) is null then
    raise exception 'Save a Discord webhook address first';
  end if;
  perform public.post_daily_leaderboard(true);
end $$;

-- Schedule the hourly check. If pg_cron isn't available, turn it on in the dashboard
-- (Integrations → Cron, or Database → Extensions → pg_cron) and run this block again.
do $$ begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('gmw-daily-standings', '2 * * * *', 'select public.post_daily_leaderboard()');
exception when others then
  raise notice 'pg_cron not available (%); daily Discord standings are off', sqlerrm;
end $$;

-- ===========================================================================
-- Privileges
-- ===========================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_admin(), public.get_board(), public.get_leaderboard(public.contract_category),
  public.get_player_summary(uuid), public.get_archive(), public.get_hunter(text),
  public.check_signup(text, text), public.signup_needs_code(), public.login_email_for(text),
  public.get_activity(int), public.get_event_stats(), public.get_chat(bigint, int)
to anon, authenticated;
grant execute on function
  public.set_display_name(text), public.submit_claim(uuid, uuid, text[], text[], text), public.withdraw_claim(uuid),
  public.review_submission(uuid, boolean, text), public.rotate_slot(int, text, uuid), public.set_slot_paused(int, boolean),
  public.sync_board_slots(), public.adjust_reputation(uuid, int, text, public.rep_source),
  public.set_player_role(uuid, public.user_role), public.set_player_banned(uuid, boolean), public.send_discord_test(),
  public.admin_set_passphrase(uuid, text),
  public.admin_submit_claim(uuid, uuid, uuid, text[], text[], text, timestamptz, boolean),
  public.my_unseen_reviews(), public.mark_reviews_seen(),
  public.revoke_approval(uuid, text), public.post_chat(text), public.delete_chat(bigint),
  public.set_player_muted(uuid, boolean), public.send_standings_now()
to authenticated;
do $$ begin
  grant execute on function public.auth_user_before_insert(), public.handle_new_user(),
    public._check_new_hunter(text, text), public._clean_rs_name(text) to supabase_auth_admin;
exception when undefined_object then null;
end $$;
