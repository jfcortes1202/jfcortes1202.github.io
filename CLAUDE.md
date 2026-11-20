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
node tools/process-media.mjs [job]   # media/ → public/media, public/docs (see below)
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
    HeroIllustration.astro     SVG gas-turbine section (traced contours, src/data/engine-section.json)
    Figure.astro               <img> with width/height from the media manifest, lazy by default
    Video.astro                content video: poster, controls, preload="metadata", no autoplay
    Carousel.astro             scroll-snap carousel: arrows, ← → keys, counter, caption, thumbnails
    MediaPlaceholder.astro     labeled placeholder frame for media not yet supplied
    ProjectHeader.astro        header block shared by project detail pages
  data/media.json              generated manifest: every processed file's width/height/poster
  lib/media.ts                 manifest lookup (throws at build time if a file is missing)
  scripts/
    motion.ts                  anime.js: hero timeline, scroll reveals, timeline rail
  pages/
    index.astro                single-scroll page (hero → about → research → experience →
                               projects → skills → education → contact)
    cv.astro                   download page for resume / full CV
    404.astro
    projects/*.astro           detail pages: bat-wing-fsi, robotic-arm, i-beam, geothermal, otv,
                               phone-stand, truss
  styles/global.css            design tokens + all component styles
public/
  cv/*.pdf                     resume.pdf, cv-full.pdf (placeholders), bat-flight-presentation.pdf
  docs/<project>/*.pdf         project reports
  media/<section>/...          processed images (WebP) and videos (H.264 MP4 + WebP poster)
  images/og.png                1200×630 social preview (qa/og.mjs renders it from the hero)
media/                         Juan's raw source files — gitignored, never published directly
tools/process-media.mjs        the pipeline from media/ to public/
```

## Media pipeline

`node tools/process-media.mjs` processes everything; pass a job name (`about`, `research`,
`researchdeck`, `prosthetics`, `otv`, `ibeam`, `geothermal`, `truss`, `arm`, `stand`, `site`) to
redo one, or `scan` to rebuild `src/data/media.json` from `public/` without re-encoding.
- Images → WebP q82, sized for their slot, metadata stripped. CAD renders/plots are trimmed and
  padded onto a white 4:3 sheet so carousels line up.
- Videos → H.264 (square pixels, yuv420p, +faststart), **audio removed**, WebP poster frame.
- The research deck embeds its videos, so it is rebuilt from page renders (83 MB → 1.2 MB).
- CAD: part renders/drawings come from the team's PDFs; SolidWorks .SLDDRW files carry a preview
  PNG that the script extracts (used for the truss drawings).
- Every page media reference goes through `media()`; a missing file fails the build.
- Playwright's bundled Chromium has no H.264, so `qa/video-check.mjs` verifies playback in Edge.

### CAD coursework page (`/projects/cad-coursework`)
- Piece list lives in `src/data/coursework.json` (38 parts/assemblies, 40 drawings, FEA shots; Exam 2 and HW10 excluded at Juan's request).
- Exports are found in `media/CAD exports/<folder>/` or next to the SolidWorks source in
  the ENME272 folder (where Juan saved them); SolidWorks' gradient background is flood-filled to white; `node tools/process-media.mjs coursework` processes them.
- Any piece without an export renders as a labeled "Export pending" slide (Carousel `placeholder`).
- Never publish exam prompts, assignment instructions, rubrics, or files showing other students'
  names; check drawing title blocks before publishing.

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
- Renders, drawings, plots and simulation frames sit on `--paper` (white; slate-100 in dark
  theme) so they read as drawing sheets in both themes.
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
7. Never publish: homework or exam work, course handout PDFs, other people's images, clips
   where teammates are on webcam/recorded audio, or files showing private information.
8. The hero turbine is traced from a tutorial-built CAD model; never caption it as Juan's design.
