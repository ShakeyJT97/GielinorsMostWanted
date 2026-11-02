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
