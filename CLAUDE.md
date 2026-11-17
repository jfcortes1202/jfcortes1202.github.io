# Juan Cortés — Portfolio Site

Personal portfolio for Juan Cortés: junior at the University of Maryland, College Park,
double-majoring in Mechanical Engineering and Physics. Undergraduate research intern at the
University of Tennessee Space Institute (computational FSI of bat flight), co-lead of the
mechanical subteam of UMD's Accessible Prosthetics Initiative, STEM tutor.

Audience, in priority order: internship recruiters (aerospace, defense, automotive, energy,
computational modeling), grad-school admissions, anyone evaluating Juan's work. The site should
read as precise, polished, and honest — built by an engineer with taste, not a template.

Live at https://jfcortes1202.github.io (GitHub Pages, deployed by `.github/workflows/deploy.yml`
on push to `main`).

## Commands

```
npm run dev        # local dev server (http://localhost:4321)
npm run build      # static build to dist/
npm run preview    # serve dist/ locally
npm run qa         # build + Playwright screenshots/checks into qa/ (dev-only)
```

Deploy: push to `main`. The workflow builds with Node 22 and publishes `dist/`.

## Stack

- Astro 7 (static), `@astrojs/sitemap`
- `animejs` 4.0.0 — all motion. Import only what is used:
  `import { animate, createTimeline, stagger, svg, onScroll, utils } from 'animejs'`
- Playwright is a dev dependency used only by `qa/` scripts; it is not part of the site.

## File structure

```
src/
  layouts/BaseLayout.astro     page shell: head/meta, nav, footer, theme toggle, motion bootstrap
  components/
    HeroIllustration.astro     procedurally generated SVG gas-turbine cross-section (hero)
    MediaPlaceholder.astro     labeled placeholder frame for images/video/PDFs not yet supplied
    ProjectHeader.astro        header block shared by project detail pages
  scripts/
    motion.ts                  anime.js: hero timeline, scroll reveals, timeline rail
  pages/
    index.astro                single-scroll page (hero → about → research → experience →
                               projects → skills → education → contact)
    cv.astro                   download page for resume / full CV
    404.astro
    projects/*.astro           detail pages: bat-wing-fsi, i-beam, geothermal, otv
  styles/global.css            design tokens + all component styles
public/
  cv/*.pdf                     resume.pdf, cv-full.pdf, bat-flight-presentation.pdf
  images/                      placeholder.png (OG image), later: headshot, project media
```

## Design tokens (see `src/styles/global.css`)

- Dark base `--slate-950: #0B1120`; neutrals are the slate scale 50–950.
- Primary accent `--sky-400: #60A5FA` (dark theme) / `--sky-500: #3B82F6` (light theme).
- Warm accent `--amber-500: #F59E0B` — sparingly, highlights only.
- Semantic tokens (`--bg-primary`, `--bg-surface`, `--text-primary`, `--text-secondary`,
  `--accent`, `--border`, …) switch with theme. Theme = `data-theme` on `<html>` (localStorage
  override) or system preference. Default is dark.
- Fonts: Plus Jakarta Sans (display/headings), DM Sans (body), JetBrains Mono (measurements:
  dates, course codes, chips, drawing labels). Loaded from Google Fonts with `preconnect`.
- Spacing scale `--space-1 … --space-24` (0.25rem steps), type scale `--text-xs … --text-5xl`.
- Content width 720px for prose, 1120px for grids/hero.

Rules:
- The hero is always dark (slate-950) in both themes, by design. Everything else must switch.
- `BaseLayout.astro` imports `global.css` inside `<style is:global>`. The `is:global` attribute is
  required — without it Astro scopes the CSS and nothing applies.
- Cards are for links (project tiles) and the skill categories only. Do not wrap arbitrary
  content in cards.
- All motion must respect `prefers-reduced-motion`; the page must look complete with JS off.

## Content rules

1. Only use facts that are on the site or supplied by Juan. No invented metrics, outcomes,
   quotes, or skills.
2. Honest framing: Juan *extended* an advisor-provided FSI codebase (did not write the original
   solver); no published findings yet; the prosthetic hand does not have a working prototype
   (do not claim one, do not announce the absence either).
3. I-beam project: Juan "worked with a Python optimizer" (AI-assisted), never "wrote/built".
4. Never include phone number, home address, immigration/work-authorization status,
   demographics, finances, or personal relationships.
5. No "Built with …" credits, no vanity stat bars, no hobbies section, no contact form.
6. Missing media gets a clearly labeled `MediaPlaceholder` and an entry in the placeholder list
   in the final report. Resume/CV links must never 404 (placeholder PDFs exist in `public/cv`).
