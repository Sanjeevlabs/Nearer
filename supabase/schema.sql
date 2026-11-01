-- Aangan schema — full PRD table list. Run ONCE in the Supabase SQL editor.
-- This script is IDEMPOTENT: every object is created IF NOT EXISTS and every
-- policy is dropped before creation, so re-running it is always safe.
--
-- RLS is ENABLED on every table with NO anonymous policies (deny by default).
-- V1 has no Supabase Auth: ALL database and storage access goes through
-- Next.js server routes using the server-only SUPABASE_SECRET_KEY (service
-- role, bypasses RLS). The anon key is never used for data access.
-- Only ritual_configs stays public-read (static festival guides).
-- M5 (privacy set) adds invite-code claims; until then the app stays in
-- mock mode (MOCK=true) and the mock store is the seam.
-- Mirrors lib/schemas.ts, lib/store.ts and lib/llm-server.ts.

-- ---------------------------------------------------------------- families
create table if not exists families (
  id text primary key,
  name text not null,
  default_home_image_ref text,
  created_at timestamptz default now()
);
-- Demo copies: hash of the caller that made them (per-caller hourly brake).
alter table families add column if not exists demo_caller text;
create index if not exists families_demo_caller_idx on families (demo_caller, created_at desc);

-- ---------------------------------------------------------------- members
-- PRD: members(+home_image, lang, display_lang, tz). Legacy `language`
-- column kept for the Day-1 schema; app reads lang + displayLang.
create table if not exists members (
  id text primary key,
  family_id text references families(id) on delete cascade,
  first_name text not null default '',
  display_name text not null,
  role text check (role in ('elder', 'adult', 'child')) default 'adult',
  language text default 'en',
  lang text default 'en',
  display_lang text default 'en' check (char_length(display_lang) between 2 and 12),
  tz text default 'UTC',
  birthday text,
  home_image_ref text,
  home_palette text[] default '{}',
  created_at timestamptz default now()
);
alter table members add column if not exists first_name text not null default '';
alter table members add column if not exists role text check (role in ('elder', 'adult', 'child')) default 'adult';
alter table members add column if not exists lang text default 'en';
alter table members add column if not exists display_lang text default 'en';
-- Major-language support: codes come from lib/languages.ts (app-validated).
alter table members drop constraint if exists members_display_lang_check;
-- Access roles (admin | member | child), separate from generation (role).
alter table members add column if not exists access text not null default 'member' check (access in ('admin', 'member', 'child'));
alter table members add constraint members_display_lang_check check (char_length(display_lang) between 2 and 12);
alter table members add column if not exists tz text default 'UTC';
alter table members add column if not exists birthday text;
alter table members add column if not exists home_image_ref text;
alter table members add column if not exists home_palette text[] default '{}';
alter table members add column if not exists photo_ref text;
alter table members add column if not exists email text;
-- Two courtyards, one door: the same person in another family's Aangan.
-- Server-set only; sides are found by this id, never by a client claim.
alter table members add column if not exists person_id text;
-- The city a person lives in, as they say it (shown on the window, never tracked).
alter table members add column if not exists city text default '';
create index if not exists members_person_idx on members (person_id) where person_id is not null;
-- One account per family; the same email may hold a place on each side.
drop index if exists members_email_idx;
create unique index if not exists members_email_family_idx on members (lower(email), family_id) where email is not null;

-- Roles v2 (owner | admin | member | teen | child) and joiners who wait.
-- owner: exactly one per family (the creator); admins: up to 3 with the
-- owner (enforced in lib/roles.ts); teen 13-17; child 0-12, a profile only.
alter table members drop constraint if exists members_access_check;
alter table members add constraint members_access_check check (access in ('owner', 'admin', 'member', 'teen', 'child'));
-- Joining with a code waits for an owner/admin ("pending") unless the family
-- made the place, or an owner/admin made the code.
alter table members add column if not exists status text not null default 'active';
alter table members drop constraint if exists members_status_check;
alter table members add constraint members_status_check check (status in ('active', 'pending'));
-- Existing families: the first admin (oldest, then by id) becomes the owner.
update members m set access = 'owner'
from (
  select distinct on (family_id) id
  from members
  where access = 'admin'
    and family_id is not null
    and family_id not in (select family_id from members where access = 'owner' and family_id is not null)
  order by family_id, created_at asc nulls last, id asc
) first_admin
where m.id = first_admin.id;
create unique index if not exists members_one_owner_idx on members (family_id) where access = 'owner';

-- ------------------------------------------------------------ relationships
-- Guided Bond adds, e.g. ('arjun','dadi','parent'). No culture in logic:
-- relation is a free-text edge label resolved by the M3 kinship resolver.
create table if not exists relationships (
  id text primary key,
  family_id text references families(id) on delete cascade,
  member_id text references members(id) on delete cascade,
  relation_member_id text references members(id) on delete cascade,
  relation text not null,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------------- cards
-- PRD: cards(+transcript, transcript_lang, segments). peaks/segments are
-- jsonb number arrays; palette is text[]. Legacy media_path/thumbnail_path
-- kept from the Day-1 schema; app writes media_ref (session ref today,
-- storage path after the Supabase swap).
create table if not exists cards (
  id text primary key,
  family_id text references families(id) on delete cascade,
  type text check (type in ('photo', 'audio', 'video')),
  caption text not null default '',
  summary text default '',
  lang text default 'en',
  taken_at timestamptz not null,
  ritual_slug text,
  source text default 'upload' check (source in ('upload', 'today', 'glasses', 'ritual', 'agent', 'muse-portrait', 'muse-restored')),
  media_path text,
  thumbnail_path text,
  media_ref text,
  peaks jsonb default '[]',
  palette text[] default '{}',
  transcript text default '',
  transcript_lang text default 'en',
  segments jsonb default '[]',
  created_at timestamptz default now()
);
alter table cards add column if not exists source text default 'upload' check (source in ('upload', 'today', 'glasses', 'ritual', 'agent'));
-- Muse-made cards are labelled by their source (Painted by Muse, Restored by Muse).
alter table cards drop constraint if exists cards_source_check;
alter table cards add constraint cards_source_check check (source in ('upload', 'today', 'glasses', 'ritual', 'agent', 'muse-portrait', 'muse-restored'));
alter table cards add column if not exists media_ref text;
alter table cards add column if not exists peaks jsonb default '[]';
alter table cards add column if not exists palette text[] default '{}';
alter table cards add column if not exists transcript text default '';
alter table cards add column if not exists transcript_lang text default 'en';
alter table cards add column if not exists segments jsonb default '[]';
alter table cards add column if not exists author_id text references members(id) on delete set null;
alter table cards add column if not exists cover_ref text;
alter table cards add column if not exists addressed_to text references members(id) on delete set null;
-- The printed-photo frame: where it was taken and a short note (both optional).
alter table cards add column if not exists place text not null default '';
alter table cards add column if not exists note text not null default '';

-- ------------------------------------------------------------------- media
-- Private-bucket objects referenced by cards. storage_path is the object key
-- inside family-media; rows are metadata only.
create table if not exists media (
  id text primary key,
  family_id text references families(id) on delete cascade,
  card_id text references cards(id) on delete set null,
  kind text check (kind in ('photo', 'audio', 'video')),
  bytes bigint default 0,
  mime text default '',
  duration_seconds numeric,
  taken_at timestamptz,
  taken_at_source text default 'now',
  source text default 'upload',
  palette text[] default '{}',
  peaks jsonb default '[]',
  storage_path text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------------- plays
-- Two-way voice Heard loop: plays(card, member, played_at).
create table if not exists plays (
  id text primary key,
  family_id text references families(id) on delete cascade,
  card_id text references cards(id) on delete cascade,
  member_id text references members(id) on delete cascade,
  played_at timestamptz not null default now(),
  created_at timestamptz default now()
);
create index if not exists plays_card_idx on plays (card_id, played_at desc);

-- --------------------------------------------------------------- reactions
-- Exactly three kinds; one per member per card (unique pair → latest wins).
create table if not exists reactions (
  id text primary key,
  family_id text references families(id) on delete cascade,
  card_id text references cards(id) on delete cascade,
  member_id text references members(id) on delete cascade,
  kind text check (kind in ('love', 'laugh', 'bless')),
  created_at timestamptz default now()
);
create unique index if not exists reactions_card_member_uidx on reactions (card_id, member_id);

-- -------------------------------------------------------------- daily_roles
-- Ikigai role per elder per day (ritual agent assigns in M4).
create table if not exists daily_roles (
  id text primary key,
  family_id text references families(id) on delete cascade,
  member_id text references members(id) on delete cascade,
  role_date date not null,
  prompt text not null default '',
  created_at timestamptz default now()
);
create unique index if not exists daily_roles_member_day_uidx on daily_roles (family_id, member_id, role_date);

-- ----------------------------------------------------------- ritual_configs
-- Data-driven festival specifics live in JSON rows/files, never in code.
create table if not exists ritual_configs (
  slug text primary key,
  title text not null,
  culture_notes text default '',
  steps jsonb not null default '[]',
  config jsonb,
  version int default 1
);
alter table ritual_configs add column if not exists culture_notes text default '';
alter table ritual_configs add column if not exists steps jsonb not null default '[]';

-- -------------------------------------------------------------- ritual_runs
-- Occasion slugs come from the family graph (birthdays) and rituals/*.json,
-- not from ritual_configs rows (nothing seeds that table), so the slug is a
-- plain column: the old foreign key made every live insert fail silently.
create table if not exists ritual_runs (
  id text primary key,
  family_id text references families(id) on delete cascade,
  ritual_slug text,
  occasion_date date,
  status text default 'open' check (status in ('open', 'collecting', 'delivered', 'done')),
  created_at timestamptz default now()
);
alter table ritual_runs drop constraint if exists ritual_runs_ritual_slug_fkey;

-- ------------------------------------------------------------------ wishes
-- Wishes AND blessings from members/elders (kind: wish|blessing).
create table if not exists wishes (
  id text primary key,
  family_id text references families(id) on delete cascade,
  ritual_run_id text references ritual_runs(id) on delete set null,
  card_id text references cards(id) on delete set null,
  member_id text references members(id) on delete cascade,
  kind text check (kind in ('wish', 'blessing')),
  created_at timestamptz default now()
);

-- ---------------------------------------------------------- gather_sessions
-- A family evening: date + per-member local times, invites, playlist.
create table if not exists gather_sessions (
  id text primary key,
  family_id text references families(id) on delete cascade,
  title text default '',
  starts_at timestamptz,
  invites jsonb default '[]',
  playlist jsonb default '[]',
  created_at timestamptz default now()
);

-- -------------------------------------------------------------- suggestions
-- Agent proposals; actions execute only on approval (glass Review card).
create table if not exists suggestions (
  id text primary key,
  family_id text references families(id) on delete cascade,
  goal text default '',
  payload jsonb default '{}',
  status text default 'pending' check (status in ('pending', 'approved', 'rejected', 'done')),
  created_at timestamptz default now()
);

-- --------------------------------------------------------------- agent_runs
create table if not exists agent_runs (
  id text primary key,
  family_id text references families(id) on delete cascade,
  goal text default '',
  tools jsonb default '[]',
  status text default 'done',
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------- llm_calls
-- Spend ledger mirror: model, purpose, cost, cache hits. Server is the only
-- writer; clients have no direct access.
create table if not exists llm_calls (
  id text primary key,
  family_id text references families(id) on delete cascade,
  model text not null default '',
  purpose text default '',
  cost_usd numeric default 0,
  cached boolean default false,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------ kinship_cache
-- PRD: kinship_cache(path, display_lang). Deterministic BFS path → terms;
-- the model runs only on a cache miss (M3). Terms are generic kinship words.
create table if not exists kinship_cache (
  path text not null,
  display_lang text not null default 'en',
  terms jsonb default '{}',
  created_at timestamptz default now(),
  primary key (path, display_lang)
);
-- Any language the app supports can be cached, so no fixed list. Databases
-- made earlier have the old inline check (Postgres names it like this); drop it.
alter table kinship_cache drop constraint if exists kinship_cache_display_lang_check;

-- ----------------------------------------------------------------- invites
-- Expiring invite codes (7 days). Service-role only until M5 privacy set.
create table if not exists invites (
  id text primary key,
  family_id text references families(id) on delete cascade,
  code text unique not null,
  expires_at timestamptz not null,
  created_by text references members(id) on delete set null,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------- consents
-- A parent saying yes to their teen's account (lib/roles.ts). For now the
-- acting owner/admin's signed-in session is the verification
-- ('parent-session-code'); a DigiLocker check comes later.
create table if not exists consents (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  parent_member_id text references members(id) on delete set null,
  kind text not null check (kind in ('teen-account')),
  method text not null check (method in ('parent-session-code')),
  created_at timestamptz not null default now()
);
create index if not exists consents_family_member_idx on consents (family_id, member_id, created_at desc);

-- Legacy Day-1 model cache table; kept untouched for backward compatibility.
create table if not exists llm_cache (
  key text primary key,
  response jsonb not null,
  cost_usd numeric default 0,
  created_at timestamptz default now()
);

-- Cron cursors (service role only): where the daily ritual scan stopped.
create table if not exists cron_state (
  id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table cron_state enable row level security;

-- --------------------------------------------------------------------- RLS
alter table families enable row level security;
alter table members enable row level security;
alter table relationships enable row level security;
alter table cards enable row level security;
alter table media enable row level security;
alter table plays enable row level security;
alter table reactions enable row level security;
alter table daily_roles enable row level security;
alter table ritual_configs enable row level security;
alter table ritual_runs enable row level security;
alter table wishes enable row level security;
alter table gather_sessions enable row level security;
alter table suggestions enable row level security;
alter table agent_runs enable row level security;
alter table llm_calls enable row level security;
alter table kinship_cache enable row level security;
alter table invites enable row level security;
alter table llm_cache enable row level security;
alter table consents enable row level security;

-- Server-only model: RLS stays ENABLED everywhere, but NO policy grants
-- anything to anon/authenticated, so direct client access is denied by
-- default. The drops below also clean up policies from earlier revisions,
-- keeping re-runs idempotent. Server routes use the service role (bypasses
-- RLS) and enforce family scoping + validation in code.
drop policy if exists "family scope" on families;
drop policy if exists "family scope" on members;
drop policy if exists "family scope" on relationships;
drop policy if exists "family scope" on cards;
drop policy if exists "family scope" on media;
drop policy if exists "family scope" on plays;
drop policy if exists "family scope" on reactions;
drop policy if exists "family scope" on daily_roles;
drop policy if exists "family scope" on ritual_runs;
drop policy if exists "family scope" on wishes;
drop policy if exists "family scope" on gather_sessions;
drop policy if exists "family scope" on suggestions;
drop policy if exists "family scope" on agent_runs;
drop policy if exists "no direct cache access" on llm_calls;
drop policy if exists "kinship read" on kinship_cache;
drop policy if exists "no direct invite access" on invites;
drop policy if exists "no direct cache access" on llm_cache;
-- Consents: RLS by family. Grants nothing today (no request carries a
-- family_id claim; the server uses the service role); scopes reads to the
-- caller's own family once Supabase Auth JWTs carry one.
drop policy if exists "family scope" on consents;
create policy "family scope" on consents for select to authenticated
  using (family_id = (auth.jwt() ->> 'family_id'));

-- Sole exception: static festival guides are public-read.
drop policy if exists "read configs" on ritual_configs;
create policy "read configs" on ritual_configs for select using (true);

-- ----------------------------------------------------------------- storage
-- PRIVATE bucket for family media. No storage policies at all: direct
-- client access (read AND write) is denied by default. Upload flow:
-- the server validates the family, then issues a short-lived signed upload
-- URL (createSignedUploadUrl); downloads go through server-issued signed
-- URLs. Only the service role (SUPABASE_SECRET_KEY) touches the bucket.
insert into storage.buckets (id, name, public)
values ('family-media', 'family-media', false)
on conflict (id) do nothing;

drop policy if exists "anon upload to family bucket" on storage.objects;

-- ------------------------------------------------------------ family_docs
-- One validated document table for the living rooms (Kitchen, presence,
-- care circle, Village, sittings, weekly questions, Muse call log). Each
-- kind has a Zod schema in lib/kinds.ts, checked on every read and write.
create table if not exists family_docs (
  id text primary key,
  family_id text not null,
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Kinds are validated by lib/kinds.ts; the check keeps junk out of the table.
alter table family_docs drop constraint if exists family_docs_kind_check;
alter table family_docs add constraint family_docs_kind_check check (kind in ('recipe','attempt','presence','care_settings','need','helper','rota','duty','pet','sitting','knock','question','muse_call','safety_checkin','safety_settings','post','order','story','project','album','place','game','ritual_settings','window_view','today_task','lamp','chitthi','partner_token','event','event_dismiss','day_line','muse_image_run','weekly_call','nudge','nudge_settings','preview_used'));
create index if not exists family_docs_family_kind_idx on family_docs (family_id, kind, created_at desc);
alter table family_docs enable row level security;

-- ---------------------------------------------------------- public_shares
-- The only data that ever leaves a family: a frozen copy of one thing a
-- member chose to share (a recipe), behind an unguessable token. Revocable.
create table if not exists public_shares (
  token text primary key,
  family_id text not null,
  kind text not null check (kind in ('recipe')),
  ref_id text not null,
  snapshot jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  views integer not null default 0
);
create index if not exists public_shares_family_idx on public_shares (family_id, created_at desc);
alter table public_shares enable row level security;
create or replace function bump_share_views(t text) returns void language sql security definer set search_path = public as $$
  update public_shares set views = views + 1 where token = t and revoked_at is null;
$$;
-- Called by the server (service role) only; never by anonymous clients.
revoke execute on function bump_share_views(text) from public, anon, authenticated;
grant execute on function bump_share_views(text) to service_role;

-- One running total of model spend for every server instance (the USD cap).
create table if not exists spend_total (
  id smallint primary key default 1 check (id = 1),
  usd numeric not null default 0,
  updated_at timestamptz not null default now()
);
alter table spend_total enable row level security;
create or replace function add_spend(c numeric) returns numeric language sql security definer set search_path = public as $$
  insert into spend_total (id, usd) values (1, greatest(c, 0))
  on conflict (id) do update set usd = spend_total.usd + greatest(excluded.usd, 0), updated_at = now()
  returning usd;
$$;
revoke execute on function add_spend(numeric) from public, anon, authenticated;
grant execute on function add_spend(numeric) to service_role;

-- -------------------------------------------------------------------- seed
-- The demo families (demo-family, demo-iyer) are served from the app's
-- in-memory seed (lib/store.ts, lib/demo*.ts) and never read or written
-- here: lib/family-db.ts keeps them off the database. These rows are unused
-- by the app and kept only so older databases stay consistent.
insert into families (id, name) values ('demo-family', 'Sharma')
on conflict (id) do nothing;

insert into members (id, family_id, first_name, display_name, role, lang, display_lang, tz, birthday)
values
  ('dadi', 'demo-family', 'Dadi', 'Dadi', 'elder', 'hi', 'hi-deva', 'Asia/Kolkata', '01-22'),
  ('dada', 'demo-family', 'Mohan', 'Dada', 'elder', 'hi', 'hi-deva', 'Asia/Kolkata', '08-15'),
  ('arjun', 'demo-family', 'Arjun', 'Dad', 'adult', 'en', 'en', 'America/New_York', '07-30'),
  ('leo', 'demo-family', 'Leo', 'Leo', 'child', 'en', 'en', 'America/New_York', '11-09'),
  ('aria', 'demo-family', 'Aria', 'Aria', 'child', 'en', 'hi-latn', 'America/Chicago', '03-14'),
  ('priya', 'demo-family', 'Priya', 'Mom', 'adult', 'en', 'en', 'America/New_York', '05-02'),
  ('kavya', 'demo-family', 'Kavya', 'Bua', 'adult', 'hi', 'en', 'Asia/Kolkata', '09-19'),
  ('rahul', 'demo-family', 'Rahul', 'Fufa', 'adult', 'en', 'en', 'Asia/Kolkata', '12-03'),
  ('anaya', 'demo-family', 'Anaya', 'Anaya', 'child', 'en', 'en', 'Asia/Kolkata', '06-25')
on conflict (id) do nothing;

-- Demo portraits and the demo family graph (idempotent).
-- Arjun owns the demo family (only if it has no owner yet, e.g. after a handover).
update members set access = 'owner'
where id = 'arjun' and family_id = 'demo-family'
  and not exists (select 1 from members where family_id = 'demo-family' and access = 'owner');
update members set access = 'child' where id in ('aria', 'anaya') and family_id = 'demo-family';
update members set photo_ref = '/demo/portrait-dadi.webp' where id = 'dadi' and photo_ref is null;
update members set photo_ref = '/demo/portrait-dad.webp' where id = 'arjun' and photo_ref is null;
update members set photo_ref = '/demo/portrait-leo.webp' where id = 'leo' and photo_ref is null;
update members set photo_ref = '/demo/portrait-aria.webp' where id = 'aria' and photo_ref is null;
insert into relationships (id, family_id, member_id, relation_member_id, relation)
values
  ('rel-arjun-dadi', 'demo-family', 'arjun', 'dadi', 'mother'),
  ('rel-dadi-dada', 'demo-family', 'dadi', 'dada', 'husband'),
  ('rel-arjun-dada', 'demo-family', 'arjun', 'dada', 'father'),
  ('rel-leo-arjun', 'demo-family', 'leo', 'arjun', 'father'),
  ('rel-aria-arjun', 'demo-family', 'aria', 'arjun', 'father'),
  ('rel-arjun-priya', 'demo-family', 'arjun', 'priya', 'wife'),
  ('rel-arjun-kavya', 'demo-family', 'arjun', 'kavya', 'sister'),
  ('rel-kavya-rahul', 'demo-family', 'kavya', 'rahul', 'husband'),
  ('rel-kavya-anaya', 'demo-family', 'kavya', 'anaya', 'daughter'),
  ('rel-priya-leo', 'demo-family', 'priya', 'leo', 'son'),
  ('rel-priya-aria', 'demo-family', 'priya', 'aria', 'daughter')
on conflict (id) do nothing;
