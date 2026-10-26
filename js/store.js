/*
 * localStorage helpers. Every access is wrapped: storage can be full, disabled or throw.
 * Exposes window.Store.
 *   tvhome.lastFocus   last focused home item (app.js)
 *   tvhome.history     the watch history (see js/smart.js)
 *   tvhome.c.<key>     cached API responses: { t: savedAt, v: value }
 */
(function () {
  'use strict';

  var CACHE = 'tvhome.c.';

  function get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }

  function set(k, v) {
    try { window.localStorage.setItem(k, v); return true; } catch (e) {
      // Probably full: drop the API cache (it can be refetched) and try once more.
      clearCache();
      try { window.localStorage.setItem(k, v); return true; } catch (e2) { return false; }
    }
  }

  function getJSON(k, fallback) {
    var s = get(k);
    if (!s) return fallback;
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  function setJSON(k, v) { return set(k, JSON.stringify(v)); }

  // Returns { v, fresh } or null. Stale entries are still returned (fresh: false) so the
  // TV can show something when it is offline.
  function cacheGet(key, ttlMs) {
    var e = getJSON(CACHE + key, null);
    if (!e || typeof e.t !== 'number') return null;
    return { v: e.v, fresh: Date.now() - e.t < ttlMs };
  }

  function cachePut(key, v) { setJSON(CACHE + key, { t: Date.now(), v: v }); }

  function clearCache() {
    try {
      var ls = window.localStorage, drop = [];
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k && k.indexOf(CACHE) === 0) drop.push(k);
      }
      drop.forEach(function (k) { ls.removeItem(k); });
    } catch (e) {}
  }

  window.Store = {
    get: get,
    set: set,
    getJSON: getJSON,
    setJSON: setJSON,
    cacheGet: cacheGet,
    cachePut: cachePut,
    clearCache: clearCache
  };
})();
