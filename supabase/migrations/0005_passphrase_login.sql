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
