/*
 * The "Descobrir" area: poster rows, the hero for the focused title, the details overlay
 * and the "Abrir em…" chooser. js/app.js owns the zones, the rows and the history; this
 * file draws and moves focus inside the rows and overlays. Exposes window.DiscoverUI(opts).
 *
 * Built for a slow TV:
 * - Moving focus does no network and no layout reads. Card positions come from fixed
 *   sizes; the row tracks move with translate3d. The focused card (tvOS style) gets a
 *   class: it scales up and its pre-painted shadow and caption fade in (transform and
 *   opacity only; every card is its own compositor layer, painted once when it mounts).
 * - Key repeats only update the model; the DOM is updated once per animation frame.
 * - Only the current row ±1 is in the DOM, each with a window of about 12 cards; images
 *   are set only on cards in that window.
 * - The hero text waits 150 ms after focus settles, the backdrop 350 ms; then the
 *   backdrops of the neighbours are preloaded so the next swap needs no network.
 * - "Where to watch", runtime and genres come from the rows themselves (app.js fetches
 *   each row per installed app) and from a background queue (2 at a time) that pauses
 *   while keys are being pressed. Missing data is filled in silently when it arrives.
 *
 * opts:
 *   catalog                 window.Catalog
 *   toast(msg, isError)
 *   onBackdrop(url|null)    the focused title's backdrop (null: back to the landscape)
 *   preload(url)            fetch a backdrop in the background (no swap)
 *   appsOf(item)            installed app items known for a title, or null if unknown yet
 *   learn(item, providers)  tell app.js the TMDB providers of a title (from details)
 *   appByKey(key)           an installed app item, or null
 *   usage(appKey)           how much an app is used (taste profile score), for "mais usado"
 *   statusOf(key)           'picked'|'watching'|'watched'|'want'|null
 *   setStatus(item, status) save a mark ("Já vi", "Quero ver", "Assistindo"), or null
 *   launchTitle(item, app)  open the app for a title (on the title itself when its id there
 *                           is known, see js/deeplink.js) and record it
 *   launchTrailer(item, youtubeKey, app)  play the trailer in YouTube (details "Trailer")
 *   onOpen(kind)            an overlay opened: 'details' | 'chooser'
 *   onClose()               an overlay closed (app.js re-syncs its zone)
 */
(function () {
  'use strict';

  var Smart = window.Smart;
  // Lite mode (old TVs, see js/platform.js): smaller posters, only the current and next row
  // in the DOM, fewer spare cards, a later backdrop.
  var LITE = !!(window.Platform && window.Platform.lite);

  var ROW_H = 420;          // label + poster + caption + gap
  var STEP = 232;           // card width 200 + gap 32
  var VISIBLE = 7;          // cards that fit at 1920 from x=112
  var MARGIN = 1;           // keep one card of context on each side when scrolling
  var EXTRA = LITE ? 1 : 2;            // cards kept in the DOM beyond each edge of the visible window
  var HERO_WAIT = 150;
  var BACKDROP_WAIT = LITE ? 800 : 350;
  var QUIET = 400;          // the background queue waits this long after the last key
  var PARALLEL = 2;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function $(id) { return document.getElementById(id); }

  function typeLabel(t) { return t === 'tv' ? 'Série' : 'Filme'; }

  // Smaller images for the TV (older history records may hold bigger sizes).
  // Lite: w154 posters in the rows, w185 in the details.
  function posterUrl(u) { return u ? u.replace(/\/w(342|185)\//, LITE ? '/w154/' : '/w185/') : ''; }
  function bigPosterUrl(u) { return u ? u.replace(/\/w(154|185)\//, LITE ? '/w185/' : '/w342/') : ''; }
  function backdropUrl(u) { return u ? u.replace('/w1280/', '/w780/') : ''; }

  function duration(d, type) {
    if (type === 'tv') return d.seasons ? d.seasons + (d.seasons === 1 ? ' temporada' : ' temporadas') : '';
    if (!d.runtime) return '';
    var h = Math.floor(d.runtime / 60), m = d.runtime % 60;
    return (h ? h + ' h ' : '') + (m ? m + ' min' : '').trim();
  }

  function tr(x, y) { return 'translate3d(' + x + 'px,' + y + 'px,0)'; }

  var STATUS_TEXT = { watched: 'Já vi', want: 'Quero ver', watching: 'Assistindo', picked: 'Aberto por aqui' };

  window.DiscoverUI = function (opts) {
    var el = {
      root: $('discover'), rows: $('rows'), hint: $('discover-hint'),
      hero: $('hero'), eyebrow: $('hero-eyebrow'), title: $('hero-title'), meta: $('hero-meta'),
      overview: $('hero-overview'), providers: $('hero-providers'),
      details: $('details'), chooser: $('chooser')
    };

    var ui = {
      rows: [], r: 0, col: [], first: [], peek: 0,
      mode: 'peek',            // 'peek' (app list focused) | 'full' (a poster focused)
      genres: { movie: {}, tv: {} },
      det: {},                 // details by item key (memory; the catalog caches on disk)
      imdb: {},
      mounted: {},             // row index -> { el, track, cards: { col: node } }
      frame: 0,                // pending requestAnimationFrame
      shownR: -1,
      focusNode: null,         // the card that has the focus look
      lastKey: 0,
      heroTimer: null, bgTimer: null,
      heroFor: null,           // item whose text the hero shows
      overlay: null            // null | { kind: 'details', … } | { kind: 'chooser', … }
    };

    // ---------- data in ----------

    function setGenres(g) { if (g) ui.genres = g; }

    // rows: [{ id, title, items: [item] }]. Keeps the focus on the same row id and title key
    // when possible (unless reset: start at the first row).
    // peekId: the row shown under the app list.
    function setRows(rows, peekId, reset) {
      var oldRow = ui.rows[ui.r], oldItem = focused();
      ui.rows = rows.filter(function (r) { return r.items && r.items.length; });
      ui.col = []; ui.first = [];
      ui.peek = 0;
      ui.rows.forEach(function (row, i) {
        ui.col[i] = 0; ui.first[i] = 0;
        if (row.id === peekId) ui.peek = i;
      });
      ui.r = ui.mode === 'peek' ? ui.peek : 0;
      if (oldRow && !reset) {
        for (var i = 0; i < ui.rows.length; i++) {
          if (ui.rows[i].id !== oldRow.id) continue;
          ui.r = i;
          var items = ui.rows[i].items;
          for (var c = 0; oldItem && c < items.length; c++) if (items[c].key === oldItem.key) { ui.col[i] = c; break; }
          if (ui.col[i] >= items.length) ui.col[i] = items.length - 1;
          scrollRow(i);
          break;
        }
      }
      if (ui.r >= ui.rows.length) ui.r = Math.max(0, ui.rows.length - 1);
      rebuild();
    }

    function setHint(text) {
      el.hint.textContent = text || '';
      el.hint.hidden = !text;
    }

    function hasRows() { return ui.rows.length > 0; }

    function focused() {
      var row = ui.rows[ui.r];
      return row ? row.items[ui.col[ui.r]] : null;
    }

    // ---------- DOM: mounted rows and card windows ----------

    // The score sits on the card, top right ("★ 7,8"): text drawn with the card, no layer of
    // its own (Smart.cardScore leaves it out for titles with no score or too few votes).
    function cardNode(it) {
      var st = opts.statusOf(it.key);
      var score = Smart.cardScore(it);
      var pal = typeof it.palette === 'number' ? it.palette : (it.id % 8);
      var d = document.createElement('div');
      d.className = 'poster';
      // The lift scales on focus (one layer per card); the caption shows under it.
      d.innerHTML = '<div class="poster__lift"><div class="poster__shadow"></div>' +
        '<div class="poster__art poster--p' + pal + '">' +
        '<span class="poster__kind">' + typeLabel(it.type) + '</span>' +
        '<span class="poster__title">' + escapeHtml(it.title) + '</span></div>' +
        (it.poster ? '<img class="poster__img" alt="" src="' + escapeHtml(posterUrl(it.poster)) + '">' : '') +
        (st === 'want' ? '<span class="poster__badge">Na lista</span>' : '') +
        (score ? '<span class="poster__score">' + score + '</span>' : '') + '</div>' +
        '<div class="poster__cap">' + escapeHtml(it.title) + '</div>';
      var img = d.querySelector('img');
      if (img) {
        img.onload = function () { this.className = 'poster__img is-loaded'; };
        img.onerror = function () { this.parentNode.removeChild(this); };
      }
      return d;
    }

    function rowNode(row, i) {
      var r = document.createElement('div');
      r.className = 'row';
      r.style.transform = tr(0, i * ROW_H);
      r.innerHTML = '<div class="row__label">' + escapeHtml(row.title) +
        (row.sub ? '<span class="row__sub">' + escapeHtml(row.sub) + '</span>' : '') + '</div>' +
        '<div class="row__track"></div>';
      return { el: r, track: r.lastChild, cards: {}, first: -1 };
    }

    // Cards of row i in [first - EXTRA, first + VISIBLE + EXTRA): add/remove at the edges.
    function syncCards(i) {
      var m = ui.mounted[i], row = ui.rows[i];
      if (!m || !row) return;
      var f = ui.first[i] || 0;
      if (m.first === f) return;
      m.first = f;
      var lo = Math.max(0, f - EXTRA), hi = Math.min(row.items.length, f + VISIBLE + EXTRA);
      Object.keys(m.cards).forEach(function (c) {
        if (c < lo || c >= hi) { m.track.removeChild(m.cards[c]); delete m.cards[c]; }
      });
      for (var c = lo; c < hi; c++) {
        if (m.cards[c]) continue;
        var n = cardNode(row.items[c]);
        n.style.transform = tr(c * STEP, 0);
        m.track.appendChild(n);
        m.cards[c] = n;
      }
      m.track.style.transform = tr(-f * STEP, 0);
    }

    // Which rows are in the DOM: the current one ±1 (full) or just the peek row.
    function mountRows() {
      var want = {};
      if (ui.mode === 'full') { if (!LITE) want[ui.r - 1] = 1; want[ui.r] = 1; want[ui.r + 1] = 1; }
      else want[ui.peek] = 1;
      Object.keys(ui.mounted).forEach(function (i) {
        if (!want[i]) { el.rows.removeChild(ui.mounted[i].el); delete ui.mounted[i]; }
      });
      Object.keys(want).forEach(function (k) {
        var i = +k;
        if (i < 0 || i >= ui.rows.length || ui.mounted[i]) return;
        var m = rowNode(ui.rows[i], i);
        ui.mounted[i] = m;
        el.rows.appendChild(m.el);
        syncCards(i);
      });
      Object.keys(ui.mounted).forEach(function (k) {
        var i = +k;
        var m = ui.mounted[i];
        m.el.style.opacity = i === ui.r ? 1 : (ui.mode === 'full' && i === ui.r + 1 ? 0.55 : 0);
        var cls = i === ui.r ? 'row is-current' : 'row';
        if (m.el.className !== cls) m.el.className = cls;
      });
    }

    function rebuild() {
      el.rows.innerHTML = '';
      ui.mounted = {};
      ui.shownR = -1;
      ui.focusNode = null;
      paint();
    }

    // The focus look moves to the focused card (two class changes, no layout).
    function paintFocus(on) {
      var m = ui.mounted[ui.r];
      var node = on && m ? m.cards[ui.col[ui.r]] || null : null;
      if (node === ui.focusNode) return;
      if (ui.focusNode) ui.focusNode.classList.remove('is-focused');
      if (node) node.classList.add('is-focused');
      ui.focusNode = node;
    }

    // The one DOM update per frame: rows, track, focused card. Then (debounced) hero and backdrop.
    function paint() {
      ui.frame = 0;
      if (ui.shownR !== ui.r) {
        el.rows.style.transform = tr(0, -ui.r * ROW_H);
        ui.shownR = ui.r;
      }
      mountRows();
      syncCards(ui.r);
      var full = ui.mode === 'full' && ui.rows.length;
      paintFocus(full);
      if (full) {
        scheduleHero();
      } else {
        clearTimeout(ui.heroTimer);
        clearTimeout(ui.bgTimer);
      }
    }

    function schedule() {
      if (!ui.frame) ui.frame = requestAnimationFrame(paint);
    }

    function scrollRow(r) {
      var c = ui.col[r], f = ui.first[r] || 0;
      if (c > f + VISIBLE - 1 - MARGIN) f = c - (VISIBLE - 1 - MARGIN);
      if (c < f + MARGIN) f = c - MARGIN;
      ui.first[r] = Math.max(0, f);
    }

    // ---------- hero ----------

    function ratingHtml(it, d) {
      var imdb = d && d.imdbId && ui.imdb[d.imdbId];
      if (imdb) return '<span class="rating rating--imdb"><b>IMDb</b> ' + Smart.formatRating(parseFloat(imdb)) + '</span>';
      if (it.rating) return '<span class="rating"><b>★</b> ' + Smart.formatRating(it.rating) + '</span>';
      return '';
    }

    function metaHtml(it, d, noRating) {
      var parts = [];
      var r = noRating ? '' : ratingHtml(it, d);
      if (r) parts.push(r);
      if (it.year) parts.push(escapeHtml(it.year));
      parts.push(typeLabel(it.type));
      var dur = d ? duration(d, it.type) : '';
      if (dur) parts.push(escapeHtml(dur));
      var names = d && d.genres.length ? d.genres : (it.genreIds || []).map(function (g) {
        return (ui.genres[it.type] || {})[g];
      }).filter(Boolean);
      if (names.length) parts.push(escapeHtml(names.slice(0, 2).join(', ')));
      return parts.join('<i class="dot">·</i>');
    }

    function providersHtml(it) {
      var st = opts.statusOf(it.key);
      var chip = st ? '<span class="pill pill--status">' + STATUS_TEXT[st] + '</span>' : '';
      var apps = opts.appsOf(it);
      if (apps === null) return chip;                 // not known yet: filled in later
      if (!apps.length) return chip + '<span class="pill pill--none">Não está nos seus apps</span>';
      return chip + apps.map(function (a) { return '<span class="pill">' + escapeHtml(a.name) + '</span>'; }).join('');
    }

    function eyebrow(it) {
      var row = ui.rows[ui.r];
      return it.reason || (row && (row.eyebrow || row.title)) || '';
    }

    function scheduleHero() {
      clearTimeout(ui.heroTimer);
      clearTimeout(ui.bgTimer);
      ui.heroTimer = setTimeout(hero, HERO_WAIT);
      ui.bgTimer = setTimeout(function () {
        var it = focused();
        if (!it || ui.mode !== 'full' || ui.overlay) return;
        opts.onBackdrop(backdropUrl(it.backdrop) || null);
        // The neighbours next, in the background: the next move swaps from memory.
        var row = ui.rows[ui.r], c = ui.col[ui.r];
        if (!opts.preload || LITE) return;
        [row.items[c + 1], row.items[c - 1]].forEach(function (x) { if (x && x.backdrop) opts.preload(backdropUrl(x.backdrop)); });
      }, BACKDROP_WAIT);
    }

    // The hero fades its text out while focus moves and back in when it is painted again.
    function staleHero() { el.hero.className = 'is-stale'; }

    // The hero for a title shown by app.js (an app's Top Shelf): eyebrow, title, meta,
    // synopsis; the status chip only (the app is the one focused).
    function showItem(it, label) {
      var d = ui.det[it.key];
      el.eyebrow.textContent = label || '';
      el.title.textContent = it.title;
      el.title.className = it.title.length > 30 ? 'is-long' : '';
      el.meta.innerHTML = metaHtml(it, d);
      el.overview.textContent = it.overview || '';
      var st = opts.statusOf(it.key);
      el.providers.innerHTML = st ? '<span class="pill pill--status">' + STATUS_TEXT[st] + '</span>' : '';
      el.hero.className = '';
    }

    function hero() {
      var it = focused();
      if (!it || ui.mode !== 'full') return;
      ui.heroFor = it;
      var d = ui.det[it.key];
      el.eyebrow.textContent = eyebrow(it);
      el.title.textContent = it.title;
      el.title.className = it.title.length > 30 ? 'is-long' : '';
      el.meta.innerHTML = metaHtml(it, d);
      el.overview.textContent = it.overview || '';
      el.providers.innerHTML = providersHtml(it);
      el.hero.className = '';
      // Not prefetched yet: put it at the front of the background queue.
      if (!d) enqueue([it], true);
    }

    // Background data arrived for a title: update the hero quietly if it shows that title.
    function refreshHeroFor(it) {
      if (ui.heroFor && ui.heroFor.key === it.key && ui.mode === 'full' && Date.now() - ui.lastKey > QUIET) {
        var d = ui.det[it.key];
        el.meta.innerHTML = metaHtml(ui.heroFor, d);
        el.providers.innerHTML = providersHtml(ui.heroFor);
      }
    }

    // ---------- background queue: details (providers, runtime, genres, IMDb) ----------

    var queue = [], queued = {}, running = 0, waiting = null, waiters = {};

    // cb (optional) runs once for each item when its details are in (at once if known).
    function enqueue(items, front, cb) {
      items.forEach(function (it) {
        if (!it) return;
        if (cb) {
          if (ui.det[it.key]) { setTimeout(cb, 0); return; }
          (waiters[it.key] = waiters[it.key] || []).push(cb);
        }
        if (ui.det[it.key] || queued[it.key]) return;
        queued[it.key] = true;
        if (front) queue.unshift(it); else queue.push(it);
      });
      pump();
    }

    function pump() {
      if (waiting) return;
      var idle = Date.now() - ui.lastKey;
      if (idle < QUIET) { waiting = setTimeout(function () { waiting = null; pump(); }, QUIET - idle + 20); return; }
      while (running < PARALLEL && queue.length) {
        var it = queue.shift();
        running++;
        loadDetails(it).then(function (x) {
          return function () {
            running--; delete queued[x.key];
            (waiters[x.key] || []).forEach(function (f) { f(); });
            delete waiters[x.key];
            refreshHeroFor(x); pump();
          };
        }(it));
      }
    }

    function loadDetails(it) {
      if (ui.det[it.key]) return Promise.resolve(ui.det[it.key]);
      return opts.catalog.details(it).then(function (d) {
        ui.det[it.key] = d;
        opts.learn(it, d.providers);
        // The title's ids inside each streaming app (for opening it directly), batched and
        // in the background; the queue does not wait for them.
        if (d.wikidataId && opts.catalog.serviceIds) {
          opts.catalog.serviceIds(d.wikidataId).then(function (ids) { if (ids) d.links = ids; });
        }
        if (d.imdbId && opts.catalog.hasImdb && !(d.imdbId in ui.imdb)) {
          return opts.catalog.imdbRating(d.imdbId).then(function (v) { ui.imdb[d.imdbId] = v; return d; });
        }
        return d;
      }, function (err) {
        console.warn('details', it.key, err);
        return { runtime: 0, seasons: 0, tagline: '', genres: [], providers: [], imdbId: '', failed: true };
      });
    }

    // ---------- modes and movement ----------

    function setMode(m) {
      if (ui.mode === m) return;
      ui.mode = m;
      if (m === 'peek') { ui.savedR = ui.r; ui.r = ui.peek; }
      schedule();
    }

    // Back from the menu: return to the row the user was on.
    function restoreRow() {
      if (ui.mode === 'full' && ui.savedR != null && ui.savedR < ui.rows.length) { ui.r = ui.savedR; schedule(); }
    }

    // Model only; the DOM follows in the next animation frame (key repeats coalesce).
    // Up/Down loop: Down on the last row goes to the first, Up on the first to the last
    // (only the target row ±1 is mounted, so a wrap costs no more than a normal move).
    // Returns 'left' when focus should leave the rows, else null.
    // edges: no loop; 'up' / 'down' when moving past the first / last row (app.js takes
    // the focus to the app grid).
    function move(dx, dy, edges) {
      ui.lastKey = Date.now();
      var row = ui.rows[ui.r];
      if (!row) return dx < 0 ? 'left' : null;
      if (dx) {
        var c = ui.col[ui.r] + dx;
        if (c < 0) return 'left';
        if (c >= row.items.length) return null;
        ui.col[ui.r] = c;
        scrollRow(ui.r);
      } else {
        if (edges && ui.r + dy < 0) return 'up';
        if (edges && ui.r + dy >= ui.rows.length) return 'down';
        ui.r = (ui.r + dy + ui.rows.length) % ui.rows.length;
      }
      clearTimeout(ui.heroTimer);
      clearTimeout(ui.bgTimer);
      staleHero();
      schedule();
      return null;
    }

    // Focus row i (its remembered card): entering the rows from the app grid or the bar.
    function goRow(i) {
      if (!ui.rows.length) return;
      ui.r = Math.max(0, Math.min(ui.rows.length - 1, i));
      ui.lastKey = Date.now();
      staleHero();
      schedule();
    }

    // Focus a title wherever it is (undo of "Já vi" returns to the restored card).
    function focusKey(key) {
      for (var i = 0; i < ui.rows.length; i++) {
        for (var c = 0; c < ui.rows[i].items.length; c++) {
          if (ui.rows[i].items[c].key !== key) continue;
          ui.r = i; ui.col[i] = c; scrollRow(i); schedule();
          return true;
        }
      }
      return false;
    }

    // "Já vi" on a card: fade it out, then cb() (app.js removes it and re-syncs the rows).
    function fadeOut(key, cb) {
      var m = ui.mounted[ui.r], row = ui.rows[ui.r];
      var c = row ? row.items.map(function (x) { return x.key; }).indexOf(key) : -1;
      var node = m && c !== -1 && m.cards[c];
      if (node) node.style.opacity = 0;
      setTimeout(cb, node ? 160 : 0);
    }

    // ---------- opening a title ----------

    function appsForItem(it) {
      var known = opts.appsOf(it);
      var p = known !== null ? Promise.resolve(ui.det[it.key] || {}) : loadDetails(it);
      return p.then(function (d) {
        var apps = opts.appsOf(it) || [];
        // A title opened before keeps its app first.
        var prev = it.app && opts.appByKey(it.app);
        if (prev) apps = [prev].concat(apps.filter(function (a) { return a.key !== prev.key; }));
        return { apps: apps, d: d };
      });
    }

    function open(it) {
      it = it || focused();
      if (!it) return;
      appsForItem(it).then(function (res) {
        if (ui.overlay) return;
        if (!res.apps.length) {
          opts.toast(res.d.failed ? 'Sem conexão para ver onde assistir' : 'Não está em nenhum app instalado', true);
          openDetails(it);
        } else if (res.apps.length === 1 || (it.app && res.apps[0].key === it.app)) {
          opts.launchTitle(it, res.apps[0]);
        } else {
          openChooser(it, res.apps);
        }
      });
    }

    // ---------- chooser ----------

    function openChooser(it, apps) {
      ui.overlay = { kind: 'chooser', item: it, apps: apps.slice(0, 5), i: 0 };
      el.chooser.innerHTML = '<div class="chooser__card">' +
        '<div class="chooser__head">Abrir em</div>' +
        '<div class="chooser__title">' + escapeHtml(it.title) + '</div>' +
        ui.overlay.apps.map(function (a, i) {
          return '<div class="chooser__item"><span>' + escapeHtml(a.name) + '</span>' +
            (i === 0 && opts.usage(a.key) > 0 ? '<small>mais usado</small>' : '') + '</div>';
        }).join('') + '</div>';
      el.chooser.hidden = false;
      paintOverlay();
      opts.onOpen('chooser');
    }

    // ---------- details ----------

    function detailButtons(it, apps) {
      var st = opts.statusOf(it.key);
      var b = apps.slice(0, 3).map(function (a) {
        return { kind: 'open', app: a, label: 'Abrir em ' + a.name, primary: true };
      });
      var yt = opts.appByKey('youtube'), d = ui.det[it.key];
      // Only where YouTube can be opened on the video (LG); on Samsung it opens on its home.
      if (yt && d && d.trailer && !window.tizen) b.push({ kind: 'trailer', app: yt, label: 'Trailer' });
      b.push({ kind: 'mark', status: 'want', label: st === 'want' ? '✓ Na lista' : '+ Quero ver', on: st === 'want' });
      b.push({ kind: 'mark', status: 'watching', label: st === 'watching' ? '✓ Assistindo' : 'Assistindo', on: st === 'watching' });
      b.push({ kind: 'mark', status: 'watched', label: st === 'watched' ? '✓ Já vi' : 'Já vi', on: st === 'watched' });
      return b;
    }

    function openDetails(it) {
      it = it || focused();
      if (!it) return;
      clearTimeout(ui.bgTimer);
      ui.overlay = { kind: 'details', item: it, buttons: [], i: 0, apps: opts.appsOf(it) || [] };
      drawDetails();
      el.details.hidden = false;
      opts.onOpen('details');
      loadDetails(it).then(function () {
        if (!ui.overlay || ui.overlay.item !== it) return;
        ui.overlay.apps = opts.appsOf(it) || [];
        var prev = it.app && opts.appByKey(it.app);
        if (prev && !ui.overlay.apps.some(function (a) { return a.key === prev.key; })) ui.overlay.apps.unshift(prev);
        drawDetails();
      });
    }

    function drawDetails() {
      var o = ui.overlay, it = o.item, d = ui.det[it.key];
      // Keep the focused button across redraws once the user has moved; before that,
      // focus the first one ("Abrir em …" when the providers have loaded).
      var keepLabel = o.moved && o.buttons[o.i] && o.buttons[o.i].label;
      if (!o.moved) o.i = 0;
      o.buttons = detailButtons(it, o.apps);
      if (o.i >= o.buttons.length) o.i = o.buttons.length - 1;
      var pal = typeof it.palette === 'number' ? it.palette : (it.id % 8);
      var avail = o.apps.length ? 'Disponível em ' + o.apps.map(function (a) { return a.name; }).join(', ')
        : !d ? 'Procurando onde assistir…'
        : d.failed ? 'Sem conexão para ver onde assistir.' : 'Não está em nenhum dos seus apps de streaming.';
      var reason = it.reason ? '<div class="details__eyebrow">' + escapeHtml(it.reason) + '</div>' : '';
      var tmdbScore = it.rating ? '<span class="rating"><b>TMDB</b> ' + Smart.formatRating(it.rating) + '</span>' : '';
      var imdb = d && d.imdbId && ui.imdb[d.imdbId];
      var imdbScore = imdb ? '<span class="rating rating--imdb"><b>IMDb</b> ' + Smart.formatRating(parseFloat(imdb)) + '</span>' : '';
      el.details.innerHTML =
        '<div class="details__poster"><div class="poster__art poster--p' + pal + '">' +
          '<span class="poster__kind">' + typeLabel(it.type) + '</span>' +
          '<span class="poster__title">' + escapeHtml(it.title) + '</span></div>' +
          (it.poster ? '<img class="poster__img is-loaded" alt="" src="' + escapeHtml(bigPosterUrl(it.poster)) + '">' : '') + '</div>' +
        '<div class="details__body">' + reason +
          '<h2 class="details__title">' + escapeHtml(it.title) + '</h2>' +
          (d && d.tagline ? '<div class="details__tagline">' + escapeHtml(d.tagline) + '</div>' : '') +
          '<div class="details__meta">' + metaHtml(it, d, true) + '</div>' +
          '<div class="details__scores">' + imdbScore + tmdbScore + '</div>' +
          '<p class="details__overview">' + escapeHtml(it.overview || 'Sem sinopse em português.') + '</p>' +
          '<div class="details__avail">' + escapeHtml(avail) + '</div>' +
          '<div class="details__buttons">' + o.buttons.map(function (b) {
            return '<div class="btn' + (b.primary ? ' btn--primary' : '') + (b.on ? ' is-on' : '') + '">' + escapeHtml(b.label) + '</div>';
          }).join('') + '</div>' +
        '</div>' +
        '<div class="details__credit">Dados de filmes e séries: TMDB. Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.</div>';
      if (keepLabel) {
        for (var i = 0; i < o.buttons.length; i++) if (o.buttons[i].label === keepLabel) { o.i = i; break; }
      }
      paintOverlay();
    }

    function paintOverlay() {
      var o = ui.overlay;
      if (!o) return;
      var nodes = o.kind === 'details'
        ? el.details.querySelectorAll('.btn')
        : el.chooser.querySelectorAll('.chooser__item');
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('is-focused', i === o.i);
    }

    function closeOverlay() {
      if (!ui.overlay) return;
      var kind = ui.overlay.kind;
      ui.overlay = null;
      el.details.hidden = true;
      el.chooser.hidden = true;
      if (kind === 'details') rebuild();   // marks may have changed the badges
      opts.onClose();
    }

    // Keys while an overlay is open. Returns true when handled.
    function overlayKey(dir, action) {
      var o = ui.overlay;
      if (!o) return false;
      var n = o.kind === 'details' ? o.buttons.length : o.apps.length;
      if (action === 'back') { closeOverlay(); return true; }
      if (o.kind === 'details' && dir.dx) { o.i = Math.max(0, Math.min(n - 1, o.i + dir.dx)); o.moved = true; }
      if (o.kind === 'chooser' && dir.dy) o.i = Math.max(0, Math.min(n - 1, o.i + dir.dy));
      if (action === 'ok') {
        if (o.kind === 'chooser') {
          var app = o.apps[o.i], it = o.item;
          closeOverlay();
          opts.launchTitle(it, app);
          return true;
        }
        var b = o.buttons[o.i];
        if (b.kind === 'open') { var item = o.item; closeOverlay(); opts.launchTitle(item, b.app); return true; }
        if (b.kind === 'trailer') { opts.launchTrailer(o.item, ui.det[o.item.key].trailer, b.app); return true; }
        var cur = opts.statusOf(o.item.key);
        opts.setStatus(o.item, cur === b.status ? null : b.status);
        o.moved = true;
        drawDetails();
        return true;
      }
      paintOverlay();
      return true;
    }

    return {
      setGenres: setGenres,
      setRows: setRows,
      setHint: setHint,
      setMode: setMode,
      hasRows: hasRows,
      focused: focused,
      move: move,
      goRow: goRow,
      rowIndex: function () { return ui.r; },
      rowCount: function () { return ui.rows.length; },
      showItem: showItem,
      cardNode: cardNode,      // a poster card, for the search screen (js/search.js)
      staleHero: staleHero,
      backdropUrl: backdropUrl,
      restoreRow: restoreRow,
      focusKey: focusKey,
      fadeOut: fadeOut,
      open: open,
      openDetails: openDetails,
      overlay: function () { return ui.overlay ? ui.overlay.kind : null; },
      overlayKey: overlayKey,
      closeOverlay: closeOverlay,
      refreshHero: function () { if (ui.mode === 'full') hero(); },
      // Background prefetch (details for the hero; availability checks for "Para você").
      enqueue: enqueue,
      details: loadDetails,
      known: function (key) { return ui.det[key] || null; }
    };
  };
})();
