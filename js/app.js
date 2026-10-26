/*
 * Home screen UI, laid out like the Apple TV (tvOS) home screen: a Top Shelf (the focused
 * app's suggestions over their artwork, full bleed), a grid of app tiles (5 per row), and
 * under it the poster rows. Also the top bar (Buscar, Entradas, Wi-Fi, Ajustes), the Red
 * menu, the background photos, the clock and the weather, and the remote. The rows, the hero
 * text for a poster and the overlays are drawn by js/discover.js; the search screen by
 * js/search.js.
 *
 * Discovery is one vertical list of rows in pairs, films then series for each category
 * ("Continuar assistindo", "Filmes para você", …). Vertical focus is one loop: top bar →
 * app grid → poster rows → (Down on the last row) the first grid row; Up from the bar goes
 * to the last poster row.
 *
 * Modes (body[data-mode], see layout()): 'shelf' (first grid row focused: Top Shelf over
 * the photo), 'grid' (a lower grid row: the grid moves up, the photo darkens) and 'rows'
 * (a poster focused: the hero shows it, the grid is gone).
 *
 * Zones (where focus is): 'list' (app list), 'rows' (posters), 'menu', 'bar' (top bar),
 * 'inputs' (its Entradas panel), 'search' (the Buscar screen), 'tvwin' (an input shown inside
 * the app, Samsung) and the overlays 'details' and 'chooser'. Views: 'home', 'all' (Todos os apps), 'mine' (Minha
 * lista), 'ids'.
 */
(function () {
  'use strict';

  var DATA = window.TVHOME_DATA;
  var CFG = window.TVHOME_CONFIG || {};
  var P = window.Platform;
  var S = window.Store;
  var Smart = window.Smart;
  var Catalog = window.Catalog;
  var STORE_KEY = 'tvhome.lastFocus';
  var HISTORY_KEY = 'tvhome.history';
  var REFRESH_MS = 6 * 3600 * 1000;
  // Never suggested: anime and Asian titles (config hideAnime, hideLanguages, hideCountries).
  // The TMDB lists are filtered in js/catalog.js; the rows built from the history here.
  var HIDE = Smart.hideRule(CFG);

  var LONG_PRESS = 600;      // ms holding OK on a poster opens the title in its app

  // App grid geometry (px at 1920x1080). Tiles are placed with transforms from these
  // numbers: focus moves never read or change layout.
  var COLS = 5;
  var TILE_X = 349;          // tile 300 + gap 49
  var TILE_Y = 240;          // tile 180 + label + gap
  var SHELF_TOP = 640;       // first grid row, under the Top Shelf
  var GRID_TOP = 200;        // first grid row once the Top Shelf has scrolled away
  var ROWS_TOP = 600;        // #rows in css/style.css: the focused poster row
  var SHELF_WAIT = 150;      // Top Shelf text after focus settles on an app
  var SHELF_BG_WAIT = 300;   // and its artwork
  var SHELF_TURN = 8000;     // the Top Shelf shows the app's next suggestion

  // Back is 10009 on Samsung and 461 on LG (Platform.backKey).
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: P.backKey || 10009 };
  var extra = P.registerKeys(); // { ColorF0Red, ColorF1Green, ColorF2Yellow, ColorF3Blue, Info }

  var state = {
    view: 'home',          // 'home' | 'all' | 'mine' | 'ids'
    zone: 'list',          // 'list' | 'rows' | 'menu' | 'bar' | 'inputs' | 'search' | 'tvwin' | 'details' | 'chooser'
    barFrom: 'list',       // where the top bar was entered from ('list' | 'rows'): Down returns there
    searchFrom: null,      // where the search screen was opened from ('bar' | 'list' | 'rows'): Back returns there
    inputs: null,          // the Entradas panel: { items: [...], i } while open
    home: [],              // items: { key, name, ids, iconPath, kind }
    apps: [],              // the installed home apps
    all: [],
    raw: [],
    installed: {},         // curated key -> app item, for the provider mapping
    byKey: {},             // every launchable item by key (home + all)
    settings: null,        // the "Configurações" special entry, launched from the menu
    focus: { home: 0, all: 0, menu: 0, bar: 0 },
    shelf: null,           // the Top Shelf: { key, items: [{ item, label }], i }
    launching: false,
    linking: false,         // a title launch is waiting (≤ 1.5 s) for the title's ids
    history: Smart.cleanHistory(S.getJSON(HISTORY_KEY, null)),
    profile: null,
    built: { home: [], mine: [] },     // the rows of the home screen and of Minha lista
    homePeek: null,                    // the row shown under the app list
    appsOf: {},            // title key -> installed app keys it is on (from rows and details)
    undo: null,            // the last "Já vi" (green), undoable with yellow while its toast shows
    loadedAt: 0
  };

  var el = {
    stage: document.getElementById('stage'),
    bgA: document.getElementById('bg-a'),
    bgB: document.getElementById('bg-b'),
    title: document.getElementById('title'),
    subtitle: document.getElementById('subtitle'),
    list: document.getElementById('list'),
    listWrap: document.getElementById('list-wrap'),
    empty: document.getElementById('empty'),
    ids: document.getElementById('ids'),
    menu: document.getElementById('menu'),
    hints: document.getElementById('hints'),
    clock: document.getElementById('clock'),
    date: document.getElementById('date'),
    weather: document.getElementById('weather'),
    toast: document.getElementById('toast'),
    mock: document.getElementById('mock-badge'),
    mineNote: document.getElementById('mine-note'),
    mineSummary: document.getElementById('mine-summary'),
    discover: document.getElementById('discover'),
    hero: document.getElementById('hero'),
    heroEyebrow: document.getElementById('hero-eyebrow'),
    heroTitle: document.getElementById('hero-title'),
    heroMeta: document.getElementById('hero-meta'),
    heroOverview: document.getElementById('hero-overview'),
    heroProviders: document.getElementById('hero-providers'),
    heroDots: document.getElementById('hero-dots'),
    bar: document.getElementById('bar'),
    net: document.getElementById('bar-net'),
    inputs: document.getElementById('inputs')
  };

  // ---------- helpers ----------

  function norm(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  // Tizen ids are in `ids`, LG webOS ids in `webos`; both are checked on every platform.
  function matchScore(entry, app) {
    var ids = (entry.ids || []).concat(entry.webos || []);
    for (var i = 0; i < ids.length; i++) if (ids[i] === app.id) return 3;
    var n = norm(app.name);
    if (!n) return 0;
    if ((entry.names || []).indexOf(n) !== -1) return 2;
    var pre = entry.prefixes || [];
    for (var j = 0; j < pre.length; j++) if (n.indexOf(pre[j]) === 0) return 1;
    return 0;
  }

  function bestMatch(entry, apps, used, requireVisible) {
    var best = null, bestScore = 0;
    apps.forEach(function (a) {
      if (used[a.id]) return;
      if (requireVisible && a.show === false && matchScore(entry, a) < 3) return;
      var s = matchScore(entry, a);
      if (s > bestScore) { best = a; bestScore = s; }
    });
    return best;
  }

  function isSystem(app) {
    var id = app.id.toLowerCase();
    var n = norm(app.name);
    if (!app.name || app.show === false) return true;
    if (DATA.systemIdPatterns.some(function (p) { return id.indexOf(p.toLowerCase()) !== -1; })) return true;
    if (DATA.systemNamePatterns.some(function (p) { return n.indexOf(norm(p)) !== -1; })) return true;
    return false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function saveHistory() { S.setJSON(HISTORY_KEY, state.history); }

  // ---------- model ----------

  function buildModel(apps) {
    var self = P.selfId();
    apps = apps.filter(function (a) { return a.id !== self; });
    state.raw = apps;

    var used = {};
    var curated = [];
    state.installed = {};
    DATA.curated.forEach(function (entry) {
      var app = bestMatch(entry, apps, used, true);
      if (!app) return;
      used[app.id] = true;
      var item = {
        key: entry.key, name: entry.name, ids: [app.id].concat(app.alt || []),
        glyph: entry.glyph, tile: entry.tile, iconPath: app.iconPath, kind: 'app'
      };
      curated.push(item);
      state.installed[entry.key] = item;
    });

    var specials = [];
    state.settings = null;
    DATA.special.forEach(function (entry) {
      var app = bestMatch(entry, apps, used, false);
      if (!app && !entry.alwaysShow) return;
      if (app) used[app.id] = true;
      var item = {
        key: entry.key, name: entry.name,
        ids: app ? [app.id].concat(app.alt || []) : ((P.isWebOS ? entry.webos : entry.ids) || []).slice(),
        glyph: entry.glyph, tile: entry.tile, iconPath: '', kind: 'special', unverified: !app
      };
      // Settings lives in the bottom-right menu ("Ajustes"), not in the list.
      if (entry.key === 'settings') state.settings = item;
      else specials.push(item);
    });

    var seen = {};
    var others = apps.filter(function (a) {
      if (used[a.id] || isSystem(a)) return false;
      var n = norm(a.name);
      if (seen[n]) return false;
      seen[n] = true;
      return true;
    }).sort(function (a, b) {
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    }).map(function (a) {
      return { key: 'app:' + a.id, name: a.name, ids: [a.id].concat(a.alt || []), iconPath: a.iconPath, kind: 'app' };
    });

    state.apps = DATA.specialPosition === 'start' ? specials.concat(curated) : curated.concat(specials);
    state.all = others;
    state.byKey = {};
    state.apps.concat(others).forEach(function (it) { state.byKey[it.key] = it; });
    buildHomeList();
  }

  // The home list is the apps only: what you were watching is the "Continuar assistindo"
  // poster rows (like every other row), not a section of this list.
  function buildHomeList() {
    state.home = state.apps.slice();
  }

  // ---------- glyphs ----------
  // Small monochrome line icons (24x24, drawn with currentColor). Apps without one
  // get a letter mark. No official logos on purpose.

  var GLYPHS = {
    play: '<rect x="2.5" y="5" width="19" height="14" rx="4.5"/><path d="M10 9.3v5.4l4.6-2.7z" fill="currentColor"/>',
    music: '<path d="M9 18V6.2l11-2.2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.7 3.9 5.9 3.9 9.5s-1.3 6.8-3.9 9.5c-2.6-2.7-3.9-5.9-3.9-9.5s1.3-6.8 3.9-9.5z"/>',
    tv: '<rect x="2.5" y="5.5" width="19" height="13" rx="3"/><path d="M8 21.5h8M8.5 2 12 5.5 15.5 2"/>',
    film: '<circle cx="12" cy="12" r="9.5"/><path d="M10 8.6v6.8l5.6-3.4z" fill="currentColor"/>'
  };

  function glyphHtml(item) {
    var g = item.glyph && GLYPHS[item.glyph];
    var inner = g || ('<rect x="2" y="2" width="20" height="20" rx="6.5"/>' +
      '<text x="12" y="16.4" text-anchor="middle" font-size="12" fill="currentColor" stroke="none">' +
      escapeHtml(letterOf(item.name)) + '</text>');
    return '<svg class="item__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  function letterOf(name) {
    var m = String(name).match(/[A-Za-z0-9À-ÿ]/);
    return m ? m[0].toUpperCase() : '•';
  }

  // ---------- rendering ----------

  // App tiles: the brand color with the app's name as a wordmark (and its glyph), like the
  // tvOS icons. Apps without a `tile` in js/apps-data.js get a muted color and the TV's own
  // icon when it has one. Focus look (css): lift, shadow, sheen; all pre-painted.
  var TILE_BG = [
    'linear-gradient(160deg, #3a3a3e 0%, #232326 100%)', 'linear-gradient(160deg, #2b4a6e 0%, #182c44 100%)',
    'linear-gradient(160deg, #4a3768 0%, #2a1e3e 100%)', 'linear-gradient(160deg, #24573f 0%, #133324 100%)',
    'linear-gradient(160deg, #6a3040 0%, #3c1a24 100%)', 'linear-gradient(160deg, #5a4a2a 0%, #33291a 100%)'
  ];
  var FILLED = {
    play: '<rect x="1.5" y="4.5" width="21" height="15" rx="4.6" fill="currentColor"/><path d="M10 9.2v5.6l4.8-2.8z" fill="#fff"/>'
  };

  function tileHtml(item, i) {
    var t = item.tile || {};
    var h = 0;
    for (var k = 0; k < item.name.length; k++) h = (h * 31 + item.name.charCodeAt(k)) % 997;
    var bg = t.bg || TILE_BG[h % TILE_BG.length];
    var text = t.text || item.name;
    var inner = '';
    var g = item.glyph && (FILLED[item.glyph] || GLYPHS[item.glyph]);
    if (g) {
      inner += '<svg class="tile__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
        (t.accent ? ' style="color:' + escapeHtml(t.accent) + '"' : '') + '>' + g + '</svg>';
    } else if (!item.tile && item.iconPath) {
      inner += '<img class="tile__icon" alt="" src="' + escapeHtml(item.iconPath) + '">';
    }
    var cls = 'tile__mark' + (t.style ? ' tile__mark--' + t.style : '') +
      (text.length > 11 ? ' tile__mark--long' : text.length > 7 ? ' tile__mark--mid' : '');
    inner += '<span class="' + cls + '">' + escapeHtml(text) + '</span>';
    return '<li class="tile" data-key="' + escapeHtml(item.key) + '" style="transform:translate3d(' +
      (i % COLS) * TILE_X + 'px,' + Math.floor(i / COLS) * TILE_Y + 'px,0)">' +
      '<div class="tile__lift"><div class="tile__shadow"></div>' +
      '<div class="tile__face' + (g ? ' has-glyph' : '') + '" style="background:' + escapeHtml(bg) +
      ';color:' + escapeHtml(t.fg || '#fff') + '">' + inner + '</div></div>' +
      '<div class="tile__label">' + escapeHtml(item.name) + '</div></li>';
  }

  function currentItems() { return state.view === 'all' ? state.all : state.home; }

  function menuItems() {
    return [
      state.view === 'mine' ? { action: 'home', name: 'Início' } : { action: 'mine', name: 'Minha lista' },
      { action: 'art', name: 'Modo Arte' },
      state.view === 'all' ? { action: 'home', name: 'Início' } : { action: 'all', name: 'Todos os apps' },
      { action: 'settings', name: 'Ajustes' }
    ];
  }

  function render() {
    var view = state.view;
    document.body.setAttribute('data-view', view);
    el.ids.hidden = view !== 'ids';
    el.listWrap.hidden = view === 'ids' || view === 'mine';
    el.mineNote.hidden = view !== 'mine';

    if (view === 'ids') { renderIds(); renderHints(); return; }

    el.title.textContent = view === 'all' ? 'Todos os apps' : view === 'mine' ? 'Minha lista' : '';
    el.subtitle.textContent = '';
    if (view === 'mine') el.mineSummary.textContent = profileSummary();
    if (view !== 'mine') {
      var items = currentItems();
      el.list.innerHTML = items.map(tileHtml).join('');
      el.empty.hidden = items.length > 0;
      if (state.focus[view] >= items.length) state.focus[view] = Math.max(0, items.length - 1);
      if (!items.length && state.zone === 'list') state.zone = 'menu';
    }
    el.menu.innerHTML = menuItems().map(function (m) {
      return '<div class="menu__item"><span>' + escapeHtml(m.name) + '</span></div>';
    }).join('');
    syncDiscover();
    updateFocus();
    renderHints();
  }

  function renderIds() {
    el.title.textContent = 'IDs dos apps';
    var src = P.listSource ? P.listSource() : '';
    el.subtitle.textContent = src === 'static' ? 'A TV não deixou listar os apps: lista fixa de js/apps-data.js' :
      (src ? 'Fonte: ' + src : '');
    var rows = state.raw.slice().sort(function (a, b) { return a.id.localeCompare(b.id); }).map(function (a) {
      return '<tr' + (a.show === false ? ' class="muted"' : '') + '><td>' + escapeHtml(a.name || '—') +
        '</td><td>' + escapeHtml(a.id) + '</td><td>' + (a.show === false ? 'oculto' : '') + '</td></tr>';
    }).join('');
    el.ids.innerHTML = '<table><thead><tr><th>Nome</th><th>ID</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
    el.ids.scrollTop = 0;
  }

  var hintsShown = null;
  function renderHints() {
    var h = '';
    if (state.view === 'home' && state.zone === 'list') h = '<span><b class="k">OK</b> Abrir</span><span><b class="k k--red">●</b> Menu</span>';
    else if (state.view === 'ids') h = '<span><b class="k">▲▼</b> Rolar</span><span><b class="k">Voltar</b> Início</span>';
    else if (state.zone === 'rows') h = '<span><b class="k">OK</b> Detalhes</span><span><b class="k">Segure OK</b> Abrir no app</span>' +
      '<span><b class="k k--green">●</b> Já vi</span>' +
      (state.undo ? '<span><b class="k k--yellow">●</b> Desfazer</span>' : '') +
      '<span><b class="k k--red">●</b> Menu</span>';
    if (h === hintsShown) return;      // most moves keep the same hints: no DOM change
    hintsShown = h;
    el.hints.innerHTML = h;
  }

  // Which layout the screen shows (body[data-mode]): see the top of this file.
  function currentMode() {
    if (state.view === 'mine') return 'rows';
    if (state.view !== 'home') return 'grid';
    var z = baseZone();
    if (z === 'menu') z = state.menuFrom === 'rows' ? 'rows' : 'list';
    if (z === 'rows' || z === 'details' || z === 'chooser') return discover.hasRows() ? 'rows' : 'shelf';
    return Math.floor(state.focus.home / COLS) === 0 ? 'shelf' : 'grid';
  }

  // Classes and transforms only: the grid, the rows' peek and the hints follow the focus.
  function updateFocus() {
    var view = state.view;
    var idx = state.focus[view];
    var tiles = el.list.children;
    var n = tiles.length;
    var mode = currentMode();
    var body = document.body;
    body.setAttribute('data-zone', state.zone === 'details' || state.zone === 'chooser' ? state.zone : baseZone());
    if (body.getAttribute('data-mode') !== mode) body.setAttribute('data-mode', mode);
    if (state.zone === 'bar' || state.zone === 'inputs') body.setAttribute('data-bar', state.zone);
    else body.removeAttribute('data-bar');
    var pills = el.bar.children;
    for (var b = 0; b < pills.length; b++) {
      pills[b].classList.toggle('is-focused', !!body.getAttribute('data-bar') && b === state.focus.bar);
    }

    var prev = el.list.querySelector('.is-focused');
    var onGrid = baseZone() === 'list' || (state.zone === 'menu' && state.menuFrom !== 'rows');
    var next = onGrid ? tiles[idx] : null;
    if (prev && prev !== next) prev.classList.remove('is-focused');
    if (next && next !== prev) next.classList.add('is-focused');

    var menu = el.menu.children;
    for (var m = 0; m < menu.length; m++) {
      menu[m].classList.toggle('is-focused', state.zone === 'menu' && m === state.focus.menu);
    }
    renderHints();
    if (view === 'mine') { el.discover.style.transform = ''; return; }

    // The grid: under the Top Shelf (first row focused), or up near the top with the focused
    // row in view; gone up while a poster has the focus. The first poster row peeks under it.
    var gridRows = Math.max(1, Math.ceil(n / COLS));
    var r = Math.floor(idx / COLS);
    var top = mode === 'shelf' ? SHELF_TOP :
      mode === 'grid' ? GRID_TOP - Math.max(0, r - 2) * TILE_Y : GRID_TOP - gridRows * TILE_Y;
    var t = 'translate3d(0,' + top + 'px,0)';
    if (el.listWrap.style.transform !== t) el.listWrap.style.transform = t;
    var d = mode === 'rows' ? '' : 'translate3d(0,' + (top + gridRows * TILE_Y + 10 - ROWS_TOP) + 'px,0)';
    if (el.discover.style.transform !== d) el.discover.style.transform = d;

    if (view === 'home' && state.home[idx]) S.set(STORE_KEY, state.home[idx].key);
  }

  // ---------- Top Shelf (an app of the first grid row focused) ----------
  // The app's own suggestions, newest first: what you were watching in it, then the first
  // titles of each poster row that are on it. Its artwork fills the top of the screen and
  // its text sits bottom-left; it turns to the next one every SHELF_TURN while idle.
  // Nothing here goes to the network: the titles come from the rows already built, and their
  // backdrops were preloaded in the background (preloadShelves).

  var shelfTimer = null, shelfBgTimer = null, turnTimer = null, lastKeyAt = 0;

  function shelfItemsFor(app) {
    var out = [], seen = {};
    if (!app || app.kind !== 'app') return out;
    function add(it, label) {
      if (!it || seen[it.key] || out.length >= 5) return false;
      if (Smart.statusOf(state.history, it.key) === 'watched') return false;
      seen[it.key] = true;
      out.push({ item: it, label: label });
      return true;
    }
    Smart.dropHidden(Smart.continueList(state.history, Date.now(), 20), HIDE).forEach(function (r) {
      if (r.app === app.key) add(r, 'Continuar assistindo');
    });
    (state.built.home || []).forEach(function (row) {
      if (row.cat === 'continue') return;
      var taken = 0;
      row.items.forEach(function (it) {
        if (taken >= 2) return;
        var apps = state.appsOf[it.key] || it.apps || [];
        if (apps.indexOf(app.key) !== -1 && add(it, row.title)) taken++;
      });
    });
    return out;
  }

  function updateShelf() {
    var mode = currentMode();
    if (mode === 'rows') {
      clearTimeout(shelfTimer); clearTimeout(shelfBgTimer); clearTimeout(turnTimer);
      if (state.shelf) state.shelf.key = null;      // the hero shows a poster now
      return;
    }
    if (mode === 'grid') {
      clearTimeout(turnTimer);
      if (state.shelf) state.shelf.key = null;      // back on the first row: paint it again
      showBackground(landscape());
      return;
    }
    var app = state.home[state.focus.home];
    var key = app ? app.key : '';
    if (state.shelf && state.shelf.key === key) return;
    state.shelf = { key: key, app: app, items: shelfItemsFor(app), i: 0 };
    el.hero.className = 'is-stale';
    clearTimeout(shelfTimer);
    clearTimeout(shelfBgTimer);
    clearTimeout(turnTimer);
    shelfTimer = setTimeout(paintShelf, SHELF_WAIT);
  }

  function paintShelf() {
    var sh = state.shelf;
    if (!sh || currentMode() !== 'shelf') return;
    var entry = sh.items[sh.i];
    if (entry) {
      discover.showItem(entry.item, entry.label);
    } else {
      // No suggestions for this app: its name over the landscape.
      el.heroEyebrow.textContent = '';
      el.heroTitle.textContent = sh.app ? sh.app.name : '';
      el.heroTitle.className = '';
      el.heroMeta.innerHTML = '';
      el.heroOverview.textContent = '';
      el.heroProviders.innerHTML = '';
      el.hero.className = 'is-plain';
    }
    var dots = '';
    if (sh.items.length > 1) {
      for (var i = 0; i < sh.items.length; i++) dots += '<i' + (i === sh.i ? ' class="is-on"' : '') + '></i>';
    }
    el.heroDots.innerHTML = dots;
    var url = entry ? discover.backdropUrl(entry.item.backdrop) : '';
    clearTimeout(shelfBgTimer);
    shelfBgTimer = setTimeout(function () {
      if (state.shelf !== sh || currentMode() !== 'shelf') return;
      showBackground(url || landscape());
      var nx = sh.items[(sh.i + 1) % sh.items.length];
      if (nx && nx !== entry) preload(discover.backdropUrl(nx.item.backdrop));
    }, SHELF_BG_WAIT);
    clearTimeout(turnTimer);
    if (sh.items.length > 1) turnTimer = setTimeout(turnShelf, SHELF_TURN);
  }

  function turnShelf() {
    var sh = state.shelf;
    if (!sh || currentMode() !== 'shelf' || state.zone !== 'list') return;
    if (Date.now() - lastKeyAt < SHELF_TURN / 2) { turnTimer = setTimeout(turnShelf, SHELF_TURN / 2); return; }
    sh.i = (sh.i + 1) % sh.items.length;
    el.hero.className = 'is-stale';
    shelfTimer = setTimeout(paintShelf, 260);
  }

  // After the rows are built: the first artwork of each app in the first grid row.
  function preloadShelves() {
    state.home.slice(0, COLS).forEach(function (app) {
      var first = shelfItemsFor(app)[0];
      if (first) preload(discover.backdropUrl(first.item.backdrop));
    });
  }

  // ---------- discovery ----------

  var discover = window.DiscoverUI({
    catalog: Catalog,
    toast: toast,
    onBackdrop: function (url) { showBackground(url || landscape()); },
    preload: function (url) { preload(url); },
    appsOf: appsOf,
    learn: learnApps,
    appByKey: function (k) { return state.byKey[k] || null; },
    usage: function (k) { return (state.profile && state.profile.appScore[k]) || 0; },
    statusOf: function (k) { return Smart.statusOf(state.history, k); },
    setStatus: function (item, status) {
      Smart.recordTitle(state.history, item, status, null, Date.now());
      saveHistory();
      historyChanged();
      if (status) toast(status === 'watched' ? 'Marcado como visto' : status === 'want' ? 'Adicionado a Quero ver' : 'Marcado como Assistindo');
      else toast('Marcação removida');
    },
    launchTitle: launchTitle,
    launchTrailer: launchTrailer,
    onOpen: function (kind) {
      state.zone = kind;
      document.body.setAttribute('data-zone', kind);
      renderHints();
    },
    onClose: function () {
      // Opened from a search result: back to the search, the results filtered again (a mark).
      if (search.isOpen()) { state.zone = 'search'; updateFocus(); search.refresh(); return; }
      state.zone = discover.hasRows() ? 'rows' : (state.view === 'mine' ? 'menu' : 'list');
      layout();
    }
  });

  // ---------- Buscar (the search screen, js/search.js) ----------
  // Over everything but the details: OK on a result opens the same details, "Abrir em…" and
  // launch as a poster in the rows (discover.openDetails / discover.open with the item).

  var search = window.SearchUI({
    catalog: Catalog,
    cardNode: discover.cardNode,
    isWatched: function (k) { return Smart.statusOf(state.history, k) === 'watched'; },
    // Só streaming: "on an app of this TV" (the apps the rows use), not any service in Brazil.
    appsOf: appsOf,
    lookup: function (it) {
      var known = appsOf(it);
      if (known) return Promise.resolve(known);
      // The details request (cached 6 h, reused by the details screen), without its extras
      // (IMDb, Wikidata): only the providers are needed here.
      return Catalog.details(it).then(function (d) { learnApps(it, d.providers); return appsOf(it) || []; });
    },
    streamIds: function () { return Smart.providerIdsFor(DATA.curated, state.installed); },
    hide: HIDE,
    genres: function () { return state.genres; },
    // With nothing typed: the "em alta" rows of the home screen (no network).
    suggestions: function () { return (state.built.home || []).filter(function (r) { return r.cat === 'popular'; }); },
    toast: toast
  });

  var searchOk = false;      // an OK keyup since the search opened: the press that opened it does not type

  // byOk: opened with OK (the Buscar pill), whose keyup is still to come.
  function openSearch(byOk) {
    closeInputs();
    state.searchFrom = state.zone === 'inputs' ? 'bar' : state.zone;
    state.zone = 'search';
    searchOk = !byOk;
    search.open();
    updateFocus();
  }

  // Back to where the search was opened from (the Buscar pill, a tile or a poster).
  function closeSearch() {
    search.close();
    state.zone = state.searchFrom || 'list';
    state.searchFrom = null;
    if (state.zone === 'rows' && !discover.hasRows()) state.zone = 'list';
    if (state.shelf) state.shelf.key = null;      // repaint the Top Shelf and its artwork
    layout();
    if (state.zone === 'rows') discover.goRow(discover.rowIndex());   // the poster's artwork again
  }

  // OK on a result: a person shows their titles; a title its details (short press) or its
  // app (long press), through the same code as the poster rows.
  function openResult(it, long) {
    if (!it) return;
    if (it.type === 'person') { search.openPerson(it); return; }
    if (long) { discover.open(it); return; }
    showBackground(discover.backdropUrl(it.backdrop) || landscape());
    discover.openDetails(it);
  }

  // A letter, digit or space typed on a real keyboard (desktop browser) or with the remote's
  // number keys (LG); '' for any other key.
  function typedChar(e) {
    var ch = e.key && e.key.length === 1 ? e.key.toLowerCase() : '';
    if (!ch) {
      var k = e.keyCode;
      if (k >= 65 && k <= 90) ch = String.fromCharCode(k + 32);
      else if (k >= 48 && k <= 57) ch = String.fromCharCode(k);
      else if (k >= 96 && k <= 105) ch = String.fromCharCode(k - 48);     // numeric keypad
      else if (k === 32) ch = ' ';
    }
    return /^[a-z0-9 \u00e0-\u00ff]$/.test(ch) ? ch : '';
  }

  function searchKey(e) {
    var k = e.keyCode;
    if (k === KEY.ENTER) {
      if (search.focused()) okDown();
      else if (searchOk) search.press();
      return true;
    }
    if (k === KEY.BACK || k === 27) { if (!search.back()) closeSearch(); return true; }
    if (k === 8) { if (!search.erase() && !search.back()) closeSearch(); return true; }   // Backspace: a letter first
    if (k === KEY.LEFT) search.move(-1, 0);
    else if (k === KEY.RIGHT) search.move(1, 0);
    else if (k === KEY.UP) search.move(0, -1);
    else if (k === KEY.DOWN) search.move(0, 1);
    else {
      var ch = typedChar(e);
      if (!ch) return false;
      search.type(ch);
    }
    return true;
  }

  // A title's TMDB providers (from its details) -> the installed apps it is on.
  function learnApps(item, providers) {
    state.appsOf[item.key] = Smart.mapProviders(providers, DATA.curated, state.installed).map(function (a) { return a.key; });
  }

  // Installed apps a title is on, most used first; null while not known yet.
  function appsOf(it) {
    var keys = state.appsOf[it.key] || it.apps;
    if (!keys) return it.app && state.byKey[it.app] ? [state.byKey[it.app]] : null;
    var score = (state.profile && state.profile.appScore) || {};
    return keys.map(function (k) { return state.byKey[k]; }).filter(Boolean)
      .sort(function (a, b) { return (score[b.key] || 0) - (score[a.key] || 0); });
  }

  // ---------- "Já vi" (green button on a poster) ----------
  // Green ALWAYS marks the focused title as watched: every mark stands on its own and is
  // saved at once. The card fades out and the title leaves every row. Yellow, while the
  // toast is showing, undoes only the last mark. (Before, a second green press within 5 s
  // was taken as "undo" and brought the previous title back.)

  var UNDO_MS = 5000;

  function markWatched() {
    var it = discover.focused();
    if (!it || Smart.statusOf(state.history, it.key) === 'watched') return;
    // History first, saved immediately, so nothing (a refresh, the next mark) can lose it.
    var token = Smart.markWatched(state.history, it, Date.now());
    saveHistory();
    discover.fadeOut(it.key, function () {
      var removed = removeEverywhere(it.key);
      buildMine();
      clearTimeout(state.undoTimer);
      state.undo = { token: token, item: it, removed: removed };
      state.undoTimer = setTimeout(function () { state.undo = null; renderHints(); }, UNDO_MS);
      toast('Marcado como visto · Amarelo para desfazer', false, UNDO_MS);
      syncDiscover();
    });
  }

  // Takes a title out of every row (home and Minha lista, except "Já vi"). Returns what was
  // removed, for undo.
  function removeEverywhere(key) {
    var removed = [];
    ['home', 'mine'].forEach(function (where) {
      (state.built[where] || []).forEach(function (row) {
        if (row.cat === 'seen') return;
        for (var i = row.items.length - 1; i >= 0; i--) {
          if (row.items[i].key === key) removed.push({ row: row, i: i, item: row.items.splice(i, 1)[0] });
        }
      });
    });
    return removed;
  }

  function undoWatched() {
    var u = state.undo;
    if (!u) return false;
    clearTimeout(state.undoTimer);
    state.undo = null;
    Smart.undoMark(state.history, u.token);
    saveHistory();
    for (var i = u.removed.length - 1; i >= 0; i--) {
      var x = u.removed[i];
      x.row.items.splice(Math.min(x.i, x.row.items.length), 0, x.item);
    }
    buildMine();
    toast('Desfeito: ' + u.item.title);
    syncDiscover();
    if (state.zone === 'rows') discover.focusKey(u.item.key);
    // A background refresh may have replaced the rows since the mark: rebuild them from the
    // cache too (order on screen is kept), then focus the title again.
    refreshDiscover().then(function () {
      if (state.zone === 'rows') discover.focusKey(u.item.key);
    });
    return true;
  }

  // Watched titles never come back through a background refresh (it may have started
  // before the mark): filter every suggestion row against the history when it lands.
  function dropWatched(rows) {
    rows.forEach(function (row) {
      if (row.cat === 'seen') return;
      row.items = row.items.filter(function (it) { return Smart.statusOf(state.history, it.key) !== 'watched'; });
    });
    return rows.filter(function (r) { return r.items.length; });
  }

  // The top bar and its panel keep the look of the zone they were entered from (the posters
  // stay full screen when it was entered from them); body[data-bar] marks their focus.
  // The search screen keeps the look of where it was opened from, also while the details of
  // a result are open over it.
  function baseZone() {
    var z = state.zone;
    if (z === 'search' || (search.isOpen() && (z === 'details' || z === 'chooser'))) z = state.searchFrom || 'list';
    return z === 'bar' || z === 'inputs' ? state.barFrom : z;
  }

  // The mode of the rows (peek under the grid / full), the Top Shelf and the background
  // follow the zone and the focused grid row.
  function layout() {
    discover.setMode(currentMode() === 'rows' && discover.hasRows() ? 'full' : 'peek');
    updateFocus();
    if (state.view === 'home') updateShelf();
    else if (state.view !== 'mine') showBackground(landscape());
  }

  function currentRows() {
    if (state.view === 'mine') return state.built.mine;
    if (state.view === 'home') return state.built.home;
    return [];
  }

  function syncDiscover() {
    var rows = currentRows();
    discover.setRows(rows, state.view === 'home' ? state.homePeek : null);
    if (state.zone === 'details' || state.zone === 'chooser') {
      // An overlay is open: the rows were refreshed behind it; leave the focus alone.
    } else if (state.view === 'mine') {
      if (rows.length) { if (state.zone !== 'menu') state.zone = 'rows'; }
      else state.zone = 'menu';
      discover.setHint(rows.length ? '' : 'Nada por aqui ainda. Abra um título pelas sugestões ou marque com "Já vi" (verde) ou "Quero ver" (OK num pôster: detalhes).');
    } else if (state.view === 'home') {
      discover.setHint(discoverHint(rows.length));
      if (state.zone === 'rows' && !rows.length) state.zone = 'list';
      if (state.barFrom === 'rows' && !rows.length) state.barFrom = 'list';
    }
    layout();
  }

  function discoverHint(n) {
    if (Catalog.mode === 'off') return 'Sugestões de filmes e séries: coloque seu token do TMDB em js/config.local.js.';
    if (!n && state.loading) return 'Carregando sugestões…';
    if (!n) return 'Nada para sugerir agora. Verifique a conexão.';
    return '';
  }

  function safe(p) { return p.then(null, function (err) { console.warn('discover', err); return []; }); }

  function genreName(id) {
    var g = state.genres || { movie: {}, tv: {} };
    return g.movie[id] || g.tv[Smart.genreFor('tv', id)] || '';
  }

  // Installed apps that TMDB knows, with their provider ids: one discover request per app,
  // so each title arrives already tagged with the apps it is on (no lookups on focus).
  function appGroups() {
    return DATA.curated.filter(function (e) {
      return state.installed[e.key] && e.tmdb && e.tmdb.ids && e.tmdb.ids.length;
    }).map(function (e) { return { key: e.key, ids: e.tmdb.ids }; });
  }

  // Runs `query` once per installed app and merges the answers (Smart.mergeByApp).
  function byApp(query, limit, exclude) {
    var by = (query.sort || '').indexOf('vote_average') === 0 ? 'rating' : 'popularity';
    return Promise.all(appGroups().map(function (g) {
      var q = {};
      for (var k in query) q[k] = query[k];
      q.providers = g.ids;
      return safe(Catalog.discover(q)).then(function (items) { return { app: g.key, items: items }; });
    })).then(function (lists) {
      var merged = Smart.mergeByApp(lists, by, limit || 20, exclude);
      merged.forEach(function (it) { state.appsOf[it.key] = it.apps; });
      return merged;
    });
  }

  // "Para você" for one type: TMDB recommendations of the latest titles of that type +
  // the best titles in the top genres on the installed apps, ranked by the taste profile.
  // Recommendations are not filtered by service: a title is shown once its apps are known
  // (from the rows or the background queue); unknown ones go to the queue, and the rows
  // are rebuilt once when the answers are in.
  function forYou(profile, exclude, type) {
    if (!profile.count) return Promise.resolve([]);
    var jobs = Smart.seedsOf(profile, type, 3).map(function (seed) {
      return safe(Catalog.recommendations(seed)).then(function (list) {
        return list.filter(function (it) { return it.type === type; }).slice(0, 12).map(function (it) {
          return { item: it, reason: 'Porque você viu ' + seed.title, bonus: 0.6 };
        });
      });
    });
    var top = profile.genres.slice(0, 2).map(function (g) { return g.id; });
    var gs = top.map(function (g) { return Smart.genreFor(type, g); }).filter(Boolean);
    if (gs.length) {
      jobs.push(byApp({ type: type, genres: gs, sort: 'vote_average.desc', minVotes: 300, minRating: 7 }, 20).then(function (list) {
        return list.map(function (it) {
          var hit = top.filter(function (g) {
            return (it.genreIds || []).some(function (x) { return Smart.canonGenre(it.type, x) === g; });
          })[0];
          var name = genreName(hit || top[0]);
          return { item: it, reason: name ? 'Porque você gosta de ' + name.toLowerCase() : 'Para você' };
        });
      }));
    }
    return Promise.all(jobs).then(function (lists) {
      var ranked = Smart.rankForYou([].concat.apply([], lists), profile, exclude, 32);
      var unknown = [];
      var out = ranked.filter(function (it) {
        var apps = state.appsOf[it.key];
        if (!apps) { unknown.push(it); return false; }
        return apps.length > 0;
      }).slice(0, 20);
      if (unknown.length) checkLater(unknown.slice(0, 12));
      return out;
    });
  }

  // Availability checks for "Para você" in the background queue; one quiet rebuild after.
  var checksPending = 0, checkTimer = null;
  function checkLater(items) {
    checksPending += items.length;
    discover.enqueue(items, false, function () {
      if (--checksPending === 0) {
        clearTimeout(checkTimer);
        checkTimer = setTimeout(refreshDiscover, 500);
      }
    });
  }

  var STABLE = { foryou: 1, mood: 1, popular: 1, top: 1 };

  // Categories in screen order; each one becomes a pair of rows, films then series.
  var CATS = ['continue', 'foryou', 'want', 'mood', 'popular', 'top'];
  var TYPES = ['movie', 'tv'];
  var PLURAL = { movie: 'Filmes', tv: 'Séries' };

  var LABEL = {
    movie: { cont: 'Continuar assistindo · Filmes', want: 'Quero ver · Filmes', foryou: 'Filmes para você',
      popular: 'Filmes em alta no Brasil', top: 'Filmes mais bem avaliados' },
    tv: { cont: 'Continuar assistindo · Séries', want: 'Quero ver · Séries', foryou: 'Séries para você',
      popular: 'Séries em alta no Brasil', top: 'Séries mais bem avaliadas' }
  };

  // Mood titles that do not already say films or series get " · Filmes" / " · Séries".
  function moodTitle(title, type) {
    return /filme|série|serie|cinema/i.test(title) ? title : title + ' · ' + PLURAL[type];
  }

  // Rows from the history only (no network): Continuar assistindo and Quero ver.
  function localRows(type, now) {
    return {
      cont: Smart.dropHidden(Smart.continueList(state.history, now, 20, type), HIDE),
      want: Smart.dropHidden(Smart.titlesWith(state.history, ['want'], type), HIDE).slice(0, 20)
    };
  }

  // The rows of one type, each with an id (cat-type) and a pure content type.
  function buildType(type, now, exclude, seenEx) {
    var h = localRows(type, now);
    var L = LABEL[type];
    function row(cat, title, items, sub) {
      return { id: cat + '-' + type, cat: cat, type: type, title: title, sub: sub, items: items };
    }
    var rows = [];
    if (h.cont.length) rows.push(row('continue', L.cont, h.cont));
    if (h.want.length) rows.push(row('want', L.want, h.want));
    if (Catalog.mode === 'off' || !appGroups().length) return Promise.resolve(rows);
    var mood = Smart.moodFor(new Date(now), state.weather, type);
    return Promise.all([
      forYou(state.profile, exclude, type),
      byApp(mood.query, 20, seenEx),
      byApp({ type: type, sort: 'popularity.desc', minVotes: 100 }, 20, seenEx),
      byApp({ type: type, sort: 'vote_average.desc', minVotes: type === 'tv' ? 800 : 2000 }, 20, seenEx)
    ]).then(function (r) {
      rows.push(row('foryou', L.foryou, r[0], 'com base no que você abriu e marcou'));
      rows.push(row('mood', moodTitle(mood.title, type), r[1]));
      rows.push(row('popular', L.popular, r[2], 'nos seus apps'));
      rows.push(row('top', L.top, r[3]));
      return rows;
    });
  }

  // Pairs: for each category, the film row then the series row; empty rows skipped.
  // Rows already on screen keep their order (a background refresh only adds at the end).
  function pairRows(byType) {
    var prev = {};
    state.built.home.forEach(function (row) { prev[row.id] = row.items; });
    var out = [];
    CATS.forEach(function (cat) {
      TYPES.forEach(function (type, t) {
        byType[t].forEach(function (row) {
          if (row.cat !== cat) return;
          // Content type stays pure, whatever the source returned.
          row.items = row.items.filter(function (it) { return it.type === type; });
          if (STABLE[cat] && prev[row.id]) row.items = Smart.stableOrder(prev[row.id], row.items, 20);
          if (row.items.length) out.push(row);
        });
      });
    });
    return out;
  }

  // Details (runtime, genres, IMDb) for the first cards of every row, top rows first,
  // fetched in the background, 2 at a time, never while keys are being pressed.
  function prefetch() {
    state.built.home.forEach(function (row) { discover.enqueue(row.items.slice(0, P.lite ? 4 : 8)); });
  }

  // Builds every row. Network answers come from the 6 h cache most of the time.
  function refreshDiscover() {
    var now = Date.now();
    state.profile = Smart.tasteProfile(state.history, now);
    var exclude = {}, seenEx = {};
    Object.keys(state.history.titles).forEach(function (k) {
      var st = state.history.titles[k].status;
      if (st) exclude[k] = true;     // already seen, followed or in "Quero ver" (own rows)
      if (st === 'watched') seenEx[k] = true;
    });
    buildMine();
    state.loading = true;
    var genres = Catalog.mode === 'off' ? Promise.resolve() :
      safe(Catalog.genres()).then(function (g) { state.genres = g && g.movie ? g : null; discover.setGenres(state.genres); });
    return genres.then(function () {
      return Promise.all(TYPES.map(function (t) { return buildType(t, now, exclude, seenEx); }));
    }).then(function (byType) {
      state.loading = false;
      // Marks made while this refresh was running win over its (older) answers.
      state.built.home = dropWatched(pairRows(byType));
      state.homePeek = state.built.home.length ? state.built.home[0].id : null;
      state.loadedAt = Date.now();
      if (state.shelf) state.shelf.key = null;     // new suggestions: repaint the Top Shelf
      if (state.view === 'home' || state.view === 'mine') syncDiscover();
      setTimeout(prefetch, 600);
      setTimeout(preloadShelves, 1500);
    }, function (err) {
      state.loading = false;
      console.warn('refreshDiscover', err);
    });
  }

  // Minha lista: Assistindo, Quero ver, Já vi, each as films then series.
  function buildMine() {
    var rows = [];
    [['watching', 'Assistindo', ['watching', 'picked']], ['want', 'Quero ver', ['want']], ['seen', 'Já vi', ['watched']]]
      .forEach(function (c) {
        TYPES.forEach(function (type) {
          var items = Smart.titlesWith(state.history, c[2], type).slice(0, 20);
          if (!items.length) return;
          rows.push({ id: 'm-' + c[0] + '-' + type, cat: c[0], type: type, title: c[1] + ' · ' + PLURAL[type],
            sub: items.length + (items.length === 1 ? ' título' : ' títulos'), items: items });
        });
      });
    state.built.mine = rows;
  }

  function profileSummary() {
    var p = state.profile || Smart.tasteProfile(state.history, Date.now());
    var parts = [];
    var g = p.genres.slice(0, 3).map(function (x) { return genreName(x.id); }).filter(Boolean);
    if (g.length) parts.push('Você curte ' + listPt(g.map(function (s) { return s.toLowerCase(); })));
    var apps = p.apps.slice(0, 2).map(function (a) { return state.byKey[a.key] && state.byKey[a.key].name; }).filter(Boolean);
    if (apps.length) parts.push('mais usados: ' + listPt(apps));
    return parts.join(' · ');
  }

  function listPt(a) {
    return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1];
  }

  // A mark or a launch changed the history: rebuild what depends on it (from cache).
  var historyTimer = null;
  function historyChanged() {
    var key = state.home[state.focus.home] && state.home[state.focus.home].key;
    buildHomeList();
    if (key) {
      for (var i = 0; i < state.home.length; i++) if (state.home[i].key === key) { state.focus.home = i; break; }
    }
    clearTimeout(historyTimer);
    historyTimer = setTimeout(function () {
      refreshDiscover().then(function () { if (state.view === 'home') render(); });
    }, 300);
  }

  // ---------- backgrounds ----------
  // Two layers crossfade (opacity only). Landscape photos by time of day; the focused
  // title's backdrop while a poster is focused.

  var bg = { front: el.bgA, back: el.bgB, url: '', want: '' };

  function slotOf(h) {
    if (h >= 5 && h < 8) return 'dawn';
    if (h >= 8 && h < 17) return 'day';
    if (h >= 17 && h < 19) return 'dusk';
    return 'night';
  }

  function landscape() {
    if (DATA.background) return DATA.background;
    var sets = DATA.backgrounds || {};
    var d = new Date();
    var list = sets[slotOf(d.getHours())] || sets.day || [];
    if (!list.length) return 'img/yosemite-dusk.jpg';
    var turn = Math.floor(d.getTime() / 60000 / (DATA.backgroundMinutes || 20));
    return list[turn % list.length];
  }

  // Backdrops fetched ahead in the background (no swap), so a focus move swaps from the
  // browser's memory instead of the network. A small ring of Image objects keeps them alive.
  var preloaded = {}, preloadRing = [];
  function preload(url) {
    if (!url || preloaded[url]) return;
    preloaded[url] = true;
    var img = new Image();
    img.onerror = function () { delete preloaded[url]; };
    img.src = url;
    preloadRing.push(img);
    if (preloadRing.length > 24) preloadRing.shift();
  }

  function showBackground(url) {
    if (!url || url === bg.want) return;
    bg.want = url;
    var img = new Image();
    img.onload = function () {
      if (bg.want !== url) return;     // focus moved on while it loaded
      var b = bg.back;
      b.style.backgroundImage = 'url("' + url + '")';
      b.classList.add('is-on');
      bg.front.classList.remove('is-on');
      bg.back = bg.front;
      bg.front = b;
      bg.url = url;
      el.stage.classList.toggle('is-title-bg', url.indexOf('img/') !== 0);
    };
    img.onerror = function () { if (bg.want === url) bg.want = bg.url; };
    img.src = url;
  }

  // ---------- actions ----------

  // The app grid: Left/Right within a row (no wrap, like tvOS), Up/Down by rows. Up from
  // the first row: the top bar. Down from the last row: the first poster row.
  function moveGrid(dx, dy) {
    var view = state.view;
    var n = currentItems().length;
    if (!n) return;
    var i = state.focus[view], c = i % COLS, r = Math.floor(i / COLS);
    var last = Math.ceil(n / COLS) - 1;
    if (dx) {
      if (c + dx < 0 || c + dx >= COLS || i + dx >= n) return;
      state.focus[view] = i + dx;
    } else if (dy < 0) {
      if (r === 0) { if (view === 'home') enterBar('list'); return; }
      state.focus[view] = i - COLS;
    } else {
      if (r === last) { if (view === 'home' && discover.hasRows()) enterRows(0); return; }
      state.focus[view] = Math.min(i + COLS, n - 1);
    }
    layout();
  }

  function enterRows(i) {
    state.zone = 'rows';
    discover.goRow(i);
    layout();
  }

  // From the poster rows back to the grid: Up from the first row lands on the last grid
  // row, Down from the last row on the first (the loop), in the same column.
  function leaveRows(dir) {
    var n = state.home.length;
    if (!n) { state.zone = 'list'; layout(); return; }
    var c = state.focus.home % COLS;
    var j = dir === 'up' ? (Math.ceil(n / COLS) - 1) * COLS + c : c;
    state.focus.home = Math.min(j, n - 1);
    state.zone = 'list';
    layout();
  }

  function moveMenu(dx) {
    var j = state.focus.menu + dx;
    if (j < 0) { leaveMenu(); return; }
    if (j >= el.menu.children.length) return;
    state.focus.menu = j;
    updateFocus();
  }

  function leaveMenu() {
    var from = state.menuFrom;
    state.menuFrom = null;
    if (from === 'rows' && state.view !== 'all' && discover.hasRows()) {
      setZone('rows');
      discover.restoreRow();
      return;
    }
    if (state.view === 'mine') { if (discover.hasRows()) setZone('rows'); return; }
    if (currentItems().length) setZone('list');
  }

  function setZone(z) {
    state.zone = z;
    if (z === 'menu') state.focus.menu = 0;
    layout();
  }

  function activate() {
    if (state.zone === 'menu') { menuAction(menuItems()[state.focus.menu]); return; }
    var items = currentItems();
    launchItem(items[state.focus[state.view]]);
  }

  function menuAction(m) {
    if (!m) return;
    if (m.action === 'all') switchView('all');
    else if (m.action === 'home') switchView('home');
    else if (m.action === 'mine') switchView('mine');
    else if (m.action === 'settings') {
      if (state.settings) launchItem(state.settings);
      else toast('Ajustes não encontrados nesta TV', true);
    } else if (m.action === 'art') {
      // There is no public Tizen web API for Art Mode, and this model has none.
      toast('Modo Arte não está disponível nesta TV');
    }
  }

  // deep (optional): open the app on a title (js/deeplink.js); if that is refused the app
  // opens plainly and fallbackMsg (if any) replaces the toast.
  function launchItem(item, msg, deep, fallbackMsg) {
    if (!item) return;
    if (state.launching) return;
    state.launching = true;
    toast(msg || 'Abrindo ' + item.name + '…', false, msg ? 4500 : 0);
    if (item.kind === 'app' && !msg) {
      Smart.recordApp(state.history, item.key, Date.now());
      saveHistory();
    }
    P.launchDeep(item.ids, deep || null).then(function (wentDeep) {
      if (deep && !wentDeep && fallbackMsg) { msg = fallbackMsg; toast(msg, false, 4500); }
      if (!P.isTV) setTimeout(function () { toast((msg || item.name) + ' (simulação no navegador)', false, msg ? 4500 : 0); }, 600);
    }, function (err) {
      console.error('launch failed', item.ids, err);
      toast('Não foi possível abrir ' + item.name, true);
    }).then(function () {
      setTimeout(function () { state.launching = false; }, 800);
      historyChanged();
    });
  }

  // The title's ids inside the streaming apps (js/deeplink.js). Usually already there: the
  // details queue looks them up in the background. If not, wait at most LINK_WAIT for them;
  // the app opens either way.
  var LINK_WAIT = 1500;
  function serviceIdsOf(item) {
    if (CFG.deepLinks === false || !window.DeepLink) return Promise.resolve(null);
    return discover.details(item).then(function (d) {
      if (d.links) return d.links;
      if (!d.wikidataId) return null;
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(null); }, LINK_WAIT);
        Catalog.serviceIds(d.wikidataId, true).then(function (ids) { if (ids) d.links = ids; resolve(ids); }, function () { resolve(null); });
      });
    }, function () { return null; });
  }

  // A title: open its streaming app on the title when its id there is known (Netflix,
  // Disney+, Max, Apple TV, Globoplay; see js/deeplink.js), else open the app and say what
  // to look for. Remembered either way.
  function launchTitle(item, app) {
    if (state.launching || state.linking) return;
    state.linking = true;
    Smart.recordTitle(state.history, item, 'picked', app.key, Date.now());
    saveHistory();
    toast('Abrindo ' + app.name + '…');
    var search = 'Abrindo ' + app.name + ' — procure por “' + item.title + '”';
    serviceIdsOf(item).then(function (ids) {
      state.linking = false;
      var deep = ids && window.DeepLink.request(app.key, item, ids);
      if (deep && !deep.sure && CFG.deepLinks === 'sure') deep = null;
      if (!deep) { launchItem(app, search); return; }
      launchItem(app, deep.sure ? 'Abrindo “' + item.title + '” no ' + app.name + '…' : search, deep, search);
    });
  }

  // "Trailer" in the details: the TMDB trailer in YouTube.
  function launchTrailer(item, videoId, app) {
    var deep = window.DeepLink && window.DeepLink.youtube(videoId);
    launchItem(app, deep ? 'Trailer de “' + item.title + '” no YouTube…' : 'Abrindo YouTube — procure por “' + item.title + ' trailer”',
      deep, 'Abrindo YouTube — procure por “' + item.title + ' trailer”');
  }

  function switchView(v) {
    closeInputs();
    state.view = v;
    state.zone = v === 'mine' ? 'rows' : 'list';
    if (state.shelf) state.shelf.key = null;
    if (v === 'all') state.focus.all = 0;
    if (v === 'mine') buildMine();
    render();
  }

  function back() {
    if (state.zone === 'details' || state.zone === 'chooser') { discover.closeOverlay(); return; }
    if (state.view !== 'home') { switchView('home'); return; }
    if (state.zone === 'menu') { leaveMenu(); return; }
    if (state.zone === 'rows') { setZone('list'); return; }
    // On the home list Back does nothing: we stay here on purpose.
  }

  var toastTimer = null;
  function toast(msg, isError, ms) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('is-error', !!isError);
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-visible'); }, ms || (isError ? 3500 : 2200));
  }

  // ---------- top bar: Entradas, Wi-Fi, Ajustes ----------
  // Home screen only. Up from the first app (or the first poster row) focuses it; Down or
  // Back returns there; Up goes on round the loop to the last app (or row). Left/Right move
  // between the pills. Every action fails soft: a toast when the TV refuses.

  var BAR = ['search', 'inputs', 'network', 'settings'];

  function enterBar(from) {
    state.barFrom = from;
    state.zone = 'bar';
    layout();
  }

  // toEnd: Up from the bar, round the loop to the last poster row (the last app when there
  // are no rows).
  function leaveBar(toEnd) {
    closeInputs();
    state.zone = state.barFrom;
    if (toEnd && discover.hasRows()) { state.zone = 'rows'; discover.goRow(discover.rowCount() - 1); }
    else if (toEnd) { state.zone = 'list'; state.focus.home = Math.max(0, state.home.length - 1); }
    layout();
  }

  function barKey(k) {
    switch (k) {
      case KEY.LEFT: if (state.focus.bar > 0) { state.focus.bar--; updateFocus(); } return true;
      case KEY.RIGHT: if (state.focus.bar < BAR.length - 1) { state.focus.bar++; updateFocus(); } return true;
      case KEY.DOWN: case KEY.BACK: case 27: case 8: leaveBar(false); return true;
      case KEY.UP: leaveBar(true); return true;
      case KEY.ENTER: barAction(BAR[state.focus.bar]); return true;
    }
    return false;
  }

  function barAction(a) {
    if (a === 'search') { openSearch(true); return; }
    if (a === 'inputs') { openInputs(); return; }
    if (a === 'settings') { menuAction({ action: 'settings' }); return; }
    toast('Abrindo as configurações de rede…');
    P.openNetworkSettings().then(function () {
      if (!P.isTV) setTimeout(function () { toast('Configurações de rede (simulação no navegador)'); }, 600);
    }, function (err) {
      console.warn('network settings', err);
      toast('A TV não deixou abrir as configurações de rede', true);
    });
  }

  // The Wi-Fi pill names the network (asked at start and on every return to the app).
  function showNetwork() {
    P.network().then(function (n) {
      el.net.textContent = n.type === 'wifi' ? (n.ssid || 'Wi-Fi') : n.type === 'wired' ? 'Rede cabeada' :
        n.type === 'none' ? 'Sem rede' : 'Wi-Fi';
    }, function (err) { console.warn('network status', err); });
  }

  // The Entradas panel, under its pill: the inputs with something connected (all of them
  // when the TV does not say), then "TV ao vivo". Asked each time it opens.
  var HDMI_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5h17v4.2L17 16H7l-3.5-4.3z"/><path d="M8.5 16v3.5h7V16M8 11h8"/></svg>';

  function openInputs() {
    state.inputs = { items: [], i: 0, loading: true };
    state.zone = 'inputs';
    drawInputs();
    el.inputs.hidden = false;
    updateFocus();
    P.inputs().then(null, function (err) { console.warn('inputs', err); return null; }).then(function (list) {
      var o = state.inputs;
      if (!o) return;                     // closed meanwhile
      o.loading = false;
      o.failed = !list;
      list = list || [];
      var known = list.some(function (x) { return x.connected !== null; });
      var shown = known ? list.filter(function (x) { return x.connected; }) : list;
      o.unplugged = list.length - shown.length;
      o.items = shown.map(function (x) {
        return { kind: 'input', input: x, name: x.label, sub: x.sub, on: x.connected === true };
      });
      if (state.byKey.livetv) o.items.push({ kind: 'tv', name: 'TV ao vivo', app: state.byKey.livetv });
      drawInputs();
    });
  }

  function drawInputs() {
    var o = state.inputs;
    if (!o) return;
    var note = o.loading ? 'Procurando entradas…' : o.failed ? 'A TV não informou as entradas.' :
      o.items.some(function (it) { return it.kind === 'input'; }) ? '' :
      o.unplugged ? 'Nenhum aparelho ligado nas entradas.' : 'Nenhuma entrada encontrada.';
    var html = '<div class="inputs__head">Entradas</div>';
    o.items.forEach(function (it) {
      if (it.kind === 'tv') html += (note ? '<div class="inputs__note">' + escapeHtml(note) + '</div>' : '') + '<div class="inputs__sep"></div>';
      html += '<div class="inputs__item">' + (it.kind === 'tv' ? glyphHtml({ glyph: 'tv' }) : HDMI_ICON) +
        '<span class="inputs__name">' + escapeHtml(it.name) + (it.sub ? '<small>' + escapeHtml(it.sub) + '</small>' : '') + '</span>' +
        (it.on ? '<span class="inputs__on">Conectado</span>' : '') + '</div>';
    });
    if (note && !o.items.some(function (it) { return it.kind === 'tv'; })) html += '<div class="inputs__note">' + escapeHtml(note) + '</div>';
    el.inputs.innerHTML = html;
    paintInputs();
  }

  function paintInputs() {
    var nodes = el.inputs.querySelectorAll('.inputs__item');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('is-focused', i === state.inputs.i);
  }

  function closeInputs() {
    if (!state.inputs) return;
    state.inputs = null;
    el.inputs.hidden = true;
    if (state.zone === 'inputs') { state.zone = 'bar'; updateFocus(); }
  }

  function inputsKey(k) {
    var o = state.inputs, n = o.items.length;
    if (k === KEY.UP) { if (o.i > 0) { o.i--; paintInputs(); } else closeInputs(); }   // Up on the first: the pill
    else if (k === KEY.DOWN) { if (o.i < n - 1) { o.i++; paintInputs(); } }
    else if (k === KEY.ENTER) { if (o.items[o.i]) pickInput(o.items[o.i]); }
    else if (k === KEY.BACK || k === 27 || k === 8 || k === KEY.LEFT) closeInputs();
    else if (k !== KEY.RIGHT) return false;
    return true;
  }

  function pickInput(it) {
    closeInputs();
    if (it.kind === 'tv') { launchItem(it.app); return; }
    toast('Mudando para ' + it.name + '…');
    P.openInput(it.input).then(function (how) {
      if (how === 'window') showInputWindow(it.name);
      else if (!P.isTV) setTimeout(function () { toast(it.name + ' (simulação no navegador)'); }, 600);
    }, function (err) {
      console.warn('input', it.input, err);
      toast('A TV não deixou mudar para ' + it.name, true);
    });
  }

  // Samsung, when the input is shown inside this app (config samsungInput: 'window', or the
  // TV's viewer would not open): the page hides itself over the TV window; OK or Back returns.
  function showInputWindow(name) {
    P.showInputWindow(true).then(function () {
      state.zone = 'tvwin';
      document.documentElement.classList.add('is-tvwin');
    }, function (err) {
      console.warn('tvwindow show', err);
      toast('A TV não deixou mostrar ' + name, true);
    });
  }

  function hideInputWindow() {
    document.documentElement.classList.remove('is-tvwin');
    state.zone = 'bar';
    P.showInputWindow(false).then(null, function (err) { console.warn('tvwindow hide', err); });
    layout();
  }

  // ---------- input ----------

  // OK on a poster: a short press opens the details, holding it opens the title in its app
  // (the "Abrir em…" chooser when it is on several).
  // TVs repeat keydown while a key is held; keyup ends the press. If a keyup is lost,
  // the timer treats the press as short.
  var press = null;
  function okDown() {
    var now = Date.now();
    if (press && !press.done) { finishPress(true); return; }                    // a repeat: held
    if (press && press.done && now - press.last < 300) { press.last = now; return; }
    press = { t: now, last: now, done: false };
    press.timer = setTimeout(function () { finishPress(false); }, 1500);
  }
  function okUp() {
    if (press && !press.done) finishPress(Date.now() - press.t >= LONG_PRESS);
    press = null;
  }
  function finishPress(long) {
    if (!press || press.done) return;
    press.done = true;
    clearTimeout(press.timer);
    if (state.zone === 'search') { openResult(search.focused(), long); return; }
    if (state.zone !== 'rows') return;
    if (long) discover.open(); else openDetails();
  }

  function openDetails() {
    if (!discover.focused()) return;
    discover.openDetails();
  }

  function rowsKey(k) {
    var out = null;
    switch (k) {
      case KEY.LEFT: out = discover.move(-1, 0); break;
      case KEY.RIGHT: out = discover.move(1, 0); break;
      // Home: past the first row up to the app grid, past the last row round to its top.
      // Minha lista loops within its rows.
      case KEY.UP: out = discover.move(0, -1, state.view === 'home'); break;
      case KEY.DOWN: out = discover.move(0, 1, state.view === 'home'); break;
      default: return false;
    }
    if (out === 'up' || out === 'down') leaveRows(out);
    return true;
  }

  function overlayKey(k) {
    var dir = { dx: 0, dy: 0 }, action = null;
    if (k === KEY.LEFT) dir.dx = -1;
    else if (k === KEY.RIGHT) dir.dx = 1;
    else if (k === KEY.UP) dir.dy = -1;
    else if (k === KEY.DOWN) dir.dy = 1;
    else if (k === KEY.ENTER) action = 'ok';
    else if (k === KEY.BACK || k === 27 || k === 8) action = 'back';
    else return false;
    discover.overlayKey(dir, action);
    // The chooser/details may have closed (onClose re-syncs the zone).
    var o = discover.overlay();
    if (o) { state.zone = o; document.body.setAttribute('data-zone', o); }
    return true;
  }

  // Green = "Já vi" acts once per physical press: key repeats (a press held a little long
  // sends more keydowns) and a second keydown before the keyup are ignored, and two marks
  // are at least 700 ms apart. Otherwise a repeat arriving after the card has faded out
  // marks the NEXT title, which is now the focused one.
  var green = { held: false, last: 0, timer: null };
  function greenDown(e) {
    var now = Date.now();
    if (e.repeat || green.held || now - green.last < 700) return;
    green.held = true;
    green.last = now;
    clearTimeout(green.timer);
    green.timer = setTimeout(function () { green.held = false; }, 1500);   // a lost keyup
    markWatched();
  }

  document.addEventListener('keyup', function (e) {
    if (e.keyCode === KEY.ENTER) { okUp(); searchOk = true; }
    if (e.keyCode === extra.ColorF1Green || e.keyCode === 71) { green.held = false; clearTimeout(green.timer); }
  });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    var handled = true;
    lastKeyAt = Date.now();
    if (state.view === 'ids') {
      if (k === KEY.UP) el.ids.scrollTop -= 240;
      else if (k === KEY.DOWN) el.ids.scrollTop += 240;
      else if (k === KEY.BACK || k === 27 || k === 8 || k === extra.ColorF2Yellow || k === 89) back();
      else handled = false;
      if (handled) e.preventDefault();
      return;
    }
    if (state.zone === 'tvwin') {
      if (k === KEY.BACK || k === KEY.ENTER || k === 27 || k === 8) { hideInputWindow(); e.preventDefault(); }
      return;
    }
    if (state.zone === 'inputs') { if (inputsKey(k)) e.preventDefault(); return; }
    if (state.zone === 'bar' && barKey(k)) { e.preventDefault(); return; }
    if (discover.overlay()) {
      // Ignore the key repeats of the OK press that opened the details or the chooser.
      if (k === KEY.ENTER && press) { e.preventDefault(); return; }
      if (overlayKey(k)) e.preventDefault();
      return;
    }
    if (state.zone === 'search') { if (searchKey(e)) e.preventDefault(); return; }
    // S or / on a real keyboard: the search, from the app grid or the posters.
    if ((k === 83 || k === 191) && (state.zone === 'list' || state.zone === 'rows') && state.view !== 'ids') {
      openSearch(); e.preventDefault(); return;
    }
    if (state.zone === 'rows') {
      if (k === KEY.ENTER) { okDown(); e.preventDefault(); return; }
      if (k === extra.ColorF1Green || k === 71) { greenDown(e); e.preventDefault(); return; }   // 71: "g"
      // Yellow while the "Já vi" toast shows: undo the last mark (otherwise Yellow = IDs).
      if ((k === extra.ColorF2Yellow || k === 89) && state.undo) { undoWatched(); e.preventDefault(); return; }  // 89: "y"
      if (k === extra.Info || k === 73) { openDetails(); e.preventDefault(); return; } // 73: "i"
      if (rowsKey(k)) { e.preventDefault(); return; }
    }
    // Red (R in a desktop browser): the bottom-right menu, from anywhere; again to leave it.
    if (k === extra.ColorF0Red || k === 82) {
      if (state.zone === 'menu') leaveMenu();
      else { state.menuFrom = state.zone; setZone('menu'); }
      e.preventDefault(); return;
    }
    var inMenu = state.zone === 'menu';
    var inGrid = state.zone === 'list';
    switch (k) {
      case KEY.LEFT: if (inMenu) moveMenu(-1); else if (inGrid) moveGrid(-1, 0); break;
      case KEY.RIGHT: if (inMenu) moveMenu(1); else if (inGrid) moveGrid(1, 0); break;
      case KEY.UP: if (inMenu) leaveMenu(); else if (inGrid) moveGrid(0, -1); break;
      case KEY.DOWN: if (inMenu) leaveMenu(); else if (inGrid) moveGrid(0, 1); break;
      case KEY.ENTER: activate(); break;
      case KEY.BACK: case 27: case 8: back(); break;          // 27/8: Esc/Backspace in a desktop browser
      case extra.ColorF3Blue: case 66:                         // 66: "b" in a desktop browser
        switchView(state.view === 'all' ? 'home' : 'all'); break;
      case extra.ColorF2Yellow: case extra.Info: case 89:      // 89: "y" in a desktop browser
        switchView('ids'); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  // ---------- clock, weather ----------

  var DAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
    'setembro', 'outubro', 'novembro', 'dezembro'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function tick() {
    var d = new Date();
    el.clock.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    el.date.textContent = DAYS[d.getDay()] + ', ' + d.getDate() + ' de ' + MONTHS[d.getMonth()];
    var mode = currentMode();
    if (mode === 'grid' || (mode === 'shelf' && state.shelf && !state.shelf.items.length)) showBackground(landscape());
    if (state.loadedAt && Date.now() - state.loadedAt > REFRESH_MS) refreshDiscover();
    setTimeout(tick, (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 50);
  }

  function showWeather(w) {
    var first = !state.weather;
    state.weather = w;
    el.weather.innerHTML = '<span class="weather__icon">' + w.icon + '</span>' +
      '<span class="weather__text"><span class="weather__temp">' + Math.round(w.temp) + '°</span>' +
      '<span class="weather__range">' + escapeHtml(w.label ? w.label + ' · ' : '') +
      Math.round(w.max) + '° / ' + Math.round(w.min) + '°</span></span>';
    el.weather.hidden = false;
    // Rain changes the mood row: rebuild once when the first answer arrives.
    if (first && state.loadedAt && Smart.isRain(w.code)) refreshDiscover();
  }

  // ---------- scaling ----------

  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    el.stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  // ---------- boot ----------

  function load(restoreKey) {
    return P.getApps().then(function (apps) {
      buildModel(apps);
      if (restoreKey) {
        for (var i = 0; i < state.home.length; i++) {
          if (state.home[i].key === restoreKey) { state.focus.home = i; break; }
        }
      }
      render();
      return refreshDiscover();
    });
  }

  window.addEventListener('resize', fit);
  fit();
  showBackground(landscape());
  if (!P.isTV) {
    el.mock.textContent = (Catalog.mode === 'mock' ? 'Pré-visualização com dados de exemplo' : 'Pré-visualização no navegador') +
      ' · setas, Enter = detalhes (segure = abrir no app), Esc, G = já vi, Y = desfazer / IDs, R = menu, B = todos os apps, S = buscar';
    el.mock.hidden = false;
  }
  Weather.start(showWeather);
  showNetwork();
  tick();
  load(S.get(STORE_KEY));

  // Coming back from an app: refresh the list (apps may have been installed or removed)
  // and go back to the app list.
  // (visibilitychange on both TVs; webOSRelaunch too on LG: see Platform.onResume.)
  P.onResume(function () {
    var cur = state.home[state.focus.home];
    var key = cur ? cur.key : S.get(STORE_KEY);
    state.launching = false;
    discover.closeOverlay();
    closeInputs();
    if (search.isOpen()) { search.close(); state.zone = state.view === 'mine' ? 'rows' : 'list'; }
    if (state.zone === 'tvwin') hideInputWindow();
    showNetwork();
    if (state.view === 'home') state.zone = 'list';
    load(key);
  });
})();
