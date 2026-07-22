'use strict';

/**
 * Patches .strapi/client/index.html after `strapi build`.
 * Replaces any title with "AIA-VEGA" and injects
 * an early inline script that intercepts all subsequent title writes
 * so the tab never shows another product name.
 *
 * Run automatically via the `postbuild` npm script.
 */

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '.strapi', 'client', 'index.html');

if (!fs.existsSync(HTML_PATH)) {
  console.error('[patch-admin-title] File not found:', HTML_PATH);
  process.exit(0); // Non-fatal — dev mode doesn't always produce this file
}

let html = fs.readFileSync(HTML_PATH, 'utf8');
const originalHtml = html;

// 1. Replace the <title> tag
html = html.replace(/<title>[^<]*<\/title>/i, '<title>AIA-VEGA</title>');

// 2. Inject early intercept script immediately after <head> opening tag
//    Only inject once (idempotent re-runs)
const INJECT_MARKER = 'data-aia-title-patch="1"';
if (!html.includes(INJECT_MARKER)) {
  const inlineScript = `
  <script ${INJECT_MARKER}>
    (function () {
      var ADMIN_TAB_TITLE = 'AIA-VEGA';
      function setExactTitle() {
        var t = document.getElementsByTagName('title')[0];
        if (t && t.textContent !== ADMIN_TAB_TITLE) {
          t.textContent = ADMIN_TAB_TITLE;
        }
      }
      // Immediately correct title if Strapi set it before this script ran
      var titleEl = document.getElementsByTagName('title')[0];
      setExactTitle();
      // Intercept document.title = '...' assignments
      try {
        Object.defineProperty(document, 'title', {
          set: function () {
            setExactTitle();
          },
          get: function () {
            return ADMIN_TAB_TITLE;
          },
          configurable: true,
        });
      } catch (e) {}
      // Watch for direct DOM mutations on <title>
      if (titleEl && window.MutationObserver) {
        new MutationObserver(function (ms) {
          ms.forEach(function () {
            setExactTitle();
          });
        }).observe(titleEl, { childList: true, characterData: true, subtree: true });
      }
    })();
  </script>`;

  html = html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${inlineScript}`);
}

if (html !== originalHtml) {
  fs.writeFileSync(HTML_PATH, html, 'utf8');
  console.log('[patch-admin-title] Patched:', HTML_PATH);
} else {
  console.log('[patch-admin-title] No change needed:', HTML_PATH);
}
