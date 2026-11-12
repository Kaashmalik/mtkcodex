-- MTK Hunter: remote jobs and client opportunities found across job boards,
-- scored against the MTK Codex skills profile, with an AI-drafted proposal
-- that is reviewed and sent from the admin.
--
-- Safe to re-run. Apply after 0001-0004 in the Supabase SQL editor.
-- RLS on with no policies: only the server (secret key) can touch it.

create table if not exists public.opportunities (
  id               text primary key,               -- "<source>:<external id>"
  source           text not null,
  external_id      text not null default '',
  dedupe_key       text not null default '',       -- company + title, catches cross-posts
  title            text not null,
  company          text not null default '',
  company_slug     text not null default '',
  company_domain   text not null default '',
  company_logo     text not null default '',
  url              text not null default '',       -- the listing
  apply_url        text not null default '',       -- where to apply, when different
  apply_email      text not null default '',       -- direct hiring email, when posted
  location         text not null default '',
  location_ok      boolean not null default true,  -- false when the post excludes Pakistan
  remote           boolean not null default true,
  employment_type  text not null default '',
  salary           text not null default '',
  tags             text[] not null default '{}',
  description      text not null default '',
  posted_at        timestamptz,
  fetched_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  status           text not null default 'new' check (status in (
                     'new', 'shortlisted', 'drafted', 'sent', 'replied', 'interview', 'won', 'lost', 'skipped', 'expired')),
  keyword_score    integer not null default 0,
  matched_skills   text[] not null default '{}',
  score            integer,                        -- AI match 0-100, null until scored
  score_reason     text not null default '',
  red_flags        text[] not null default '{}',
  matched_projects text[] not null default '{}',   -- product slugs to cite
  proposal         jsonb,                          -- { kind, subject, body, cover, model, created_at }
  sent_at          timestamptz,
  sent_via         text not null default '' check (sent_via in ('', 'email', 'apply_link')),
  sent_to          text not null default '',
  followups        integer not null default 0,
  followup_at      timestamptz,
  lead_id          text references public.leads (id) on delete set null,
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists opportunities_status_idx on public.opportunities (status, posted_at desc nulls last);
create index if not exists opportunities_score_idx on public.opportunities (score desc nulls last) where status not in ('expired', 'skipped');
create index if not exists opportunities_unscored_idx on public.opportunities (keyword_score desc) where score is null and status = 'new';
create index if not exists opportunities_company_idx on public.opportunities (company_slug);
create index if not exists opportunities_dedupe_idx on public.opportunities (dedupe_key);
create index if not exists opportunities_followup_idx on public.opportunities (followup_at) where followup_at is not null;
create index if not exists opportunities_sent_idx on public.opportunities (sent_at desc) where sent_at is not null;

alter table public.opportunities enable row level security;

create or replace function public.opportunities_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists opportunities_touch on public.opportunities;
create trigger opportunities_touch before update on public.opportunities
  for each row execute function public.opportunities_touch();
