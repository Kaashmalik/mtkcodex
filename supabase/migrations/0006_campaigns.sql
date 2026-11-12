-- Campaigns: consented contact imports, SMS / WhatsApp campaigns with tracked
-- links, local-time sending windows and per-recipient delivery state.
--
-- Safe to re-run. Apply after 0001-0005 in the Supabase SQL editor.
-- RLS on with no policies: only the server (secret key) can touch these tables.

-- Consent record on every contact (who agreed, how, when, to which channels).
alter table public.leads
  add column if not exists consent_source   text not null default '',
  add column if not exists consent_at       timestamptz,
  add column if not exists consent_channels text[] not null default '{}',
  add column if not exists import_batch     text not null default '';

create index if not exists leads_import_batch_idx on public.leads (import_batch) where import_batch <> '';
create index if not exists leads_consent_idx on public.leads using gin (consent_channels);

create table if not exists public.campaigns (
  id            text primary key,
  name          text not null,
  channel       text not null check (channel in ('sms', 'whatsapp')),
  status        text not null default 'draft' check (status in ('draft', 'running', 'paused', 'done')),
  message       text not null default '',          -- SMS body with {name} {city} {link}
  wa_template   text not null default '',          -- approved WhatsApp template name
  wa_language   text not null default 'en',
  wa_params     text[] not null default '{}',      -- template params, may use {name} {city} {link}
  landing_url   text not null default '',
  audience      jsonb not null default '{}'::jsonb, -- { batch, states[], city }
  daily_limit   integer not null default 200,
  window_start  integer not null default 9,          -- recipient local hour, inclusive
  window_end    integer not null default 20,         -- recipient local hour, exclusive
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  started_at    timestamptz
);

alter table public.campaigns enable row level security;

create table if not exists public.campaign_recipients (
  campaign_id  text not null references public.campaigns (id) on delete cascade,
  lead_id      text not null references public.leads (id) on delete cascade,
  token        text not null unique,                 -- personal tracked link /go/<token>
  status       text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed', 'skipped')),
  error        text not null default '',
  external_id  text not null default '',             -- Twilio SID or WhatsApp wamid
  sent_at      timestamptz,
  delivered_at timestamptz,
  clicked_at   timestamptz,
  clicks       integer not null default 0,
  created_at   timestamptz not null default now(),
  primary key (campaign_id, lead_id)
);

create index if not exists campaign_recipients_queue_idx on public.campaign_recipients (campaign_id, status);
create index if not exists campaign_recipients_external_idx on public.campaign_recipients (external_id) where external_id <> '';
create index if not exists campaign_recipients_sent_idx on public.campaign_recipients (campaign_id, sent_at desc);

alter table public.campaign_recipients enable row level security;

drop trigger if exists campaigns_touch on public.campaigns;
create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.opportunities_touch();
