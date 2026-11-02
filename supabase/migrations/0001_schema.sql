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
