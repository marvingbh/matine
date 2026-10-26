/*
 * Film and series data: TMDB API v3 (+ optional IMDb ratings from OMDb), cached in
 * localStorage. Same code path on the TV and in a desktop browser: with a token in
 * js/config.local.js it uses the real TMDB data and images. In a desktop browser only,
 * js/mock-data.js stands in when there is no token, when the page is opened with ?mock,
 * or for a call whose fetch fails (offline). Exposes window.Catalog.
 *
 * Item shape (what the UI uses):
 *   { key: 'movie:123', id, type: 'movie'|'tv', title, year, overview, poster, backdrop,
 *     rating, votes, popularity, genreIds, lang, countries, palette? (mock only), providers? (mock only) }
 * Details shape:
 *   { runtime, seasons, tagline, genres: [names], providers: [{ id, name }], imdbId,
 *     wikidataId, trailer (YouTube key) }
 */
(function () {
  'use strict';

  var CFG = window.TVHOME_CONFIG || {};
  var MOCK = window.TVHOME_MOCK;
  var S = window.Store;

  var API = 'https://api.themoviedb.org/3';
  var IMG = 'https://image.tmdb.org/t/p/';
  var OMDB = 'https://www.omdbapi.com/';
  var LANG = CFG.language || 'pt-BR';
  var REGION = CFG.region || 'BR';
  var HOUR = 3600 * 1000;
  var TTL = (CFG.cacheHours || 6) * HOUR;
  // No anime in any row (Smart.isAnime). 210024 is TMDB's "anime" keyword.
  var HIDE_ANIME = CFG.hideAnime !== false;
  var ANIME_KEYWORD = 210024;

  var browser = !!(window.Platform && !window.Platform.isTV && MOCK);
  var forceMock = /[?&]mock\b/.test(location.search);
  var mode = browser && (forceMock || !CFG.tmdbToken) ? 'mock' : (CFG.tmdbToken ? 'tmdb' : 'off');

  // ---------- network ----------

  var active = 0, queue = [];
  var MAX_PARALLEL = 4;

  function xhrJSON(url, headers) {
    return new Promise(function (resolve, reject) {
      queue.push(function () {
        var x = new XMLHttpRequest();
        x.open('GET', url, true);
        x.timeout = 12000;
        Object.keys(headers || {}).forEach(function (h) { x.setRequestHeader(h, headers[h]); });
        x.onload = function () {
          done();
          if (x.status >= 200 && x.status < 300) {
            try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); }
          } else reject(new Error('HTTP ' + x.status + ' ' + url.split('?')[0]));
        };
        x.onerror = x.ontimeout = function () { done(); reject(new Error('network ' + url.split('?')[0])); };
        x.send();
      });
      pump();
    });
  }
  function done() { active--; pump(); }
  function pump() {
    while (active < MAX_PARALLEL && queue.length) { active++; queue.shift()(); }
  }

  function qs(params) {
    return Object.keys(params).sort().filter(function (k) {
      return params[k] !== undefined && params[k] !== null && params[k] !== '';
    }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
  }

  var inflight = {};

  // Fresh cache wins; otherwise fetch; if the fetch fails, fall back to stale cache.
  function cached(cacheKey, ttl, fetcher) {
    var c = S.cacheGet(cacheKey, ttl);
    if (c && c.fresh) return Promise.resolve(c.v);
    if (inflight[cacheKey]) return inflight[cacheKey];
    var p = fetcher().then(function (v) {
      delete inflight[cacheKey];
      S.cachePut(cacheKey, v);
      return v;
    }, function (err) {
      delete inflight[cacheKey];
      if (c) return c.v;
      throw err;
    });
    inflight[cacheKey] = p;
    return p;
  }

  function tmdb(path, params, ttl, shape) {
    var q = qs(params || {});
    return cached('tmdb' + path + '?' + q, ttl || TTL, function () {
      return xhrJSON(API + path + (q ? '?' + q : ''), {
        Authorization: 'Bearer ' + CFG.tmdbToken,
        Accept: 'application/json'
      }).then(shape || function (x) { return x; });
    });
  }

  // ---------- shaping ----------

  function img(path, size) { return path ? IMG + size + path : ''; }

  function shapeItem(r, typeHint) {
    var type = r.media_type || typeHint;
    if (type !== 'movie' && type !== 'tv') return null;
    var date = r.release_date || r.first_air_date || '';
    return {
      key: type + ':' + r.id,
      id: r.id,
      type: type,
      title: r.title || r.name || '',
      year: date.slice(0, 4),
      overview: String(r.overview || '').slice(0, 420),
      poster: img(r.poster_path, 'w185'),     // details overlay uses w342
      backdrop: img(r.backdrop_path, 'w780'),
      rating: r.vote_average || 0,
      votes: r.vote_count || 0,
      popularity: Math.round(r.popularity || 0),
      genreIds: r.genre_ids || [],
      lang: r.original_language || '',     // these two: for the anime filter
      countries: r.origin_country || []
    };
  }

  function shapeList(type) {
    return function (res) {
      return (res.results || []).map(function (r) { return shapeItem(r, type); })
        .filter(function (it) { return it && it.title && it.poster; });
    };
  }

  function shapeDetails(d) {
    var wp = d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results[REGION];
    return {
      runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0,
      seasons: d.number_of_seasons || 0,
      tagline: d.tagline || '',
      genres: (d.genres || []).map(function (g) { return (LANG === 'pt-BR' && TV_GENRES_PT[g.id]) || g.name; }),
      providers: ((wp && wp.flatrate) || []).map(function (p) {
        return { id: p.provider_id, name: p.provider_name };
      }),
      imdbId: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || '',
      wikidataId: (d.external_ids && d.external_ids.wikidata_id) || '',
      trailer: trailerKey(d.videos && d.videos.results)
    };
  }

  // The YouTube key of the best trailer: Portuguese before English, official first.
  function trailerKey(videos) {
    var best = null, bestScore = -1;
    (videos || []).forEach(function (v) {
      if (v.site !== 'YouTube' || !v.key || (v.type !== 'Trailer' && v.type !== 'Teaser')) return;
      var score = (v.iso_639_1 === 'pt' ? 4 : 0) + (v.type === 'Trailer' ? 2 : 0) + (v.official ? 1 : 0);
      if (score > bestScore) { best = v.key; bestScore = score; }
    });
    return best || '';
  }

  // ---------- TMDB implementation ----------

  // q: { type, sort, providers: [ids], genres: [ids], minVotes, maxVotes, minRating,
  //      runtimeMin, runtimeMax, tvType, page }
  function discoverTmdb(q) {
    var p = {
      language: LANG,
      watch_region: REGION,
      with_watch_monetization_types: 'flatrate',
      with_watch_providers: (q.providers || []).join('|'),
      with_genres: (q.genres || []).join('|'),
      sort_by: q.sort || 'popularity.desc',
      'vote_count.gte': q.minVotes,
      'vote_count.lte': q.maxVotes,
      'vote_average.gte': q.minRating,
      include_adult: 'false',
      without_keywords: HIDE_ANIME ? ANIME_KEYWORD : '',
      page: q.page || 1
    };
    // with_runtime is the film length, or the episode length for series.
    p['with_runtime.gte'] = q.runtimeMin;
    p['with_runtime.lte'] = q.runtimeMax;
    if (q.type === 'movie') p.region = REGION;
    else p.with_type = q.tvType;        // 2 = miniseries
    return tmdb('/discover/' + q.type, p, TTL, shapeList(q.type));
  }

  function recommendationsTmdb(item) {
    return tmdb('/' + item.type + '/' + item.id + '/recommendations', { language: LANG, page: 1 }, TTL, shapeList(item.type));
  }

  function detailsTmdb(item) {
    return tmdb('/' + item.type + '/' + item.id,
      { language: LANG, append_to_response: 'watch/providers,external_ids,videos',
        include_video_language: LANG.split('-')[0] + ',en' }, TTL, shapeDetails);
  }

  // TMDB leaves some TV genres untranslated in pt-BR ("Action & Adventure").
  var TV_GENRES_PT = { 10759: 'Ação e Aventura', 10762: 'Infantil', 10763: 'Notícias', 10764: 'Reality',
    10765: 'Ficção científica e Fantasia', 10766: 'Novela', 10767: 'Entrevistas', 10768: 'Guerra e Política' };

  function genresTmdb() {
    function list(type) {
      return tmdb('/genre/' + type + '/list', { language: LANG }, 7 * 24 * HOUR, function (r) {
        var m = {};
        (r.genres || []).forEach(function (g) {
          m[g.id] = (type === 'tv' && LANG === 'pt-BR' && TV_GENRES_PT[g.id]) || g.name;
        });
        return m;
      });
    }
    return Promise.all([list('movie'), list('tv')]).then(function (r) { return { movie: r[0], tv: r[1] }; });
  }

  // IMDb rating through OMDb (optional key). Resolves '8.3' or ''.
  function imdbRating(imdbId) {
    if (!imdbId) return Promise.resolve('');
    if (mode === 'mock') return Promise.resolve(MOCK.imdb[imdbId] || '');
    if (!CFG.omdbKey) return Promise.resolve('');
    return cached('omdb:' + imdbId, 7 * 24 * HOUR, function () {
      return xhrJSON(OMDB + '?' + qs({ i: imdbId, apikey: CFG.omdbKey })).then(function (r) {
        return (r && r.imdbRating && r.imdbRating !== 'N/A') ? r.imdbRating : '';
      });
    }).catch(function () { return ''; });
  }

  // ---------- per-service title ids (Wikidata) ----------
  // TMDB gives the Wikidata item of a title (external_ids.wikidata_id, already in the
  // details); Wikidata holds the title's id on Netflix, Disney+, Max & co. (see js/deeplink.js).
  // Asked in batches through one SPARQL query (only the properties we need, ~0.5 kB a title),
  // one query at a time, never on a key press: the details queue feeds it. Kept 14 days,
  // including "no ids" so a title is asked once.
  var WDQS = 'https://query.wikidata.org/sparql';
  var WD_TTL = 14 * 24 * HOUR;
  var WD_BATCH = 40;
  var WD_WAIT = 1500;           // collect ids this long before asking (0 when a launch waits)
  var wdWant = {}, wdWaiters = {}, wdTimer = null, wdBusy = false;

  // Resolves { netflix: '80189213', disneyMovie: '…', … } (maybe {}), or null if unknown.
  // now: ask at once (a launch is waiting for it).
  function serviceIds(qid, now) {
    var DL = window.DeepLink;
    if (!DL || mode !== 'tmdb' || !/^Q\d+$/.test(qid || '')) return Promise.resolve(null);
    var c = S.cacheGet('wd:' + qid, WD_TTL);
    if (c && c.fresh) return Promise.resolve(c.v);
    return new Promise(function (resolve) {
      (wdWaiters[qid] = wdWaiters[qid] || []).push(function (v) { resolve(v || (c ? c.v : null)); });
      wdWant[qid] = true;
      if (now) { clearTimeout(wdTimer); wdTimer = null; wdFlush(); }
      else if (!wdTimer) wdTimer = setTimeout(wdFlush, WD_WAIT);
    });
  }

  function wdSettle(qid, v) {
    var ws = wdWaiters[qid] || [];
    delete wdWaiters[qid];
    ws.forEach(function (f) { f(v); });
  }

  function wdFlush() {
    wdTimer = null;
    if (wdBusy) { wdTimer = setTimeout(wdFlush, 300); return; }
    var ids = Object.keys(wdWant).slice(0, WD_BATCH);
    if (!ids.length) return;
    ids.forEach(function (q) { delete wdWant[q]; });
    wdBusy = true;
    xhrJSON(WDQS + '?' + qs({ format: 'json', query: window.DeepLink.sparql(ids) })).then(function (res) {
      var map = window.DeepLink.fromSparql(res, ids);
      ids.forEach(function (q) { S.cachePut('wd:' + q, map[q]); wdSettle(q, map[q]); });
    }, function (err) {
      console.warn('Wikidata failed', err);
      ids.forEach(function (q) { wdSettle(q, null); });
    }).then(function () {
      wdBusy = false;
      if (!wdTimer && Object.keys(wdWant).length) wdTimer = setTimeout(wdFlush, 300);
    });
  }

  // ---------- mock implementation ----------

  function mockItem(t) {
    return {
      key: t.type + ':' + t.id, id: t.id, type: t.type, title: t.title, year: String(t.year),
      overview: t.overview, poster: '', backdrop: 'mock/bd-' + t.palette + '.jpg',
      rating: t.rating, votes: t.votes, popularity: t.popularity, genreIds: t.genres,
      palette: t.palette
    };
  }

  function mockProviders(t) {
    return t.providers.map(function (id) { return { id: id, name: MOCK.providerNames[id] || '' }; });
  }

  function discoverMock(q) {
    var list = MOCK.titles.filter(function (t) {
      if (t.type !== q.type) return false;
      if (q.providers && q.providers.length && !t.providers.some(function (p) { return q.providers.indexOf(p) !== -1; })) return false;
      if (q.genres && q.genres.length && !t.genres.some(function (g) { return q.genres.indexOf(g) !== -1; })) return false;
      if (q.minVotes && t.votes < q.minVotes) return false;
      if (q.maxVotes && t.votes > q.maxVotes) return false;
      if (q.minRating && t.rating < q.minRating) return false;
      if (q.runtimeMin && t.runtime < q.runtimeMin) return false;
      if (q.runtimeMax && t.runtime > q.runtimeMax) return false;
      if (q.tvType === 2 && t.seasons !== 1) return false;   // sample data: one season = miniseries
      return true;
    });
    var by = (q.sort || '').indexOf('vote_average') === 0 ? 'rating' : 'popularity';
    list.sort(function (a, b) { return b[by] - a[by]; });
    return Promise.resolve(list.map(mockItem));
  }

  function recommendationsMock(item) {
    var src = MOCK.byKey[item.key];
    var gs = src ? src.genres : item.genreIds || [];
    return Promise.resolve(MOCK.titles.filter(function (t) {
      return t.type + ':' + t.id !== item.key && t.genres.some(function (g) { return gs.indexOf(g) !== -1; });
    }).map(mockItem));
  }

  function detailsMock(item) {
    var t = MOCK.byKey[item.key];
    if (!t) return Promise.resolve({ runtime: 0, seasons: 0, tagline: '', genres: [], providers: [], imdbId: '' });
    var names = MOCK.genreNames[t.type];
    return Promise.resolve({
      runtime: t.runtime || 0, seasons: t.seasons || 0, tagline: t.tagline || '',
      genres: t.genres.map(function (g) { return names[g]; }).filter(Boolean),
      providers: mockProviders(t), imdbId: t.imdbId || ''
    });
  }

  // ---------- public ----------

  var mockImpl = { discover: discoverMock, recommendations: recommendationsMock, details: detailsMock,
    genres: function () { return Promise.resolve(MOCK.genreNames); } };
  var tmdbImpl = { discover: discoverTmdb, recommendations: recommendationsTmdb, details: detailsTmdb, genres: genresTmdb };

  // Browser preview with a token: a failed fetch (offline, no cache) falls back to the mock.
  function withFallback(name) {
    return function (arg) {
      return tmdbImpl[name](arg).then(null, function (err) {
        console.warn('TMDB failed, using mock data', err);
        return mockImpl[name](arg);
      });
    };
  }

  var impl = mode === 'mock' ? mockImpl
    : browser ? { discover: withFallback('discover'), recommendations: withFallback('recommendations'),
        details: withFallback('details'), genres: withFallback('genres') }
    : tmdbImpl;

  // Every title list goes through the anime filter (cached answers too).
  function noAnime(fn) {
    if (!HIDE_ANIME || !window.Smart) return fn;
    return function (arg) { return fn(arg).then(window.Smart.dropAnime); };
  }

  window.Catalog = {
    mode: mode,                 // 'tmdb' | 'mock' | 'off'
    discover: noAnime(impl.discover),
    recommendations: noAnime(impl.recommendations),
    details: impl.details,
    genres: impl.genres,
    imdbRating: imdbRating,
    serviceIds: serviceIds,
    hasImdb: mode === 'mock' || !!CFG.omdbKey
  };
})();
