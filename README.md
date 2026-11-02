<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:7c3aed,50:06b6d4,100:22d3ee&height=220&section=header&text=MTK%20CODEX&fontSize=68&fontColor=ffffff&fontAlignY=38&desc=Code%20That%20Scales%20Your%20Business&descAlignY=58&descSize=22&descColor=22d3ee&animation=fadeIn" alt="MTK Codex Banner" width="100%" />

[![Next.js 16](https://img.shields.io/badge/Next.js_16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](#-tech-stack)
[![React 19](https://img.shields.io/badge/React_19-23272F?style=for-the-badge&logo=react&logoColor=61DAFB)](#-tech-stack)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#-tech-stack)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS_v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](#-tech-stack)
&nbsp;
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/Kaashmalik/mtkcodex?style=for-the-badge&logo=github&color=yellow)](https://github.com/Kaashmalik/mtkcodex/stargazers)
[![Deploy on Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FKaashmalik%2Fmtkcodex.git)

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&pause=1200&color=22D3EE&center=true&vCenter=true&multiline=true&repeat=true&width=650&height=75&lines=SaaS+platforms+shipped+%E2%80%94+7+industries%2C+one+team.;Web+%2B+Mobile+%2B+Desktop+from+a+single+codebase.;Automation+that+works+while+your+business+sleeps." alt="Animated tagline" />

**[mtkcodex.tech](https://mtkcodex.tech)** — the company website of MTK Codex: SaaS products, software development, maintenance, audits and automation.

Visit the site · [Products](https://mtkcodex.tech/products) · [Services](https://mtkcodex.tech/services) · [Pricing](https://mtkcodex.tech/pricing) · [Contact](https://mtkcodex.tech/contact)

</div>

---

## ✨ Highlights

| | |
| --- | --- |
| 🏗️ **7 production platforms** | FinTech · AgriTech · EdTech · SportsTech · e-commerce · AI security · desktop software |
| ⚡ **95+ Lighthouse score** | Static-ready App Router pages with streaming demos and OG image generation |
| 🤖 **Automation-first** | Contact routing by `?intent=` / `?service=` / `?product=`, WhatsApp deep links, Resend email |
| 🔍 **SEO-complete** | Structured data, `sitemap.ts`, `robots.ts`, `llms.txt`, `ads.txt`, per-page OG images |
| 🎨 **Motion-rich UI** | Count-up stats, reveal-on-scroll, interactive product demos, dark/light theme |
| 🌍 **Global reach** | Lahore HQ with coverage across PK · AE · SA · UK · EU · US/CA |

## 🧰 Tech Stack

<div align="center">

[![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![lucide-react](https://img.shields.io/badge/lucide--react-F56565?style=flat-square)](https://lucide.dev)
[![marked](https://img.shields.io/badge/marked-000000?style=flat-square&logo=markdown&logoColor=white)](https://marked.js.org)
[![Resend](https://img.shields.io/badge/Resend-black?style=flat-square&logo=resend&logoColor=white)](https://resend.com)
[![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com)

</div>

## 🚀 Getting Started

```bash
git clone https://github.com/Kaashmalik/mtkcodex.git
cd mtkcodex
npm install
cp .env.example .env.local   # optional: enables direct email delivery
npm run dev                  # → http://localhost:3000
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server on <http://localhost:3000> |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | Lint with ESLint |

### Environment Variables

```bash
RESEND_API_KEY=re_xxxxxxxx   # free at resend.com — enables direct email delivery
```

Without `RESEND_API_KEY` the contact form gracefully opens the visitor's email client instead. See [`.env.example`](./.env.example).

## 🗺️ Pages

| Route | Content |
| --- | --- |
| `/` | Hero, product strip, stats, suite, interactive demos, services, automation, industries, process, reviews, founder, pricing, FAQ |
| `/products`, `/products/[slug]` | All 7 platforms with coded UI demos, metrics, features, stack |
| `/services` | 8 service lines with deliverables |
| `/industries` | Industry coverage with per-industry pages |
| `/customers` | Client reviews |
| `/pricing` | Engagement models + FAQ |
| `/about` | Values, founder, timeline |
| `/contact` | Lead form (pre-filled from `?intent=`, `?service=`, `?product=`), WhatsApp, email |
| `/blog/[slug]` | Markdown blog rendered with `marked` from `content/blog/` |
| `/locations` | Location pages incl. Lahore, with keyless maps embeds |

## 📁 Project Structure

```
mtkcodex/
├── content/blog/           # Markdown blog posts
├── public/                 # Static assets (icons, favicon)
├── src/
│   ├── app/                # App Router pages, API routes, SEO files
│   │   ├── api/contact/    # Resend-powered contact endpoint
│   │   ├── blog/[slug]/    # Blog + dynamic OG images
│   │   └── products/[slug]/
│   ├── components/         # layout · sections · motion · ui · demo
│   ├── data/               # 👈 All site copy lives here
│   │   ├── site.ts         # Brand, contact, founder, stats
│   │   ├── products.ts     # The 7 products (add here → appears everywhere)
│   │   ├── services.ts     # Services + delivery process
│   │   └── content.ts      # Testimonials, industries, pricing, FAQ
│   └── lib/                # blog, seo, consent, OG icon helpers
├── .env.example
├── LICENSE                 # MIT
└── package.json
```

> **Adding content:** drop a new product into `src/data/products.ts` or a new `.md` file into `content/blog/` — routing, sitemap and OG images pick it up automatically.

## ☁️ Deploy

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FKaashmalik%2Fmtkcodex.git">
  <img src="https://vercel.com/button" alt="Deploy with Vercel" />
</a>

1. Click the button above (or push and import the repo into Vercel)
2. Add `RESEND_API_KEY` in Project → Settings → Environment Variables
3. Point `mtkcodex.tech` at the project

## 📄 License

Released under the [MIT License](./LICENSE) — free to use, copy, modify and distribute with attribution.

## 🤝 Connect

<div align="center">

**Muhammad Kashif** — CEO & Founder · Full-Stack SaaS Architect

[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Kaashmalik)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/muhammadkashif-mtkcodex)
[![Portfolio](https://img.shields.io/badge/Portfolio-7c3aed?style=for-the-badge&logo=aboutdotme&logoColor=white)](https://pf.mtkcodex.site)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:kaash0542@gmail.com)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://wa.me/923020718182)

📍 Lahore, Pakistan · Serving clients worldwide · Mon–Sat · Response within 12 hours

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:22d3ee,50:06b6d4,100:7c3aed&height=140&section=footer" alt="Footer" width="100%" />

</div>
