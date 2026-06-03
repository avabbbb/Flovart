// Flovart popup i18n helper.
// Substitutes [data-i18n] textContent and [data-i18n-attr] attributes
// with chrome.i18n.getMessage lookups. Also exposes window.t() for
// dynamic strings used in popup.js status / error messages.

(function () {
  'use strict';

  // window.t(key, ...args) — supports $1/$2 placeholders.
  function t(key) {
    if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
      var raw = chrome.i18n.getMessage(key);
      if (raw) {
        for (var i = 1; i < arguments.length; i++) {
          raw = raw.replace(new RegExp('\\$' + i, 'g'), String(arguments[i]));
        }
        return raw;
      }
    }
    return key;
  }

  // window.tHtml(key) — alias for [data-i18n] innerHTML (use sparingly).
  function tHtml(key) { return t(key); }

  // Apply i18n to the DOM after load.
  function applyDom(root) {
    var scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      var msg = t(key);
      if (msg) {
        // For <option> elements and <title>, set textContent.
        // For regular spans, set textContent as well.
        el.textContent = msg;
      }
    });

    scope.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var spec = el.getAttribute('data-i18n-attr');
      if (!spec) return;
      // Format: "attr:key[,attr:key]..."
      spec.split(',').forEach(function (pair) {
        var idx = pair.indexOf(':');
        if (idx < 0) return;
        var attr = pair.slice(0, idx).trim();
        var key = pair.slice(idx + 1).trim();
        if (!attr || !key) return;
        var msg = t(key);
        if (msg) el.setAttribute(attr, msg);
      });
    });
  }

  // Expose
  window.t = t;
  window.tHtml = tHtml;
  window.__flovartI18nApply = applyDom;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { applyDom(); });
  } else {
    applyDom();
  }
})();
