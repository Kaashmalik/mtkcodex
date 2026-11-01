# MTK Codex — Company Website

> **Code That Scales Your Business.**

The company website for MTK Codex: SaaS products, software development, maintenance, audits and automation. Founded by **Muhammad Kashif** (CEO & Full-Stack SaaS Architect).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · lucide-react

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
```

## Pages

| Route | Content |
| --- | --- |
| `/` | Hero, product strip, stats, product suite, interactive demos, services, automation, industries, process, reviews, founder, pricing, FAQ |
| `/products`, `/products/[slug]` | All 7 platforms with coded UI demos, metrics, features, stack |
| `/services` | 8 service lines with deliverables |
| `/customers` | Client reviews |
| `/pricing` | Engagement models + FAQ |
| `/about` | Values, founder, timeline |
| `/contact` | Lead form (pre-filled from `?intent=`, `?service=`, `?product=`), WhatsApp, email |

## Editing content

All copy lives in `src/data/`:

- `site.ts` — company name, slogan, contact details, founder bio, headline stats
- `products.ts` — the 7 products (add a new one here and it appears everywhere)
- `services.ts` — services, delivery process, automation examples
- `content.ts` — testimonials, industries, pricing models, FAQ

## Contact form email

Copy `.env.example` to `.env.local` and set `RESEND_API_KEY` (free at resend.com).
Without it, the form opens the visitor's email client addressed to you.

## Deploy

Push to GitHub and import into Vercel. Set the environment variables, and point `mtkcodex.tech` at the project.
