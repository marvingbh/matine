/*
 * Platform layer: talks to Tizen (Samsung) or webOS (LG) on the TV, or returns mock data
 * in a desktop browser. One codebase; the platform is picked at runtime.
 * Exposes window.Platform:
 *   name        'tizen' | 'webos' | 'browser'
 *   isTizen     Samsung TV
 *   isWebOS     LG TV
 *   isTV        either of them (false = desktop preview)
 *   lite        old/slow TV: smaller images, no crossfades, fewer rows in the DOM
 *   chrome      Chromium major version from the user agent (0 if unknown)
 *   backKey     keyCode of the remote's Back key (Tizen 10009, webOS 461)
 *   selfId()    this app's own id (left out of the app list)
 *   getApps()   Promise<[{ id, name, show, iconPath, alt? }]>
 *   launch(ids) Promise: tries the ids in order until one launches
 *   launchDeep(ids, deep)  Promise<bool>: opens the app on a title (js/deeplink.js), falling
 *               back to a plain launch; true if the deep launch went out
 *   registerKeys()  { ColorF0Red, ColorF1Green, ColorF2Yellow, ColorF3Blue, Info } keyCodes
 *   onResume(fn)    fn() when the app comes back to the foreground
 *   inputs()    Promise<[{ label, type, number, connected (true|false|null = unknown), … }]>:
 *               the TV's external inputs (HDMI & co.), without the tuner
 *   openInput(inp)  Promise<'viewer'|'window'>: switches to an input ('window' = Samsung shows
 *               it inside this app, see showInputWindow); rejects if the TV refuses
 *   showInputWindow(on)  Samsung: the input full screen behind this page (the page must
 *               hide itself), or hidden again
 *   network()   Promise<{ type: 'wifi'|'wired'|'none'|'', ssid }>
 *   openNetworkSettings()  Promise: the TV's network settings (else its general settings)
 *
 * Must run on Chromium 53 (LG webOS 4.x): ES5 only.
 */
(function () {
  'use strict';

  var DATA = window.TVHOME_DATA || {};
  var CFG = window.TVHOME_CONFIG || {};
  var UA = navigator.userAgent || '';

  var hasTizen = typeof window.tizen !== 'undefined' && !!window.tizen.application;
  // webOS: PalmSystem is injected by the web app manager; the UA says "Web0S" (with a zero).
  var hasWebOS = !hasTizen && (typeof window.PalmSystem !== 'undefined' ||
    typeof window.PalmServiceBridge !== 'undefined' || /Web0S|webOS/.test(UA));

  var chromeMatch = UA.match(/Chrome\/(\d+)/);
  var chrome = chromeMatch ? parseInt(chromeMatch[1], 10) : 0;

  // Lite mode: Chromium older than 68 means webOS 4.x and older (Chromium 53), or Tizen 5.0
  // and older. Override with ?lite / ?nolite in the URL or `lite: true|false` in config.local.js.
  function detectLite() {
    var q = location.search || '';
    if (/[?&]nolite\b/.test(q)) return false;
    if (/[?&]lite\b/.test(q)) return true;
    if (typeof CFG.lite === 'boolean') return CFG.lite;
    return chrome > 0 && chrome < 68;
  }
  var lite = detectLite();

  // Mock list for desktop preview. Mixes real-looking ids with system entries so the
  // filtering logic gets exercised.
  var MOCK_APPS = [
    { id: 'org.tizen.netflix-app', name: 'Netflix', show: true },
    { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', show: true },
    { id: 'org.tizen.primevideo', name: 'Prime Video', show: true },
    { id: 'MCmYXNxgcu.DisneyPlus', name: 'Disney+', show: true },
    { id: 'Hx9Mock001.Max', name: 'Max', show: true },
    { id: 'Gp7Mock002.Globoplay', name: 'Globoplay', show: true },
    { id: 'rJeHak5zRg.Spotify', name: 'Spotify - Música e podcasts', show: true },
    { id: 'com.samsung.tv.aria-video', name: 'Apple TV', show: true },
    { id: 'Pp3Mock003.ParamountPlus', name: 'Paramount+', show: true },
    { id: 'Tw4Mock004.Twitch', name: 'Twitch', show: true },
    { id: 'Tp5Mock005.TVPlus', name: 'Samsung TV Plus', show: true },
    { id: 'Pl6Mock006.PlutoTV', name: 'Pluto TV', show: true },
    { id: 'org.tizen.browser', name: 'Internet', show: true },
    { id: 'Yk7Mock007.YouTubeKids', name: 'YouTube Kids', show: true },
    { id: 'Ub8Mock008.Ubook', name: 'Ubook', show: true },
    { id: 'Ga9Mock009.Gshow', name: 'Gshow', show: true },
    { id: 'Rk1Mock010.RakutenTV', name: 'Rakuten TV', show: true },
    { id: 'com.samsung.tv.gallery', name: 'Galeria', show: true },
    { id: 'org.tizen.tv-viewer', name: 'TV', show: false },
    { id: 'com.samsung.tv.settings', name: 'Configurações', show: false },
    { id: 'com.samsung.tv.notification-service', name: '', show: false },
    { id: 'org.tizen.homescreen-efl', name: 'Home', show: false },
    { id: 'TvHome0001.Home', name: 'Matinê', show: true }
  ];

  function normalizeInfo(a) {
    return {
      id: a.id,
      name: a.name || '',
      show: typeof a.show === 'boolean' ? a.show : true,
      iconPath: a.iconPath || '',
      categories: a.categories || []
    };
  }

  // ======================= webOS (LG) =======================

  // Luna service call, the way webOSTV.js's webOS.service.request does it: a
  // PalmServiceBridge per call, the answer arrives in onservicecallback as a JSON string.
  // Uses webOSTV.js itself when it is loaded (js/vendor/webOSTV.js).
  var pendingBridges = {};   // keep bridges referenced until they answer (else they can be GC'd)
  var bridgeSeq = 0;

  function luna(service, method, params) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function ok(res) { if (done) return; done = true; resolve(res || {}); }
      function fail(res) { if (done) return; done = true; reject(res || { errorText: 'luna call failed' }); }
      var timer = setTimeout(function () { fail({ errorText: 'timeout ' + service + '/' + method }); }, 8000);
      function okT(r) { clearTimeout(timer); ok(r); }
      function failT(r) { clearTimeout(timer); fail(r); }

      if (window.webOS && window.webOS.service && typeof window.webOS.service.request === 'function') {
        try {
          window.webOS.service.request(service, {
            method: method, parameters: params || {},
            onSuccess: okT, onFailure: failT
          });
        } catch (e) { failT({ errorText: String(e) }); }
        return;
      }
      if (typeof window.PalmServiceBridge === 'undefined') { failT({ errorText: 'no PalmServiceBridge' }); return; }
      try {
        var id = ++bridgeSeq;
        var bridge = new window.PalmServiceBridge();
        pendingBridges[id] = bridge;
        bridge.onservicecallback = function (msg) {
          delete pendingBridges[id];
          try { bridge.cancel(); } catch (e0) {}   // one-shot call, as webOSTV.js does
          var res;
          try { res = typeof msg === 'string' ? JSON.parse(msg) : msg; } catch (e) { failT({ errorText: 'bad JSON' }); return; }
          if (res && res.returnValue === false) failT(res); else okT(res);
        };
        var uri = service.charAt(service.length - 1) === '/' ? service + method : service + '/' + method;
        bridge.call(uri, JSON.stringify(params || {}));
      } catch (e2) { failT({ errorText: String(e2) }); }
    });
  }

  var AM = 'luna://com.webos.applicationManager';

  function webosSelfId() {
    try {
      if (window.webOS && typeof window.webOS.fetchAppId === 'function') {
        var a = window.webOS.fetchAppId();
        if (a) return a;
      }
      if (window.PalmSystem && window.PalmSystem.identifier) return String(window.PalmSystem.identifier).split(' ')[0];
    } catch (e) {}
    return 'com.marcus.tvhome';
  }

  function fromLaunchPoints(res) {
    return (res.launchPoints || []).map(function (lp) {
      return normalizeInfo({ id: lp.id, name: lp.title, show: true, iconPath: lp.icon || lp.largeIcon || '' });
    });
  }

  function fromListApps(res) {
    return (res.apps || []).map(function (a) {
      return normalizeInfo({ id: a.id, name: a.title, show: a.visible !== false && !a.hidden, iconPath: a.icon || '' });
    });
  }

  // When the TV refuses both listing calls (it does for developer-mode apps on webOS 6 and
  // later: listLaunchPoints/listApps are not in the "public" security group), fall back to
  // the curated list: every webOS id in js/apps-data.js is checked with getAppLoadStatus
  // (public, webOS 4.0+), and the first installed id of each app is used. If that call fails
  // too, the app is assumed installed (first id, the others kept as `alt` for launch).
  function appExists(id) {
    return luna(AM, 'getAppLoadStatus', { appId: id }).then(function (res) {
      return res.exist === true ? true : res.exist === false ? false : null;
    }, function () { return null; });
  }

  function staticWebOSList() {
    var entries = (DATA.curated || []).concat(DATA.special || []).filter(function (e) {
      return e.webos && e.webos.length;
    });
    return Promise.all(entries.map(function (e) {
      return Promise.all(e.webos.map(appExists)).then(function (found) {
        var ids = e.webos.filter(function (id, i) { return found[i] === true; });
        var unknown = e.webos.filter(function (id, i) { return found[i] === null; });
        if (!ids.length && !unknown.length) return null;            // checked: not installed
        var all = ids.concat(unknown);
        var app = normalizeInfo({ id: all[0], name: e.name, show: true });
        app.alt = all.slice(1);
        app.assumed = !ids.length;
        return app;
      });
    })).then(function (apps) { return apps.filter(Boolean); });
  }

  var webosListSource = '';   // which call answered, for the IDs screen and debugging

  function webosGetApps() {
    return luna(AM, 'listLaunchPoints', {}).then(function (res) {
      var list = fromLaunchPoints(res);
      if (!list.length) throw { errorText: 'empty launchPoints' };
      webosListSource = 'listLaunchPoints';
      return list;
    }).then(null, function (err) {
      console.warn('listLaunchPoints failed', err && err.errorText);
      return luna(AM, 'listApps', {}).then(function (res) {
        var list = fromListApps(res);
        if (!list.length) throw { errorText: 'empty apps' };
        webosListSource = 'listApps';
        return list;
      });
    }).then(null, function (err) {
      console.warn('listApps failed, using the static list', err && err.errorText);
      webosListSource = 'static';
      return staticWebOSList();
    });
  }

  // deep (optional): { params } handed to the app (contentTarget & co., see js/deeplink.js).
  function webosLaunchOne(id, deep) {
    var req = { id: id };
    if (deep && deep.params) req.params = deep.params;
    return luna(AM, 'launch', req).then(function () { return id; });
  }

  // ======================= Tizen (Samsung) =======================

  function tizenSelfId() {
    try { return tizen.application.getCurrentApplication().appInfo.id; } catch (e) { return 'TvHome0001.Home'; }
  }

  function tizenGetApps() {
    return new Promise(function (resolve) {
      try {
        tizen.application.getAppsInfo(function (list) {
          resolve(list.map(normalizeInfo));
        }, function (err) {
          console.error('getAppsInfo failed', err);
          resolve([]);
        });
      } catch (e) {
        console.error('getAppsInfo threw', e);
        resolve([]);
      }
    });
  }

  function tizenLaunchOne(id) {
    return new Promise(function (resolve, reject) {
      try {
        tizen.application.launch(id, function () { resolve(id); }, function (err) {
          // Fallback: explicit ApplicationControl with the default operation.
          try {
            var ctrl = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, null);
            tizen.application.launchAppControl(ctrl, id, function () { resolve(id); }, function (err2) {
              reject(err2 || err);
            }, null);
          } catch (e2) { reject(err); }
        });
      } catch (e) { reject(e); }
    });
  }

  // ======================= common =======================

  function selfId() {
    if (hasTizen) return tizenSelfId();
    if (hasWebOS) return webosSelfId();
    return 'TvHome0001.Home';
  }

  function getApps() {
    if (hasTizen) return tizenGetApps();
    if (hasWebOS) return webosGetApps();
    return Promise.resolve(MOCK_APPS.map(normalizeInfo));
  }

  function launchOne(id, deep) {
    if (hasTizen) return tizenLaunchOne(id);
    if (hasWebOS) return webosLaunchOne(id, deep);
    console.log('[mock] launch', id, deep ? JSON.stringify(deep) : '');
    return Promise.resolve(id);
  }

  // Try ids in order until one launches.
  function launch(ids, deep) {
    var i = 0;
    return new Promise(function (resolve, reject) {
      var lastErr = null;
      (function next() {
        if (i >= ids.length) { reject(lastErr || new Error('no id')); return; }
        var id = ids[i++];
        launchOne(id, deep).then(resolve, function (err) { lastErr = err; next(); });
      })();
    });
  }

  // Open an app on a title: deep = { webos: { params } } from js/deeplink.js, or null.
  // Only LG has a way (launch params); Samsung launches plainly. If the deep launch is
  // refused (Luna error), the app is launched plainly. Resolves true when the deep launch went out, false after the plain fallback.
  // (An app that ignores what it was given still just opens on its home: we cannot tell.)
  function launchDeep(ids, deep) {
    var d = deep && !hasTizen ? deep.webos : null;
    if (!d) return launch(ids).then(function () { return false; });
    return launch(ids, d).then(function () { return true; }, function (err) {
      console.warn('deep launch failed, plain launch', err);
      return launch(ids).then(function () { return false; });
    });
  }

  // Samsung: arrows, Enter and Back are delivered by default; the colour keys and Info
  // must be registered. LG: every key is delivered with these fixed codes (Back = 461 once
  // appinfo.json has "disableBackHistoryAPI": true).
  var EXTRA_KEYS = ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info'];

  function registerKeys() {
    var codes = { ColorF0Red: 403, ColorF1Green: 404, ColorF2Yellow: 405, ColorF3Blue: 406, Info: 457 };
    if (window.tizen && tizen.tvinputdevice) {
      try {
        if (tizen.tvinputdevice.registerKeyBatch) {
          tizen.tvinputdevice.registerKeyBatch(EXTRA_KEYS, null, function (e) { console.warn('registerKeyBatch', e); });
        } else {
          EXTRA_KEYS.forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) {} });
        }
        EXTRA_KEYS.forEach(function (k) {
          try { codes[k] = tizen.tvinputdevice.getKey(k).code; } catch (e) {}
        });
      } catch (e) { console.warn('tvinputdevice unavailable', e); }
    }
    return codes;
  }

  // Back in the foreground: visibilitychange on both platforms; on webOS also
  // webOSRelaunch (the app was launched again while it was still running).
  function onResume(fn) {
    var last = 0;
    function fire() {
      var now = Date.now();
      if (now - last < 500) return;     // both events can fire for one return
      last = now;
      fn();
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) fire(); });
    if (hasWebOS) {
      document.addEventListener('webOSRelaunch', function () {
        try { if (window.PalmSystem && window.PalmSystem.activate) window.PalmSystem.activate(); } catch (e) {}
        fire();
      }, true);
    }
  }

  // ======================= inputs and network (top bar) =======================
  // Samsung: the inputs come from tizen.systeminfo VIDEOSOURCE (no privilege; each with a
  // connected flag). Switching uses the TV Window API (privilege tv.window in config.xml):
  // setSource on the MAIN window, then the TV's own viewer (org.tizen.tv-viewer) is opened
  // to show it with the remote passed through to the device (HDMI-CEC). CFG.samsungInput
  // 'window' instead shows the input full screen inside this app (Back returns).
  // LG: com.webos.service.eim/getAllInputStatus (connected flag); if the TV refuses it, the
  // inputs apps com.webos.app.hdmi1..4 that exist. Switching launches that app, the way
  // LG's own launcher and the CleanYourTV LG launcher do.

  var TYPE_LABEL = { HDMI: 'HDMI', AV: 'AV', COMP: 'Componente', PC: 'PC', DVI: 'DVI', SCART: 'SCART', SVIDEO: 'S-Video' };

  function tizenInputs() {
    return new Promise(function (resolve, reject) {
      try {
        tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (v) {
          var out = [];
          function add(list, on) {
            (list || []).forEach(function (src) {
              if (!TYPE_LABEL[src.type]) return;          // TV (the tuner row) and MEDIA (USB)
              var name = TYPE_LABEL[src.type] + ' ' + src.number;
              out.push({ label: src.editName || name, sub: src.editName ? name : '', type: src.type,
                number: src.number, connected: on, src: src });
            });
          }
          add(v && v.connected, true);
          add(v && v.disconnected, false);
          out.sort(function (a, b) { return a.type === b.type ? a.number - b.number : (a.type < b.type ? -1 : 1); });
          resolve(out);
        }, reject);
      } catch (e) { reject(e); }
    });
  }

  var tvViewer = ((DATA.special || []).filter(function (e) { return e.key === 'livetv'; })[0] || {}).ids || ['org.tizen.tv-viewer'];

  function tizenSetSource(inp) {
    return new Promise(function (resolve, reject) {
      try { tizen.tvwindow.setSource(inp.src, resolve, reject, 'MAIN'); } catch (e) { reject(e); }
    });
  }

  function tizenOpenInput(inp) {
    if (!window.tizen.tvwindow) return Promise.reject({ message: 'no tvwindow' });
    return tizenSetSource(inp).then(function () {
      if (CFG.samsungInput === 'window') return 'window';
      return launch(tvViewer).then(function () { return 'viewer'; }, function () { return 'window'; });
    });
  }

  function tizenShowInputWindow(on) {
    return new Promise(function (resolve, reject) {
      try {
        if (on) tizen.tvwindow.show(resolve, reject, ['0px', '0px', '100%', '100%'], 'MAIN');
        else tizen.tvwindow.hide(resolve, reject, 'MAIN');
      } catch (e) { reject(e); }
    });
  }

  function hdmiLabel(s) { return String(s || '').replace(/^HDMI\s*(\d)$/i, 'HDMI $1'); }

  function webosInputs() {
    return luna('luna://com.webos.service.eim', 'getAllInputStatus', {}).then(function (res) {
      var list = (res.devices || []).filter(function (d) { return d.appId; }).map(function (d) {
        var name = hdmiLabel(d.id ? String(d.id).replace('_', ' ') : d.label);
        var label = hdmiLabel(d.label) || name;
        return { label: label, sub: label !== name ? name : '', type: 'HDMI', appId: d.appId,
          connected: typeof d.connected === 'boolean' ? d.connected : null };
      });
      if (!list.length) throw { errorText: 'no inputs' };
      return list;
    }).then(null, function (err) {
      console.warn('getAllInputStatus failed, checking the HDMI apps', err && err.errorText);
      var ids = [1, 2, 3, 4].map(function (n) { return 'com.webos.app.hdmi' + n; });
      return Promise.all(ids.map(appExists)).then(function (found) {
        return ids.map(function (id, i) {
          return found[i] === false ? null : { label: 'HDMI ' + (i + 1), type: 'HDMI', appId: id, connected: null };
        }).filter(Boolean);
      });
    });
  }

  function inputs() {
    if (hasTizen) return tizenInputs();
    if (hasWebOS) return webosInputs();
    return Promise.resolve([
      { label: 'PlayStation 5', sub: 'HDMI 1', type: 'HDMI', number: 1, connected: true },
      { label: 'HDMI 2', type: 'HDMI', number: 2, connected: false },
      { label: 'HDMI 3', type: 'HDMI', number: 3, connected: true }
    ]);
  }

  function openInput(inp) {
    if (hasTizen) return tizenOpenInput(inp);
    if (hasWebOS) return webosLaunchOne(inp.appId).then(function () { return 'viewer'; });
    console.log('[mock] input', inp.label);
    return Promise.resolve('viewer');
  }

  function showInputWindow(on) {
    if (hasTizen && window.tizen.tvwindow) return tizenShowInputWindow(on);
    return Promise.resolve();
  }

  // Network status for the Wi-Fi pill: one call, no subscription.
  function tizenProp(name) {
    return new Promise(function (resolve, reject) {
      try { tizen.systeminfo.getPropertyValue(name, resolve, reject); } catch (e) { reject(e); }
    });
  }

  function network() {
    if (hasTizen) {
      return tizenProp('NETWORK').then(function (n) {
        if (n.networkType === 'WIFI') {
          return tizenProp('WIFI_NETWORK').then(function (w) { return { type: 'wifi', ssid: w.ssid || '' }; },
            function () { return { type: 'wifi', ssid: '' }; });
        }
        return { type: n.networkType === 'ETHERNET' ? 'wired' : n.networkType === 'NONE' ? 'none' : '', ssid: '' };
      });
    }
    if (hasWebOS) {
      return luna('luna://com.palm.connectionmanager', 'getStatus', {}).then(function (r) {
        if (r.wired && r.wired.state === 'connected') return { type: 'wired', ssid: '' };
        if (r.wifi && r.wifi.state === 'connected') return { type: 'wifi', ssid: r.wifi.ssid || '' };
        return { type: r.isInternetConnectionAvailable === false ? 'none' : '', ssid: '' };
      });
    }
    return Promise.resolve({ type: 'wifi', ssid: 'Casa' });
  }

  // Network settings. LG: the candidates of the CleanYourTV LG launcher (the network page of
  // the first-use overlay on recent webOS, then Settings on its network page, then plain
  // Settings). Samsung: the network page of Settings (app ids found on the QN50Q60), then
  // Settings itself.
  var NETWORK_SETTINGS = {
    tizen: [{ id: 'com.samsung.tv.coba.setting.networksettings' }, { id: 'org.tizen.NetworkSetting-Tizen' },
      { id: 'com.samsung.tv.coba.setting' }],
    webos: [{ id: 'com.webos.app.firstuse-overlay', params: { target: 'network' } },
      { id: 'com.palm.app.settings', params: { target: 'network' } }, { id: 'com.palm.app.settings' }]
  };

  function openNetworkSettings() {
    var list = NETWORK_SETTINGS[hasTizen ? 'tizen' : 'webos'];
    var i = 0;
    return new Promise(function (resolve, reject) {
      (function next(err) {
        var c = list[i++];
        if (!c) { reject(err || new Error('no settings app')); return; }
        if (!hasTizen && !hasWebOS) { console.log('[mock] launch', c.id); resolve(c.id); return; }
        launchOne(c.id, c.params ? { params: c.params } : null).then(resolve, next);
      })();
    });
  }

  if (lite && document.body) document.body.className += ' is-lite';

  window.Platform = {
    name: hasTizen ? 'tizen' : hasWebOS ? 'webos' : 'browser',
    isTizen: hasTizen,
    isWebOS: hasWebOS,
    isTV: hasTizen || hasWebOS,
    lite: lite,
    chrome: chrome,
    backKey: hasWebOS ? 461 : 10009,
    selfId: selfId,
    getApps: getApps,
    launch: launch,
    launchDeep: launchDeep,
    registerKeys: registerKeys,
    onResume: onResume,
    listSource: function () { return hasWebOS ? webosListSource : ''; },
    inputs: inputs,
    openInput: openInput,
    showInputWindow: showInputWindow,
    network: network,
    openNetworkSettings: openNetworkSettings,
    luna: luna
  };
})();
