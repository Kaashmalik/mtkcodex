# Lead CRM & outreach runbook

The marketing site doubles as a lightweight lead CRM for MTK Codex outreach.
Everything lives in one Next.js app — no separate admin project, no third-party CRM subscription.

- **Dashboard:** `/admin` (pipeline table, filters, notes, follow-ups, CSV export)
- **Outreach desk:** `/admin/outreach` (one-click WhatsApp send queue)
- **Playbook:** `/admin/docs` (short in-app version of this file)
- **Login:** owner email + password from env vars

---

## 1. Access & security

| Item | Value |
|---|---|
| Login URL | `/admin/login` |
| Email | `ADMIN_EMAIL` (default `kaash0542@gmail.com`) |
| Password | `ADMIN_PASSWORD` (never committed) |
| Session | 8-hour HMAC-signed, `HttpOnly`, `SameSite=Lax`, `Secure` in production |
| Signing key | `ADMIN_SESSION_SECRET` (32+ random bytes) |
| Indexing | `/admin` is `noindex` and disallowed in `robots.txt` |

The admin API routes (`/api/admin/*`) re-check the session cookie on every request.
Login attempts are throttled in memory (8 per 10 minutes per IP) — enough to stop casual
password guessing; use Vercel WAF / Cloudflare if you need stronger protection.

To rotate the password: change `ADMIN_PASSWORD` in Vercel → Settings → Environment Variables,
redeploy, and sign in again. Existing sessions stay valid until they expire or
`ADMIN_SESSION_SECRET` is rotated (rotating it signs everyone out).

---

## 2. Environment variables

```bash
# Required for the admin login
ADMIN_EMAIL=kaash0542@gmail.com
ADMIN_PASSWORD=<strong password>
ADMIN_SESSION_SECRET=<32+ random bytes, hex or base64>

# Required to persist CRM changes on Vercel
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

Local development reads `.env.local` (gitignored). Production reads Vercel env vars.

> `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is only ever used in server code
> (`src/lib/leads.ts`), never sent to the browser.

---

## 3. Storage modes

| Mode | When | Behaviour |
|---|---|---|
| `supabase` | Both Supabase vars set | Reads/writes the `leads` table. Recommended for production. |
| `file` | No Supabase, not on Vercel | Reads/writes `.data/leads.json` (gitignored), seeded from `src/data/leads.seed.json`. |
| `readonly` | No Supabase, `VERCEL` env present | Shows the bundled seed batch. Sending works; status/notes edits are saved in the owner's browser (localStorage) so the queue survives reloads. Export the CSV to keep a copy. |

The dashboard shows a banner explaining which mode is active.

> Browser-only progress is per browser and per device. Clearing site data resets it, and it is not visible to `/api/admin/leads/export` (use the in-page **Export CSV** button, which serialises what the table shows). Connect Supabase before relying on the CRM for real pipeline reporting.

### Supabase setup (5 minutes)

1. Create a project at [supabase.com](https://supabase.com) (free tier is enough).
2. SQL Editor → paste and run [`supabase/migrations/0001_leads.sql`](../supabase/migrations/0001_leads.sql).
3. Project Settings → API → copy **Project URL** and **service_role** key.
4. Add both to Vercel env vars (and `.env.local` for local testing), then redeploy.
5. Open `/admin` and click **Import batch** once to load the current seed leads.
6. Confirm the footer says “Synced to Supabase.”

RLS is enabled with no policies, so the anon/public key cannot read the table.

### Current production setup

| Item | Value |
|---|---|
| Supabase project | `ldfqabpupduhzdycogdn` (`https://ldfqabpupduhzdycogdn.supabase.co`) |
| App key | Project **secret** key (`sb_secret_…`), set in Vercel for production, preview and development |
| Table | `public.leads` (migration `0001_leads.sql` applied) |
| Seeded | 15 leads from the 2026-11-02 batch (13 queued, 2 contacted) |

Notes for future work:

- Use the project **secret** key (or a legacy `service_role` JWT) as `SUPABASE_SERVICE_ROLE_KEY`.
  The publishable/`anon` key is for browsers and is blocked by RLS; a Supabase **personal access
  token** (`sbp_…`) only works against the Management API and is not a database key.
- Supabase's newer `sb_secret_…` keys are not JWTs, so send them in both `apikey` and
  `Authorization: Bearer` headers (the storage adapter already does this).
- Values added through the Vercel CLI or dashboard can arrive with a trailing space/newline.
  `src/lib/leads.ts` and `src/lib/admin-auth.ts` trim them; keep that behaviour when editing.
- Rotate the secret key in Supabase → Project Settings → API keys, then update the Vercel env var
  and redeploy. Revoke any personal access token used for one-off setup once it is no longer needed.

### Google Sheet (warehouse mirror)

The scraper project (`C:\Users\DELL\leads\lahore_leads`) owns a Google Sheet warehouse; the CRM is
the working pipeline. Both admin pages link to it with the **Google Sheet** / **Warehouse sheet** button.

| Item | Value |
|---|---|
| Spreadsheet | [`1DFO45PtJIEDnGX-xyCbzp1FTGXDVVok3Klu74ANIdJM`](https://docs.google.com/spreadsheets/d/1DFO45PtJIEDnGX-xyCbzp1FTGXDVVok3Klu74ANIdJM/edit#gid=312869384) |
| Tab | `Leads` (~6,200 rows, full enrichment columns) |
| Credentials | Service account JSON in the scraper repo (`credentials/`), shared with the sheet — never committed here |
| Upstream sync | `scripts/sync_outreach_state.py --apply` in the scraper repo mirrors sends into `status`, `last_contacted`, `next_followup`, `notes` |

After a sending session, bring the day's sends into the CRM:

```bash
# Dry run: shows what would change
node scripts/import-sent-log.mjs "C:\Users\DELL\leads\lahore_leads\output\sent_2026-11-02.csv"

# Write to Supabase
node scripts/import-sent-log.mjs "C:\Users\DELL\leads\lahore_leads\output\sent_2026-11-02.csv" --apply
```

The importer reads `.env.local`, matches by `lead_id` then phone number, marks leads `contacted`,
stamps `last_contacted`, sets `next_followup` three days out, appends
`WhatsApp sent YYYY-MM-DD (1 touch)` and creates any missing lead with a generated opener.
It is idempotent, so re-running the same file is safe. Options: `--date=YYYY-MM-DD`,
`--followup-days=N`.

---

## 4. Data model

Table: `public.leads` (one row per business)

| Column | Purpose |
|---|---|
| `id` | Stable lead id from the scraper (`gm:…`, `bl:…`) |
| `name`, `business_type`, `area` | Identity and segmentation |
| `phone`, `email`, `website` | Contact channels |
| `lead_score`, `lead_tier`, `scenario` | Priority and pitch angle from scraping |
| `rating`, `reviews`, `google_maps_url` | Social proof / Maps link |
| `recommended_pitch` | Scraper's suggested offer |
| `message` | The exact WhatsApp opener (editable) |
| `status` | Pipeline stage (see below) |
| `channel` | `whatsapp` (default), `call`, `email` |
| `notes` | Contact person, replies, next step |
| `last_contacted` | Date of last outbound message |
| `next_followup` | Date the next touch is due |
| `do_not_contact` | Hard opt-out — hides the lead from outreach |
| `created_at`, `updated_at` | Audit timestamps |

### Status lifecycle

```
new → queued → contacted → replied → interested → won
                    ↘ lost
queued/contacted → skipped (not on WhatsApp)
```

- `new` — imported, not reviewed
- `queued` — approved for outreach (appears in the send queue)
- `contacted` — first message sent (auto-stamps `last_contacted`)
- `replied` — they answered
- `interested` — qualified, wants a call/quote/demo
- `won` / `lost` — closed
- `skipped` — number not on WhatsApp or otherwise unreachable

Marking `do_not_contact` hides the lead from the outreach queue regardless of status.

---

## 5. Daily workflow

1. Open `/admin/outreach`. Work top-down (highest lead score first).
2. **Open chat** → WhatsApp opens with the message pre-filled.
3. **Copy message** → paste in WhatsApp → send.
4. **Mark sent** → status becomes `contacted`, date stamped.
5. Open the lead in `/admin` → set **Next follow-up** to 2–3 days out → **Save changes**.
6. If the number is invalid: **Not on WhatsApp** (records the reason and stops retries).
7. Any opt-out (“stop”, “not interested”): tick **Do not contact** first, then mark `lost`.

Safe volume: keep new cold conversations under ~15–20 per day per number and space them
through the day. Automated bulk sends violate WhatsApp's terms and can get the business
number banned — this app intentionally stays click-to-send.

---

## 6. Adding the next batch

1. Scrape/export the batch as CSV (same columns as `today_batch_check.csv`).
2. Copy the selected rows into `src/data/leads.seed.json` (see the existing structure), one
   object per lead with generated `message`, `status: "queued"`, timestamps.
3. Commit the seed file. On a fresh environment the dashboard shows it automatically.
4. With Supabase connected: `/admin` → **Import batch** (adds seed leads that are not already in the
   CRM; existing rows keep their live status, notes and dates).
5. Record the batch in `docs/outreach/YYYY-MM-DD-<area>.md`.

Tip: keep the seed file to the current batch (10–25 rows). The full scraped database stays in
`C:\Users\DELL\leads\lahore_leads\output\` and should not be committed to the public repo.

---

## 7. Website analytics

`/admin/analytics` (and the strip on `/admin`) shows live traffic, daily visits and
first-message outreach in one place. It is **first-party and cookieless** — no GA4 property
and no third-party reporting credentials needed.

| Metric | Definition |
|---|---|
| Live now | Distinct visitors with a page view or heartbeat in the last 5 minutes |
| Last 24 hours | Distinct visitors and page views in the trailing 24 hours |
| Today / Yesterday | Distinct visitors since midnight Asia/Karachi |
| Last 7 / 30 days | Distinct visitors in the trailing window |
| First messages today | Leads whose `first_contacted` date is today (PKT) |

How it works:

- `src/components/analytics/AnalyticsBeacon.tsx` sends one `POST /api/track` per navigation,
  then a heartbeat every 60s while the tab is visible. Localhost is skipped unless
  `NEXT_PUBLIC_ANALYTICS_DEBUG=1` at build time.
- `src/app/api/track/route.ts` drops bots (including headless browsers), `/admin`, `/api`,
  rate-limits by IP and always answers `204` so measurement can never break a page.
- The visitor id is `HMAC-SHA256(day, IP, user-agent, ADMIN_SESSION_SECRET)` truncated to
  24 hex chars. It is pseudonymous, cannot be reversed and rotates daily — no cookies, no
  localStorage, no fingerprint storage.
- Rows live in `public.page_views` (`kind = 'view' | 'ping'`). Only `view` rows count as page
  views; pings just keep "live now" honest. The admin reads everything through the
  `analytics_summary()` SQL function (single round trip).
- `first_contacted` on `leads` is stamped once by a trigger the first time a lead is
  contacted, so follow-ups do not inflate the "first messages" number.

Setup / operations:

1. Apply `supabase/migrations/0002_analytics.sql` and `0003_first_contacted.sql`.
2. Keep `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set (already required for the CRM).
3. Retention: run `select public.analytics_prune(180);` monthly (or schedule it with
   `pg_cron`). It refuses to delete anything newer than 7 days.
4. To pause measurement, remove the beacon import in `src/app/(site)/layout.tsx` and redeploy;
   the dashboard then shows zeros rather than breaking.

Privacy: the beacon honours an explicit "analytics off" choice in the cookie banner, Do Not
Track and Global Privacy Control. `/privacy` and `/cookies` describe the cookieless
measurement. Nothing in `page_views` identifies a person, and no data is sent to third parties.

---

## 8. Backup & reporting

- **Export CSV** (`/api/admin/leads/export`) downloads every column for the current workspace.
- Supabase → Database → Backups covers point-in-time recovery on paid plans; for the free
  tier, export a CSV after each batch.
- The CSV uses the same column names as the scraper (`phone_e164`, `lead_score`, `status`,
  `notes`, …) so it can be merged back into `mtkcodex_leads.csv`.

---

## 9. File map

| Path | Purpose |
|---|---|
| `src/app/admin/(dashboard)/` | Protected admin pages |
| `src/app/admin/login/` | Public login screen |
| `src/app/api/admin/*` | Session-guarded admin API |
| `src/lib/admin-auth.ts` | Session signing, password check, throttling |
| `src/lib/leads.ts` | Storage adapter (Supabase / file / read-only) |
| `src/lib/lead-types.ts` | Shared types, stats, CSV, WhatsApp links |
| `src/components/admin/` | Dashboard, outreach queue, login form |
| `src/lib/crm-links.ts` | Google Sheet warehouse link used by both admin pages |
| `src/lib/analytics.ts` | Page-view insert, visitor hash, bot/device/referrer helpers |
| `src/lib/analytics-types.ts` | Shared analytics types (safe for client components) |
| `src/app/api/track/route.ts` | Public cookieless beacon (bot filter, rate limit, always 204) |
| `src/app/api/admin/analytics/route.ts` | Session-guarded analytics summary API |
| `src/app/admin/(dashboard)/analytics/page.tsx` | Traffic + outreach reporting page |
| `src/components/admin/AnalyticsDashboard.tsx` | Charts, sources, devices, recent visits |
| `src/components/admin/LiveTraffic.tsx` | Live KPI strip (20s refresh) |
| `src/components/analytics/AnalyticsBeacon.tsx` | Client beacon (view + heartbeat) |
| `supabase/migrations/0002_analytics.sql` | `page_views`, `analytics_summary()`, `analytics_prune()` |
| `supabase/migrations/0003_first_contacted.sql` | `first_contacted` column + trigger |
| `scripts/import-sent-log.mjs` | Reconciles a WhatsApp sent CSV into the CRM (idempotent) |
| `src/data/leads.seed.json` | Current outreach batch (committed) |
| `supabase/migrations/0001_leads.sql` | Table, indexes, trigger, RLS |

---

## 10. Compliance notes

- Message only businesses where you have a legitimate reason to reach out; include a clear
  opt-out in every first message.
- Honour every STOP/opt-out immediately and record it in `do_not_contact`.
- Do not scrape or message personal numbers at scale, and do not use unofficial WhatsApp
  automation libraries against your business number.
- WhatsApp Business API (Cloud API) is the compliant route if you later need true automation;
  it requires a Meta Business account and pre-approved templates.
