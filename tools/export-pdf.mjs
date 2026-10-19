#!/usr/bin/env node
// export-pdf.mjs — turn an HTML slide deck into a presentation PDF.
//
// Works with decks from the frontend-slides, html-ppt and guizang-ppt skills,
// and with any deck whose slides match a CSS selector and advance on ArrowRight.
//
// Every slide is rendered in headless Chromium at 1920×1080 and placed on its
// own 16:9 page (13.333in × 7.5in, the PowerPoint widescreen size). Pages carry
// native PDF transitions (/Trans), which Acrobat, Foxit, Okular and other
// presentation-capable viewers play in full-screen mode. With --animate, each
// slide's entry animation is sampled into extra frames that auto-advance (/Dur),
// so the slide builds on screen in viewers that honour page durations.
//
// Usage:
//   node tools/export-pdf.mjs <deck.html> [options]
//
// Options:
//   -o, --out <file>         Output PDF (default: <deck>.pdf next to the deck)
//   -t, --transition <name>  fade | dissolve | push | cover | uncover | wipe | split |
//                            blinds | box | glitter | fly | zoom | replace | none | mix
//                            (default: fade; "mix" cycles through a curated set)
//   -d, --duration <sec>     Transition length in seconds (default: 0.7)
//   --animate[=N]            Add N in-animation frames per slide (default N: 6). The deck's own
//                            HTML transitions are captured in those frames, so pages then get
//                            no PDF transition unless -t is given explicitly
//   --window <sec>           With --animate, sample only the first <sec> seconds of motion
//   --steps                  One page per build step (fragments) instead of one per slide
//   --scale <n>              Device scale factor: 1 = 1920×1080, 2 = 3840×2160 (default: 1)
//   --png                    Lossless PNG frames (larger file) instead of JPEG
//   --quality <1-100>        JPEG quality (default: 90)
//   --selector <css>         Slide selector (default: .slide)
//   --wait <ms>              Settle time after each navigation (default: 500)
//   --root <dir>             Folder served over HTTP (default: the current folder when
//                            the deck is inside it, else the deck's folder)
//   --no-fullscreen          Do not ask the viewer to open the PDF in full-screen
//
// Per-slide overrides: put data-pdf-transition="push" and/or
// data-pdf-duration="1.2" on a slide element.

import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, PDFName } from 'pdf-lib';

const WIDTH = 1920;
const HEIGHT = 1080;
const PAGE_W = 960; // 13.333in at 72pt/in
const PAGE_H = 540; // 7.5in

// PDF 32000-1 §12.4.4.1, Table 162. Di is only 0 or 270 for Push/Cover/Uncover.
const TRANSITIONS = {
  none: null,
  replace: { S: 'R' },
  fade: { S: 'Fade' },
  dissolve: { S: 'Dissolve' },
  push: { S: 'Push', Di: 0 },
  cover: { S: 'Cover', Di: 0 },
  uncover: { S: 'Uncover', Di: 270 },
  wipe: { S: 'Wipe', Di: 180 },
  split: { S: 'Split', Dm: 'V', M: 'O' },
  blinds: { S: 'Blinds', Dm: 'H' },
  box: { S: 'Box', M: 'O' },
  glitter: { S: 'Glitter', Di: 315 },
  fly: { S: 'Fly', Di: 0, M: 'I' },
  zoom: { S: 'Fly', Di: 'None', SS: 0.05, B: true },
};
const MIX = ['fade', 'push', 'zoom', 'wipe', 'split', 'cover', 'box', 'uncover', 'dissolve'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error('usage: node tools/export-pdf.mjs <deck.html> [-o out.pdf] [-t fade|push|zoom|mix|...]');
  console.error('       [-d 0.7] [--animate[=6]] [--window 2] [--steps] [--scale 1] [--png] [--quality 90]');
  console.error('       [--selector .slide] [--wait 500] [--root dir] [--no-fullscreen]');
  process.exit(msg ? 1 : 0);
}

function parseArgs(argv) {
  const opts = {
    transition: 'fade', duration: 0.7, frames: 0, steps: false, scale: 1, png: false,
    quality: 90, selector: '.slide', wait: 500, fullscreen: true,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') usage();
    else if (a === '-o' || a === '--out') opts.out = next();
    else if (a === '-t' || a === '--transition') { opts.transition = next().toLowerCase(); opts.transitionGiven = true; }
    else if (a === '-d' || a === '--duration') opts.duration = Number(next());
    else if (a === '--animate') opts.frames = 6;
    else if (a.startsWith('--animate=')) opts.frames = Number(a.slice(10));
    else if (a === '--steps') opts.steps = true;
    else if (a === '--window') opts.window = Number(next());
    else if (a === '--scale') opts.scale = Number(next());
    else if (a === '--png') opts.png = true;
    else if (a === '--quality') opts.quality = Number(next());
    else if (a === '--selector') opts.selector = next();
    else if (a === '--wait') opts.wait = Number(next());
    else if (a === '--root') opts.root = next();
    else if (a === '--no-fullscreen') opts.fullscreen = false;
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) usage('give exactly one deck HTML file');
  if (opts.transition !== 'mix' && !(opts.transition in TRANSITIONS)) {
    usage(`unknown transition "${opts.transition}"`);
  }
  if (!(opts.frames >= 0 && opts.frames <= 30)) usage('--animate frames must be 0-30');
  opts.deck = resolve(rest[0]);
  opts.out = resolve(opts.out ?? opts.deck.replace(/\.html?$/i, '') + '.pdf');
  // Decks often reach up for shared assets (../../assets/runtime.js), so serve a
  // folder above the deck when possible.
  const cwd = process.cwd();
  opts.root = resolve(opts.root ?? (opts.deck.startsWith(cwd + sep) ? cwd : dirname(opts.deck)));
  if (!opts.deck.startsWith(opts.root + sep)) usage(`deck must be inside --root ${opts.root}`);
  return opts;
}

// Static server for the deck and the assets it references, so fonts and relative paths load.
async function serve(root) {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = resolve(join(root, urlPath));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const target = (await stat(file)).isDirectory() ? join(file, 'index.html') : file;
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

// --- In-page helpers (run inside the browser) ---------------------------------

// Slides are siblings; matches elsewhere (overview thumbnails, presenter
// previews) are clones the deck runtime made and are skipped.
function pageInstallSlideFinder() {
  window.__exportSlides = (selector) => {
    const all = [...document.querySelectorAll(selector)];
    return all.filter((s) => s.parentElement === all[0]?.parentElement);
  };
}

// Index of the current slide: the deck's own counter or "active" class when it
// has one, otherwise the visible slide that fills the most of the viewport.
function pageCurrentIndex(selector) {
  if (Number.isInteger(window.__currentSlideIndex)) return window.__currentSlideIndex;
  const slides = window.__exportSlides(selector);
  const flagged = slides.filter((s) => /(^|\s)(active|is-active|current|present)(\s|$)/.test(s.className));
  if (flagged.length === 1) return slides.indexOf(flagged[0]);
  let best = -1;
  let bestScore = 0;
  slides.forEach((s, i) => {
    const cs = getComputedStyle(s);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return;
    const r = s.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const score = w * h;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

// Class/hidden state inside a slide, used to tell build steps from no-ops.
function pageSignature([selector, idx]) {
  const s = window.__exportSlides(selector)[idx];
  if (!s) return '';
  let sig = '';
  for (const e of s.querySelectorAll('*')) sig += `|${e.getAttribute('class') ?? ''}${e.hidden ? 'h' : ''}`;
  return sig;
}

function pageFinishAnimations() {
  for (const a of document.getAnimations()) {
    if (Number.isFinite(a.effect?.getComputedTiming().endTime)) {
      try {
        a.finish();
      } catch {}
    }
  }
}

// Pause every finite animation and report how long the longest one runs (ms).
function pageFreezeAnimations() {
  const anims = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime));
  anims.forEach((a) => a.pause());
  window.__exportAnims = anims;
  return Math.max(0, ...anims.map((a) => a.effect.getComputedTiming().endTime));
}

function pageSeekAnimations(t) {
  for (const a of window.__exportAnims ?? []) a.currentTime = t;
}

function pageForceShow([selector, idx]) {
  const slides = window.__exportSlides(selector);
  slides.forEach((s, i) => {
    for (const c of ['active', 'visible', 'is-active', 'current']) s.classList.toggle(c, i === idx);
  });
  window.presentation?.goToSlide?.(idx);
  slides[idx]?.scrollIntoView({ behavior: 'instant' });
}

function pageSlideMeta([selector, idx]) {
  const s = window.__exportSlides(selector)[idx];
  return { transition: s?.dataset.pdfTransition, duration: s?.dataset.pdfDuration };
}

// --- Capture -------------------------------------------------------------------

async function nextFrame(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function shoot(page, opts) {
  return page.screenshot(opts.png ? { type: 'png' } : { type: 'jpeg', quality: opts.quality });
}

// Capture the slide state reached by the last navigation: optional animation
// frames first, then the settled final state.
async function captureState(page, opts) {
  const frames = [];
  await nextFrame(page);
  if (opts.frames > 0) {
    let end = await page.evaluate(pageFreezeAnimations);
    if (opts.window > 0) end = Math.min(end, opts.window * 1000);
    if (end > 0) {
      for (let k = 0; k < opts.frames; k++) {
        await page.evaluate(pageSeekAnimations, (end * k) / opts.frames);
        await nextFrame(page);
        frames.push({ image: await shoot(page, opts), dur: Math.max(0.04, end / opts.frames / 1000) });
      }
    }
  }
  // Let JS timers (staggered reveals, observers) fire, then jump to the end state.
  await page.evaluate(pageFinishAnimations);
  await page.waitForTimeout(opts.wait);
  await page.evaluate(pageFinishAnimations);
  await page.evaluate(() => document.fonts.ready);
  await nextFrame(page);
  frames.push({ image: await shoot(page, opts) });
  return frames;
}

async function captureDeck(page, opts) {
  const total = await page.evaluate((sel) => window.__exportSlides(sel).length, opts.selector);
  if (total === 0) throw new Error(`no slides match "${opts.selector}" — pass --selector`);
  console.log(`  ${total} slides found`);

  const states = []; // { slide, frames, step }
  const cur = () => page.evaluate(pageCurrentIndex, opts.selector);
  const sig = (i) => page.evaluate(pageSignature, [opts.selector, i]);

  // After a key press, poll until the slide index or the slide's build state
  // changes; give up after the settle time (end of deck, or keys ignored).
  const waitForChange = async (idx, before) => {
    const deadline = Date.now() + Math.max(opts.wait, 400);
    do {
      await nextFrame(page);
      const now = await cur();
      if (now !== idx || (await sig(idx)) !== before) return now;
    } while (Date.now() < deadline);
    return null;
  };

  let idx = await cur();
  if (idx !== 0) {
    await page.keyboard.press('Home');
    await page.waitForTimeout(opts.wait);
    idx = await cur();
  }
  states.push({ slide: idx, frames: await captureState(page, opts), step: 0 });

  let navigated = false;
  for (let n = 0; n < total * 12; n++) {
    const before = await sig(idx);
    await page.keyboard.press('ArrowRight');
    const now = await waitForChange(idx, before);
    if (now === null || now < idx) break; // end of deck, or it wrapped to the start
    const frames = await captureState(page, opts);
    if (now !== idx) {
      navigated = true;
      idx = now;
      states.push({ slide: idx, frames, step: 0 });
      continue;
    }
    // Same slide, new build step (fragment).
    const last = states.at(-1);
    if (opts.steps) states.push({ slide: idx, frames, step: last.step + 1 });
    else last.frames = [...last.frames.slice(0, -1), frames.at(-1)];
  }

  if (!navigated && total > 1) {
    console.warn('  ⚠ ArrowRight did not change slides — falling back to toggling slide classes');
    states.length = 0;
    for (let i = 0; i < total; i++) {
      await page.evaluate(pageForceShow, [opts.selector, i]);
      states.push({ slide: i, frames: await captureState(page, opts), step: 0 });
    }
  }
  const seen = new Set(states.map((s) => s.slide));
  if (seen.size < total) console.warn(`  ⚠ captured ${seen.size} of ${total} slides`);
  return states;
}

// --- PDF assembly ----------------------------------------------------------------

function transitionFor(opts, slide, meta) {
  // Animated exports already contain the deck's own transition as frames
  if (opts.frames > 0 && !opts.transitionGiven) return null;
  const name = (meta.transition ?? (opts.transition === 'mix' ? MIX[slide % MIX.length] : opts.transition)).toLowerCase();
  if (!(name in TRANSITIONS)) {
    console.warn(`  ⚠ slide ${slide + 1}: unknown transition "${name}", using fade`);
    return { ...TRANSITIONS.fade, D: opts.duration };
  }
  const t = TRANSITIONS[name];
  return t && { ...t, D: Number(meta.duration ?? opts.duration) };
}

async function buildPdf(states, metas, opts, title) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('Slide tools · export-pdf.mjs');
  for (const state of states) {
    const trans = state.slide === 0 && state.step === 0
      ? null
      : state.step > 0
        ? { S: 'Dissolve', D: 0.3 }
        : transitionFor(opts, state.slide, metas[state.slide]);
    for (const [k, frame] of state.frames.entries()) {
      const img = opts.png ? await pdf.embedPng(frame.image) : await pdf.embedJpg(frame.image);
      const page = pdf.addPage([PAGE_W, PAGE_H]);
      page.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
      if (k === 0 && trans) page.node.set(PDFName.of('Trans'), pdf.context.obj({ Type: 'Trans', ...trans }));
      if (frame.dur) page.node.set(PDFName.of('Dur'), pdf.context.obj(frame.dur));
    }
  }
  if (opts.fullscreen) pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('FullScreen'));
  pdf.catalog.set(PDFName.of('PageLayout'), PDFName.of('SinglePage'));
  return pdf.save();
}

// --- Main ------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.deck)) usage(`file not found: ${opts.deck}`);

  console.log(`▶ Exporting ${opts.deck}`);
  const server = await serve(opts.root);
  const urlPath = relative(opts.root, opts.deck).split(sep).map(encodeURIComponent).join('/');
  const url = `http://127.0.0.1:${server.address().port}/${urlPath}`;

  // Cloud sessions ship Chromium in /opt/pw-browsers; locally Playwright finds its own.
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
  const browser = await chromium.launch({
    executablePath,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: opts.scale,
      reducedMotion: 'no-preference',
    });
    await page.addInitScript(pageInstallSlideFinder);
    page.on('pageerror', (e) => console.warn(`  ⚠ page error: ${e.message}`));
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(async (e) => {
      console.warn(`  ⚠ ${e.message.split('\n')[0]} — continuing with what loaded`);
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(opts.wait);

    const states = await captureDeck(page, opts);
    const total = await page.evaluate((sel) => window.__exportSlides(sel).length, opts.selector);
    const metas = [];
    for (let i = 0; i < total; i++) metas.push(await page.evaluate(pageSlideMeta, [opts.selector, i]));
    const title = (await page.title()) || basename(opts.deck);

    const bytes = await buildPdf(states, metas, opts, title);
    await writeFile(opts.out, bytes);
    const pages = states.reduce((n, s) => n + s.frames.length, 0);
    console.log(`✓ ${opts.out}`);
    console.log(`  ${pages} pages · ${(bytes.length / 1024 / 1024).toFixed(1)} MB · transition: ${opts.transition}` +
      `${opts.frames ? ` · ${opts.frames} animation frames/slide` : ''}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
