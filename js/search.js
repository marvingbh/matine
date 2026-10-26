/*
 * The "Buscar" screen, like the tvOS search: the query at the top, two filters (Categoria
 * and Ano) under it, an on-screen keyboard moved with the arrows (the TVs' own keyboards are
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
 *
 * opts:
 *   catalog              window.Catalog (search, searchKnown, personTitles, mode)
 *   cardNode(item)       a poster card, the same as in the rows (js/discover.js)
 *   isWatched(key)       true for a title marked "Já vi" (left out)
 *   hideAnime            leave anime out (config hideAnime)
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
  var CHIP_X = 400;         // css .search__chip: width 384 + gap 16
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
        '<div class="search__chips"><div class="search__chip"></div><div class="search__chip"></div></div>' +
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
      chip: 0,                 // 0 Categoria, 1 Ano
      kr: 0, kc: 0,            // the focused key
      cat: null, year: null,   // the chosen filter options (null: Todas / Qualquer)
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
        year: s.year ? s.year.year : null
      };
    }

    function paintQuery() { el.text.textContent = s.q; }

    function paintChips() {
      el.chips[0].innerHTML = 'Categoria: <b>' + escapeHtml(s.cat ? s.cat.name : 'Todas') + '</b>';
      el.chips[1].innerHTML = 'Ano: <b>' + escapeHtml(s.year ? s.year.name : 'Qualquer') + '</b>';
      el.chips[0].classList.toggle('is-set', !!s.cat);
      el.chips[1].classList.toggle('is-set', !!s.year);
      // The filters in the query bar too: the chips scroll away with the keyboard.
      el.sum.textContent = [s.cat && s.cat.name, s.year && s.year.name].filter(Boolean).join(' · ');
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
      if (!f.text && !f.cat && !f.year) { s.res = null; s.loading = false; buildRows(); return; }
      var hit = opts.catalog.searchKnown(f);
      if (hit) { s.res = hit; s.loading = false; buildRows(); return; }
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

    function oneYear() { return { key: 'one', name: String(s.stepYear), year: { from: s.stepYear, to: s.stepYear } }; }

    function pickLabel(o) {
      if (o.stepper) return '<span class="pick__step">‹</span>' + s.stepYear + '<span class="pick__step">›</span>';
      return escapeHtml(o.name) + (o.note ? '<small>' + o.note + '</small>' : '');
    }

    function openPick(kind) {
      var items = kind === 'cat' ? catOptions() : yearOptions();
      var cur = kind === 'cat' ? s.cat : s.year, at = 0;
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
      else s.year = o.year ? o : null;
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
    // or (nothing asked) the "em alta" rows of the home screen. keepKey: focus that card.
    function buildRows(keepKey) {
      var f = filter(), rows;
      if (s.person) {
        rows = Smart.searchRows(s.person.res, opts.isWatched, opts.hideAnime, null).map(function (r) {
          return { id: r.id, title: LABEL[r.id] + ' com ' + s.person.item.title, items: r.items };
        });
      } else if (!f.text && !f.cat && !f.year) {
        rows = (opts.suggestions() || []).map(function (r) {
          return { id: r.id, title: r.title, items: r.items.filter(function (it) { return !opts.isWatched(it.key); }) };
        });
      } else {
        rows = Smart.searchRows(s.res, opts.isWatched, opts.hideAnime, f).map(function (r) {
          return { id: r.id, title: LABEL[r.id], items: r.items };
        });
      }
      rows = rows.filter(function (r) { return r.items.length; });
      rows.forEach(function (r) { r.items = r.items.slice(0, PER_ROW); });
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
      else if (f.text || f.cat || f.year) {
        t = 'Nada encontrado' + (f.text ? ' para “' + f.text + '”' : '') + (f.cat || f.year ? ' com estes filtros' : '') + '.';
      } else t = 'Digite o nome de um filme, série ou pessoa, ou escolha uma categoria e um ano.';
      el.note.textContent = t;
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
        var n = row.id === 'people' ? personNode(row.items[c]) : opts.cardNode(row.items[c]);
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
      else if (s.at === 'chips') openPick(s.chip ? 'year' : 'cat');
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
        buildRows();
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
