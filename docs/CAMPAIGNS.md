# Campaigns — SMS & WhatsApp to consented contacts

Campaigns lives in the admin at **`/admin/campaigns`**. Import your consented contacts (JSON or
CSV), write a short message about your services with a personal link to your site, and let the
sender deliver it in small batches during each contact's local daytime. Clicks, replies and
opt-outs flow back into the CRM.

```
 JSON / CSV ──► Import + consent record ──► Campaign (SMS or WhatsApp) ──► Sends every 15 min, 9am–8pm local
                                                                            │
                     Leads & Deals ◄── Replies (Inbox / alerts) ◄── Clicks on /go/<token> ◄─┘   STOP → never again
```

**Contents**
1. [Before you start: consent](#1-before-you-start-consent)
2. [Setup](#2-setup)
3. [Importing contacts](#3-importing-contacts)
4. [Creating a campaign](#4-creating-a-campaign)
5. [How sending works](#5-how-sending-works)
6. [Links, clicks, replies and opt-outs](#6-links-clicks-replies-and-opt-outs)
7. [Pakistan vs international leads](#7-pakistan-vs-international-leads)
8. [Costs, free credits and the recommended plan](#8-costs)
9. [Troubleshooting](#9-troubleshooting)
10. [Compliance checklist](#10-compliance-checklist)
11. [For developers](#11-for-developers)

---

## 1. Before you start: consent

US law (the TCPA) requires **prior express written consent** before sending marketing texts or
WhatsApp messages to someone's phone. That means each person actively agreed, for example by
ticking an "I agree to receive texts from MTK Codex" box on a form, and you can show it. Fines run
$500–$1,500 per message, and carriers and Meta block senders who message people who didn't opt in.

So Campaigns:
- asks **where and how** each import's contacts agreed, the date, and the channels (SMS,
  WhatsApp), and stores it on every contact;
- only messages contacts who consented **to that channel** and haven't opted out;
- names you as the sender and adds "Reply STOP to opt out" to every SMS.

**Only import people who opted in.** Bought, scraped or "found" number lists don't have consent,
and no setting makes them legal to text.

---

## 2. Setup

| Step | What to do |
|---|---|
| 1 | Run `supabase/migrations/0006_campaigns.sql` in the Supabase SQL editor (after 0001–0005) |
| 2 | Set `CRON_SECRET` if you haven't (shared with MTK Hunter). Netlify runs `netlify/functions/campaigns-run.mjs` every 15 minutes |
| 3 | **For SMS:** set up Twilio (below) |
| 4 | **For WhatsApp:** connect the WhatsApp Cloud API ([`CRM.md`](./CRM.md) → Step 6) and get a marketing template approved |
| 5 | Redeploy, then check **Settings** shows *SMS campaigns (Twilio)* as on |

### Twilio (SMS)

1. Create a Twilio account and buy a US local number (or a toll-free number).
2. **Register for A2P 10DLC** (Messaging → Regulatory Compliance): a Brand (your business) and a
   Campaign with use case *Marketing*. Describe how people opt in, and paste a sample message.
   Unregistered US traffic is blocked by carriers. Approval usually takes a few days. A
   toll-free number needs *toll-free verification* instead.
3. Create a **Messaging Service**, add your number to it, and set its incoming-message webhook to
   `https://mtkcodex.tech/api/sms/webhook` (HTTP POST). Keep Twilio's Advanced Opt-Out on.
4. Add the env vars:
   ```bash
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_MESSAGING_SERVICE_SID=MG...     # or TWILIO_FROM=+1XXXXXXXXXX
   ```

### WhatsApp

Business-initiated WhatsApp messages must use a **template approved by Meta** (category
*Marketing*). In WhatsApp Manager create one such as:

> Hi {{1}}, thanks for signing up with MTK Codex. We build websites, CRMs and automations that bring
> businesses more customers. See our work: {{2}}

In the campaign, set the template name and the variables in order (`{name}`, then `{link}`).

---

## 3. Importing contacts

**Campaigns → Import contacts**, then:

1. **Choose the file.** These all work:
   - a JSON array: `[{"phone": "...", "city": "..."}]`
   - nested objects: `{"contact": {"phone": "..."}, "address": {"state": "TX"}}`
   - wrapped lists: `{"customers": [...]}` (also `data`, `contacts`, `clients`, `results`…)
   - JSON Lines (one object per line), or CSV / TSV
2. **Match the fields.** Phone is required; name, first/last name, company, email, city, state,
   ZIP and tags are optional. Common names are matched automatically.
3. **Check the preview**: how many rows have a valid US number, and a sample of how they'll look.
   Numbers are cleaned to `+1XXXXXXXXXX`; anything that isn't a valid US number is skipped.
4. **Fill in the consent record:**
   - *Batch name*, e.g. `texas-webinar-2026` (used to target campaigns)
   - *Where and how did they agree?* Be specific: the form or page, the checkbox wording, and when
   - *Consent date* (optional; defaults to today)
   - *Agreed to SMS / WhatsApp*
   - Tick the confirmation
5. **Import.** Big files go up in chunks of 1,000. 3,000 contacts take a few seconds.

**Future imports:** import new files the same way. Existing contacts (same phone) are updated:
their consent record is refreshed and missing city/state is filled in, without duplicates. New
contacts matching a **running** campaign's audience join it automatically.

Contacts are stored as **Leads** (tagged `campaign` and the batch name), so they appear on the Leads
page with their timeline, and WhatsApp replies thread into the Inbox. Contacts without a name show
as "Contact (512) 555-0123 · Austin, TX" and are greeted as "there".

---

## 4. Creating a campaign

**Campaigns → New campaign**

| Field | Notes |
|---|---|
| Name | For you, e.g. "Austin businesses — website offer" |
| Channel | SMS (Twilio) or WhatsApp template |
| Message (SMS) | Use `{name}`, `{city}`, `{link}`. `{link}` is required. "MTK Codex:" and "Reply STOP to opt out." are added if missing |
| Template + variables (WhatsApp) | Approved template name, language (`en`, `en_US`), one variable per line |
| Landing page | Where `{link}` goes, e.g. `https://mtkcodex.tech/services` or a special offer page |
| Batch / States / City | Who gets it. Empty = all consented contacts for that channel |
| Per day | Max messages per day (US Eastern day) |
| From / Until | Local hours, between 8:00 and 21:00. Default 9–20 |

The **preview** shows the exact message for a sample contact, its length, and the number of SMS
segments (you're billed per segment; emoji make segments shorter). Keep it to one or two segments.

**Writing tips**
- Lead with what they get, not who you are: "Free website audit for {city} businesses".
- One clear call to action and one link.
- Plain words, no ALL CAPS, no "act now!!!", no link shorteners (carriers filter them; your
  `/go/` link is on your own domain, which is better).

Press **Start** on the campaign card. You'll be asked to confirm the audience size, daily limit and
hours. **Pause** stops it at once; **Resume** continues where it left off. You can edit while paused.

---

## 5. How sending works

Every 15 minutes the sender:
1. adds any new matching contacts to each running campaign;
2. goes through the queue and, for each contact:
   - **skips** them for good if they opted out or lost consent for this channel;
   - **waits** if it's outside their local sending hours (time zone from their state; if the state is
     unknown, it only sends when it's daytime in every mainland zone);
   - otherwise **sends**, records it on their timeline and marks the lead *contacted*;
3. **paces itself**: each run sends at most about 1.5 × (daily limit ÷ number of 15-minute runs in
   the sending hours), so 200/day over 9:00–20:00 goes out ~7 every 15 minutes, never in one burst;
   it also stops at the daily limit, or after ~18 seconds, and continues next run;
4. pauses a campaign's run after 5 failures in a row with no success (a provider problem), and
   marks a campaign **done** when everyone has been messaged.

**Send next batch now** runs the same pass immediately.

At the default 200/day, 3,000 contacts take 15 days. Raise *Per day* gradually: new 10DLC numbers
have carrier throughput limits, and sudden spikes look like spam.

---

## 6. Links, clicks, replies and opt-outs

- **Links:** each contact gets a personal link like `https://mtkcodex.tech/go/k3J9aB2xQp`. Opening it
  records the click (shown as *Clicked* and on their timeline), then redirects to your landing
  page with `utm_source`, `utm_campaign` and `ref` tags, so the **Analytics** page shows the visit.
- **WhatsApp replies** arrive in the **Inbox** like any WhatsApp conversation, with the template
  you sent shown in the thread.
- **SMS replies** mark the lead *Replied*, appear on their timeline, and send you a phone alert.
  Reply to them from your Twilio number or phone. (SMS isn't a two-way Inbox channel yet.)
- **STOP** (or UNSUBSCRIBE, CANCEL, END, QUIT) on SMS, or STOP on WhatsApp, marks the contact
  **do-not-contact** everywhere in the CRM. Twilio also blocks further texts to that number.
- **Delivery:** Twilio delivery receipts update *Delivered* / *Failed* per contact.

Good replies become Leads you work in the CRM: set them *Interested*, start a Deal.

### Best time to send (from Pakistan)

The **Best time to send** card on the Campaigns page (and on the Leads page when *International*
is selected) works out, from your contacts' time zones:

- the **one Pakistan-time window** that lands in prime reading hours for the most contacts, e.g.
  *"Send 9 PM–10 PM PKT on Tue–Thu to reach 100% of 3,000 contacts"*;
- **right now**, what share of them are in prime time;
- for each time zone: their local time now (prime / awake / night) and their prime hours
  converted to PKT.

Prime hours are **10 AM–12 PM and 2–5 PM recipient time, Tue–Thu** (avoid Monday mornings, Friday
afternoons and weekends). Daylight saving is handled automatically. In winter, 10 AM in New York
is 8 PM in Pakistan; in summer it's 7 PM.

US quick reference (winter / summer, in PKT):

| US zone | 10 AM–12 PM their time | 2–5 PM their time |
|---|---|---|
| Eastern (New York, Florida) | 8–10 PM / 7–9 PM | 12–3 AM / 11 PM–2 AM |
| Central (Texas, Chicago) | 9–11 PM / 8–10 PM | 1–4 AM / 12–3 AM |
| Mountain (Denver) | 10 PM–12 AM / 9–11 PM | 2–5 AM / 1–4 AM |
| Pacific (California) | 11 PM–1 AM / 10 PM–12 AM | 3–6 AM / 2–5 AM |

You don't have to stay up: set a campaign's sending hours to **10–17** and the sender only
releases batches during each contact's prime time, while you sleep in Lahore.

---

## 7. Pakistan vs international leads

The **Leads** page has a **Pakistan / International** switch above the filters, with a country
picker when *International* is selected. A lead's country comes from its saved location, or from
its phone prefix (+1 US, +44 UK, +971 UAE, +966 Saudi Arabia…). Leads with no known country count as
Pakistan. Each lead row shows its country flag.

---

## 8. Costs

Approximate; check current pricing with Twilio and Meta.

| Item | Approx. cost |
|---|---|
| Twilio US SMS | ~$0.008 per segment, plus US carrier fees of ~$0.003–0.005 per message |
| Twilio number | ~$1–2 a month |
| A2P 10DLC registration | One-off brand and campaign vetting fees, plus a small monthly campaign fee |
| WhatsApp marketing template (US) | ~$0.025 per message (billed by Meta) |
| Netlify, Supabase, tracking | Free tier |

Example: 3,000 one-segment SMS ≈ $35–40 in messaging fees.

### Free credits and the cheapest way to send

There is **no legitimate way to send marketing SMS to US numbers for free every day**. Every route
goes through a carrier, and US carriers bill per message. What you *can* get free or cheap:

| Option | What you get | Good for |
|---|---|---|
| **GitHub Student Developer Pack → Twilio** | Twilio is a pack partner; in 2022 the offer was **up to $100 Twilio credit** for new accounts. Check the current amount at [education.github.com/pack/offers](https://education.github.com/pack/offers) and sign up **through the pack link** before making a normal Twilio account | **Best option.** $100 ≈ 7,000–8,000 one-segment US SMS: 3,000 contacts about twice. 10DLC registration fees are generally charged to your Twilio balance; confirm in the Twilio Console |
| **Twilio free trial** | ~$15 credit, but texts only go to up to 5 numbers you verify yourself, and every message starts with "Sent from a Twilio trial account" | Testing the whole setup on your own phone, not real campaigns |
| **WhatsApp Cloud API** | Marketing templates are **always paid** (~$0.025 per message to the US); no free daily allowance for them. Replies within 24 hours to a customer who messaged you first have historically been free; check Meta's current rate card | Cheap follow-ups once people write to you |
| **"Message us" buttons** | Free. Put a WhatsApp chat link and a "Text us" link on your landing page (and in Hunter proposals) so interested people start the conversation | Turning link clicks into free conversations |
| **Email** | Resend free plan: 100 a day, 3,000 a month | Contacts with emails (future imports that include them) |

**Avoid** "free SMS gateway" websites, phone-SIM bulk-SMS apps and email-to-text tricks. US
carriers block that traffic, it breaks their terms, and numbers get banned fast.

### Recommended plan

1. **Claim the GitHub Student Pack Twilio offer** (new Twilio account through the pack link).
2. **Register A2P 10DLC** in Twilio (brand + *Marketing* campaign). Allow a few days for approval.
3. **Test on the free trial / your own phone first**: send a campaign to a one-contact batch, check
   the link click, a reply, and STOP.
4. **Send to your 3,000 contacts at 100–200 a day** with sending hours **10–17** (prime reading
   time; see *Best time to send*). The sender paces itself, about 4–7 messages every 15 minutes.
5. **Use WhatsApp only for contacts who replied or opted in to WhatsApp**, and answer replies
   within 24 hours.
6. **Watch the numbers** on each campaign card (delivered, clicked, replied, opted out). If opt-outs
   go above ~2% or replies are rare, pause, rewrite the message, and try a smaller batch.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Campaigns unavailable" | Migration not run | Run `0006_campaigns.sql` |
| Import says 0 valid numbers | Wrong column mapped, or non-US numbers | Pick the phone column; only US numbers (+1) are accepted |
| "Connect Twilio before starting" | Twilio env vars missing | Add them and redeploy |
| Many *Failed* with error 30034 | Number not registered for A2P 10DLC | Finish 10DLC registration in Twilio |
| *Failed* 21610 | That person replied STOP earlier | Nothing to do: they're marked do-not-contact |
| *Failed* 21614 / 30006 | Landline or unreachable number | Nothing to do |
| Queued but nothing sends | Outside local hours, daily limit reached, or campaign paused | Wait for the window, or check the campaign card |
| Nothing sends for hours | 15-minute job not running | Check `CRON_SECRET`, and Netlify → Functions → `campaigns-run` logs |
| WhatsApp sends fail | Template not approved, wrong name or language, or wrong number of variables | Match the template exactly as approved in WhatsApp Manager |
| SMS replies not recorded | Webhook not set | Set the Messaging Service incoming webhook to `/api/sms/webhook` |

---

## 10. Compliance checklist

- [ ] Every imported contact opted in to marketing messages from MTK Codex, on that channel, and you
      kept the evidence (form, checkbox wording, date, IP or submission record)
- [ ] The consent source you typed at import describes that evidence accurately
- [ ] Twilio A2P 10DLC brand and campaign approved (or toll-free verified)
- [ ] Messages name MTK Codex and include STOP instructions (added automatically for SMS)
- [ ] Sending hours stay within 9:00–20:00 local (some states, such as Florida, Oklahoma and
      Washington, restrict texts to 8:00–20:00 and limit frequency)
- [ ] No more than a few messages per person per month; respect replies asking for less
- [ ] Opt-outs honoured immediately (automatic) and never re-imported as consented
- [ ] Your website has a privacy policy explaining how you use phone numbers

---

## 11. For developers

| Path | Purpose |
|---|---|
| `src/app/admin/(dashboard)/campaigns/page.tsx` | Campaigns page (server) |
| `src/components/admin/CampaignsBoard.tsx` | Campaign list, import dialog, editor with preview |
| `src/lib/contact-import.ts` | JSON/CSV parsing, field mapping, consent validation |
| `src/lib/us-contacts.ts` | US phone normalisation, state → time zone, sending windows |
| `src/lib/campaign-message.ts` | Message rendering (`{name}`, `{city}`, `{link}`), SMS segments |
| `src/lib/campaigns.ts` | Storage, audience, queue, sender, clicks, delivery and replies |
| `src/lib/sms.ts` | Twilio send, webhook signature check, STOP words |
| `src/app/go/[token]/route.ts` | Tracked link redirect |
| `src/app/api/sms/webhook/route.ts` | Twilio inbound + status webhook |
| `src/app/api/cron/campaigns/route.ts` | 15-minute sender (Bearer `CRON_SECRET`) |
| `netlify/functions/campaigns-run.mjs` | Netlify scheduled function |
| `supabase/migrations/0006_campaigns.sql` | Consent columns on `leads`, `campaigns`, `campaign_recipients` |

**Admin API:** `GET/POST/PATCH /api/admin/campaigns` (list with stats, create, edit or
start/pause), `POST /api/admin/campaigns/import` (≤1,000 rows per call, with mapping and consent),
`POST /api/admin/campaigns/run` (send the next batch now).

**Tests:** `src/lib/__tests__/campaigns.test.ts` covers phone and state parsing, sending
windows, file parsing, consent validation, message rendering, segments, STOP words, audience
rules, stats, the Eastern-time daily reset, the Twilio signature check and the
Pakistan/international split.
