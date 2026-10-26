/*
 * Weather from Open-Meteo (no key): current temperature, WMO weather code, day/night and
 * today's min/max. Refreshes every 30 minutes; the last answer is cached in localStorage.
 * The place comes from TVHOME_CONFIG (lat/lon, or a city name geocoded once).
 * In a desktop browser it shows fixed mock weather only with ?mock or when no place is
 * configured. Exposes window.Weather.
 */
(function () {
  'use strict';

  var CFG = window.TVHOME_CONFIG || {};
  var S = window.Store;
  var REFRESH = 30 * 60 * 1000;
  var configured = (typeof CFG.lat === 'number' && typeof CFG.lon === 'number') || !!CFG.city;
  var mock = window.Platform && !window.Platform.isTV && (/[?&]mock\b/.test(location.search) || !configured);

  function getJSON(url) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.timeout = 12000;
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); }
        } else reject(new Error('HTTP ' + x.status));
      };
      x.onerror = x.ontimeout = function () { reject(new Error('network')); };
      x.send();
    });
  }

  function place() {
    if (typeof CFG.lat === 'number' && typeof CFG.lon === 'number') {
      return Promise.resolve({ lat: CFG.lat, lon: CFG.lon, name: CFG.city || '' });
    }
    var key = 'geo:' + CFG.city;
    var c = S.cacheGet(key, 365 * 24 * 3600 * 1000);
    if (c) return Promise.resolve(c.v);
    return getJSON('https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&format=json&name=' +
      encodeURIComponent(CFG.city)).then(function (r) {
      var g = r.results && r.results[0];
      if (!g) throw new Error('city not found: ' + CFG.city);
      var p = { lat: g.latitude, lon: g.longitude, name: g.name };
      S.cachePut(key, p);
      return p;
    });
  }

  function fetchNow() {
    return place().then(function (p) {
      var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat + '&longitude=' + p.lon +
        '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min' +
        '&timezone=auto&forecast_days=1';
      return getJSON(url).then(function (r) {
        var w = {
          temp: r.current.temperature_2m,
          code: r.current.weather_code,
          isDay: r.current.is_day === 1,
          max: r.daily.temperature_2m_max[0],
          min: r.daily.temperature_2m_min[0],
          place: p.name
        };
        S.cachePut('weather', w);
        return w;
      });
    });
  }

  // ---------- icons (inline SVG, 48x48, currentColor) ----------

  var SUN = '<circle cx="24" cy="24" r="8.5"/><path d="M24 5v5M24 38v5M5 24h5M38 24h5M10.6 10.6l3.5 3.5M33.9 33.9l3.5 3.5M10.6 37.4l3.5-3.5M33.9 14.1l3.5-3.5"/>';
  var MOON = '<path d="M33 31.5A14 14 0 0 1 18.5 11a14 14 0 1 0 18.5 18.6 13.9 13.9 0 0 1-4 1.9z"/>';
  var CLOUD = '<path d="M15 38h19a8 8 0 0 0 .8-16A11 11 0 0 0 13.6 25 6.6 6.6 0 0 0 15 38z"/>';
  var SMALL_SUN = '<circle cx="17" cy="16" r="6"/><path d="M17 4v3M5 16h3M8.5 7.5l2 2M25.5 7.5l-2 2M8.5 24.5l2-2"/>';
  var SMALL_MOON = '<path d="M23 20a9 9 0 0 1-9.5-12.5A9.5 9.5 0 1 0 25 19.3a9 9 0 0 1-2 .7z"/>';
  var CLOUD_LOW = '<path d="M17 40h17a7.5 7.5 0 0 0 .7-15A10 10 0 0 0 15.6 27.7 6.2 6.2 0 0 0 17 40z"/>';
  var CLOUD_HIGH = '<path d="M15 31h19a8 8 0 0 0 .8-16A11 11 0 0 0 13.6 18 6.6 6.6 0 0 0 15 31z"/>';

  var ICONS = {
    clearDay: SUN,
    clearNight: MOON,
    partlyDay: SMALL_SUN + CLOUD_LOW,
    partlyNight: SMALL_MOON + CLOUD_LOW,
    cloudy: CLOUD,
    fog: '<path d="M8 18h32M12 25h28M8 32h26M14 39h20"/>',
    drizzle: CLOUD_HIGH + '<path d="M18 36v3M26 36v3M34 36v3"/>',
    rain: CLOUD_HIGH + '<path d="M17 35l-2 7M25 35l-2 7M33 35l-2 7"/>',
    snow: CLOUD_HIGH + '<path d="M18 38h.01M26 41h.01M34 38h.01M22 44h.01M30 44h.01" stroke-width="4"/>',
    storm: CLOUD_HIGH + '<path d="M25 32l-4 7h6l-4 7"/>'
  };

  // WMO weather interpretation codes (Open-Meteo docs).
  function describe(code, isDay) {
    if (code === 0) return { icon: isDay ? 'clearDay' : 'clearNight', label: isDay ? 'Ensolarado' : 'Céu limpo' };
    if (code <= 2) return { icon: isDay ? 'partlyDay' : 'partlyNight', label: 'Parcialmente nublado' };
    if (code === 3) return { icon: 'cloudy', label: 'Nublado' };
    if (code === 45 || code === 48) return { icon: 'fog', label: 'Neblina' };
    if (code >= 51 && code <= 57) return { icon: 'drizzle', label: 'Garoa' };
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: 'rain', label: 'Chuva' };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'snow', label: 'Neve' };
    if (code >= 95) return { icon: 'storm', label: 'Tempestade' };
    return { icon: 'cloudy', label: '' };
  }

  function iconSvg(name) {
    return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || CLOUD) + '</svg>';
  }

  function decorate(w) {
    var d = describe(w.code, w.isDay);
    w.label = d.label;
    w.icon = iconSvg(d.icon);
    return w;
  }

  // onUpdate(weather) is called with { temp, max, min, code, isDay, label, icon, place }.
  function start(onUpdate) {
    if (mock) {
      var h = new Date().getHours();
      onUpdate(decorate({ temp: 24, code: 2, isDay: h >= 6 && h < 18, max: 28, min: 17, place: CFG.city || 'Belo Horizonte' }));
      return true;
    }
    if (!configured) return false;
    var c = S.cacheGet('weather', REFRESH);
    if (c) onUpdate(decorate(c.v));
    function refresh() {
      fetchNow().then(function (w) { onUpdate(decorate(w)); }, function (err) {
        console.warn('weather', err);
      });
    }
    if (!c || !c.fresh) refresh();
    setInterval(refresh, REFRESH);
    return true;
  }

  window.Weather = { start: start, describe: describe };
})();
