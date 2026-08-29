/*
 * Peaklab localisation patch.
 *
 * Loaded last, after the vendor's own scripts. Does three things:
 *   1. Makes Mongolian the default language for first-time visitors.
 *   2. Restores AULA branding, which the vendor's code only applies on its
 *      own hostnames (aulacn.com, kzzi.com, ...) and skips on ours.
 *   3. Works around a vendor bug: its language <select> handler reads
 *      curDevice.version, which is undefined until a keyboard is connected,
 *      so it throws and the UI never re-renders. On the vendor's own site
 *      that means language switching does nothing until you plug in. Here we
 *      finish the job it aborted.
 *
 * It touches no vendor file, so re-syncing upstream (tools/sync.sh) does not
 * clobber it.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
   * Sub-path support.
   *
   * The vendor site lives at a domain root, so its `../config/x` and
   * `url("../image/x")` references resolve to `/config/x` and `/image/x` -
   * the `..` is a no-op there. Served from a sub-path such as
   * /winhe-driver/, the same strings climb out of the site and 404.
   *
   * Rather than edit obfuscated vendor files, rewrite the two places those
   * strings are used: fetch() calls, and the themes lookup table.
   * At a domain root this is a no-op, so it stays correct if the site later
   * moves to its own domain.
   * ------------------------------------------------------------------ */
  var BASE = location.pathname.replace(/[^/]*$/, ''); // '/winhe-driver/' or '/'

  function rebase(u) {
    return typeof u === 'string' ? u.replace(/\.\.\//g, BASE) : u;
  }

  if (BASE !== '/') {
    if (typeof window.fetch === 'function') {
      var nativeFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        return nativeFetch(typeof input === 'string' ? rebase(input) : input, init);
      };
    }

    /* themes.min.js declares `themes` at top level; classic scripts share the
       global lexical scope, so it is reachable here. Its values are CSS
       strings like url("../image/icon_close.png"). */
    try {
      if (typeof themes === 'object' && themes) {
        for (var name in themes) {
          var table = themes[name];
          if (!table) continue;
          for (var k in table) {
            if (typeof table[k] === 'string' && table[k].indexOf('../') !== -1) {
              table[k] = rebase(table[k]);
            }
          }
        }
      }
    } catch (e) { /* themes not exposed; icons fall back to CSS defaults */ }
  }

  /* ---- Branding. Change these two lines, nothing else. ---- */
  var PAGE_TITLE = 'AULA WIN60 HE / WIN68 HE — Peaklab';
  var WELCOME_KEY = 'welcomeSuoai'; // 'welcome' = unbranded, 'welcomeSuoai' = AULA

  var DEFAULT_LANG = 'mn';

  function stored() {
    try { return localStorage.getItem('language'); } catch (e) { return null; }
  }

  function remember(v) {
    try { localStorage.setItem('language', v); } catch (e) { /* private mode */ }
  }

  function ready() {
    return typeof lang !== 'undefined' && lang && lang[DEFAULT_LANG] &&
           typeof getI18nDom === 'function';
  }

  /* Re-render the UI in `code`. Safe to call after the vendor handler, whether
     that handler succeeded or threw partway. */
  function render(code) {
    try {
      i18n = code;
      document.documentElement.lang = code;
      getI18nDom(document.body);
    } catch (e) { /* nothing sensible left to do */ }
  }

  function applyBranding() {
    if (PAGE_TITLE) document.title = PAGE_TITLE;
    var welcome = document.getElementById('welcome');
    if (welcome && typeof getI18n === 'function') {
      welcome.setAttribute('i18n', WELCOME_KEY);
      welcome.innerText = getI18n(WELCOME_KEY);
    }
  }

  /* First visit (or a previously stored 'mn', which the vendor's own resolver
     downgrades to 'en') means: show Mongolian. */
  function applyDefault() {
    var sel = document.getElementById('language');
    if (!sel || !ready()) return false;

    var saved = stored();
    if (!saved || saved === DEFAULT_LANG) {
      sel.value = DEFAULT_LANG;
      try { if (typeof sel.onchange === 'function') sel.onchange(); } catch (e) { /* vendor bug */ }
      render(DEFAULT_LANG);
      remember(DEFAULT_LANG);
    }
    applyBranding();
    return true;
  }

  /* The vendor boots asynchronously (fetches config/language.json), so poll
     briefly rather than guessing at a ready event. */
  var tries = 0;
  var timer = setInterval(function () {
    if (applyDefault() || ++tries > 200) clearInterval(timer);
  }, 50);

  /* Bubble phase on document => runs after the select's own handler, so we
     pick up the pieces if it threw. */
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || el.id !== 'language' || !ready()) return;
    render(el.value);
    remember(el.value);
    applyBranding();
  }, false);
})();
