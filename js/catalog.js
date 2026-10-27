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
 * Search answer (search, personTitles): { items: [item], people: [person] }, a person being
 *   { key: 'person:123', id, type: 'person', title (the name), photo, dept, known: [item] }
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
  // No anime in any row (Smart.isAnime). 210024 is TMDB's "anime" keyword. Asian titles
  // (Smart.hideRule: hideLanguages, hideCountries) are left out of every list too.
  var HIDE_ANIME = CFG.hideAnime !== false;
  var HIDE = window.Smart ? window.Smart.hideRule(CFG) : null;
  var ANIME_KEYWORD = 210024;

  var browser = !!(window.Platform && !window.Platform.isTV && MOCK);
  var forceMock = /[?&]mock\b/.test(location.search);
  var mode = browser && (forceMock || !CFG.tmdbToken) ? 'mock' : (CFG.tmdbToken ? 'tmdb' : 'off');

  // ---------- network ----------

  var active = 0, queue = [];
  var MAX_PARALLEL = 4;

  // urgent: ahead of everything waiting (the search screen; the rest is background work).
  function xhrJSON(url, headers, urgent) {
    return new Promise(function (resolve, reject) {
      queue[urgent ? 'unshift' : 'push'](function () {
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

  function authHeaders() {
    return { Authorization: 'Bearer ' + CFG.tmdbToken, Accept: 'application/json' };
  }

  function tmdb(path, params, ttl, shape) {
    var q = qs(params || {});
    return cached('tmdb' + path + '?' + q, ttl || TTL, function () {
      return xhrJSON(API + path + (q ? '?' + q : ''), authHeaders()).then(shape || function (x) { return x; });
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
      date: date,                          // first release / first air date (YYYY-MM-DD)
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
  //      runtimeMin, runtimeMax, tvType, page, monetization ('flatrate' if not given),
  //      releaseFrom/To + releaseTypes (films: regional release dates of those types),
  //      primaryFrom/To (films: first release), airFrom/To (series: any episode aired) }
  function discoverTmdb(q) {
    var p = {
      language: LANG,
      watch_region: REGION,
      with_watch_monetization_types: q.monetization || 'flatrate',
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
    if (q.type === 'movie') {
      p.region = REGION;
      p['release_date.gte'] = q.releaseFrom;
      p['release_date.lte'] = q.releaseTo;
      p.with_release_type = (q.releaseTypes || []).join('|');
      p['primary_release_date.gte'] = q.primaryFrom;
      p['primary_release_date.lte'] = q.primaryTo;
    } else {
      p.with_type = q.tvType;           // 2 = miniseries
      p['air_date.gte'] = q.airFrom;
      p['air_date.lte'] = q.airTo;
    }
    return tmdb('/discover/' + q.type, p, TTL, shapeList(q.type));
  }

  function recommendationsTmdb(item) {
    return tmdb('/' + item.type + '/' + item.id + '/recommendations', { language: LANG, page: 1 }, TTL, shapeList(item.type));
  }

  function similarTmdb(item) {
    return tmdb('/' + item.type + '/' + item.id + '/similar', { language: LANG, page: 1 }, TTL, shapeList(item.type));
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

  // ---------- Disney / Pixar animation (Smart.hideRule) ----------
  // The keys of the animation those companies made (films with at least 50 votes, series
  // with at least 10: about 230 + 100 titles, some 18 pages), asked page by page, once a
  // week, in the background. Only the keys are kept. Until it is in, animation is hidden.
  var ALLOW_TTL = 7 * 24 * HOUR;
  var ALLOW_PAGES = 15;               // per type, at most

  function allowTmdb() {
    var companies = HIDE.companies.join('|');
    function pages(type) {
      function page(n) {
        return xhrJSON(API + '/discover/' + type + '?' + qs({
          with_genres: 16, with_companies: companies, include_adult: 'false', sort_by: 'popularity.desc',
          'vote_count.gte': type === 'movie' ? 50 : 10, page: n
        }), authHeaders());
      }
      return page(1).then(function (first) {
        var n = Math.min(first.total_pages || 1, ALLOW_PAGES), more = [];
        for (var i = 2; i <= n; i++) more.push(page(i));
        return Promise.all(more).then(function (rest) {
          return [first].concat(rest).reduce(function (keys, res) {
            return keys.concat((res.results || []).map(function (r) { return type + ':' + r.id; }));
          }, []);
        });
      });
    }
    return Promise.all([pages('movie'), pages('tv')]).then(function (r) { return r[0].concat(r[1]); });
  }

  function allowMock() {
    return Promise.resolve(MOCK.titles.filter(function (t) {
      return t.genres.indexOf(16) !== -1 && (t.companies || []).some(function (c) { return HIDE.companies.indexOf(c) !== -1; });
    }).map(function (t) { return t.type + ':' + t.id; }));
  }

  // Fills HIDE.allow. Resolves the number of titles allowed (0 when nothing is known).
  function loadAnimationAllow() {
    if (!HIDE || !HIDE.animation || mode === 'off' || !HIDE.companies.length) return Promise.resolve(0);
    var p = mode === 'mock' ? allowMock() : cached('animallow:' + HIDE.companies.join('|'), ALLOW_TTL, allowTmdb);
    return p.then(function (keys) {
      var m = {};
      (keys || []).forEach(function (k) { m[k] = 1; });
      HIDE.allow = m;
      return keys.length;
    }, function (err) { console.warn('animation allowlist', err); return 0; });
  }

  // ---------- search (the "Buscar" screen, js/search.js) ----------
  // Asked while the user types, so the answers are kept in memory only (every prefix in
  // localStorage would crowd out the row cache) and the requests go to the front of the
  // queue, before the background work. f: { text, cat: { movie, tv } | null,
  // year: { from, to } | null, rating: minimum score | null, stream: [provider ids] | null }.
  //   text, no filter:   /search/multi (films, series and people in one answer)
  //   text and filter:   /search/movie + /search/tv (one year: primary_release_year /
  //                      first_air_date_year); the genre, a range of years and the score are
  //                      checked on the answer (Smart.searchRows), streaming by js/search.js
  //   no text, filter:   /discover/movie + /discover/tv by popularity, with with_genres, the
  //                      release dates, vote_average.gte, without the anime keyword, and
  //                      (Só streaming) only titles on the TV's apps in Brazil
  // A type the category does not exist for (a TV-only genre) is not asked.
  var live = {}, liveKeys = [];
  var LIVE_MAX = 60;

  function tmdbLive(path, params, shape) {
    var url = API + path + '?' + qs(params);
    if (live[url]) return live[url];
    var p = xhrJSON(url, authHeaders(), true).then(shape);
    live[url] = p;
    liveKeys.push(url);
    if (liveKeys.length > LIVE_MAX) delete live[liveKeys.shift()];
    p.then(null, function () { if (live[url] === p) delete live[url]; });   // asked again next time
    return p;
  }

  function searchTypes(f) {
    return ['movie', 'tv'].filter(function (t) { return !f.cat || f.cat[t]; });
  }

  function searchParams(type, f) {
    var p = { language: LANG, include_adult: 'false', page: 1 };
    var y = f.year || {};
    if (f.text) {
      p.query = f.text;
      if (y.from && y.from === y.to) p[type === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = y.from;
      return p;
    }
    var date = type === 'movie' ? 'primary_release_date' : 'first_air_date';
    p.sort_by = 'popularity.desc';
    p.with_genres = f.cat ? f.cat[type] : '';
    // "Animação" in the search: only the companies whose animation is shown (Disney, Pixar).
    if (f.cat && f.cat[type] === 16 && HIDE && HIDE.animation && HIDE.companies.length) p.with_companies = HIDE.companies.join('|');
    p[date + '.gte'] = y.from ? y.from + '-01-01' : '';
    p[date + '.lte'] = y.to ? y.to + '-12-31' : '';
    // No pages of unknown titles; with "Nota", enough votes for the score to mean something.
    p['vote_count.gte'] = f.rating ? window.Smart.minVotes(type) : 20;
    p['vote_average.gte'] = f.rating || '';
    p.without_keywords = HIDE_ANIME ? ANIME_KEYWORD : '';
    if (f.stream && f.stream.length) {
      p.watch_region = REGION;
      p.with_watch_monetization_types = 'flatrate|free|ads';
      p.with_watch_providers = f.stream.join('|');
    }
    return p;
  }

  function shapePerson(r) {
    return {
      key: 'person:' + r.id, id: r.id, type: 'person', title: r.name || '',
      photo: img(r.profile_path, 'w185'), dept: r.known_for_department || '',
      known: (r.known_for || []).map(function (k) { return shapeItem(k); }).filter(Boolean)
    };
  }

  // /search/multi: titles with a poster, people with a photo.
  function shapeSearch(res) {
    var items = [], people = [];
    (res.results || []).forEach(function (r) {
      if (r.media_type === 'person') { if (r.profile_path) people.push(shapePerson(r)); return; }
      var it = shapeItem(r);
      if (it && it.title && it.poster) items.push(it);
    });
    return { items: items, people: people };
  }

  function searchTmdb(f) {
    if (f.text && !f.cat && !f.year && !f.rating) {
      return tmdbLive('/search/multi', { language: LANG, query: f.text, include_adult: 'false', page: 1 }, shapeSearch);
    }
    return Promise.all(searchTypes(f).map(function (t) {
      return tmdbLive((f.text ? '/search/' : '/discover/') + t, searchParams(t, f), shapeList(t));
    })).then(function (lists) { return { items: [].concat.apply([], lists), people: [] }; });
  }

  // A person's films and series (OK on a person): acting (not as themselves) and directing,
  // best known first. Talk shows and news are left out.
  function shapeCredits(res) {
    var list = (res.cast || []).filter(function (c) { return !/^(self|himself|herself)\b/i.test(c.character || ''); })
      .concat((res.crew || []).filter(function (c) { return c.job === 'Director' || c.job === 'Creator'; }));
    var seen = {}, items = [];
    list.forEach(function (r) {
      var it = shapeItem(r);
      if (!it || !it.poster || seen[it.key]) return;
      if (it.type === 'tv' && (it.genreIds.indexOf(10767) !== -1 || it.genreIds.indexOf(10763) !== -1)) return;
      seen[it.key] = true;
      items.push(it);
    });
    items.sort(function (a, b) { return b.votes - a.votes; });
    return { items: items.slice(0, 60), people: [] };
  }

  function personTitlesTmdb(person) {
    return tmdbLive('/person/' + person.id + '/combined_credits', { language: LANG }, shapeCredits);
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
      key: t.type + ':' + t.id, id: t.id, type: t.type, title: t.title, year: String(t.year), date: t.year + '-06-01',
      overview: t.overview, poster: '', backdrop: 'mock/bd-' + t.palette + '.jpg',
      rating: t.rating, votes: t.votes, popularity: t.popularity, genreIds: t.genres,
      lang: t.lang || '', countries: t.countries || [], palette: t.palette
    };
  }

  function mockPerson(p) {
    return {
      key: 'person:' + p.id, id: p.id, type: 'person', title: p.name, photo: '', dept: p.dept || '',
      palette: p.palette, known: p.credits.map(function (k) { return mockItem(MOCK.byKey[k]); })
    };
  }

  // Titles whose name has the text (accents and case ignored); with no text, all of them (the
  // filter is applied by Smart.searchRows, as for TMDB's answers). People: by name.
  function searchMock(f) {
    var q = window.Smart.norm(f.text || '');
    function has(name) { return window.Smart.norm(name).indexOf(q) !== -1; }
    var stream = !q && f.stream && f.stream.length ? f.stream : null;      // discover mode
    var items = MOCK.titles.filter(function (t) {
      if (stream && !t.providers.some(function (p) { return stream.indexOf(p) !== -1; })) return false;
      return !q || has(t.title);
    })
      .sort(function (a, b) { return b.popularity - a.popularity; }).map(mockItem);
    var people = q && !f.cat && !f.year && !f.rating ? MOCK.people.filter(function (p) { return has(p.name); }).map(mockPerson) : [];
    return Promise.resolve({ items: items, people: people });
  }

  function personTitlesMock(person) {
    var p = MOCK.people.filter(function (x) { return x.id === person.id; })[0];
    return Promise.resolve({ items: p ? p.credits.map(function (k) { return mockItem(MOCK.byKey[k]); }) : [], people: [] });
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
      if ((q.releaseFrom || q.primaryFrom || q.airFrom) && t.year < 2024) return false;   // "new": 2024 on
      return true;
    });
    var from = q.releaseFrom || q.primaryFrom || q.airFrom;
    var by = (q.sort || '').indexOf('vote_average') === 0 ? 'rating' : 'popularity';
    list.sort(function (a, b) { return b[by] - a[by]; });
    return Promise.resolve(list.map(function (t) {
      var it = mockItem(t);
      if (from && t.year >= 2025) it.date = from;       // sample data: 2025 on counts as just arrived
      return it;
    }));
  }

  function recommendationsMock(item) {
    var src = MOCK.byKey[item.key];
    var gs = src ? src.genres : item.genreIds || [];
    return Promise.resolve(MOCK.titles.filter(function (t) {
      return t.type + ':' + t.id !== item.key && t.genres.some(function (g) { return gs.indexOf(g) !== -1; });
    }).map(mockItem));
  }

  // Sample "similar": the same genres, best rated first.
  function similarMock(item) {
    return recommendationsMock(item).then(function (list) {
      return list.slice().sort(function (a, b) { return b.rating - a.rating; });
    });
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
    genres: function () { return Promise.resolve(MOCK.genreNames); },
    search: searchMock, personTitles: personTitlesMock, similar: similarMock };
  var tmdbImpl = { discover: discoverTmdb, recommendations: recommendationsTmdb, details: detailsTmdb, genres: genresTmdb,
    search: searchTmdb, personTitles: personTitlesTmdb, similar: similarTmdb };

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
        details: withFallback('details'), genres: withFallback('genres'),
        search: withFallback('search'), personTitles: withFallback('personTitles'), similar: withFallback('similar') }
    : tmdbImpl;

  // "Títulos semelhantes" in the details (asked when the details open, cached 6 h like the
  // rest): TMDB's recommendations, and its similar titles too when those are fewer than
  // SIMILAR_MIN. Both through the hide rule. A separate request, not appended to the details:
  // the details of ~100 titles are prefetched in the background and would each carry it.
  var SIMILAR_MIN = 8;
  var recsFiltered = noHidden(impl.recommendations, false);
  var similarFiltered = noHidden(impl.similar, false);
  function similar(item) {
    if (mode === 'off') return Promise.resolve([]);
    return recsFiltered(item).then(null, function () { return []; }).then(function (recs) {
      if (recs.length >= SIMILAR_MIN) return recs;
      return similarFiltered(item).then(function (more) { return recs.concat(more); }, function () { return recs; });
    });
  }

  // The last answers of the search screen by query and filter, so a letter deleted (or a
  // filter set back) shows its results at once, without waiting for the debounce.
  var answers = {}, answerKeys = [];
  function searchKey(f) {
    return JSON.stringify([f.text || '', f.cat ? [f.cat.movie, f.cat.tv] : 0, f.year ? [f.year.from, f.year.to] : 0,
      f.rating || 0, f.stream ? f.stream.join('|') : 0]);
  }
  function search(f) {
    if (mode === 'off') return Promise.resolve({ items: [], people: [] });
    var k = searchKey(f);
    return impl.search(f).then(function (v) {
      if (!answers[k]) { answerKeys.push(k); if (answerKeys.length > LIVE_MAX) delete answers[answerKeys.shift()]; }
      answers[k] = v;
      return v;
    });
  }

  // Every title list goes through the filter (cached answers too). TMDB cannot leave out an
  // original language, so a discover page the filter thins out (fewer than MIN_KEPT left) is
  // topped up once with the next page.
  var MIN_KEPT = 12;
  function noHidden(fn, more) {
    if (!HIDE) return fn;
    return function (q) {
      return fn(q).then(function (list) {
        var kept = window.Smart.dropHidden(list, HIDE);
        if (!more || kept.length >= MIN_KEPT || kept.length === list.length || (q.page || 1) > 1) return kept;
        var q2 = {};
        for (var k in q) q2[k] = q[k];
        q2.page = (q.page || 1) + 1;
        return fn(q2).then(function (next) {
          var seen = {};
          kept.forEach(function (it) { seen[it.key] = true; });
          return kept.concat(window.Smart.dropHidden(next, HIDE).filter(function (it) { return !seen[it.key]; }));
        }, function () { return kept; });
      });
    };
  }

  window.Catalog = {
    mode: mode,                 // 'tmdb' | 'mock' | 'off'
    discover: noHidden(impl.discover, true),
    recommendations: noHidden(impl.recommendations, false),
    hide: HIDE,                 // the rule (Smart.hideRule) for the lists built elsewhere
    loadAnimationAllow: loadAnimationAllow,
    similar: similar,
    details: impl.details,
    genres: impl.genres,
    imdbRating: imdbRating,
    serviceIds: serviceIds,
    search: search,
    searchKnown: function (f) { return answers[searchKey(f)] || null; },
    personTitles: function (p) { return mode === 'off' ? Promise.resolve({ items: [], people: [] }) : impl.personTitles(p); },
    hasImdb: mode === 'mock' || !!CFG.omdbKey
  };
})();
