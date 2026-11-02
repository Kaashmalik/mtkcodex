-- CRM v2: deals, activity timeline, WhatsApp inbox and shared rate limits.
--
-- Safe to re-run. Apply after 0001-0003 in the Supabase SQL editor.
-- Every table keeps RLS on with no policies: only the server (secret key) can touch it.

-- ---------------------------------------------------------------------------
-- Leads: deal tracking, priority and conversation state
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists source          text not null default 'scraper',
  add column if not exists starred         boolean not null default false,
  add column if not exists tags            text[] not null default '{}',
  add column if not exists deal_stage      text not null default 'none',
  add column if not exists deal_value      numeric(14, 2),
  add column if not exists deal_currency   text not null default 'PKR',
  add column if not exists last_inbound_at  timestamptz,
  add column if not exists last_outbound_at timestamptz,
  add column if not exists unread_count    integer not null default 0;

alter table public.leads drop constraint if exists leads_deal_stage_check;
alter table public.leads add constraint leads_deal_stage_check
  check (deal_stage in ('none', 'discovery', 'proposal', 'negotiation', 'in_progress', 'review', 'delivered', 'on_hold'));

create index if not exists leads_starred_idx on public.leads (starred) where starred;
create index if not exists leads_deal_stage_idx on public.leads (deal_stage) where deal_stage <> 'none';
create index if not exists leads_unread_idx on public.leads (unread_count) where unread_count > 0;
create index if not exists leads_last_inbound_idx on public.leads (last_inbound_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Activity timeline: every send, reply, status move, note and deal change
-- ---------------------------------------------------------------------------

create table if not exists public.lead_activities (
  id         bigserial primary key,
  lead_id    text not null references public.leads (id) on delete cascade,
  kind       text not null check (kind in (
               'created', 'import', 'status', 'note', 'followup', 'deal',
               'message_out', 'message_in', 'opt_out', 'edit')),
  summary    text not null default '',
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_activities_lead_idx on public.lead_activities (lead_id, created_at desc);
create index if not exists lead_activities_kind_idx on public.lead_activities (kind, created_at desc);

alter table public.lead_activities enable row level security;

-- Backfill one "message_out" per lead that was already contacted, so history
-- and the "sent per day" chart include sends made before this migration.
insert into public.lead_activities (lead_id, kind, summary, meta, created_at)
select l.id, 'message_out', 'First WhatsApp message sent (before activity log)',
       jsonb_build_object('channel', 'whatsapp', 'backfill', true),
       (coalesce(l.first_contacted, l.last_contacted)::timestamp + interval '12 hours') at time zone 'Asia/Karachi'
from public.leads l
where coalesce(l.first_contacted, l.last_contacted) is not null
  and not exists (select 1 from public.lead_activities a where a.lead_id = l.id and a.kind = 'message_out');

-- ---------------------------------------------------------------------------
-- WhatsApp Cloud API messages (two-way inbox)
-- ---------------------------------------------------------------------------

create table if not exists public.wa_messages (
  id         bigserial primary key,
  lead_id    text references public.leads (id) on delete set null,
  wa_id      text not null,               -- customer number, digits only (e.g. 923001234567)
  direction  text not null check (direction in ('in', 'out')),
  msg_type   text not null default 'text',
  body       text not null default '',
  wamid      text unique,                  -- WhatsApp message id, used to dedupe webhooks
  status     text not null default 'sent'
             check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  error      text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists wa_messages_thread_idx on public.wa_messages (wa_id, created_at desc);
create index if not exists wa_messages_lead_idx on public.wa_messages (lead_id, created_at desc);
create index if not exists wa_messages_created_idx on public.wa_messages (created_at desc);

alter table public.wa_messages enable row level security;

-- ---------------------------------------------------------------------------
-- Shared fixed-window rate limits (login, contact form). Works across
-- serverless instances, unlike an in-memory Map.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limits (
  key      text primary key,
  count    integer not null,
  reset_at timestamptz not null
);

alter table public.rate_limits enable row level security;

-- Counts one hit and returns true when the caller is over the limit.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hits integer;
begin
  insert into public.rate_limits as r (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    count    = case when r.reset_at < now() then 1 else r.count + 1 end,
    reset_at = case when r.reset_at < now() then excluded.reset_at else r.reset_at end
  returning count into hits;

  -- Opportunistic cleanup keeps the table tiny.
  if random() < 0.02 then
    delete from public.rate_limits where reset_at < now() - interval '1 day';
  end if;

  return hits > p_max;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
