/*
 * Pure logic, no DOM and no network: provider-to-app mapping, the watch history model,
 * the taste profile, "Para você" ranking, the time/weather "mood" row and the anime filter.
 * Runs in the TV (window.Smart) and in node (module.exports) for tools/test-smart.js.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Smart = api;
})(this, function () {
  'use strict';

  var DAY = 24 * 3600 * 1000;

  function norm(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\+/g, 'plus')
      .replace(/[^a-z0-9]/g, '');
  }

  // ---------- providers -> installed apps ----------

  // Does a TMDB/JustWatch provider ({ provider_id, provider_name }) belong to a curated entry?
  // Add-on channels ("Paramount+ Amazon Channel") are sold inside another app, so they never
  // match the brand's own app.
  function providerMatches(entry, prov) {
    var t = entry.tmdb;
    if (!t) return false;
    var n = norm(prov.name);
    if (n.indexOf('channel') !== -1) return false;
    if ((t.ids || []).indexOf(prov.id) !== -1) return true;
    if (!n) return false;
    if ((t.names || []).indexOf(n) !== -1) return true;
    var pre = t.prefixes || [];
    for (var i = 0; i < pre.length; i++) if (n.indexOf(pre[i]) === 0) return true;
    return false;
  }

  // providers: [{ id, name }] in TMDB display order. entries: TVHOME_DATA.curated.
  // installed: { key: appItem } of the apps found on the TV. appScore (optional):
  // { key: number } to put the most used app first.
  // Returns the installed app items, deduplicated.
  function mapProviders(providers, entries, installed, appScore) {
    var out = [], seen = {};
    (providers || []).forEach(function (p, order) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (seen[e.key] || !installed[e.key] || !providerMatches(e, p)) continue;
        seen[e.key] = true;
        out.push({ app: installed[e.key], order: order });
        break;
      }
    });
    if (appScore) {
      out.sort(function (a, b) {
        return ((appScore[b.app.key] || 0) - (appScore[a.app.key] || 0)) || (a.order - b.order);
      });
    }
    return out.map(function (x) { return x.app; });
  }

  // TMDB provider ids of the installed apps (for discover's with_watch_providers).
  function providerIdsFor(entries, installed) {
    var ids = [];
    entries.forEach(function (e) {
      if (!installed[e.key] || !e.tmdb) return;
      (e.tmdb.ids || []).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
    });
    return ids;
  }

  // ---------- genres ----------
  // TMDB uses different ids for some TV genres. The profile keeps "canonical" (movie) ids.

  var TV_TO_CANON = { 10759: 28, 10765: 878, 10768: 10752, 10762: 10751 };
  var CANON_TO_TV = { 28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768 };
  var TV_ONLY = { 10763: 1, 10764: 1, 10766: 1, 10767: 1 };      // news, reality, soap, talk
  var MOVIE_ONLY = { 27: 1, 53: 1, 10749: 1, 36: 1, 10402: 1, 10770: 1 };

  function canonGenre(type, id) {
    if (type === 'tv') return TV_TO_CANON[id] || id;
    return id;
  }

  // The id to use in a discover query for `type`, or null when that genre has no equivalent.
  function genreFor(type, canonId) {
    if (type === 'tv') {
      if (MOVIE_ONLY[canonId]) return null;
      return CANON_TO_TV[canonId] || canonId;
    }
    if (TV_ONLY[canonId]) return null;
    return canonId;
  }

  // ---------- history ----------
  // { titles: { key: { key, id, type, title, year, poster, backdrop, overview, genreIds,
  //                     rating, status, app, t, picks } },
  //   apps:   { appKey: { t, n } } }
  // status: 'picked' (opened from here), 'watching', 'watched', 'want'.

  var MAX_TITLES = 200;

  function emptyHistory() { return { titles: {}, apps: {} }; }

  function cleanHistory(h) {
    if (!h || typeof h !== 'object') return emptyHistory();
    if (!h.titles || typeof h.titles !== 'object') h.titles = {};
    if (!h.apps || typeof h.apps !== 'object') h.apps = {};
    return h;
  }

  function recordApp(h, appKey, now) {
    var a = h.apps[appKey] || { t: 0, n: 0 };
    a.t = now; a.n += 1;
    h.apps[appKey] = a;
    return h;
  }

  function snapshot(item) {
    return {
      key: item.key, id: item.id, type: item.type, title: item.title, year: item.year || '',
      poster: item.poster || '', backdrop: item.backdrop || '', palette: item.palette,
      overview: String(item.overview || '').slice(0, 320),
      genreIds: (item.genreIds || []).slice(0, 6), rating: item.rating || 0
    };
  }

  // status: one of the statuses above, or null to forget the title.
  function recordTitle(h, item, status, appKey, now) {
    if (!status) { delete h.titles[item.key]; return h; }
    var old = h.titles[item.key];
    var rec = snapshot(item);
    rec.status = status;
    // Opening a title we already follow keeps its status ("watching" stays "watching").
    if (status === 'picked' && old && (old.status === 'watching' || old.status === 'watched')) rec.status = old.status;
    rec.app = appKey || (old && old.app) || '';
    rec.picks = (old && old.picks || 0) + (status === 'picked' ? 1 : 0);
    rec.t = now;
    h.titles[item.key] = rec;
    if (appKey) recordApp(h, appKey, now);
    var keys = Object.keys(h.titles);
    if (keys.length > MAX_TITLES) {
      keys.sort(function (a, b) { return h.titles[a].t - h.titles[b].t; });
      keys.slice(0, keys.length - MAX_TITLES).forEach(function (k) { delete h.titles[k]; });
    }
    return h;
  }

  // "Já vi" from the green button. Each mark stands on its own and is kept; the returned
  // token undoes only that mark (undoMark), restoring whatever the title had before.
  function markWatched(h, item, now) {
    var old = h.titles[item.key];
    var token = { key: item.key, prev: old ? JSON.parse(JSON.stringify(old)) : null };
    recordTitle(h, item, 'watched', null, now);
    return token;
  }

  function undoMark(h, token) {
    if (!token) return h;
    if (token.prev) h.titles[token.key] = token.prev; else delete h.titles[token.key];
    return h;
  }

  function statusOf(h, key) {
    var r = h.titles[key];
    return r ? r.status : null;
  }

  function titlesWith(h, statuses, type) {
    return Object.keys(h.titles).map(function (k) { return h.titles[k]; })
      .filter(function (r) { return statuses.indexOf(r.status) !== -1 && (!type || r.type === type); })
      .sort(function (a, b) { return b.t - a.t; });
  }

  // "Continuar assistindo": titles opened here or marked "Assistindo" in the last 60 days.
  // type (optional): only 'movie' or only 'tv'.
  function continueList(h, now, limit, type) {
    return titlesWith(h, ['watching', 'picked']).filter(function (r) {
      return now - r.t < 60 * DAY && (!type || r.type === type);
    }).slice(0, limit || 20);
  }

  // The mini "Continuar" section of the app list: up to `limit` recent titles and apps,
  // newest first. A title stands in for its app (it is more specific).
  function recentMix(h, now, limit) {
    var out = [];
    var titles = continueList(h, now, limit || 3);
    var covered = {};
    titles.forEach(function (r) { out.push({ kind: 'title', t: r.t, rec: r }); if (r.app) covered[r.app] = true; });
    Object.keys(h.apps).forEach(function (k) {
      var a = h.apps[k];
      if (covered[k] || now - a.t > 14 * DAY) return;
      out.push({ kind: 'app', t: a.t, appKey: k });
    });
    out.sort(function (a, b) { return b.t - a.t; });
    return out.slice(0, limit || 3);
  }

  // ---------- taste profile ----------

  var WEIGHT = { watched: 3, watching: 2.5, picked: 1.5, want: 1 };
  var HALF_LIFE = 30 * DAY;

  function decay(now, t) { return Math.pow(0.5, Math.max(0, now - t) / HALF_LIFE); }

  function tasteProfile(h, now) {
    var genres = {}, apps = {}, seen = {}, count = 0;
    Object.keys(h.titles).forEach(function (k) {
      var r = h.titles[k];
      var w = (WEIGHT[r.status] || 0) * decay(now, r.t);
      if (!w) return;
      count++;
      if (r.status === 'watched') seen[k] = true;
      (r.genreIds || []).forEach(function (g) {
        var c = canonGenre(r.type, g);
        genres[c] = (genres[c] || 0) + w;
      });
      if (r.app) apps[r.app] = (apps[r.app] || 0) + w;
    });
    Object.keys(h.apps).forEach(function (k) {
      var a = h.apps[k];
      apps[k] = (apps[k] || 0) + Math.min(a.n, 20) * 0.5 * decay(now, a.t);
    });
    var gl = Object.keys(genres).map(function (g) { return { id: +g, score: genres[g] }; })
      .sort(function (a, b) { return b.score - a.score; });
    var al = Object.keys(apps).map(function (k) { return { key: k, score: apps[k] }; })
      .sort(function (a, b) { return b.score - a.score; });
    // Seeds for TMDB /recommendations: the latest titles that say something about taste.
    // Each tab takes the first three of its own type (see seedsOf).
    var seeds = titlesWith(h, ['watched', 'watching', 'picked']).slice(0, 12);
    return { genres: gl, apps: al, appScore: apps, seeds: seeds, seen: seen, count: count };
  }

  // lists: [{ app: appKey, items: [item] }] from one discover request per installed app.
  // Returns the titles once each (copies) with item.apps = the apps it was found on,
  // sorted by `by` ('popularity' | 'rating'), minus `exclude` ({ key: true }).
  function mergeByApp(lists, by, limit, exclude) {
    var map = {}, out = [];
    lists.forEach(function (l) {
      (l.items || []).forEach(function (it) {
        if (exclude && exclude[it.key]) return;
        var m = map[it.key];
        if (!m) { m = map[it.key] = shallow(it); m.apps = []; out.push(m); }
        if (m.apps.indexOf(l.app) === -1) m.apps.push(l.app);
      });
    });
    out.sort(function (a, b) { return ((b[by] || 0) - (a[by] || 0)) || ((b.popularity || 0) - (a.popularity || 0)); });
    return out.slice(0, limit || 20);
  }

  // A background refresh must not reorder what is on screen: keep the titles of `prev`
  // that are still in `next`, in their old order, then add the new ones at the end.
  function stableOrder(prev, next, limit) {
    var byKey = {}, out = [], used = {};
    next.forEach(function (it) { byKey[it.key] = it; });
    (prev || []).forEach(function (it) {
      if (byKey[it.key] && !used[it.key]) { out.push(byKey[it.key]); used[it.key] = true; }
    });
    next.forEach(function (it) { if (!used[it.key]) { out.push(it); used[it.key] = true; } });
    return out.slice(0, limit || 20);
  }

  function seedsOf(profile, type, n) {
    return profile.seeds.filter(function (r) { return r.type === type; }).slice(0, n || 3);
  }

  // candidates: [{ item, reason }]. Returns items with item.reason set, best first.
  // Score = genre affinity + quality + a little popularity. Seen titles are dropped.
  function rankForYou(candidates, profile, exclude, limit) {
    var top = profile.genres.length ? profile.genres[0].score : 1;
    var aff = {};
    profile.genres.forEach(function (g) { aff[g.id] = g.score / top; });
    var best = {};
    candidates.forEach(function (c) {
      var it = c.item;
      if (!it || profile.seen[it.key] || (exclude && exclude[it.key])) return;
      var gs = 0;
      (it.genreIds || []).forEach(function (g) { gs += aff[canonGenre(it.type, g)] || 0; });
      var score = Math.min(gs, 2) * 2 +
        ((it.rating || 6) - 6) * 0.6 +
        Math.log(1 + (it.popularity || 0)) / Math.LN10 * 0.3 +
        (c.bonus || 0);
      if (!best[it.key] || best[it.key].score < score) best[it.key] = { item: it, reason: c.reason, score: score };
    });
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, limit || 20)
      .map(function (x) { var o = shallow(x.item); o.reason = x.reason; o.score = Math.round(x.score * 100) / 100; return o; });
  }

  function shallow(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }

  // ---------- mood row ----------
  // One extra row per tab that changes with the time of day, the weekday and the weather.
  // type: 'movie' | 'tv'. weather: { code (WMO), temp } or null. Returns { id, title, query }.
  // query fields map to TMDB discover filters (see catalog.js); tvType 2 = miniseries.

  function isRain(code) { return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95; }

  function moodFor(date, weather, type) {
    var h = date.getHours(), d = date.getDay();
    var wet = weather && isRain(weather.code);
    var hot = weather && weather.temp >= 30;
    var weekendNight = (d === 5 || d === 6) && h >= 18;
    var sunday = d === 0 && h >= 11 && h < 19;
    var late = h >= 22 || h < 5;
    var morning = h >= 5 && h < 12;
    function m(id, title, query) { query.type = type; return { id: id, title: title, query: query }; }

    if (type === 'tv') {
      if (wet) return m('rain', 'Dia de chuva: séries para maratonar',
        { genres: [18, 9648, 80], sort: 'vote_average.desc', minVotes: 300, minRating: 7.5 });
      if (weekendNight) return m('binge', 'Para maratonar no fim de semana',
        { sort: 'popularity.desc', minVotes: 500, minRating: 7.8 });
      if (sunday) return m('sunday', 'Domingo em família: animação e aventura',
        { genres: [16, 10751], sort: 'popularity.desc', minVotes: 200, minRating: 7 });
      if (late) return m('late', 'Episódios curtos: até 30 minutos',
        { genres: [35, 16], sort: 'popularity.desc', minVotes: 200, minRating: 7, runtimeMax: 30 });
      if (morning) return m('morning', 'Para começar o dia: documentários em série',
        { genres: [99], sort: 'popularity.desc', minVotes: 30, minRating: 7 });
      return m('mini', 'Minisséries: começo, meio e fim',
        { tvType: 2, sort: 'vote_average.desc', minVotes: 200, minRating: 7.4 });
    }
    if (wet) return m('rain', 'Dia de chuva: um filme longo e bom',
      { sort: 'vote_average.desc', minVotes: 1500, minRating: 7.6, runtimeMin: 130 });
    if (weekendNight) return m('weekend-night', 'Noite de cinema em casa',
      { sort: 'popularity.desc', minVotes: 1000, minRating: 7.2, runtimeMin: 100 });
    if (sunday) return m('sunday', 'Domingo em família',
      { genres: [10751, 16], sort: 'popularity.desc', minVotes: 300, minRating: 6.8 });
    if (late) return m('late', 'Antes de dormir: até 100 minutos',
      { genres: [35, 16, 10749], sort: 'popularity.desc', minVotes: 300, minRating: 6.8, runtimeMax: 100 });
    if (hot) return m('hot', 'Calor lá fora: aventura leve',
      { genres: [12, 35], sort: 'popularity.desc', minVotes: 500, minRating: 6.8 });
    if (morning) return m('morning', 'Para começar o dia: documentários',
      { genres: [99], sort: 'popularity.desc', minVotes: 50, minRating: 7 });
    return m('gems', 'Joias escondidas: ótimas notas, pouca fama',
      { sort: 'vote_average.desc', minVotes: 150, maxVotes: 2500, minRating: 7.6 });
  }

  // ---------- anime ----------
  // Japanese animation is left out of every TMDB row (config hideAnime, default on).
  // Discover calls also exclude TMDB's "anime" keyword (catalog.js); this check covers the
  // other lists (recommendations) and titles without the keyword: animation (genre 16, the
  // same id for films and series) made in Japan (original language or origin country).
  var ANIMATION = 16;

  function isAnime(it) {
    if (!it || (it.genreIds || []).indexOf(ANIMATION) === -1) return false;
    return it.lang === 'ja' || (it.countries || []).indexOf('JP') !== -1;
  }

  function dropAnime(items) {
    return (items || []).filter(function (it) { return !isAnime(it); });
  }

  // ---------- formatting ----------

  function formatRating(n) {
    if (!n && n !== 0) return '';
    return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
  }

  function relTime(t, now) {
    var m = Math.round((now - t) / 60000);
    if (m < 2) return 'agora';
    if (m < 60) return 'há ' + m + ' min';
    var hh = Math.round(m / 60);
    if (hh < 24) return 'há ' + hh + ' h';
    var dd = Math.round(hh / 24);
    if (dd === 1) return 'ontem';
    return 'há ' + dd + ' dias';
  }

  return {
    norm: norm,
    providerMatches: providerMatches,
    mapProviders: mapProviders,
    providerIdsFor: providerIdsFor,
    canonGenre: canonGenre,
    genreFor: genreFor,
    emptyHistory: emptyHistory,
    cleanHistory: cleanHistory,
    recordApp: recordApp,
    recordTitle: recordTitle,
    statusOf: statusOf,
    markWatched: markWatched,
    undoMark: undoMark,
    titlesWith: titlesWith,
    continueList: continueList,
    recentMix: recentMix,
    tasteProfile: tasteProfile,
    rankForYou: rankForYou,
    seedsOf: seedsOf,
    mergeByApp: mergeByApp,
    stableOrder: stableOrder,
    moodFor: moodFor,
    isRain: isRain,
    isAnime: isAnime,
    dropAnime: dropAnime,
    formatRating: formatRating,
    relTime: relTime
  };
});
