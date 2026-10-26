/*
 * The "Buscar" screen, like the tvOS search: the query at the top, four filters (Categoria,
 * Ano, Nota and Só streaming) under it, an on-screen keyboard moved with the arrows (the TVs' own keyboards are
 * slow and differ per model), and the results under that as poster rows: Filmes, Séries and
 * Pessoas, kept apart as everywhere else. js/app.js owns the zone and the keys; OK on a title
 * goes to the same details, "Abrir em…" and launch code as the rows (js/discover.js).
 * Exposes window.SearchUI(opts).
 *
 * Vertical focus is one loop: filters → keyboard (3 rows) → result rows → (Down on the last
 * row) the filters; Up from the filters goes to the last result row. Up from the first result
 * row returns to the key that was focused.
 *
 * Fast on a slow TV:
 * - A key press changes the model only; the DOM follows once per animation frame, and only
 *   classes and transforms change (the keyboard is drawn once).
 * - TMDB is asked 350 ms after the last letter (at the front of the catalog's queue); the
 *   answer to an older query is dropped. Answers are kept in memory: deleting a letter or
 *   setting a filter back shows the earlier results at once.
 * - Moving between results does no network: the cards come from the answer, with the rows'
 *   poster sizes, and only a window of about 11 cards per row is in the DOM.
 * - Só streaming (on by default): with filters only, TMDB itself returns titles on the TV's
 *   apps (catalog.js). With text, TMDB cannot filter, so when an answer arrives the apps of
 *   its titles are looked up in the background, 4 at a time, in the answer's order (the
 *   details request, cached, which the details screen then reuses); never on a key press.
 *   The rows wait for the first 8 answers, then each row shows its titles in order up to the
 *   first one still being checked: cards are only added at the end, nothing on screen moves.
 *
 * opts:
 *   catalog              window.Catalog (search, searchKnown, personTitles, mode)
 *   cardNode(item)       a poster card, the same as in the rows (js/discover.js)
 *   isWatched(key)       true for a title marked "Já vi" (left out)
 *   appsOf(item)         the installed apps a title is on ([{ name }]), or null if not known yet
 *   lookup(item)         Promise: find out (details request, cached) which apps a title is on
 *   streamIds()          TMDB provider ids of the TV's apps (Só streaming)
 *   hide                 what is left out (Smart.hideRule: anime, Asian titles)
 *   genres()             { movie: { id: name }, tv: { id: name } } or null: the categories
 *   suggestions()        rows shown while there is no text and no filter: [{ id, title, items }]
 *   toast(msg, isError)
 */
(function () {
  'use strict';

  var Smart = window.Smart;
  var LITE = !!(window.Platform && window.Platform.lite);

  // Card geometry: the same as the poster rows (js/discover.js; css .row, .poster).
  var ROW_H = 420;
  var STEP = 232;
  var VISIBLE = 7;
  var MARGIN = 1;
  var EXTRA = LITE ? 1 : 2;
  var ROWS_TOP = 340;       // css .search__rows: the results, under the filters and the keyboard
  var CHIP_X = 368;         // css .search__chip: width 352 + gap 16
  var LOOK_PARALLEL = 4;    // streaming checks at a time
  var FIRST_BATCH = 8;      // the rows wait for this many checks
  var PICK_ROWS = 8;        // lines a filter list shows at once
  var PICK_H = 62;          // css .pick__item
  var WAIT = 350;           // ms after the last letter before TMDB is asked
  var MAX_Q = 40;
  var PER_ROW = 20;
  var THIS_YEAR = new Date().getFullYear();

  // Letters, digits and the commonest accents; the last column is Apagar, Espaço and Limpar.
  var KEYS = [
    'abcdefghijklm'.split('').concat(['del']),
    'nopqrstuvwxyz'.split('').concat(['space']),
    '1234567890çãé'.split('').concat(['clear'])
  ];
  var ACTION = { del: 'Apagar', space: 'Espaço', clear: 'Limpar' };
  var LABEL = { movie: 'Filmes', tv: 'Séries', people: 'Pessoas' };
  var DEPT = { Acting: 'Atuação', Directing: 'Direção', Writing: 'Roteiro', Production: 'Produção' };
  var ICON = '<svg class="search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg>';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function tr(x, y) { return 'translate3d(' + x + 'px,' + y + 'px,0)'; }

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase();
  }

  function keyboardHtml() {
    return KEYS.map(function (row) {
      return '<div class="kb__row">' + row.map(function (k) {
        return ACTION[k] ? '<div class="kb__key kb__key--wide">' + ACTION[k] + '</div>' : '<div class="kb__key">' + escapeHtml(k) + '</div>';
      }).join('') + '</div>';
    }).join('');
  }

  window.SearchUI = function (opts) {
    var root = document.getElementById('search');
    root.innerHTML =
      '<div class="search__query">' + ICON + '<span class="search__text"></span><i class="search__caret"></i>' +
        '<span class="search__ph">Filmes, séries e pessoas</span><span class="search__sum"></span></div>' +
      '<div class="search__view"><div class="search__body">' +
        '<div class="search__chips"><div class="search__chip"></div><div class="search__chip"></div>' +
          '<div class="search__chip"></div><div class="search__chip"></div></div>' +
        '<div class="search__kb">' + keyboardHtml() + '</div>' +
        '<p class="search__note"></p><div class="search__rows"></div>' +
      '</div></div>' +
      '<div class="search__pick" hidden><div class="pick__list"></div></div>' +
      '<div class="search__hints"></div>';

    function $(sel) { return root.querySelector(sel); }
    var el = {
      text: $('.search__text'), body: $('.search__body'), chips: $('.search__chips').children,
      note: $('.search__note'), rows: $('.search__rows'), pick: $('.search__pick'), pickList: $('.pick__list'),
      hints: $('.search__hints'), sum: $('.search__sum')
    };
    var keyNodes = [];
    var kbRows = $('.search__kb').children;
    for (var i = 0; i < kbRows.length; i++) keyNodes.push(kbRows[i].children);

    var s = {
      open: false,
      q: '',
      at: 'kb',                // 'chips' | 'kb' | 'pick' (a filter's list) | 'rows' (a result)
      chip: 0,                 // 0 Categoria, 1 Ano, 2 Nota, 3 Só streaming
      kr: 0, kc: 0,            // the focused key
      cat: null, year: null, rating: null,   // the chosen filter options (null: Todas / Qualquer)
      stream: true,            // Só streaming: only titles on an app of this TV
      ready: true,             // false until the first streaming checks of an answer are in
      failed: {},              // titles whose check failed (left out)
      stepYear: THIS_YEAR,     // the year of the "one year" line
      pick: null,              // the open filter list: { kind, items, i, top }
      rows: [], r: 0, col: [], first: [],
      res: null,               // the answer shown (kept to filter again after a mark)
      loading: false,
      person: null,            // { item, res, key } while a person's titles are shown
      seq: 0, timer: null, frame: 0,
      mounted: [], shownY: null, shownAt: '', hintsShown: '',
      keyFocus: null, chipFocus: null, cardFocus: null, pickFocus: null
    };

    // ---------- query and filters ----------

    function filter() {
      return {
        text: s.q.replace(/\s+/g, ' ').replace(/^ | $/g, ''),
        cat: s.cat ? s.cat.cat : null,
        year: s.year ? s.year.year : null,
        rating: s.rating ? s.rating.min : null,
        stream: s.stream && opts.streamIds().length ? opts.streamIds() : null
      };
    }

    function paintQuery() { el.text.textContent = s.q; }

    function paintChips() {
      el.chips[0].innerHTML = 'Categoria: <b>' + escapeHtml(s.cat ? s.cat.name : 'Todas') + '</b>';
      el.chips[1].innerHTML = 'Ano: <b>' + escapeHtml(s.year ? s.year.name : 'Qualquer') + '</b>';
      el.chips[2].innerHTML = 'Nota: <b>' + escapeHtml(s.rating ? s.rating.name : 'Qualquer') + '</b>';
      el.chips[3].innerHTML = 'Só streaming: <b>' + (s.stream ? 'Sim' : 'Não') + '</b>';
      el.chips[0].classList.toggle('is-set', !!s.cat);
      el.chips[1].classList.toggle('is-set', !!s.year);
      el.chips[2].classList.toggle('is-set', !!s.rating);
      el.chips[3].classList.toggle('is-set', !s.stream);
      // The filters in the query bar too: the chips scroll away with the keyboard.
      el.sum.textContent = [s.cat && s.cat.name, s.year && s.year.name, s.rating && 'Nota ' + s.rating.name,
        !s.stream && 'Também fora do streaming'].filter(Boolean).join(' · ');
    }

    function setQuery(q) {
      if (q === s.q) return;
      s.q = q;
      paintQuery();
      changed(false);
    }

    // The query or a filter changed: the answer at once when it is known, else TMDB after the
    // pause (now: a filter was chosen, no pause). The rows on screen stay until it arrives.
    function changed(now) {
      s.person = null;
      clearTimeout(s.timer);
      s.seq++;
      var f = filter();
      cancelChecks();
      if (!f.text && !f.cat && !f.year && !f.rating) { s.res = null; s.loading = false; buildRows(); return; }
      var hit = opts.catalog.searchKnown(f);
      if (hit) { s.res = hit; s.loading = false; startChecks(); buildRows(); return; }
      s.loading = true;
      note();
      s.timer = setTimeout(run, now ? 0 : WAIT);
    }

    function run() {
      var seq = s.seq;
      opts.catalog.search(filter()).then(function (res) {
        if (seq !== s.seq || !s.open) return;         // an older query: its answer is dropped
        s.res = res;
        s.loading = false;
        startChecks();
        buildRows();
      }, function (err) {
        if (seq !== s.seq) return;
        console.warn('search', err);
        s.res = { items: [], people: [], failed: true };
        s.loading = false;
        buildRows();
      });
    }

    // OK on a key of the on-screen keyboard.
    function key(k) {
      var q = s.q;
      if (k === 'del') q = q.slice(0, -1);
      else if (k === 'clear') q = '';
      else if (k === 'space') { if (q && q.charAt(q.length - 1) !== ' ') q += ' '; }
      else if (q.length < MAX_Q) q += k;
      setQuery(q);
    }

    // ---------- the filter lists (Categoria, Ano) ----------

    function catOptions() {
      return [{ key: 'all', name: 'Todas', cat: null }].concat(Smart.searchCategories(opts.genres()).map(function (c) {
        return { key: c.key, name: c.name, cat: { movie: c.movie, tv: c.tv },
          note: !c.movie ? 'só séries' : !c.tv ? 'só filmes' : '' };
      }));
    }

    function yearOptions() {
      var list = [{ key: 'any', name: 'Qualquer ano', year: null }, { key: 'one', stepper: true }];
      [2020, 2010, 2000, 1990].forEach(function (d) { list.push({ key: 'd' + d, name: 'Anos ' + d, year: { from: d, to: d + 9 } }); });
      list.push({ key: 'old', name: 'Antes de 1990', year: { from: null, to: 1989 } });
      return list;
    }

    function ratingOptions() {
      return [{ key: 'any', name: 'Qualquer', min: null }, { key: 'r6', name: '6+', min: 6 }, { key: 'r7', name: '7+', min: 7 },
        { key: 'r75', name: '7,5+', min: 7.5 }, { key: 'r8', name: '8+', min: 8 }];
    }

    function oneYear() { return { key: 'one', name: String(s.stepYear), year: { from: s.stepYear, to: s.stepYear } }; }

    function pickLabel(o) {
      if (o.stepper) return '<span class="pick__step">‹</span>' + s.stepYear + '<span class="pick__step">›</span>';
      return escapeHtml(o.name) + (o.note ? '<small>' + o.note + '</small>' : '');
    }

    function openPick(kind) {
      var items = kind === 'cat' ? catOptions() : kind === 'year' ? yearOptions() : ratingOptions();
      var cur = kind === 'cat' ? s.cat : kind === 'year' ? s.year : s.rating, at = 0;
      items.forEach(function (o, j) { if (cur && o.key === cur.key) at = j; });
      s.pick = { kind: kind, items: items, i: at, top: 0 };
      el.pickList.innerHTML = items.map(function (o) { return '<div class="pick__item">' + pickLabel(o) + '</div>'; }).join('');
      el.pick.style.transform = tr(s.chip * CHIP_X, 0);
      el.pick.hidden = false;
      s.pickFocus = null;
      s.at = 'pick';
      paintPick();
    }

    function paintPick() {
      var p = s.pick;
      if (p.i < p.top) p.top = p.i;
      if (p.i >= p.top + PICK_ROWS) p.top = p.i - PICK_ROWS + 1;
      el.pickList.style.transform = tr(0, -p.top * PICK_H);
      swap('pickFocus', el.pickList.children[p.i] || null);
    }

    // Up/Down choose a line; Left/Right on the year line change the year (shown at once).
    function movePick(dx, dy) {
      var p = s.pick, o = p.items[p.i];
      if (dx) {
        if (!o.stepper) return;
        s.stepYear = Math.max(1900, Math.min(THIS_YEAR + 1, s.stepYear + dx));
        el.pickList.children[p.i].innerHTML = pickLabel(o);
        s.year = oneYear();
        paintChips();
        changed(false);
        schedule();
        return;
      }
      p.i = Math.max(0, Math.min(p.items.length - 1, p.i + dy));
      paintPick();
    }

    function choosePick() {
      var p = s.pick, o = p.items[p.i];
      if (o.stepper) o = oneYear();
      if (p.kind === 'cat') s.cat = o.cat ? o : null;
      else if (p.kind === 'year') s.year = o.year ? o : null;
      else s.rating = o.min ? o : null;
      closePick();
      paintChips();
      changed(true);
    }

    function closePick() {
      if (!s.pick) return;
      s.pick = null;
      el.pick.hidden = true;
      swap('pickFocus', null);
      s.at = 'chips';
      schedule();
    }

    // ---------- result rows ----------

    // The rows for what is asked: a person's titles, the answer for the query and filters,
    // or (nothing asked) the "em alta" rows of the home screen.
    function computeRows() {
      var f = filter(), rows;
      if (s.person) {
        rows = Smart.searchRows(s.person.res, opts.isWatched, opts.hide, null).map(function (r) {
          return { id: r.id, title: LABEL[r.id] + ' com ' + s.person.item.title, items: r.items };
        });
      } else if (!f.text && !f.cat && !f.year && !f.rating) {
        rows = (opts.suggestions() || []).map(function (r) {
          return { id: r.id, title: r.title, items: r.items.filter(function (it) { return !opts.isWatched(it.key); }) };
        });
      } else {
        rows = Smart.searchRows(s.res, opts.isWatched, opts.hide, f).map(function (r) {
          return { id: r.id, title: LABEL[r.id], items: r.items };
        });
      }
      if (checking()) {
        rows = !s.ready ? [] : rows.map(function (r) {
          if (r.id !== 'people') r.items = streamPrefix(r.items);
          return r;
        });
      }
      rows = rows.filter(function (r) { return r.items.length; });
      rows.forEach(function (r) { r.items = r.items.slice(0, PER_ROW); });
      return rows;
    }

    // keepKey: focus that card.
    function buildRows(keepKey) { apply(computeRows(), keepKey); }

    function apply(rows, keepKey) {
      if (s.person && s.person.jump && rows.length) { s.person.jump = false; s.at = 'rows'; s.r = 0; }
      s.rows = rows;
      s.col = [];
      s.first = [];
      var kept = -1;
      rows.forEach(function (row, i) {
        s.col[i] = 0;
        s.first[i] = 0;
        for (var c = 0; keepKey && kept === -1 && c < row.items.length; c++) {
          if (row.items[c].key === keepKey) { kept = i; s.col[i] = c; scrollRow(i); }
        }
      });
      s.r = kept !== -1 ? kept : Math.min(s.r, Math.max(0, rows.length - 1));
      if (!rows.length && s.at === 'rows') s.at = 'kb';
      note();
      mount();
      schedule();
    }

    function note() {
      var f = filter(), t = '';
      if (opts.catalog.mode === 'off') t = 'Para buscar, coloque seu token do TMDB em js/config.local.js.';
      else if (s.rows.length) t = '';
      else if (s.loading) t = 'Buscando…';
      else if (s.res && s.res.failed) t = 'Sem conexão para buscar.';
      else if (checking() && (!s.ready || look.queue.length || look.running)) t = 'Procurando onde assistir…';
      else if (f.text || f.cat || f.year || f.rating) {
        t = 'Nada encontrado' + (f.text ? ' para “' + f.text + '”' : '') + (f.cat || f.year || f.rating ? ' com estes filtros' : '') +
          (f.stream ? ' nos seus apps de streaming' : '') + '.';
      } else t = 'Digite o nome de um filme, série ou pessoa, ou escolha uma categoria e um ano.';
      el.note.textContent = t;
    }

    // ---------- Só streaming: which app a search result is on ----------

    var look = { queue: [], running: 0, seq: 0, done: 0, first: 0, timer: null };

    // Titles are checked with text (TMDB's search cannot filter by service) and for a
    // person's titles; with filters only, TMDB's discover already did it.
    function checking() {
      var f = filter();
      return !!f.stream && !!(s.person || f.text);
    }

    // A row's titles in order, up to the first one not checked yet; those on no app of this
    // TV (or whose check failed) are left out.
    function streamPrefix(items) {
      var out = [];
      for (var i = 0; i < items.length; i++) {
        if (s.failed[items[i].key]) continue;
        var apps = opts.appsOf(items[i]);
        if (apps === null) break;
        if (apps.length) out.push(items[i]);
      }
      return out;
    }

    function cancelChecks() {
      look.seq++;
      look.queue = [];
      clearTimeout(look.timer);
      look.timer = null;
      s.ready = true;
    }

    // An answer arrived: queue the titles whose apps are not known, films and series in turn,
    // in the answer's order.
    function startChecks() {
      cancelChecks();
      if (!checking()) return;
      var src = s.person ? s.person.res : s.res;
      var lists = Smart.searchRows(src, opts.isWatched, opts.hide, s.person ? null : filter())
        .filter(function (r) { return r.id !== 'people'; })
        .map(function (r) {
          return r.items.filter(function (it) { return opts.appsOf(it) === null && !s.failed[it.key]; });
        });
      for (var i = 0; i < 40; i++) lists.forEach(function (l) { if (l[i]) look.queue.push(l[i]); });
      look.done = 0;
      look.first = Math.min(FIRST_BATCH, look.queue.length);
      s.ready = look.first === 0;
      pumpLook();
    }

    function pumpLook() {
      while (look.running < LOOK_PARALLEL && look.queue.length) checkOne(look.queue.shift());
    }

    function checkOne(it) {
      var seq = look.seq;
      look.running++;
      opts.lookup(it).then(null, function (err) {
        console.warn('search: apps of', it.key, err);
        s.failed[it.key] = true;
      }).then(function () {
        look.running--;
        if (seq === look.seq) {
          look.done++;
          if (!s.ready && look.done >= look.first) s.ready = true;
          if (s.ready && !look.timer) look.timer = setTimeout(grow, 120);   // a few answers per update
        }
        pumpLook();
      });
    }

    // New checks are in: cards are added at the ends of the rows (the rows are rebuilt, focus
    // kept, only when a whole row appears).
    function grow() {
      look.timer = null;
      if (!s.open) return;
      var old = s.rows, cur = focused();
      var rows = computeRows();
      var same = rows.length === old.length && rows.every(function (r, i) {
        var o = old[i];
        if (o.id !== r.id || r.items.length < o.items.length) return false;
        for (var c = 0; c < o.items.length; c++) if (o.items[c].key !== r.items[c].key) return false;
        return true;
      });
      if (!same) { apply(rows, cur && cur.key); return; }
      rows.forEach(function (r, i) {
        if (r.items.length === old[i].items.length) return;
        old[i].items = r.items;
        s.mounted[i].first = -1;          // syncCards adds the new cards of the window
      });
      relabel();
      note();
      schedule();
    }

    // The app's name on a card (top left) once it is known: a card made before that is
    // replaced by one with the label (js/discover.js cardNode), in place.
    function label(node, it) {
      if (node.appLabel || !it || !node.parentNode) return node;
      var apps = opts.appsOf(it);
      if (!apps || !apps.length) return node;
      var n = opts.cardNode(it, true);
      if (!n.appLabel) return node;
      n.style.transform = node.style.transform;
      if (node.classList.contains('is-focused')) { n.classList.add('is-focused'); s.cardFocus = n; }
      node.parentNode.replaceChild(n, node);
      return n;
    }

    function relabel() {
      s.mounted.forEach(function (m, i) {
        var row = s.rows[i];
        if (!row || row.id === 'people') return;
        Object.keys(m.cards).forEach(function (c) { m.cards[c] = label(m.cards[c], row.items[c]); });
      });
    }

    function personNode(p) {
      var d = document.createElement('div');
      var pal = typeof p.palette === 'number' ? p.palette : (p.id % 8);
      d.className = 'poster poster--person';
      d.innerHTML = '<div class="poster__lift"><div class="poster__shadow"></div>' +
        '<div class="poster__art poster--p' + pal + '"><span class="person__initials">' + escapeHtml(initials(p.title)) + '</span></div>' +
        (p.photo ? '<img class="poster__img" alt="" src="' + escapeHtml(p.photo) + '">' : '') + '</div>' +
        '<div class="poster__cap">' + escapeHtml(p.title) + (DEPT[p.dept] ? '<small>' + DEPT[p.dept] + '</small>' : '') + '</div>';
      var img = d.querySelector('img');
      if (img) {
        img.onload = function () { this.className = 'poster__img is-loaded'; };
        img.onerror = function () { this.parentNode.removeChild(this); };
      }
      return d;
    }

    // At most three rows (Filmes, Séries, Pessoas): all are in the DOM, their cards windowed.
    function mount() {
      el.rows.innerHTML = '';
      s.mounted = [];
      s.cardFocus = null;
      s.rows.forEach(function (row, i) {
        var n = document.createElement('div');
        n.className = 'row';
        n.style.transform = tr(0, i * ROW_H);
        n.innerHTML = '<div class="row__label">' + escapeHtml(row.title) + '</div><div class="row__track"></div>';
        el.rows.appendChild(n);
        s.mounted[i] = { el: n, track: n.lastChild, cards: {}, first: -1, op: '' };
      });
    }

    // Cards of row i in [first - EXTRA, first + VISIBLE + EXTRA): add/remove at the edges.
    function syncCards(i) {
      var m = s.mounted[i], row = s.rows[i];
      if (!m || !row) return;
      var f = s.first[i] || 0;
      if (m.first === f) return;
      m.first = f;
      var lo = Math.max(0, f - EXTRA), hi = Math.min(row.items.length, f + VISIBLE + EXTRA);
      Object.keys(m.cards).forEach(function (c) {
        if (c < lo || c >= hi) { m.track.removeChild(m.cards[c]); delete m.cards[c]; }
      });
      for (var c = lo; c < hi; c++) {
        if (m.cards[c]) continue;
        var n = row.id === 'people' ? personNode(row.items[c]) : opts.cardNode(row.items[c], true);
        n.style.transform = tr(c * STEP, 0);
        m.track.appendChild(n);
        m.cards[c] = n;
      }
      m.track.style.transform = tr(-f * STEP, 0);
    }

    function scrollRow(r) {
      var c = s.col[r], f = s.first[r] || 0;
      if (c > f + VISIBLE - 1 - MARGIN) f = c - (VISIBLE - 1 - MARGIN);
      if (c < f + MARGIN) f = c - MARGIN;
      s.first[r] = Math.max(0, f);
    }

    // ---------- painting (once per animation frame) ----------

    function swap(name, node) {
      if (s[name] === node) return;
      if (s[name]) s[name].classList.remove('is-focused');
      if (node) node.classList.add('is-focused');
      s[name] = node;
    }

    var HINTS = {
      chips: '<span><b class="k">OK</b> Filtrar</span>',
      kb: '<span><b class="k">OK</b> Digitar</span>',
      pick: '<span><b class="k">▲▼</b> Escolher</span><span><b class="k">OK</b> Pronto</span>',
      rows: '<span><b class="k">OK</b> Detalhes</span><span><b class="k">Segure OK</b> Abrir no app</span>'
    };

    function paint() {
      s.frame = 0;
      if (s.shownAt !== s.at) { root.setAttribute('data-at', s.at); s.shownAt = s.at; }
      swap('keyFocus', s.at === 'kb' ? keyNodes[s.kr][s.kc] : null);
      swap('chipFocus', s.at === 'chips' || s.at === 'pick' ? el.chips[s.chip] : null);
      // A result focused: its row goes up under the query; the keyboard leaves through the top.
      var y = s.at === 'rows' ? -(ROWS_TOP + s.r * ROW_H - 20) : 0;
      if (y !== s.shownY) { el.body.style.transform = tr(0, y); s.shownY = y; }
      var cur = s.at === 'rows' ? s.r : 0;
      s.mounted.forEach(function (m, i) {
        syncCards(i);
        var op = i === cur ? '1' : i === cur + 1 ? '0.55' : '0';
        if (m.op !== op) { m.el.style.opacity = op; m.op = op; }
      });
      var m = s.at === 'rows' ? s.mounted[s.r] : null;
      swap('cardFocus', m ? m.cards[s.col[s.r]] || null : null);
      var h = HINTS[s.at] + (s.pick && s.pick.kind === 'year' ? '<span><b class="k">◀▶</b> Ano</span>' : '') + '<span><b class="k">Voltar</b> ' +
        (s.pick ? 'Fechar a lista' : s.person ? 'Voltar à busca' : 'Sair') + '</span>';
      if (h !== s.hintsShown) { el.hints.innerHTML = h; s.hintsShown = h; }
    }

    function schedule() {
      if (!s.frame) s.frame = requestAnimationFrame(paint);
    }

    // ---------- public ----------

    function open() {
      s.open = true;
      s.at = 'kb';
      root.hidden = false;
      paintQuery();
      paintChips();
      buildRows();
    }

    function close() {
      s.open = false;
      clearTimeout(s.timer);
      s.seq++;
      cancelChecks();
      if (s.pick) { s.pick = null; el.pick.hidden = true; swap('pickFocus', null); }
      root.hidden = true;
    }

    // Arrows. The keyboard rows wrap; the rest follows the loop at the top of this file.
    function move(dx, dy) {
      if (s.at === 'pick') { movePick(dx, dy); return; }
      if (s.at === 'chips') {
        if (dx) s.chip = Math.max(0, Math.min(el.chips.length - 1, s.chip + dx));
        else if (dy > 0) s.at = 'kb';
        else if (s.rows.length) { s.at = 'rows'; s.r = s.rows.length - 1; }
      } else if (s.at === 'kb') {
        if (dx) { var n = KEYS[s.kr].length; s.kc = (s.kc + dx + n) % n; }
        else if (dy < 0) { if (s.kr > 0) s.kr--; else s.at = 'chips'; }
        else if (s.kr < KEYS.length - 1) s.kr++;
        else if (s.rows.length) { s.at = 'rows'; s.r = 0; }
      } else {
        var row = s.rows[s.r];
        if (dx) {
          var c = s.col[s.r] + dx;
          if (!row || c < 0 || c >= row.items.length) return;
          s.col[s.r] = c;
          scrollRow(s.r);
        } else if (dy < 0) { if (s.r > 0) s.r--; else s.at = 'kb'; }
        else if (s.r < s.rows.length - 1) s.r++;
        else s.at = 'chips';
      }
      schedule();
    }

    // OK on a key, a filter or a line of a filter list. false: a result has the focus (app.js
    // handles short and long presses there).
    function press() {
      if (s.at === 'kb') key(KEYS[s.kr][s.kc]);
      else if (s.at === 'chips' && s.chip === 3) { s.stream = !s.stream; paintChips(); changed(true); }
      else if (s.at === 'chips') openPick(['cat', 'year', 'rating'][s.chip]);
      else if (s.at === 'pick') choosePick();
      else return false;
      return true;
    }

    // Back: closes a filter list, or leaves a person's titles. false: leave the search.
    function back() {
      if (s.pick) { closePick(); return true; }
      if (s.person) { leavePerson(); return true; }
      return false;
    }

    // OK on a person: their films and series (one request), in place of the results.
    function openPerson(p) {
      var seq = ++s.seq;
      clearTimeout(s.timer);
      opts.catalog.personTitles(p).then(function (res) {
        if (seq !== s.seq || !s.open) return;
        s.person = { item: p, res: res, key: p.key };
        startChecks();
        buildRows();
        // Not checked yet: the titles show (and take the focus) when the first checks are in.
        if (!s.ready) { s.person.jump = true; s.at = 'kb'; schedule(); return; }
        if (s.rows.length) { s.at = 'rows'; s.r = 0; schedule(); return; }
        opts.toast('Nenhum título de ' + p.title + ' para mostrar');
        leavePerson();
      }, function (err) {
        console.warn('person', err);
        if (seq === s.seq) opts.toast('Sem conexão para ver os títulos de ' + p.title, true);
      });
    }

    function leavePerson() {
      var k = s.person.key;
      s.person = null;
      startChecks();
      buildRows(k);
    }

    function focused() {
      var row = s.at === 'rows' ? s.rows[s.r] : null;
      return row ? row.items[s.col[s.r]] || null : null;
    }

    return {
      open: open,
      close: close,
      isOpen: function () { return s.open; },
      move: move,
      press: press,
      back: back,
      // A letter or digit from a real keyboard or the remote's number keys.
      type: function (ch) { if (s.q.length < MAX_Q) setQuery(s.q + ch); },
      // Backspace on a real keyboard: false when there is nothing to delete.
      erase: function () { if (!s.q) return false; setQuery(s.q.slice(0, -1)); return true; },
      focused: focused,
      openPerson: openPerson,
      // After the details closed (a mark may have changed): filter again, same card focused.
      refresh: function () { var it = focused(); buildRows(it && it.key); }
    };
  };
})();
