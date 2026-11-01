import { Award, Mail } from 'lucide-react';
import { site } from '@/data/site';
import { Button } from '@/components/ui/primitives';
import { GithubIcon, LinkedinIcon } from '@/components/ui/BrandIcons';
import Reveal from '@/components/ui/Reveal';

export default function Founder() {
  const f = site.founder;
  return (
    <section id="founder" className="container-x scroll-mt-24 py-20">
      <Reveal className="card grid overflow-hidden lg:grid-cols-[0.9fr_1.1fr]">
        <div className="relative isolate flex min-h-[340px] flex-col justify-end overflow-hidden bg-[linear-gradient(160deg,#032d42,#075058_55%,#1f7a3a)] p-8 text-white sm:p-10">
          <div className="absolute inset-0 -z-10 opacity-30 [background-image:radial-gradient(circle_at_30%_20%,white_0,transparent_40%)]" />
          <div className="mb-auto grid size-28 place-items-center rounded-3xl border border-white/30 bg-white/10 font-display text-4xl font-extrabold backdrop-blur">
            MK
          </div>
          <p className="mt-10 text-sm uppercase tracking-[0.18em] text-white/70">Leadership</p>
          <h2 className="mt-2 text-3xl font-bold sm:text-4xl">{f.name}</h2>
          <p className="mt-1 text-white/80">{f.role}</p>
          <div className="mt-6 flex gap-2">
            <a href={site.social.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="grid size-10 place-items-center rounded-full bg-white/15 hover:bg-white/25">
              <LinkedinIcon className="size-[18px]" />
            </a>
            <a href={site.social.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="grid size-10 place-items-center rounded-full bg-white/15 hover:bg-white/25">
              <GithubIcon className="size-[18px]" />
            </a>
            <a href={`mailto:${site.email}`} aria-label="Email" className="grid size-10 place-items-center rounded-full bg-white/15 hover:bg-white/25">
              <Mail className="size-[18px]" />
            </a>
          </div>
        </div>
        <div className="p-8 sm:p-12">
          <p className="eyebrow">Meet the founder</p>
          <p className="mt-4 font-display text-2xl font-semibold leading-snug">
            &ldquo;Every business deserves software that is fast, secure and built to grow — not just something that works on launch day.&rdquo;
          </p>
          <p className="mt-5 leading-relaxed text-fg-muted">{f.bio}</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {f.highlights.map((h) => (
              <li key={h} className="rounded-xl bg-muted p-4 text-sm font-medium">
                {h}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-2">
            {f.certifications.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-fg-muted">
                <Award className="size-3.5 text-brand" /> {c}
              </span>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="/contact?intent=call" arrow>
              Book a call with Kashif
            </Button>
            <Button href={site.social.portfolio} external variant="secondary">
              View portfolio
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
