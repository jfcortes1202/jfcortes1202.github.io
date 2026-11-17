/**
 * All motion on the site, powered by anime.js v4.
 *
 * Principles:
 *  - One orchestrated moment on load (the hero drawing), then quiet.
 *  - Scroll reveals are single, restrained entrances per block; children stagger.
 *  - The experience timeline rail "draws" with scroll, because it is a sequence.
 *  - If the user prefers reduced motion, nothing here runs and the CSS leaves the
 *    page fully visible (`.js-motion` is never added).
 */
import { animate, createTimeline, stagger, svg, onScroll, utils } from 'animejs';

const root = document.documentElement;
const motionOn = root.classList.contains('js-motion');

function revealEverything() {
  root.classList.remove('js-motion');
}

if (motionOn) {
  try {
    heroSequence();
    scrollReveals();
    timelineRail();
  } catch (err) {
    // Never leave the page hidden because an animation failed.
    console.error('[motion]', err);
    revealEverything();
  }
}

/* ------------------------------------------------------------------ */
/* Hero: the illustration traces itself, then the copy settles in.     */
/* ------------------------------------------------------------------ */
function heroSequence() {
  const ill = document.querySelector<SVGSVGElement>('.hero-ill');
  const copy = Array.from(document.querySelectorAll<HTMLElement>('.hero__copy > *'));
  if (!ill) {
    copy.forEach((el) => (el.style.opacity = '1'));
    return;
  }

  const q = (sel: string) => Array.from(ill.querySelectorAll<SVGElement>(sel));

  // Dashed strokes (centreline, streamlines) are revealed with a clip rect so
  // their dash pattern survives; solid strokes are traced with createDrawable.
  const axisClip = ill.querySelector<SVGRectElement>('[data-ill="axis-clip"]');
  const flowClip = ill.querySelector<SVGRectElement>('[data-ill="flow-clip"]');
  const profile = q('[data-ill="profile"]');
  const blades = q('[data-ill="blade"]');
  const internals = q('[data-ill="internal"]');
  const outline = q('[data-ill="outline"]');
  const dims = q('[data-ill="dim"]');
  const labels = q('[data-ill="label"]');
  const width = ill.viewBox.baseVal.width || 740;

  // Initial states, set before the SVG is shown so nothing flashes.
  const drawn = svg.createDrawable([...profile, ...blades, ...internals, ...outline, ...dims]);
  utils.set(drawn, { draw: '0 0' });
  utils.set(labels, { opacity: 0, translateY: 4 });
  utils.set(copy, { opacity: 0, translateY: 14 });
  ill.style.opacity = '1';

  const tl = createTimeline({ defaults: { ease: 'inOutSine' } });

  if (axisClip) tl.add(axisClip, { width: [0, width], duration: 800, ease: 'inOutQuad' }, 0);
  tl.add(svg.createDrawable(profile), { draw: '0 1', duration: 1100, delay: stagger(120) }, 250)
    .add(svg.createDrawable(blades), { draw: '0 1', duration: 420, delay: stagger(9), ease: 'outQuad' }, 700)
    .add(svg.createDrawable(internals), { draw: '0 1', duration: 700, delay: stagger(40) }, 1000)
    .add(svg.createDrawable(outline), { draw: '0 1', duration: 900 }, 1150);
  if (flowClip) tl.add(flowClip, { width: [0, width], duration: 1000, ease: 'outSine' }, 1500);
  tl.add(svg.createDrawable(dims), { draw: '0 1', duration: 500, delay: stagger(40), ease: 'outQuad' }, 1700)
    .add(labels, { opacity: 1, translateY: 0, duration: 450, delay: stagger(40), ease: 'outQuad' }, 1950);

  // Copy enters in parallel with the drawing, not after it.
  tl.add(copy, { opacity: 1, translateY: 0, duration: 650, delay: stagger(90), ease: 'outCubic' }, 300);
}

/* ------------------------------------------------------------------ */
/* Scroll reveals                                                      */
/* ------------------------------------------------------------------ */
function scrollReveals() {
  const singles = document.querySelectorAll<HTMLElement>('[data-reveal]');
  singles.forEach((el) => {
    animate(el, {
      opacity: [0, 1],
      translateY: [14, 0],
      duration: 650,
      ease: 'outCubic',
      autoplay: onScroll({ target: el, enter: 'bottom-=48 top', repeat: false }),
    });
  });

  const groups = document.querySelectorAll<HTMLElement>('[data-reveal-group]');
  groups.forEach((group) => {
    const items = Array.from(group.children) as HTMLElement[];
    if (!items.length) return;
    animate(items, {
      opacity: [0, 1],
      translateY: [12, 0],
      duration: 550,
      delay: stagger(55),
      ease: 'outCubic',
      autoplay: onScroll({ target: group, enter: 'bottom-=48 top', repeat: false }),
    });
  });

  // Safety net: if something is on screen and still hidden (e.g. a jump past the
  // scroll threshold), show it rather than leave content invisible.
  if ('IntersectionObserver' in window) {
    const watched = [...singles, ...Array.from(groups).flatMap((g) => Array.from(g.children) as HTMLElement[])];
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target as HTMLElement;
        io.unobserve(el);
        setTimeout(() => {
          if (getComputedStyle(el).opacity === '0') {
            el.style.opacity = '1';
            el.style.transform = 'none';
          }
        }, 1200);
      });
    }, { threshold: 0.05 });
    watched.forEach((el) => io.observe(el));
  }
}

/* ------------------------------------------------------------------ */
/* Experience timeline rail, scrubbed by scroll                        */
/* ------------------------------------------------------------------ */
function timelineRail() {
  const timeline = document.querySelector<HTMLElement>('.timeline');
  const rail = timeline?.querySelector<HTMLElement>('.timeline__rail');
  if (!timeline || !rail) return;
  animate(rail, {
    scaleY: [0, 1],
    ease: 'linear',
    autoplay: onScroll({
      target: timeline,
      enter: 'bottom-=120 top',
      leave: 'center bottom',
      sync: 0.25,
    }),
  });
}
