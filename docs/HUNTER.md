# MTK Hunter — remote jobs & AI proposals

MTK Hunter lives in the admin at **`/admin/opportunities`** (the **Hunter** tab). It finds fresh
remote jobs and client posts, scores each one against your real projects, writes a tailored
proposal, and sends it — after your review, or automatically when you switch on auto mode and the
post passes every safety check.

```
 Job boards ──► Keyword match ──► Dedupe ──► AI score ──► AI draft ──► Review ──► Send ──► Inbox ──► Follow-up ──► Deal
 (8 sources)    (instant, free)            (DeepSeek)   (Kimi)      (you, or    (email or
                                                                      auto mode)  apply page)
```

**Contents**
1. [Setup in 15 minutes](#1-setup-in-15-minutes)
2. [AI models: which, why, cost, how to change](#2-ai-models)
3. [Using Hunter day to day](#3-using-hunter-day-to-day)
4. [Review mode vs auto mode](#4-review-mode-vs-auto-mode)
5. [Where jobs come from](#5-where-jobs-come-from)
6. [How scoring works](#6-how-scoring-works)
7. [How proposals are written](#7-how-proposals-are-written)
8. [Email, replies and follow-ups](#8-email-replies-and-follow-ups)
9. [The hourly run](#9-the-hourly-run)
10. [Settings reference](#10-settings-reference)
11. [Troubleshooting](#11-troubleshooting)
12. [Rules, limits and good practice](#12-rules-limits-and-good-practice)
13. [For developers: files and API](#13-for-developers)

---

## 1. Setup in 15 minutes

You need the CRM already running (Supabase + Resend, see [`CRM.md`](./CRM.md) → Go-live checklist).

| Step | What to do | Where |
|---|---|---|
| 1 | Run `supabase/migrations/0005_opportunities.sql` | Supabase → SQL editor |
| 2 | Create an API key | https://console.river.ai/keys (keys start with `rv_`) |
| 3 | Add the env vars below | Vercel → Project → Settings → Environment Variables (Production) |
| 4 | Redeploy | `vercel --prod --scope kaash0542-6365s-projects`, or redeploy the current deployment |
| 5 | Open **Hunter → Run now** and watch the run log | `/admin/opportunities` |
| 6 | Check **Settings** shows *MTK Hunter — AI* and *hourly run* as on | `/admin/settings` |

Minimum env vars:

```bash
LLM_API_KEY=rv_xxxxxxxxxxxxxxxx           # River key
CRON_SECRET=<openssl rand -hex 32>         # protects the hourly run
OPP_EMAIL_FROM="Muhammad Kashif <kashif@mtkcodex.tech>"   # sender, on your verified Resend domain
OPP_CONTACT_EMAIL=kaash0542@gmail.com      # shown in your signature
EMAIL_FORWARD_TO=kaash0542@gmail.com       # copy of every reply to Gmail
```

Everything else has sensible defaults (see [section 10](#10-settings-reference)).

> **Why not send from Gmail?** Resend (and any honest sending service) can only send from a domain
> you have verified. Proposals go from `@mtkcodex.tech` under your name; your Gmail is in the
> signature, and replies are copied to Gmail. This also keeps your personal Gmail's reputation safe.

---

## 2. AI models

Hunter talks to any **OpenAI-compatible** API. It is set up for **River**
(`https://api.river.ai/v1`), which serves open models, doesn't keep your requests, and doesn't
train on them.

### Two jobs, two models

| Job | Volume | What matters | Default model |
|---|---|---|---|
| **Scoring** — rate every job 0–100, say why, pick projects to cite | Hundreds a day | Cheap, fast, follows JSON | `deepseek-ai/DeepSeek-V4.1-Flash` |
| **Writing** — proposals and follow-ups | A handful a day | Writing quality, follows instructions | `moonshotai/Kimi-K3.1-Pro` |

### River models you can choose from

Prices are per 1M tokens, as listed in the River console (Nov 2026). Always check
https://console.river.ai for current prices.

| Model id | Input | Output | Good for |
|---|---|---|---|
| `deepseek-ai/DeepSeek-V4.1-Flash` | $0.12 | $0.48 | **Scoring (default).** Cheap, fast, reliable JSON |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | $0.12 | $0.48 | Pinned snapshot of the above, for stable behaviour |
| `zai-org/GLM-5.3-Flash` | $0.12 | $0.40 | Scoring alternative; **fast writer fallback** if Kimi times out |
| `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4` | $0.07 | $0.37 | Cheapest scoring option; test its JSON first |
| `Qwen/Qwen3.8-27B-FP8` | $0.10 | $2.00 | Scoring alternative (pricier output) |
| `moonshotai/Kimi-K3.1-Pro` | $2.00 | $10.00 | **Writing (default).** Best tone and instruction following |
| `GLM-5.3` | $1.12 | $3.52 | Writing at about a third of Kimi's price |
| `moonshotai/Kimi-K3` | $3.00 | $15.00 | Older and pricier than K3.1 Pro: no reason to pick it |

To see exactly which ids your key can use:

```bash
curl -s https://api.river.ai/v1/models -H "Authorization: Bearer $LLM_API_KEY"
```

### Reasoning effort (important for Kimi)

Kimi K3.1 Pro "thinks" before answering, and **defaults to `max`**, which is slow and costly for a
short email. Hunter sends `reasoning_effort` to control it:

| `LLM_REASONING` | Speed | Use when |
|---|---|---|
| `none` | Fastest | You only need clean writing |
| `low` (default) | Fast | Best balance for proposals |
| `high` | Slow | Complex, senior roles where you want deeper tailoring |
| `max` | Slowest | Not recommended: likely to hit the hosting time limit |

Scoring always uses `none`. If a model doesn't accept `reasoning_effort` or JSON mode, Hunter
retries once without them.

### What it costs

Rough numbers with the defaults:

| Work | Tokens per unit | Cost per unit | Typical day | Per day |
|---|---|---|---|---|
| Score 8 jobs (one batch) | ~5k in, ~2k out | ~$0.0015 | 500 jobs ≈ 63 batches | **~$0.10** |
| Write one proposal | ~3k in, ~1k out | ~$0.015–0.02 | 8 drafts | **~$0.15** |
| Follow-up | ~2k in, ~0.4k out | ~$0.01 | a few | ~$0.03 |

**About $5–9 a month** with the defaults. Halve it with `LLM_MODEL_WRITER=GLM-5.3`, or cut the
number of drafts per day on the Hunter page. Keyword matching, fetching and sending cost nothing.

### Changing models

1. Set the env vars and redeploy:
   ```bash
   LLM_MODEL_FAST=deepseek-ai/DeepSeek-V4.1-Flash
   LLM_MODEL_WRITER=moonshotai/Kimi-K3.1-Pro
   LLM_REASONING=low
   ```
2. On the Hunter page, write one proposal by hand and read it. The toast shows which model wrote it.
3. The footer of the Hunter page always shows the models in use.

**Recommended combos**

| Goal | `LLM_MODEL_FAST` | `LLM_MODEL_WRITER` | `LLM_REASONING` |
|---|---|---|---|
| Best quality (default) | DeepSeek-V4.1-Flash | Kimi-K3.1-Pro | `low` |
| Cheaper, still good | DeepSeek-V4.1-Flash | GLM-5.3 | — |
| Fastest (if drafts time out) | GLM-5.3-Flash | GLM-5.3-Flash | — |
| Lowest cost | Nemotron-3.5-Super | GLM-5.3-Flash | — |

### Using another provider

Any OpenAI-compatible endpoint works. Set the base URL (the part before `/chat/completions`), the
key and that provider's model ids:

```bash
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=...
LLM_MODEL_FAST=<provider's id>
LLM_MODEL_WRITER=<provider's id>
```

---

## 3. Using Hunter day to day

**Morning (5–10 minutes)**
1. Open **Hunter**. It opens on **Ready to send** when drafts are waiting.
2. Open each draft: read the **fit reason**, the **warnings**, and the **company signals** (open
   roles, roles posted in the last 2 weeks, other roles at that company).
3. Edit the message if needed. Edits save when you click away.
4. Send:
   - **Send email** when the post gave a hiring email (or you add one).
   - **Copy & open apply page** when they want an application form: the proposal is copied, the
     form opens, you paste and submit. Hunter marks it applied.
   - Or tick several drafts with emails and press **Send selected**.
5. Check **Follow-ups due** and send the short follow-ups Hunter writes for you.

**Anytime**
- **Matches**: every strong job, best first. Untick *Open to my country* to see location-locked posts too.
- **Add a job**: paste a post from Upwork, LinkedIn, a referral or anywhere else to get a score and
  a proposal. You submit it on that site yourself.
- **Skip** (✕) jobs you don't want; they never come back.
- When someone replies, it lands in the **Inbox** and the job moves to *Replies* by itself. Mark
  *Interview*, *Won* or *Lost* as things progress; good ones become Leads and Deals in the CRM.

**What the screen shows**

| Thing | Meaning |
|---|---|
| Score badge `AI 86` | AI match score (0–100) |
| Score badge `kw 54` | Keyword score only; the AI hasn't looked yet |
| Green "5 open roles · 2 new" | The company is hiring across several roles: a growth signal |
| "direct email" | The post published a hiring email, so you can email straight away |
| Amber chips | Warnings, such as "Post may exclude your country" or "Unpaid test task" |
| Grey chips | Your skills found in the post |

---

## 4. Review mode vs auto mode

Switch at the top of the Hunter page. **Pause** stops drafting and sending (fetching and scoring
continue).

| | **Review first** (default) | **Auto send** |
|---|---|---|
| Drafting | Top matches drafted automatically, up to *Drafts / day* | Same |
| Email jobs | Wait in **Ready to send** for your click | Sent automatically if they pass every check |
| Apply-link jobs | Your one click | Your one click (forms are never auto-submitted) |
| Pace | You decide | At most **one auto-send per hourly run**, up to *Auto-sends / day* |
| Alerts | Phone alert when the first draft of the day is ready | Plus an alert for every auto-send |

**A draft is only auto-sent when all of these are true.** Otherwise it waits for you:

- AI score is at least *Auto-send from score* (default 80, never below 60)
- no warnings on the job
- the post is open to your country
- the hiring email was **published in the post** (Hunter never guesses addresses)
- that email's domain can receive mail (MX check)
- nobody at that company, and not that address, was contacted in the last 30 days
- the contact isn't marked do-not-contact
- the draft passes the quality check: mentions the company, no `[placeholders]`, no "as an AI"
  phrases, 60–420 words, a sensible subject
- you are under *Auto-sends / day* and the overall daily email cap

**Numbers on the Hunter page**

| Setting | Default | Range | Meaning |
|---|---|---|---|
| Drafts / day | 8 | 0–30 | AI drafts written per day, best matches first (direct emails ahead) |
| Draft from score | 70 | 40–100 | Lowest AI score that gets an automatic draft |
| Auto-sends / day | 5 | 0–20 | Unreviewed sends per day (auto mode) |
| Auto-send from score | 80 | 60–100 | Lowest AI score that may be sent unreviewed |

**Suggested rollout:** stay in Review mode for a week. When most drafts go out unchanged, switch
to Auto with *Auto-sends / day* at 3, then raise it.

---

## 5. Where jobs come from

All free and public; no key needed.

| Board | What it adds | Notes |
|---|---|---|
| **Himalayas** | Large remote board, filtered to jobs open to `OPP_COUNTRY` | Searched with each term in `OPP_QUERIES` |
| **Remote OK** | Newest ~100 remote jobs | Sometimes refuses automated requests; shown red in board status when it does |
| **Remotive** | Curated software jobs | Feed is 24 h delayed |
| **Arbeitnow** | EU-focused; remote jobs only | |
| **Jobicy** | Remote jobs by tag (React, Next.js, Node.js, TypeScript, full stack, Python) | |
| **We Work Remotely** | Full-stack, back-end and front-end feeds (RSS) | |
| **HN "Who is hiring"** | Monthly startup thread; often a **direct hiring email** | Job-seeker posts are filtered out |
| **Watchlist** | Your dream companies' own Greenhouse / Lever / Ashby boards | `OPP_WATCHLIST=greenhouse:vercel,ashby:linear` |

Finding a company's board name: open their careers page. A URL like
`boards.greenhouse.io/vercel` → `greenhouse:vercel`; `jobs.lever.co/acme` → `lever:acme`;
`jobs.ashbyhq.com/linear` → `ashby:linear`.

**Freshness:** posts older than `OPP_MAX_AGE_DAYS` (21) are ignored. Posts that disappear from
their board for 3 days are marked expired. Anything you acted on is kept.

**Duplicates:** the same job on several boards collapses to one, keeping the copy with a direct
email.

**Not included, on purpose:** Upwork, LinkedIn and Fiverr have no public job API, and their terms
forbid bots and automated proposals (accounts get banned). Use **Add a job** for those.

---

## 6. How scoring works

1. **Keyword match** (instant, free, every job): looks for your stack (Next.js, React, TypeScript,
   Node.js, Supabase, SaaS, CRM, scraping, automation, AI…), with title hits counting double. Clear
   non-fits (sales, support, nursing…) are skipped; "US only" style posts are flagged and halved.
   Add skills with `OPP_EXTRA_SKILLS=vue,django`.
2. **AI score** (jobs with keyword score ≥ `OPP_MIN_SCORE`, 8 per call): the model reads your
   profile and projects, then returns a score, a one-line reason, warnings, and up to three
   projects to cite.

| AI score | Meaning |
|---|---|
| 90+ | Ideal: core stack, remote, open to you, clear budget |
| 70–89 | Strong: worth a proposal |
| 50–69 | Possible: read it yourself |
| < 50 | Weak |

Your profile comes from the site's own data: `src/data/site.ts` (founder bio, highlights,
certifications, links), `src/data/products.ts` (projects, stacks, live links) and
`src/data/services.ts`. **Improve those files and every score and proposal improves.**

---

## 7. How proposals are written

The writer model gets the job post, the company, the fit reason, and the 2–3 projects that match
best (with their real links). It writes:

- **Subject**: specific to the role, under 70 characters
- **Message**: opens on *their* problem, proves fit with your projects, offers a concrete first
  step, ends with an easy call to action (your booking link if `NEXT_PUBLIC_BOOKING_URL` is set)
- **Cover note**: 2–3 sentences for "why us" boxes on application forms

Options: tone (warm, direct, formal), length (short 90–140 words, medium 150–220), and *Extra
direction* ("mention I can start Monday", "focus on the scraping side").

**Safety built in**
- It can only cite your projects and facts: no invented clients, numbers or degrees.
- Any link it writes that isn't one of yours is removed.
- Your signature (name, role, contact email, site, portfolio) is added by code, not by the AI.
- Job posts are treated as untrusted text: instructions hidden in a post are ignored, except
  genuine application instructions ("mention the word X", "answer this question"), which it follows.

---

## 8. Email, replies and follow-ups

- Proposal emails go through Resend, exactly like replies from the Inbox. Each company becomes a
  **Lead** (tagged `hunter`) with its own reply address, so replies thread into the **Inbox** and
  the lead's timeline.
- When a reply arrives, the job moves to **Replies** and follow-ups stop.
- **Follow-ups:** an email proposal with no reply shows in *Follow-ups due* after 4 days, then
  6 more days later; at most two. Hunter writes them; you send them.
- **Opt-outs:** a reply of "unsubscribe" / "stop" marks the lead do-not-contact, and Hunter will
  never email them again.
- **Daily cap:** `OPP_DAILY_SEND_LIMIT` (20) proposal emails per day across manual, batch and auto
  sends. Resend's free plan allows 100 emails a day in total.

---

## 9. The hourly run

The `hunter` schedule in `vercel.json` calls `GET /api/cron/hunter-run` every hour at :07 (on
Netlify: the `netlify/functions/hunter-run.mjs` scheduled function). One invocation runs the steps
in-process until the queue empties or it reaches its 45-second budget; each step saves its progress,
so a run cut short resumes next hour:

1. **Fetch** all boards, if the last fetch was over 6 hours ago
2. **Score** up to 3 batches with the AI
3. **Draft** up to 3 proposals (until *Drafts / day*)
4. **Send** one cleared draft (auto mode only)
5. Stop when there's nothing to do

**Run now** on the Hunter page does the same thing straight away. The **Run log** lists every
step, what it did and any error. A failed step is retried next hour.

**Board status chips:** green = last fetch OK (with job count), amber = failed 1–2 times in a row,
red = failing 3+ times. One board failing never stops a run.

---

## 10. Settings reference

**Env vars** (Netlify → Environment variables; `.env.local` for local dev)

| Variable | Default | What it does |
|---|---|---|
| `LLM_API_KEY` | — | **Required for AI.** River key (`rv_…`) |
| `LLM_BASE_URL` | `https://api.river.ai/v1` | OpenAI-compatible base URL |
| `LLM_MODEL_FAST` | `deepseek-ai/DeepSeek-V4.1-Flash` | Scoring model |
| `LLM_MODEL_WRITER` | `moonshotai/Kimi-K3.1-Pro` | Proposal model |
| `LLM_REASONING` | `low` | Writer `reasoning_effort`: `none`, `low`, `high`, `max` |
| `CRON_SECRET` | — | **Required for the hourly run.** 16+ random characters |
| `OPP_EMAIL_FROM` | `EMAIL_FROM` | Sender for proposals (verified domain) |
| `OPP_CONTACT_EMAIL` | site email | Email in your signature |
| `OPP_DAILY_SEND_LIMIT` | `20` | Proposal emails per day, all kinds |
| `OPP_QUERIES` | next.js, react, full stack, typescript, node.js, saas, automation, web scraping | Himalayas search terms (max 12) |
| `OPP_COUNTRY` | `Pakistan` | Country you work from |
| `OPP_WATCHLIST` | — | `greenhouse:<board>, lever:<slug>, ashby:<board>` |
| `OPP_EXTRA_SKILLS` | — | Extra keywords for matching |
| `OPP_MAX_AGE_DAYS` | `21` | Ignore older posts |
| `OPP_MIN_SCORE` | `20` | Keyword score needed before AI scoring |
| `OPP_SCORE_BATCH` | `8` | Jobs per AI scoring call (max 15) |
| `HIMALAYAS_API_KEY` | — | Optional: higher Himalayas limits |
| `NEXT_PUBLIC_BOOKING_URL` | — | Booking link used in calls to action |
| `EMAIL_FORWARD_TO` | — | Copy of every reply to this address |

**On the Hunter page:** mode, pause, drafts per day, draft-from score, auto-sends per day,
auto-send-from score (see [section 4](#4-review-mode-vs-auto-mode)).

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "MTK Hunter unavailable" | Migration not run | Run `0005_opportunities.sql` |
| "AI is off" notice | No `LLM_API_KEY` | Add it and redeploy |
| `AI 401` in run log | Wrong or revoked key | New key at console.river.ai/keys |
| `AI 404` / model not found | Wrong model id | `curl …/v1/models` and copy the exact id |
| `AI 429` / `503` | Provider busy | Nothing to do; next run retries. Lower `OPP_SCORE_BATCH` if frequent |
| Draft fails with a timeout | Writer too slow for the host's time limit | `LLM_REASONING=none`, or `LLM_MODEL_WRITER=zai-org/GLM-5.3-Flash` |
| "AI answer had no JSON" | Model ignored the format | Retry; if repeated, switch to a default model |
| A board is red | That board is down or blocks requests | Others keep working; it recovers on its own |
| Every board fails | Network or DNS on the host | Check status.netlify.com; try **Run now** later |
| Run log empty for hours | Hourly run not set up | Check `CRON_SECRET`, and Netlify → Functions → `hunter-run` logs |
| "Daily limit reached" | `OPP_DAILY_SEND_LIMIT` hit | Wait until tomorrow (PKT) or raise it carefully |
| "cannot receive mail" | The email's domain has no mail server | Use the apply page instead |
| Nothing auto-sends | Mode is Review, paused, or no draft passes the checks | Open **Ready to send**; each draft explains why it's waiting |
| Replies not showing | Resend receiving not set up | `CRM.md` → Step 3 (MX record + webhook) |

---

## 12. Rules, limits and good practice

- **Quality beats volume.** Five specific proposals a day beat fifty generic ones, and protect your
  sender reputation. Keep the daily caps modest.
- **Only apply where it's invited.** Hunter only emails addresses that companies published for
  applications. Don't add scraped or guessed addresses.
- **Respect each board's terms.** Remote OK, Remotive and Jobicy ask for credit and a link back:
  Hunter shows the source and links every listing. Don't republish their listings publicly.
- **Every email identifies you** and is easy to decline; "unsubscribe" replies are honoured
  automatically.
- **Keep your profile honest and current.** The AI can only use what's in your site data, so keep
  projects, stacks and links up to date.
- **Watch the first week.** Read the run log and a sample of drafts before trusting auto mode.

---

## 13. For developers

**Files**

| Path | Purpose |
|---|---|
| `src/app/admin/(dashboard)/opportunities/page.tsx` | Hunter page (server) |
| `src/components/admin/OpportunityBoard.tsx` | List, tabs, review modal, batch send, add-a-job |
| `src/components/admin/HunterAutomation.tsx` | Mode switch, numbers, board status, run log |
| `src/lib/opportunity-sources.ts` | Board connectors, retries, RSS reader |
| `src/lib/opportunity-types.ts` | Types and pure helpers (text clean-up, dedupe, signals) |
| `src/lib/opportunities.ts` | Storage, fetch pipeline, scoring queue, sending |
| `src/lib/hunter-profile.ts` | Your profile from site data, keyword matcher |
| `src/lib/hunter-ai.ts` | Scoring and proposal prompts, output clean-up |
| `src/lib/hunter-automation.ts` | Settings, guard rails, quality check, step order, run log |
| `src/lib/hunter-runner.ts` | One step at a time: fetch, score, draft, send; batch send |
| `src/lib/llm.ts` | OpenAI-compatible client (River by default) |
| `src/lib/app-state.ts` | Small key/value store (`app_state`) |
| `src/app/api/cron/hunter/route.ts` | Single-step endpoint (Bearer `CRON_SECRET`) |
| `src/app/api/cron/hunter-run/route.ts` | Hourly batch used by the Vercel Schedule |
| `netlify/functions/hunter-run.mjs` | Netlify scheduled function (alternative host) |
| `supabase/migrations/0005_opportunities.sql` | `opportunities` table |

**Admin API** (session cookie; POST/PUT/PATCH also check the Origin header)

| Method & path | Does |
|---|---|
| `GET /api/admin/opportunities` | List (also marks replied ones) |
| `POST /api/admin/opportunities` | Add a job by hand |
| `PATCH /api/admin/opportunities` | Status, notes, hiring email, draft edits |
| `POST /api/admin/opportunities/refresh` | Fetch all boards now |
| `POST /api/admin/opportunities/score` | AI-score the next batch |
| `POST /api/admin/opportunities/proposal` | Draft or redraft (`kind: proposal \| followup`) |
| `POST /api/admin/opportunities/send` | Send one (`via: email \| apply_link`) |
| `POST /api/admin/opportunities/send-batch` | Send several reviewed drafts |
| `GET/PUT /api/admin/opportunities/automation` | Read or change mode and numbers |
| `POST /api/admin/opportunities/run` | Run one step (the page loops until `idle`) |

**Tests:** `npm test` covers parsing, matching, dedupe, JSON extraction, link stripping, the
auto-send guard rails, the quality check, the step order and the IP and token fixes
(`src/lib/__tests__/hunter*.test.ts`, `security.test.ts`).

**Local dev:** without Supabase, Hunter stores data in `.data/opportunities.json`. Run
`npm run dev`, sign in at `/admin`, open Hunter and press **Run now**.
