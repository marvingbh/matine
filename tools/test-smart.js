#!/usr/bin/env node
/* Unit checks for js/smart.js (provider mapping, history, taste profile, ranking, mood, anime),
   js/deeplink.js (Wikidata ids, deep-link launch requests) and js/catalog.js's anime filter.
   Run: node tools/test-smart.js   (no dependencies; not packaged) */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var Smart = require('../js/smart.js');
var DeepLink = require('../js/deeplink.js');

var ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/apps-data.js'), 'utf8'), ctx);
var DATA = ctx.window.TVHOME_DATA;

var passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }

function installed(keys) {
  var m = {};
  keys.forEach(function (k) { m[k] = { key: k, name: k, ids: ['id.' + k] }; });
  return m;
}
var ALL = installed(DATA.curated.map(function (e) { return e.key; }));

// Provider names and ids as TMDB returned them for watch_region=BR (October 2026).
var BR = [
  [8, 'Netflix'], [1796, 'Netflix Standard with Ads'], [119, 'Amazon Prime Video'], [2100, 'Amazon Prime Video with Ads'],
  [337, 'Disney Plus'], [1899, 'HBO Max'], [307, 'Globoplay'], [350, 'Apple TV'], [531, 'Paramount Plus'],
  [2303, 'Paramount Plus Premium'], [283, 'Crunchyroll'], [300, 'Pluto TV'],
  [582, 'Paramount+ Amazon Channel'], [1825, 'HBO Max Amazon Channel'], [2243, 'Apple TV Amazon Channel'],
  [1853, 'Paramount Plus Apple TV channel'], [201, 'MUBI Amazon Channel'], [10, 'Amazon Video'], [2, 'Apple TV Store']
].map(function (p) { return { id: p[0], name: p[1] }; });

function keysFor(provs, inst, score) {
  return Smart.mapProviders(provs, DATA.curated, inst || ALL, score).map(function (a) { return a.key; });
}

test('every real BR flatrate provider maps to its app', function () {
  var expect = { 8: 'netflix', 1796: 'netflix', 119: 'primevideo', 2100: 'primevideo', 337: 'disney', 1899: 'max',
    307: 'globoplay', 350: 'appletv', 531: 'paramount', 2303: 'paramount', 283: 'crunchyroll', 300: 'pluto' };
  BR.forEach(function (p) {
    var got = keysFor([p])[0] || null;
    assert.strictEqual(got, expect[p.id] || null, p.name + ' -> ' + got);
  });
});

test('add-on channels and stores never map (they play inside another app)', function () {
  assert.deepStrictEqual(keysFor(BR.filter(function (p) { return /channel|store|amazon video/i.test(p.name); })), []);
});

test('mapping by name works when TMDB changes an id', function () {
  assert.deepStrictEqual(keysFor([{ id: 99999, name: 'Disney+' }, { id: 99998, name: 'Max' }, { id: 99997, name: 'Apple TV+' }]),
    ['disney', 'max', 'appletv']);
});

test('only installed apps, deduplicated, TMDB order, then usage order', function () {
  var inst = installed(['netflix', 'max']);
  var provs = [{ id: 8, name: 'Netflix' }, { id: 1796, name: 'Netflix Standard with Ads' }, { id: 337, name: 'Disney Plus' }, { id: 1899, name: 'HBO Max' }];
  assert.deepStrictEqual(keysFor(provs, inst), ['netflix', 'max']);
  assert.deepStrictEqual(keysFor(provs, inst, { max: 5, netflix: 1 }), ['max', 'netflix']);
});

test('providerIdsFor lists the ids of installed apps only', function () {
  var ids = Smart.providerIdsFor(DATA.curated, installed(['netflix', 'globoplay']));
  assert.deepStrictEqual(ids.sort(function (a, b) { return a - b; }), [8, 307, 1796]);
});

test('genre ids: TV ids fold into movie ids and back', function () {
  assert.strictEqual(Smart.canonGenre('tv', 10765), 878);
  assert.strictEqual(Smart.canonGenre('movie', 18), 18);
  assert.strictEqual(Smart.genreFor('tv', 878), 10765);
  assert.strictEqual(Smart.genreFor('tv', 27), null);          // no horror genre for TV
  assert.strictEqual(Smart.genreFor('movie', 10764), null);    // no reality genre for films
});

var NOW = Date.UTC(2026, 9, 25, 22, 0, 0);
var H = 3600e3, D = 24 * H;
function item(type, id, title, genres, extra) {
  var it = { key: type + ':' + id, id: id, type: type, title: title, genreIds: genres, rating: 8, popularity: 100 };
  for (var k in extra || {}) it[k] = extra[k];
  return it;
}

function sampleHistory() {
  var h = Smart.emptyHistory();
  Smart.recordTitle(h, item('tv', 1, 'Ruptura', [18, 9648, 10765]), 'watched', 'appletv', NOW - 4 * D);
  Smart.recordTitle(h, item('tv', 2, 'The Last of Us', [18, 10765]), 'watching', 'max', NOW - D);
  Smart.recordTitle(h, item('movie', 3, 'Duna: Parte Dois', [878, 12]), 'picked', 'max', NOW - 3 * H);
  Smart.recordTitle(h, item('movie', 4, 'Interestelar', [12, 18, 878]), 'want', null, NOW - 8 * D);
  Smart.recordTitle(h, item('movie', 5, 'Velho', [35]), 'picked', 'netflix', NOW - 90 * D);
  for (var i = 0; i < 6; i++) Smart.recordApp(h, 'netflix', NOW - (2 + i) * D);
  Smart.recordApp(h, 'youtube', NOW - 50 * 60e3);
  return h;
}

test('recordTitle keeps "watching" when the title is opened again, and counts picks', function () {
  var h = sampleHistory();
  Smart.recordTitle(h, item('tv', 2, 'The Last of Us', [18, 10765]), 'picked', 'max', NOW);
  assert.strictEqual(h.titles['tv:2'].status, 'watching');
  assert.strictEqual(h.titles['tv:2'].picks, 1);
  Smart.recordTitle(h, item('tv', 2, 'The Last of Us', []), null, null, NOW);
  assert.ok(!h.titles['tv:2']);
});

test('history is capped at 200 titles, oldest dropped', function () {
  var h = Smart.emptyHistory();
  for (var i = 0; i < 230; i++) Smart.recordTitle(h, item('movie', i, 'T' + i, [18]), 'want', null, NOW - (230 - i) * H);
  assert.strictEqual(Object.keys(h.titles).length, 200);
  assert.ok(!h.titles['movie:0'] && h.titles['movie:229']);
});

test('continueList: watching + picked within 60 days, newest first', function () {
  var keys = Smart.continueList(sampleHistory(), NOW).map(function (r) { return r.key; });
  assert.deepStrictEqual(keys, ['movie:3', 'tv:2']);    // "Velho" is 90 days old
});

test('recentMix: titles stand in for their app; apps from the last 14 days', function () {
  var mix = Smart.recentMix(sampleHistory(), NOW, 3);
  assert.deepStrictEqual(mix.map(function (m) { return m.kind === 'app' ? 'app:' + m.appKey : m.rec.key; }),
    ['app:youtube', 'movie:3', 'tv:2']);
});

test('taste profile: genres, apps and seeds', function () {
  var p = Smart.tasteProfile(sampleHistory(), NOW);
  // Sci-fi (Duna + Ruptura/The Last of Us as TV 10765 + Interestelar) edges out drama.
  assert.deepStrictEqual(p.genres.slice(0, 2).map(function (g) { return g.id; }), [878, 18]);
  assert.ok(p.appScore.max > p.appScore.youtube);
  assert.deepStrictEqual(p.seeds.slice(0, 3).map(function (s) { return s.title; }), ['Duna: Parte Dois', 'The Last of Us', 'Ruptura']);
  assert.ok(p.seen['tv:1'] && !p.seen['tv:2']);
  assert.strictEqual(Smart.tasteProfile(Smart.emptyHistory(), NOW).count, 0);
});

test('rankForYou: excludes seen, prefers taste, keeps the best reason', function () {
  var p = Smart.tasteProfile(sampleHistory(), NOW);
  var drama = item('tv', 10, 'Slow Horses', [18, 80], { rating: 8 });
  var comedy = item('movie', 11, 'Comédia leve', [35], { rating: 8 });
  var cands = [
    { item: comedy, reason: 'Porque você gosta de comédia' },
    { item: drama, reason: 'Porque você gosta de drama' },
    { item: drama, reason: 'Porque você viu Ruptura', bonus: 0.6 },
    { item: item('tv', 1, 'Ruptura', [18]), reason: 'x' }
  ];
  var out = Smart.rankForYou(cands, p, {}, 10);
  assert.deepStrictEqual(out.map(function (i) { return i.title; }), ['Slow Horses', 'Comédia leve']);
  assert.strictEqual(out[0].reason, 'Porque você viu Ruptura');
  assert.deepStrictEqual(Smart.rankForYou(cands, p, { 'tv:10': true }, 10).map(function (i) { return i.key; }), ['movie:11']);
});

test('mood row follows weather and time, per tab, with that type only', function () {
  function at(y, mo, d, h) { return new Date(y, mo, d, h, 0, 0); }
  function id(date, w, type) { var m = Smart.moodFor(date, w, type); assert.strictEqual(m.query.type, type); return m.id; }
  var sun = at(2026, 9, 25, 15), fri = at(2026, 9, 23, 20), tueLate = at(2026, 9, 21, 23), tueAm = at(2026, 9, 21, 9), tue = at(2026, 9, 21, 15);
  assert.strictEqual(id(sun, { code: 61, temp: 20 }, 'movie'), 'rain');
  assert.strictEqual(id(sun, { code: 61, temp: 20 }, 'tv'), 'rain');
  assert.strictEqual(id(fri, null, 'movie'), 'weekend-night');
  assert.strictEqual(id(fri, null, 'tv'), 'binge');
  assert.strictEqual(id(sun, { code: 1, temp: 25 }, 'movie'), 'sunday');
  assert.strictEqual(id(tueLate, null, 'movie'), 'late');
  assert.strictEqual(Smart.moodFor(tueLate, null, 'movie').query.runtimeMax, 100);
  assert.strictEqual(Smart.moodFor(tueLate, null, 'tv').query.runtimeMax, 30);    // short episodes
  assert.strictEqual(id(tueAm, null, 'movie'), 'morning');
  assert.strictEqual(id(tue, { code: 0, temp: 33 }, 'movie'), 'hot');
  assert.strictEqual(id(tue, { code: 0, temp: 25 }, 'movie'), 'gems');
  assert.strictEqual(id(tue, { code: 0, temp: 25 }, 'tv'), 'mini');
  assert.strictEqual(Smart.moodFor(tue, null, 'tv').query.tvType, 2);              // TMDB with_type=2: miniseries
});

test('per-type filters: continue list, marks and recommendation seeds', function () {
  var h = sampleHistory();
  assert.deepStrictEqual(Smart.continueList(h, NOW, 20, 'tv').map(function (r) { return r.key; }), ['tv:2']);
  assert.deepStrictEqual(Smart.continueList(h, NOW, 20, 'movie').map(function (r) { return r.key; }), ['movie:3']);
  assert.deepStrictEqual(Smart.titlesWith(h, ['want'], 'tv'), []);
  assert.strictEqual(Smart.titlesWith(h, ['want'], 'movie')[0].title, 'Interestelar');
  var p = Smart.tasteProfile(h, NOW);
  assert.deepStrictEqual(Smart.seedsOf(p, 'tv').map(function (r) { return r.title; }), ['The Last of Us', 'Ruptura']);
  assert.deepStrictEqual(Smart.seedsOf(p, 'movie').map(function (r) { return r.title; }), ['Duna: Parte Dois', 'Velho']);
});

test('mergeByApp: one request per app -> titles tagged with every app they are on', function () {
  var a = item('tv', 1, 'A', [18], { popularity: 50 }), b = item('tv', 2, 'B', [18], { popularity: 90 }), c = item('tv', 3, 'C', [18], { popularity: 70 });
  var out = Smart.mergeByApp([{ app: 'netflix', items: [a, b] }, { app: 'max', items: [b, c] }], 'popularity', 20, { 'tv:3': true });
  assert.deepStrictEqual(out.map(function (x) { return x.key + '=' + x.apps.join('+'); }), ['tv:2=netflix+max', 'tv:1=netflix']);
  assert.ok(!a.apps, 'inputs are not modified');
});

test('stableOrder: a background refresh keeps the order on screen and appends new titles', function () {
  function k(list) { return list.map(function (x) { return x.key; }); }
  var prev = [item('tv', 1, 'A', []), item('tv', 2, 'B', []), item('tv', 3, 'C', [])];
  var next = [item('tv', 4, 'D', []), item('tv', 3, 'C', []), item('tv', 1, 'A', [])];
  assert.deepStrictEqual(k(Smart.stableOrder(prev, next)), ['tv:1', 'tv:3', 'tv:4']);
});

test('"Já vi": mark A, mark B -> both watched; undo -> only B goes back', function () {
  var h = sampleHistory();
  var a = item('movie', 50, 'A', [18]), b = item('tv', 51, 'B', [18]);
  Smart.recordTitle(h, b, 'want', null, NOW - D);                 // B was in "Quero ver" before
  var ta = Smart.markWatched(h, a, NOW);
  var tb = Smart.markWatched(h, b, NOW + 1000);
  assert.strictEqual(Smart.statusOf(h, 'movie:50'), 'watched');
  assert.strictEqual(Smart.statusOf(h, 'tv:51'), 'watched');
  Smart.undoMark(h, tb);                                            // yellow: undo the last mark only
  assert.strictEqual(Smart.statusOf(h, 'movie:50'), 'watched', 'A stays watched');
  assert.strictEqual(Smart.statusOf(h, 'tv:51'), 'want', 'B gets its old status back');
  var round = JSON.parse(JSON.stringify(h));                        // what localStorage keeps
  assert.strictEqual(Smart.statusOf(round, 'movie:50'), 'watched');
  Smart.undoMark(h, ta);
  assert.strictEqual(Smart.statusOf(h, 'movie:50'), null, 'a title with no history is removed again');
});

test('formatting', function () {
  assert.strictEqual(Smart.formatRating(8.06), '8,1');
  assert.strictEqual(Smart.relTime(NOW - 3 * H, NOW), 'há 3 h');
  assert.strictEqual(Smart.relTime(NOW - 30 * H, NOW), 'ontem');
});

// ---------- deep links (js/deeplink.js) ----------

// Rows as query.wikidata.org answered for Coco (Q5815826), Grey's Anatomy (Q438406) and
// Person of Interest (Q564345), October 2026, plus a few bad values.
function b(q, p, v) {
  return { i: { value: 'http://www.wikidata.org/entity/' + q }, p: { value: 'http://www.wikidata.org/prop/direct/' + p }, v: { value: v } };
}
var WD = { results: { bindings: [
  b('Q5815826', 'P1874', '80189213'), b('Q5815826', 'P7595', 'db9orsI5O4gC'), b('Q5815826', 'P7595', 'SvWfRZO0Z3mF'),
  b('Q5815826', 'P9586', 'umc.cmc.5y1554je00oslx5xtkxv9uk7s'),
  b('Q438406', 'P1874', '70140391'), b('Q438406', 'P1874', '81683910'), b('Q438406', 'P7596', '6P4ZI3bWwSDj'),
  b('Q438406', 'P9751', 'umc.cmc.2kau27si25o1mt2sah5dtjgr0'),
  b('Q564345', 'P1874', '70197042'), b('Q564345', 'P8298', 'series/urn:hbo:series:GYAcfKQrV88IyQgEAAAHt'),
  b('Q564345', 'P12356', 'W7gfVsrnLk'), b('Q564345', 'P9586', 'javascript:alert(1)'), b('Q99', 'P1874', '1234567')
] } };

test('Wikidata answer -> ids per title (first value, bad values dropped, unknown titles empty)', function () {
  var m = DeepLink.fromSparql(WD, ['Q5815826', 'Q438406', 'Q564345', 'Q1']);
  assert.deepStrictEqual(m.Q5815826, { netflix: '80189213', disneyMovie: 'db9orsI5O4gC', appleMovie: 'umc.cmc.5y1554je00oslx5xtkxv9uk7s' });
  assert.deepStrictEqual(m.Q438406, { netflix: '70140391', disneySeries: '6P4ZI3bWwSDj', appleShow: 'umc.cmc.2kau27si25o1mt2sah5dtjgr0' });
  assert.deepStrictEqual(m.Q564345, { netflix: '70197042', globoplay: 'W7gfVsrnLk' }, 'old HBO Max urn and a bad Apple id are dropped');
  assert.deepStrictEqual(m.Q1, {}, 'asked but unknown: an empty object, cached so it is not asked again');
  assert.strictEqual(m.Q99, undefined, 'rows for items not asked are ignored');
  assert.deepStrictEqual(DeepLink.fromSparql(null, ['Q1']), { Q1: {} });
});

test('the SPARQL query asks only the given items and the service properties', function () {
  var q = DeepLink.sparql(['Q1079', 'Q886', 'bad']);
  assert.ok(q.indexOf('wd:Q1079 wd:Q886}') !== -1, q);
  assert.ok(q.indexOf('bad') === -1);
  ['P1874', 'P7595', 'P7596', 'P8298', 'P9586', 'P9751', 'P12356'].forEach(function (p) { assert.ok(q.indexOf('wdt:' + p) !== -1, p); });
});

test('deep-link requests per app and platform', function () {
  var movie = { type: 'movie' }, tv = { type: 'tv' };
  var coco = DeepLink.fromSparql(WD, ['Q5815826']).Q5815826;
  var greys = DeepLink.fromSparql(WD, ['Q438406']).Q438406;
  var nf = DeepLink.request('netflix', movie, coco);
  assert.strictEqual(nf.sure, true);
  assert.deepStrictEqual(nf.webos, { params: { contentTarget: 'm=https://www.netflix.com/watch/80189213&source_type=4' } });
  assert.strictEqual(nf.tizen, undefined, 'Samsung: plain launch (nothing worked on the TV)');
  assert.strictEqual(DeepLink.request('disney', movie, coco).webos.params.contentTarget, 'https://www.disneyplus.com/movies/wd/db9orsI5O4gC');
  assert.strictEqual(DeepLink.request('disney', tv, greys).webos.params.contentTarget, 'https://www.disneyplus.com/series/wp/6P4ZI3bWwSDj');
  assert.strictEqual(DeepLink.request('disney', tv, coco), null, 'a movie id is not used for a series');
  assert.strictEqual(DeepLink.request('appletv', tv, greys).webos.params.contentTarget, 'https://tv.apple.com/show/umc.cmc.2kau27si25o1mt2sah5dtjgr0');
  assert.strictEqual(DeepLink.request('disney', movie, coco).sure, false, 'guessed formats say so');
  assert.strictEqual(DeepLink.request('disney', movie, coco).tizen, undefined, 'no Tizen format: plain launch');
  assert.strictEqual(DeepLink.request('max', tv, { max: 'show/12345678-1234-1234-1234-123456789abc' }).webos.params.contentTarget,
    'https://play.hbomax.com/show/12345678-1234-1234-1234-123456789abc');
  assert.strictEqual(DeepLink.request('primevideo', movie, coco), null);
  assert.strictEqual(DeepLink.request('netflix', movie, {}), null);
  assert.strictEqual(DeepLink.request('netflix', movie, null), null);
});

test('trailer in YouTube', function () {
  var y = DeepLink.youtube('dQw4w9WgXcQ');
  assert.deepStrictEqual(y.webos, { params: { contentTarget: 'https://www.youtube.com/tv?v=dQw4w9WgXcQ' } });
  assert.strictEqual(y.tizen, undefined);
  assert.strictEqual(DeepLink.youtube(''), null);
  assert.strictEqual(DeepLink.youtube('a b&c=1'), null);
});

test('anime: Japanese animation is dropped, other animation and Japanese live action stay', function () {
  var anime = item('tv', 31, 'Frieren', [16, 10765], { lang: 'ja', countries: ['JP'] });
  var animeFilm = item('movie', 32, 'A Viagem de Chihiro', [16, 14], { lang: 'ja' });
  var coProd = item('tv', 33, 'Castlevania', [16, 10759], { lang: 'en', countries: ['JP', 'US'] });
  var pixar = item('movie', 34, 'Divertida Mente 2', [16, 10751], { lang: 'en', countries: ['US'] });
  var liveAction = item('movie', 35, 'Godzilla Minus One', [878, 27], { lang: 'ja' });
  var old = item('movie', 36, 'Sem idioma (cache antigo)', [16]);
  assert.ok(Smart.isAnime(anime) && Smart.isAnime(animeFilm) && Smart.isAnime(coProd));
  assert.ok(!Smart.isAnime(pixar) && !Smart.isAnime(liveAction) && !Smart.isAnime(old) && !Smart.isAnime(null));
  assert.deepStrictEqual(Smart.dropAnime([anime, pixar, animeFilm, liveAction]).map(function (x) { return x.id; }), [34, 35]);
});

// catalog.js in a sandbox with a fake XMLHttpRequest: what it asks TMDB and what it returns.
function catalogWith(cfg, answer) {
  var urls = [];
  function XHR() {}
  XHR.prototype.open = function (m, url) { this.url = url; };
  XHR.prototype.setRequestHeader = function () {};
  XHR.prototype.send = function () {
    var x = this;
    urls.push(x.url);
    x.status = 200;
    x.responseText = JSON.stringify(answer);
    setTimeout(function () { x.onload(); }, 0);
  };
  var mem = {};
  var win = {
    TVHOME_CONFIG: cfg, Smart: Smart, Platform: { isTV: true },
    Store: { cacheGet: function (k) { return mem[k] ? { v: mem[k], fresh: true } : null; },
      cachePut: function (k, v) { mem[k] = v; } }
  };
  var c = { window: win, XMLHttpRequest: XHR, location: { search: '' }, setTimeout: setTimeout, console: console };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/catalog.js'), 'utf8'), c);
  return { Catalog: win.Catalog, urls: urls };
}

var TMDB_ANSWER = { results: [
  { id: 1, media_type: 'tv', name: 'Jujutsu Kaisen', poster_path: '/a.jpg', genre_ids: [16, 10759], original_language: 'ja', origin_country: ['JP'] },
  { id: 2, media_type: 'tv', name: 'Arcane', poster_path: '/b.jpg', genre_ids: [16, 10765], original_language: 'en', origin_country: ['US'] },
  { id: 3, media_type: 'tv', name: 'Shogun', poster_path: '/c.jpg', genre_ids: [18], original_language: 'en', origin_country: ['US'] }
] };

var asyncTests = [];
function testAsync(name, fn) { asyncTests.push({ name: name, fn: fn }); }
function titles(list) { return JSON.stringify(list.map(function (x) { return x.title; })); }   // across vm realms

testAsync('catalog: discover excludes the anime keyword and every list drops anime', function () {
  var t = catalogWith({ tmdbToken: 'test' }, TMDB_ANSWER);
  return t.Catalog.discover({ type: 'tv', providers: [8] }).then(function (list) {
    assert.ok(/[?&]without_keywords=210024(&|$)/.test(t.urls[0]), t.urls[0]);
    assert.strictEqual(titles(list), '["Arcane","Shogun"]');
    return t.Catalog.recommendations({ type: 'tv', id: 99 });
  }).then(function (list) {
    assert.ok(t.urls[1].indexOf('/tv/99/recommendations') !== -1);
    assert.strictEqual(titles(list), '["Arcane","Shogun"]');
  });
});

testAsync('catalog: hideAnime false keeps anime', function () {
  var t = catalogWith({ tmdbToken: 'test', hideAnime: false }, TMDB_ANSWER);
  return t.Catalog.discover({ type: 'tv' }).then(function (list) {
    assert.ok(t.urls[0].indexOf('without_keywords') === -1, t.urls[0]);
    assert.strictEqual(list.length, 3);
  });
});

asyncTests.reduce(function (p, x) {
  return p.then(function () { return x.fn(); }).then(function () { passed++; console.log('ok  ' + x.name); });
}, Promise.resolve()).then(function () {
  console.log('\n' + passed + ' checks passed');
}, function (err) {
  console.error(err);
  process.exit(1);
});
