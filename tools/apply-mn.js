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
// Keep any mn-only keys we deliberately added, but never the _-prefixed
// metadata (notes, the intentionally-English list): that is documentation for
// whoever edits mn.json, not UI text, and one of them is an array - copying it
// into the shipped locale would put a non-string where getI18n expects a string.
for (const k of Object.keys(mn)) {
  if (k.startsWith('_')) continue;
  if (!(k in merged)) merged[k] = mn[k];
}

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
const OURS = ['peaklab.js', 'demo.js'];
let anchor = /([ \t]*)(<script[^>]+src="js\/clearCache\.min\.js[^"]*"><\/script>)/;

for (const name of OURS) {
  const file = path.join(root, 'js', name);
  const hash = crypto
    .createHash('sha1')
    .update(fs.readFileSync(file))
    .digest('hex')
    .slice(0, 8);
  const tag = '<script type="text/javascript" src="js/' + name + '?v=' + hash + '"></script>';
  const present = new RegExp('<script[^>]*src="js/' + name.replace('.', '\\.') + '[^"]*"></script>');
  const found = html.match(present);

  if (found) {
    if (found[0] !== tag) {
      html = html.replace(found[0], tag);
      out('index.html: ' + name + ' cache tag -> ?v=' + hash);
    }
  } else {
    html = html.replace(anchor, '$1$2\n$1' + tag);
    out('index.html: added js/' + name + '?v=' + hash);
  }
  // chain the next script directly after this one
  anchor = new RegExp('([ \\t]*)(<script[^>]*src="js/' + name.replace('.', '\\.') + '[^"]*"></script>)');
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
for (const n of OURS) {
  if (!fs.existsSync(path.join(root, 'js', n))) problems.push('js/' + n + ' is missing');
  const ref = new RegExp('src="js/' + n.replace(/\./g, '\\.') + '\\?v=[0-9a-f]{8}"');
  if (!ref.test(finalHtml)) problems.push('index.html does not load js/' + n + ' with a cache tag');
}

if (problems.length) {
  out('\nFAILED:');
  problems.forEach((p) => out('  - ' + p));
  process.exit(1);
}
out('\nOK - Mongolian localisation applied' + (changed ? '' : ' (nothing to do)'));
