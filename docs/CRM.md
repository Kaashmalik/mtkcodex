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
4. With Supabase connected: `/admin` → **Import batch** (upsert by `id`, safe to repeat).
5. Record the batch in `docs/outreach/YYYY-MM-DD-<area>.md`.

Tip: keep the seed file to the current batch (10–25 rows). The full scraped database stays in
`C:\Users\DELL\leads\lahore_leads\output\` and should not be committed to the public repo.

---

## 7. Backup & reporting

- **Export CSV** (`/api/admin/leads/export`) downloads every column for the current workspace.
- Supabase → Database → Backups covers point-in-time recovery on paid plans; for the free
  tier, export a CSV after each batch.
- The CSV uses the same column names as the scraper (`phone_e164`, `lead_score`, `status`,
  `notes`, …) so it can be merged back into `mtkcodex_leads.csv`.

---

## 8. File map

| Path | Purpose |
|---|---|
| `src/app/admin/(dashboard)/` | Protected admin pages |
| `src/app/admin/login/` | Public login screen |
| `src/app/api/admin/*` | Session-guarded admin API |
| `src/lib/admin-auth.ts` | Session signing, password check, throttling |
| `src/lib/leads.ts` | Storage adapter (Supabase / file / read-only) |
| `src/lib/lead-types.ts` | Shared types, stats, CSV, WhatsApp links |
| `src/components/admin/` | Dashboard, outreach queue, login form |
| `src/data/leads.seed.json` | Current outreach batch (committed) |
| `supabase/migrations/0001_leads.sql` | Table, indexes, trigger, RLS |

---

## 9. Compliance notes

- Message only businesses where you have a legitimate reason to reach out; include a clear
  opt-out in every first message.
- Honour every STOP/opt-out immediately and record it in `do_not_contact`.
- Do not scrape or message personal numbers at scale, and do not use unofficial WhatsApp
  automation libraries against your business number.
- WhatsApp Business API (Cloud API) is the compliant route if you later need true automation;
  it requires a Meta Business account and pre-approved templates.
