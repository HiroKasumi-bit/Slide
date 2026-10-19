#!/usr/bin/env node
// insert-images.mjs — insert full-bleed image pages into a slide PDF.
//
// PDFs cannot play video, so a deck's video slide can be followed by stills of
// the video's scenes (e.g. extracted with ffmpeg). Pages are 16:9 like the
// pages export-pdf.mjs makes and carry a PDF transition; the document's
// full-screen setting is kept.
//
// Usage:
//   node tools/insert-images.mjs <in.pdf> <after-page> <out.pdf> <image>... [-t fade] [-d 0.7]
//
//   after-page   1-based page number to insert after (0 = before the first page)
//   images       .jpg/.jpeg or .png files, inserted in the order given

import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

const TRANSITIONS = { none: null, fade: { S: 'Fade' }, dissolve: { S: 'Dissolve' }, push: { S: 'Push', Di: 0 }, wipe: { S: 'Wipe', Di: 180 } };

const args = process.argv.slice(2);
let transition = 'fade';
let duration = 0.7;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-t') transition = args[++i];
  else if (args[i] === '-d') duration = Number(args[++i]);
  else rest.push(args[i]);
}
const [input, afterArg, output, ...images] = rest;
const after = Number(afterArg);
if (!input || !output || !images.length || !Number.isInteger(after) || !(transition in TRANSITIONS)) {
  console.error('usage: node tools/insert-images.mjs <in.pdf> <after-page> <out.pdf> <image>... [-t fade|dissolve|push|wipe|none] [-d 0.7]');
  process.exit(1);
}

const pdf = await PDFDocument.load(await readFile(input));
if (after < 0 || after > pdf.getPageCount()) {
  console.error(`after-page must be between 0 and ${pdf.getPageCount()}`);
  process.exit(1);
}
// Match the deck's page size (960×540 pt from export-pdf.mjs)
const ref = pdf.getPageCount() ? pdf.getPage(0) : null;
const [w, h] = ref ? [ref.getWidth(), ref.getHeight()] : [960, 540];

for (const [k, file] of images.entries()) {
  const bytes = await readFile(file);
  const img = extname(file).toLowerCase() === '.png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const page = pdf.insertPage(after + k, [w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  const t = TRANSITIONS[transition];
  if (t) page.node.set(PDFName.of('Trans'), pdf.context.obj({ Type: 'Trans', ...t, D: duration }));
}

await writeFile(output, await pdf.save());
console.log(`✓ ${output}: inserted ${images.length} page(s) after page ${after}, now ${pdf.getPageCount()} pages`);
