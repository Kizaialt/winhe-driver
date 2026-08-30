/*
 * Peaklab demo mode - drive the full configurator with no keyboard attached.
 *
 * Open  ?demo=1            WIN 60 HE
 *       ?demo=SI2828HEARGB WIN 68 HE (any product from config/device.json)
 * or click "Демо горим" on the connect screen.
 *
 * How it works
 * ------------
 * We do NOT fake the UI. We hand the vendor's own deviceInitialization() a
 * stand-in HIDDevice, so the real code path runs: it loads the key layout from
 * config/keys/<product>.json, builds its default 5-profile config, renders
 * every menu and applies the translation.
 *
 * The stand-in only has to answer one message. The vendor's identity probe
 * (report 0x0D) spins in an unbounded loop until the keyboard replies, so that
 * one gets a real response. Every other read is bounded - `while (!done &&
 * waitCount < 10)` - so staying silent just lets those settle on defaults,
 * which is exactly what a demo wants.
 *
 * Nothing here runs unless demo mode is explicitly requested, so customers
 * with a real keyboard are unaffected.
 */
(function () {
  'use strict';

  var DEFAULT_PRODUCT = 'SI2825HEARGB'; // WIN 60 HE
  var REPORT_SIZE = 63;
  var CMD_IDENTITY = 0x0d;

  var TEXT = {
    mn: {
      button: 'Демо горим',
      banner: 'ДЕМО ГОРИМ — гар холбогдоогүй. Энд хийсэн тохиргоо хаана ч хадгалагдахгүй.',
      exit: 'Гарах'
    },
    en: {
      button: 'Demo mode',
      banner: 'DEMO MODE — no keyboard connected. Nothing here is written to a device.',
      exit: 'Exit'
    }
  };

  function t(key) {
    var loc = (typeof i18n !== 'undefined' && TEXT[i18n]) ? i18n : 'en';
    return TEXT[loc][key];
  }

  /* getI18n() throws if called before config/language.json has loaded, so
     read the table defensively and fall back to our own strings. */
  function vendorText(key, fallback) {
    try {
      if (typeof lang !== 'undefined' && lang &&
          typeof i18n !== 'undefined' && lang[i18n] && lang[i18n][key]) {
        return lang[i18n][key];
      }
    } catch (e) { /* not ready */ }
    return fallback;
  }

  /* ---------------- stand-in device ---------------- */

  /*
   * Reply to the capability probe (0x01).
   *
   * The vendor's dispatcher reads slice = report.slice(5, 0x17) and derives
   * which features - and therefore which menus - exist on this keyboard:
   *
   *   slice[9]        SOCD                       -> report[14]
   *   slice[12] bits  1 calibration   2 custom light   4 switch list
   *                   8 polling rate 16 dead band    32 music rhythm
   *                 128 N-key/6-key              -> report[17]
   *   slice[13] bits  1 high precision  4 gamepad  8 RS  16 RKRT
   *                                              -> report[18]
   *   slice[16]       music rhythm currently on  -> report[21]
   *   slice[17] bit 1 6-key mode                 -> report[22]
   *
   * The demo advertises the full set so every menu is reachable; a real
   * keyboard reports its own capabilities instead.
   */
  function capabilityReport() {
    var out = new Uint8Array(REPORT_SIZE);
    out[0] = 0x01;
    out[10] = 0x00; // triMode: USB
    out[14] = 0x01; // SOCD
    out[17] = 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x80;
    out[18] = 0x01 | 0x04 | 0x08 | 0x10;
    out[20] = 0x00; // performance view default
    out[21] = 0x00; // music rhythm off
    out[22] = 0x00; // N-key mode (not 6-key)
    return out;
  }

  /*
   * Anything else: echo the command byte back with a zeroed payload.
   *
   * Every read is shaped `while (!flag && waitCount < 10) await tick()`, and
   * the dispatcher sets that flag on `report[0] === command`. Echoing makes
   * each read finish on the first tick instead of burning ten - which matters
   * because a backgrounded tab throttles setTimeout to ~1s, turning twenty
   * silent reads into minutes. Zeroed payloads read as "nothing configured",
   * so the UI falls back to its defaults.
   */
  function echoReport(cmd) {
    var out = new Uint8Array(REPORT_SIZE);
    out[0] = cmd;
    return out;
  }

  function identityReport(product, version) {
    var out = new Uint8Array(REPORT_SIZE);
    // The parser splits on ',' and reads [4] as product, [5] as version.
    var info = 'AULA,0,0,0,' + product + ',V' + String(version).replace(/\./g, '_');
    var bytes = new TextEncoder().encode(info);

    out[0] = CMD_IDENTITY;
    out[1] = 0x00;              // 0 = ok
    out[3] = 0x00;              // parser requires this
    out[4] = 5 + bytes.length;  // it slices subarray(5, out[4]) - absolute end
    out.set(bytes, 5);
    return out;
  }

  function makeDevice(entry, version) {
    var dev = {
      vendorId: entry.vid,
      productId: entry.pid,
      productName: entry.name,
      opened: false,
      oninputreport: null,
      collections: [{
        usagePage: 0xff1b,
        usage: 0x91,
        inputReports: [{ reportId: 1 }],
        outputReports: [{ reportId: 1 }]
      }],
      open: function () { dev.opened = true; return Promise.resolve(); },
      close: function () { dev.opened = false; return Promise.resolve(); },
      forget: function () { return Promise.resolve(); },
      addEventListener: function () {},
      removeEventListener: function () {},
      sendFeatureReport: function () { return Promise.resolve(); },
      receiveFeatureReport: function () {
        return Promise.resolve(new DataView(new ArrayBuffer(REPORT_SIZE)));
      },
      sendReport: function (reportId, data) {
        var cmd = data && data.length ? data[0] : -1;
        if (cmd === CMD_IDENTITY) {
          deliver(identityReport(entry.product, version));
        } else if (cmd >= 0) {
          deliver(cmd === 0x01 ? capabilityReport() : echoReport(cmd));
        }
        return Promise.resolve();
      }
    };

    function deliver(bytes) {
      setTimeout(function () {
        if (typeof dev.oninputreport === 'function') {
          dev.oninputreport({ reportId: 1, data: new DataView(bytes.buffer) });
        }
      }, 0);
    }

    return dev;
  }

  /* ---------------- banner ---------------- */

  function showBanner() {
    if (document.getElementById('peaklabDemoBanner')) return;

    // Anchored to the bottom on purpose: the app positions its keyboard view
    // absolutely from the top, so a top bar (or any body padding to clear one)
    // pushes panels out of alignment.
    var bar = document.createElement('div');
    bar.id = 'peaklabDemoBanner';
    bar.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:99999',
      'background:#b45309', 'color:#fff',
      'font:600 13px/1.4 "Microsoft YaHei",Arial,sans-serif',
      'padding:7px 14px', 'text-align:center',
      'display:flex', 'align-items:center', 'justify-content:center', 'gap:14px',
      'box-shadow:0 -1px 6px rgba(0,0,0,.4)'
    ].join(';');

    var label = document.createElement('span');
    label.textContent = t('banner');

    var exit = document.createElement('button');
    exit.textContent = t('exit');
    exit.style.cssText = [
      'background:rgba(0,0,0,.28)', 'color:#fff', 'border:1px solid rgba(255,255,255,.5)',
      'border-radius:4px', 'padding:2px 12px', 'cursor:pointer', 'font:inherit'
    ].join(';');
    exit.onclick = function () {
      location.href = location.pathname; // drop ?demo and reload clean
    };

    bar.appendChild(label);
    bar.appendChild(exit);
    document.body.appendChild(bar);
  }

  /* ---------------- keep demo edits out of real settings ---------------- */

  /*
   * The app persists profiles to localStorage[curDevice.product], and reloads
   * them the next time a keyboard of that product connects. Without this, a
   * customer who plays with the demo would find those edits applied to their
   * actual keyboard later. Reads still work - showing an existing profile is
   * fine - but writes to that key are dropped.
   */
  function sandboxStorage(product) {
    try {
      var native = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (key, value) {
        if (key === product) return; // demo edits stop here
        return native(key, value);
      };
    } catch (e) { /* storage unavailable; nothing to protect */ }
  }

  /* ---------------- start ---------------- */

  function vendorReady() {
    return typeof deviceInitialization === 'function' &&
           typeof devList !== 'undefined' && devList && devList.length > 0;
  }

  function findEntry(product) {
    for (var i = 0; i < devList.length; i++) {
      if (devList[i].product === product) return devList[i];
    }
    return null;
  }

  function firmwareVersionFor(product) {
    return fetch('config/firmware.json')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var list = (j && j.device) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].product === product) return list[i].version;
        }
        return '3.00.00';
      })
      .catch(function () { return '3.00.00'; });
  }

  var started = false;

  function start(product) {
    if (started) return Promise.resolve();
    product = product || DEFAULT_PRODUCT;

    return new Promise(function (resolve, reject) {
      var tries = 0;
      var timer = setInterval(function () {
        if (vendorReady()) {
          clearInterval(timer);
          resolve();
        } else if (++tries > 200) {
          clearInterval(timer);
          reject(new Error('vendor scripts did not finish loading'));
        }
      }, 50);
    })
      .then(function () {
        if (typeof curDevice !== 'undefined' && curDevice) {
          throw new Error('a real keyboard is already connected');
        }
        var entry = findEntry(product);
        if (!entry) {
          throw new Error('unknown product "' + product + '" - not in config/device.json');
        }
        started = true;
        sandboxStorage(product);
        return firmwareVersionFor(product).then(function (version) {
          return deviceInitialization([makeDevice(entry, version)]);
        });
      })
      .then(function () {
        showBanner();
        console.log('[peaklab] demo mode active:', product);
      })
      .catch(function (err) {
        started = false;
        console.error('[peaklab] demo mode failed:', err.message);
        throw err;
      });
  }

  /* ---------------- wiring ---------------- */

  function addButton() {
    var host = document.querySelector('.extraBtn');
    if (!host || document.getElementById('peaklabDemoBtn')) return;

    var btn = document.createElement('button');
    btn.id = 'peaklabDemoBtn';
    btn.className = 'btn';
    btn.onclick = function () {
      btn.disabled = true;
      start().catch(function () { btn.disabled = false; });
    };
    host.appendChild(btn);

    // 'mockDevice' already exists in every vendor locale ("Демо горим"), so
    // use it when the table is loaded and our own string until then.
    function label() {
      btn.textContent = vendorText('mockDevice', t('button'));
    }
    label();

    var tries = 0;
    var timer = setInterval(function () {
      label();
      if (typeof lang !== 'undefined' && lang && lang[i18n] || ++tries > 200) {
        clearInterval(timer);
      }
    }, 50);

    // Keep the label in step with the language picker.
    document.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'language') setTimeout(label, 0);
    }, false);
  }

  // Public handle, so it can also be triggered from the console.
  window.peaklabDemo = start;

  var requested = /[?&]demo(=|&|$)/.test(location.search) || location.hash === '#demo';
  var param = (location.search.match(/[?&]demo=([^&]*)/) || [])[1];
  var wanted = param && param !== '1' && param !== 'true'
    ? decodeURIComponent(param)
    : DEFAULT_PRODUCT;

  function boot() {
    addButton();
    if (requested) start(wanted).catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
