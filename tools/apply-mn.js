#!/usr/bin/env node
/*
 * Re-applies the Mongolian localisation on top of a clean vendor mirror.
 *
 *   node tools/apply-mn.js
 *
 * Idempotent: safe to run repeatedly, and safe to run again after
 * tools/sync.sh pulls fresh files from hed.aulacn.com.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const out = (s) => process.stdout.write(s + '\n');

const LANG_FILE = path.join(root, 'config', 'language.json');
const HTML_FILE = path.join(root, 'index.html');
const MN_FILE = path.join(__dirname, 'mn.json');

let changed = 0;

/* ---- 1. merge the mn locale into config/language.json ---- */
const mn = JSON.parse(fs.readFileSync(MN_FILE, 'utf8'));
const langs = JSON.parse(fs.readFileSync(LANG_FILE, 'utf8'));

// Every key any upstream locale defines must exist in mn, otherwise
// getI18n() returns '' and the UI renders a blank label.
const upstreamKeys = new Set();
for (const loc of Object.keys(langs)) {
  if (loc === 'mn') continue;
  Object.keys(langs[loc]).forEach((k) => upstreamKeys.add(k));
}
const missing = [...upstreamKeys].filter((k) => !(k in mn));
if (missing.length) {
  out('WARNING: upstream added ' + missing.length + ' key(s) with no Mongolian text.');
  out('  ' + missing.join(', '));
  out('  Add them to tools/mn.json. Falling back to English for those.');
}

const merged = {};
for (const k of upstreamKeys) {
  merged[k] = k in mn ? mn[k] : (langs.en && langs.en[k]) || '';
}
// keep any mn-only keys we deliberately added
for (const k of Object.keys(mn)) if (!(k in merged)) merged[k] = mn[k];

if (JSON.stringify(langs.mn) !== JSON.stringify(merged)) {
  langs.mn = merged;
  fs.writeFileSync(LANG_FILE, JSON.stringify(langs, null, 2), 'utf8');
  out('config/language.json: mn locale written (' + Object.keys(merged).length + ' keys)');
  changed++;
} else {
  out('config/language.json: mn locale already up to date');
}

/* ---- 2. patch index.html ---- */
let html = fs.readFileSync(HTML_FILE, 'utf8');
const before = html;

// 2a. add the Монгол option to the language picker
if (!/<option value="mn"/.test(html)) {
  html = html.replace(
    /(\s*)(<option value="zh-cn">)/,
    '$1<option value="mn">Монгол</option>$1$2'
  );
  out('index.html: added Монгол to the language picker');
}

// 2b. load our patch script after every vendor script.
//     Versioned by content hash: GitHub Pages serves assets with a ~10 minute
//     max-age, and the vendor's own scripts dodge that with ?v=..., so ours
//     needs the same or a fix can sit behind a stale cached copy.
const peaklabPath = path.join(root, 'js', 'peaklab.js');
const hash = crypto
  .createHash('sha1')
  .update(fs.readFileSync(peaklabPath))
  .digest('hex')
  .slice(0, 8);
const scriptTag = '<script type="text/javascript" src="js/peaklab.js?v=' + hash + '"></script>';

if (/src="js\/peaklab\.js/.test(html)) {
  const existing = html.match(/<script[^>]*src="js\/peaklab\.js[^"]*"><\/script>/);
  if (existing && existing[0] !== scriptTag) {
    html = html.replace(existing[0], scriptTag);
    out('index.html: peaklab.js cache tag -> ?v=' + hash);
  }
} else {
  html = html.replace(
    /([ \t]*)(<script[^>]+src="js\/clearCache\.min\.js[^"]*"><\/script>)/,
    '$1$2\n$1' + scriptTag
  );
  out('index.html: added js/peaklab.js?v=' + hash);
}

// 2c. declare Mongolian as the document language
html = html.replace(/<html lang="[^"]*">/, '<html lang="mn">');

if (html !== before) {
  fs.writeFileSync(HTML_FILE, html, 'utf8');
  changed++;
} else {
  out('index.html: already patched');
}

/* ---- 3. verify ---- */
const check = JSON.parse(fs.readFileSync(LANG_FILE, 'utf8'));
const finalHtml = fs.readFileSync(HTML_FILE, 'utf8');
const problems = [];
if (!check.mn) problems.push('config/language.json has no mn locale');
if (!/<option value="mn"/.test(finalHtml)) problems.push('index.html has no mn <option>');
if (!/js\/peaklab\.js/.test(finalHtml)) problems.push('index.html does not load js/peaklab.js');
if (!fs.existsSync(path.join(root, 'js', 'peaklab.js'))) problems.push('js/peaklab.js is missing');

if (problems.length) {
  out('\nFAILED:');
  problems.forEach((p) => out('  - ' + p));
  process.exit(1);
}
out('\nOK - Mongolian localisation applied' + (changed ? '' : ' (nothing to do)'));
