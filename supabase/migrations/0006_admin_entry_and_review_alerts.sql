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
