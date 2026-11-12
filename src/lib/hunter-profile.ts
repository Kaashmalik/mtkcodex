import { products } from '@/data/products';
import { services } from '@/data/services';
import { site } from '@/data/site';
import type { Opportunity, RawOpportunity } from '@/lib/opportunity-types';

/**
 * The skills profile every job is matched against and every proposal is
 * written from. Built from the site's own data (products, services, founder),
 * so a proposal can only cite projects that really exist.
 *
 *   OPP_EXTRA_SKILLS   comma list added to the keyword matcher, e.g. "vue,django"
 *   OPP_CONTACT_EMAIL  email in the proposal signature (default: site email)
 */

export type ProfileProject = {
  slug: string;
  name: string;
  category: string;
  summary: string;
  stack: string[];
  url: string;
  links: string[];
};

export type HunterProfile = {
  name: string;
  role: string;
  bio: string;
  highlights: string[];
  certifications: string[];
  services: string[];
  projects: ProfileProject[];
  links: { site: string; portfolio: string; github: string; linkedin: string; booking: string };
  /** Shown in the signature: where companies can reach you directly. */
  email: string;
  location: string;
  timezone: string;
};

export function hunterProfile(): HunterProfile {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || site.url).replace(/\/+$/, '');
  return {
    name: site.founder.name,
    role: site.founder.role,
    bio: site.founder.bio,
    highlights: [...site.founder.highlights],
    certifications: [...site.founder.certifications],
    services: services.map((service) => service.title),
    projects: products.map((product) => {
      const url = `${siteUrl}/products/${product.slug}`;
      return {
        slug: product.slug,
        name: product.name,
        category: product.category,
        summary: product.description,
        stack: product.stack,
        url,
        links: [url, product.liveUrl, product.githubUrl].filter((link): link is string => Boolean(link)),
      };
    }),
    links: {
      site: siteUrl,
      portfolio: site.social.portfolio,
      github: site.social.github,
      linkedin: site.social.linkedin,
      booking: (process.env.NEXT_PUBLIC_BOOKING_URL || '').trim(),
    },
    email: (process.env.OPP_CONTACT_EMAIL || site.email).trim(),
    location: 'Lahore, Pakistan (PKT, UTC+5)',
    timezone: site.timezone,
  };
}

/** Every URL a proposal may contain. Anything else the model writes is removed. */
export function allowedLinks(profile: HunterProfile): string[] {
  const { site: home, portfolio, github, linkedin, booking } = profile.links;
  return [home, portfolio, github, linkedin, booking, ...profile.projects.flatMap((project) => project.links)].filter(Boolean);
}

/* ---------------------------------------------------------------------------
 * Keyword pre-filter: cheap, instant, runs on every fetched job
 * ------------------------------------------------------------------------- */

/** term → weight. Regex-safe lower-case terms; matched on word boundaries. */
const SKILLS: Record<string, number> = {
  'next.js': 14,
  nextjs: 14,
  react: 12,
  typescript: 10,
  'node.js': 10,
  nodejs: 10,
  node: 6,
  nestjs: 9,
  'full stack': 10,
  'full-stack': 10,
  fullstack: 10,
  frontend: 6,
  'front-end': 6,
  backend: 5,
  'back-end': 5,
  javascript: 6,
  postgres: 7,
  postgresql: 7,
  supabase: 9,
  prisma: 6,
  tailwind: 6,
  redis: 4,
  saas: 8,
  'multi-tenant': 8,
  crm: 9,
  automation: 8,
  'web scraping': 10,
  scraping: 9,
  scraper: 9,
  crawler: 7,
  ai: 5,
  llm: 8,
  openai: 7,
  'ai agent': 9,
  agents: 4,
  rag: 6,
  'react native': 8,
  expo: 5,
  electron: 7,
  stripe: 5,
  api: 3,
  'rest api': 4,
  graphql: 4,
  docker: 3,
  aws: 3,
  vercel: 5,
  'tensorflow.js': 6,
  webrtc: 5,
  websocket: 4,
  websockets: 4,
  'e-commerce': 5,
  ecommerce: 5,
  shopify: 4,
  mongodb: 4,
  python: 3,
  'n8n': 6,
  zapier: 4,
  'make.com': 4,
};

/** Roles that are clearly not a fit, whatever keywords they mention. */
const OFF_TARGET =
  /\b(sales|account executive|recruiter|nurse|nursing|driver|warehouse|accountant|bookkeeper|customer support|customer success|call cent(?:er|re)|teacher|tutor|lawyer|paralegal|marketing manager|seo specialist|copywriter|hr |human resources|cashier|physician|therapist|pharmac)/i;

/** Posts that rule out a Pakistan-based contractor. */
const LOCATION_LOCKED =
  /\b(us|u\.s\.|usa|united states|canada|uk|eu|europe|germany)[- ]?(only|based only|residents? only)\b|\bmust (be|reside|live) (located |based )?in (the )?(us|usa|united states|uk|eu|canada|germany)\b|\bsecurity clearance\b|\bus citizens?\b/i;

function extraSkills(): Record<string, number> {
  const extra: Record<string, number> = {};
  for (const term of (process.env.OPP_EXTRA_SKILLS || '').split(',')) {
    const key = term.trim().toLowerCase();
    if (key) extra[key] = 8;
  }
  return extra;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type KeywordMatch = { score: number; matched: string[]; offTarget: boolean; locationLocked: boolean };

export function keywordMatch(
  job: Pick<RawOpportunity, 'title' | 'description'> & { tags?: string[]; location?: string },
  extra: Record<string, number> = extraSkills(),
): KeywordMatch {
  const title = job.title.toLowerCase();
  const body = `${(job.tags || []).join(' ')} ${job.description}`.toLowerCase().slice(0, 12_000);
  const terms = { ...SKILLS, ...extra };
  const matched: string[] = [];
  let raw = 0;
  for (const [term, weight] of Object.entries(terms)) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}($|[^a-z0-9])`, 'i');
    const inTitle = pattern.test(title);
    if (inTitle || pattern.test(body)) {
      matched.push(term);
      // Title hits count double: "Senior Next.js Engineer" beats a passing mention.
      raw += inTitle ? weight * 2 : weight;
    }
  }
  const offTarget = OFF_TARGET.test(title);
  const locationLocked = LOCATION_LOCKED.test(`${job.location || ''} ${title} ${job.description.slice(0, 3000)}`);
  let score = Math.round(100 * (1 - Math.exp(-raw / 45)));
  if (offTarget) score = Math.min(score, 10);
  if (locationLocked) score = Math.round(score * 0.5);
  return { score, matched: [...new Set(matched)].slice(0, 12), offTarget, locationLocked };
}

/** Compact profile text for prompts (kept short: it is sent with every call). */
export function profileBrief(profile: HunterProfile): string {
  return [
    `${profile.name} — ${profile.role}. Based in ${profile.location}; works remotely with clients in the US, UK, EU and Gulf.`,
    profile.bio,
    `Highlights: ${profile.highlights.join('; ')}.`,
    `Certifications: ${profile.certifications.join('; ')}.`,
    `Services: ${profile.services.join(', ')}.`,
  ].join('\n');
}

export function projectsBrief(projects: ProfileProject[]): string {
  return projects
    .map((p) => `- [${p.slug}] ${p.name} (${p.category}): ${p.summary} Stack: ${p.stack.join(', ')}. Links: ${p.links.join(' ')}`)
    .join('\n');
}

/** Picks the projects to cite: the AI's picks when present, else the best stack overlap. */
export function pickProjects(opp: Pick<Opportunity, 'matched_projects' | 'title' | 'description' | 'tags'>, profile: HunterProfile, max = 3): ProfileProject[] {
  const bySlug = new Map(profile.projects.map((p) => [p.slug, p]));
  const chosen = opp.matched_projects.map((slug) => bySlug.get(slug)).filter((p): p is ProfileProject => Boolean(p));
  if (chosen.length) return chosen.slice(0, max);
  const text = `${opp.title} ${opp.tags.join(' ')} ${opp.description}`.toLowerCase();
  return [...profile.projects]
    .map((p) => ({
      p,
      overlap: [...p.stack, p.category].filter((term) => text.includes(term.toLowerCase().replace(/\s+\d+$/, ''))).length,
    }))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, max)
    .map(({ p }) => p);
}
