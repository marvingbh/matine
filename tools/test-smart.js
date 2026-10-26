#!/usr/bin/env node
/* Unit checks for js/smart.js (provider mapping, history, taste profile, ranking, mood, anime,
   search rows and filters), js/deeplink.js (Wikidata ids, deep-link launch requests) and
   js/catalog.js (anime filter, search requests).
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

// ---------- search (js/search.js uses these) ----------

test('search rows: films and series apart, anime and "Já vi" left out, people kept', function () {
  var h = Smart.emptyHistory();
  var seen = item('movie', 41, 'Duna', [878], { year: '2021' });
  Smart.markWatched(h, seen, NOW);
  var res = { items: [
    item('tv', 40, 'Frieren', [16, 10765], { lang: 'ja', countries: ['JP'] }),
    seen,
    item('movie', 42, 'Duna: Parte Dois', [878], { year: '2024' }),
    item('tv', 43, 'Duna: A Profecia', [10765], { year: '2024' }),
    item('movie', 42, 'Duna: Parte Dois', [878])                       // twice in the answer
  ], people: [
    { key: 'person:1', type: 'person', title: 'Denis Villeneuve', known: [seen] },
    { key: 'person:2', type: 'person', title: 'Dublador', known: [item('tv', 40, 'Frieren', [16], { lang: 'ja' })] }
  ] };
  function watched(k) { return Smart.statusOf(h, k) === 'watched'; }
  var rows = Smart.searchRows(res, watched, true, null);
  assert.deepStrictEqual(rows.map(function (r) { return r.id + '=' + r.items.map(function (x) { return x.key; }).join(','); }),
    ['movie=movie:42', 'tv=tv:43', 'people=person:1']);
  var all = Smart.searchRows(res, watched, false, null);
  assert.strictEqual(all[1].items[0].key, 'tv:40', 'hideAnime off keeps anime');
  assert.strictEqual(all[2].items.length, 2);
  assert.deepStrictEqual(Smart.searchRows(null, watched, true, null), []);
});

test('search filter: category per type, single year and ranges; no people with a filter', function () {
  var res = { items: [
    item('movie', 1, 'Ficção 2024', [878], { year: '2024' }), item('movie', 2, 'Drama 2015', [18], { year: '2015' }),
    item('tv', 3, 'Série sci-fi 2016', [10765], { year: '2016' }), item('tv', 4, 'Reality 2016', [10764], { year: '2016' }),
    item('movie', 5, 'Antigo', [878], { year: '1968' }), item('movie', 6, 'Sem ano', [878], { year: '' })
  ], people: [{ key: 'person:9', type: 'person', title: 'X' }] };
  function keys(f) {
    return Smart.searchRows(res, null, true, f).map(function (r) { return r.items.map(function (x) { return x.id; }).join(','); });
  }
  assert.deepStrictEqual(keys({ cat: { movie: 878, tv: 10765 }, year: null }), ['1,5,6', '3']);
  assert.deepStrictEqual(keys({ cat: { movie: null, tv: 10764 }, year: null }), ['4'], 'a TV-only category: no film row');
  assert.deepStrictEqual(keys({ cat: null, year: { from: 2010, to: 2019 } }), ['2', '3,4']);
  assert.deepStrictEqual(keys({ cat: { movie: 878, tv: 10765 }, year: { from: null, to: 1989 } }), ['5']);
  assert.deepStrictEqual(keys({ cat: null, year: { from: 2024, to: 2024 } }), ['1']);
});

test('search filter "Nota": minimum score with enough votes (100 for films, 50 for series)', function () {
  var res = { items: [
    item('movie', 1, 'Bom', [18], { rating: 7.6, votes: 5000 }), item('movie', 2, 'Obscuro 10', [18], { rating: 10, votes: 12 }),
    item('movie', 3, 'Mediano', [18], { rating: 6.4, votes: 900 }), item('tv', 4, 'Série boa', [18], { rating: 8.1, votes: 60 }),
    item('tv', 5, 'Série nova', [18], { rating: 9, votes: 40 })
  ], people: [{ key: 'person:1', type: 'person', title: 'X' }] };
  function ids(min) {
    return Smart.searchRows(res, null, true, { rating: min }).map(function (r) { return r.items.map(function (x) { return x.id; }).join(','); });
  }
  assert.deepStrictEqual(ids(7), ['1', '4'], 'no people row with a filter');
  assert.deepStrictEqual(ids(8), ['4']);
  assert.deepStrictEqual(ids(6), ['1,3', '4']);
  assert.strictEqual(Smart.minVotes('movie'), 100);
  assert.strictEqual(Smart.minVotes('tv'), 50);
});

test('poster score: one decimal, hidden with no score or few votes', function () {
  assert.strictEqual(Smart.cardScore({ rating: 7.84, votes: 3000 }), '★ 7,8');
  assert.strictEqual(Smart.cardScore({ rating: 9.5, votes: 12 }), '');
  assert.strictEqual(Smart.cardScore({ rating: 0, votes: 3000 }), '');
  assert.strictEqual(Smart.cardScore({ rating: 8 }), '★ 8,0', 'older history records have no vote count');
  assert.strictEqual(Smart.cardScore(null), '');
});

test('search categories: one per genre, with its film and TV id; TV-only genres apart', function () {
  var cats = Smart.searchCategories({
    movie: { 28: 'Ação', 12: 'Aventura', 18: 'Drama', 27: 'Terror', 878: 'Ficção científica' },
    tv: { 10759: 'Ação e Aventura', 18: 'Drama', 10765: 'Ficção científica e Fantasia', 10764: 'Reality' }
  });
  var by = {};
  cats.forEach(function (c) { by[c.name] = [c.movie, c.tv]; });
  assert.deepStrictEqual(cats.map(function (c) { return c.name; }), ['Ação', 'Aventura', 'Drama', 'Ficção científica', 'Reality', 'Terror']);
  assert.deepStrictEqual(by['Ação'], [28, 10759]);
  assert.deepStrictEqual(by['Aventura'], [12, 10759]);
  assert.deepStrictEqual(by['Ficção científica'], [878, 10765]);
  assert.deepStrictEqual(by.Terror, [27, null], 'no horror genre for series');
  assert.deepStrictEqual(by.Reality, [null, 10764]);
  assert.deepStrictEqual(Smart.searchCategories(null), []);
});

test('Asian titles: dropped by original language, or origin country when given; config can turn it off', function () {
  var rule = Smart.hideRule({});
  var kdrama = item('tv', 61, 'Pousando no Amor', [35, 18], { lang: 'ko', countries: ['KR'] });
  var cdrama = item('tv', 62, 'Série em inglês feita em Taiwan', [18], { lang: 'en', countries: ['TW'] });
  var bolly = item('movie', 63, 'RRR', [28], { lang: 'te' });
  var hkFilm = item('movie', 64, 'Filme de Hong Kong', [28], { lang: 'cn' });
  var coProd = item('movie', 65, 'Coprodução', [18], { lang: 'en', countries: ['US', 'JP'] });
  var brazil = item('movie', 66, 'Ainda Estou Aqui', [18], { lang: 'pt', countries: ['BR'] });
  var noData = item('movie', 67, 'Sem idioma (cache antigo)', [18]);
  var spanish = item('tv', 68, 'La Casa de Papel', [80], { lang: 'es', countries: ['ES'] });
  var all = [kdrama, cdrama, bolly, hkFilm, coProd, brazil, noData, spanish];
  assert.deepStrictEqual(Smart.dropHidden(all, rule).map(function (x) { return x.id; }), [66, 67, 68]);
  assert.ok(Smart.isHidden(item('tv', 69, 'Frieren', [16], { lang: 'ja' }), rule), 'anime too');
  var off = Smart.hideRule({ hideLanguages: false, hideCountries: false, hideAnime: false });
  assert.strictEqual(Smart.dropHidden(all, off).length, all.length);
  var onlyKo = Smart.hideRule({ hideLanguages: ['ko'], hideCountries: false });
  assert.deepStrictEqual(Smart.dropHidden(all, onlyKo).map(function (x) { return x.id; }), [62, 63, 64, 65, 66, 67, 68]);
  // The history keeps language and countries, so "Continuar" can be filtered too.
  var h = Smart.emptyHistory();
  Smart.recordTitle(h, kdrama, 'watching', 'netflix', NOW);
  assert.strictEqual(h.titles['tv:61'].lang, 'ko');
  assert.deepStrictEqual(Smart.dropHidden(Smart.continueList(h, NOW), rule), []);
  // Search rows and people use the same rule.
  var rows = Smart.searchRows({ items: [kdrama, spanish], people: [{ key: 'person:1', type: 'person', title: 'Ator', known: [kdrama] }] }, null, rule, null);
  assert.deepStrictEqual(rows.map(function (r) { return r.id + '=' + r.items.length; }), ['tv=1']);
});

test('Novidades: windows (films 90 days, series 60), order newest first, Estreia vs Nova temporada', function () {
  var now = new Date(2026, 9, 26, 15, 0, 0).getTime();
  var mv = Smart.newArrivals('movie', now);
  assert.deepStrictEqual([mv.releaseFrom, mv.releaseTo, mv.releaseTypes.join('|'), mv.minVotes, mv.monetization],
    ['2026-07-28', '2026-10-26', '4|5|6', 10, 'flatrate|free|ads']);
  var fb = Smart.newArrivals('movie', now, true);
  assert.deepStrictEqual([fb.primaryFrom, fb.primaryTo, fb.releaseFrom], ['2026-07-28', '2026-10-26', undefined]);
  var tv = Smart.newArrivals('tv', now);
  assert.deepStrictEqual([tv.airFrom, tv.airTo, tv.sort], ['2026-08-27', '2026-10-26', 'popularity.desc']);
  var films = Smart.newOrder([item('movie', 1, 'Antigo', [], { date: '2026-03-01', popularity: 900 }),
    item('movie', 2, 'Novo', [], { date: '2026-09-30', popularity: 10 })], mv);
  assert.deepStrictEqual(films.map(function (x) { return x.id; }), [2, 1]);
  var shows = Smart.newOrder([item('tv', 3, 'Volta', [], { date: '2019-05-01', popularity: 50 }),
    item('tv', 4, 'Estreia', [], { date: '2026-09-10', popularity: 80 })], tv);
  assert.deepStrictEqual(shows.map(function (x) { return x.id + ' ' + x.reason; }), ['4 Estreia', '3 Nova temporada']);
});

test('animation: only Disney / Pixar (the allowlist) shows; config can turn it off', function () {
  var rule = Smart.hideRule({});
  assert.deepStrictEqual(rule.companies, [6125, 3, 2, 3475]);
  var pixar = item('movie', 1022789, 'Divertida Mente 2', [16, 10751], { lang: 'en', countries: ['US'] });
  var dreamworks = item('movie', 1184918, 'Robô Selvagem', [16, 878], { lang: 'en', countries: ['US'] });
  var arcane = item('tv', 94605, 'Arcane', [16, 10765], { lang: 'en', countries: ['US'] });
  var live = item('movie', 693134, 'Duna: Parte Dois', [878], { lang: 'en' });
  var all = [pixar, dreamworks, arcane, live];
  assert.deepStrictEqual(Smart.dropHidden(all, rule).map(function (x) { return x.id; }), [693134], 'allowlist not loaded yet: no animation');
  rule.allow = { 'movie:1022789': 1 };
  assert.deepStrictEqual(Smart.dropHidden(all, rule).map(function (x) { return x.id; }), [1022789, 693134]);
  assert.strictEqual(Smart.dropHidden(all, Smart.hideRule({ hideAnimation: false })).length, 4);
  // History rows and search go through the same rule.
  var rows = Smart.searchRows({ items: all, people: [] }, null, rule, null);
  assert.deepStrictEqual(rows.map(function (r) { return r.id + '=' + r.items.length; }), ['movie=2']);
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
  var t = catalogWith({ tmdbToken: 'test', hideAnimation: false }, TMDB_ANSWER);
  return t.Catalog.discover({ type: 'tv', providers: [8] }).then(function (list) {
    assert.ok(/[?&]without_keywords=210024(&|$)/.test(t.urls[0]), t.urls[0]);
    assert.strictEqual(titles(list), '["Arcane","Shogun"]');
    return t.Catalog.recommendations({ type: 'tv', id: 99 });
  }).then(function (list) {
    assert.ok(t.urls[t.urls.length - 1].indexOf('/tv/99/recommendations') !== -1);
    assert.strictEqual(titles(list), '["Arcane","Shogun"]');
  });
});

testAsync('catalog: hideAnime false keeps anime', function () {
  var t = catalogWith({ tmdbToken: 'test', hideAnime: false, hideAnimation: false, hideLanguages: false, hideCountries: false }, TMDB_ANSWER);
  return t.Catalog.discover({ type: 'tv' }).then(function (list) {
    assert.ok(t.urls[0].indexOf('without_keywords') === -1, t.urls[0]);
    assert.strictEqual(list.length, 3);
  });
});

testAsync('catalog search: text alone asks /search/multi; people with a photo, titles with a poster', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { results: [
    { id: 7, media_type: 'person', name: 'Fernanda Torres', profile_path: '/f.jpg', known_for_department: 'Acting', known_for: [{ id: 1, media_type: 'movie', title: 'Ainda Estou Aqui' }] },
    { id: 8, media_type: 'person', name: 'Sem foto' },
    { id: 1, media_type: 'movie', title: 'Ainda Estou Aqui', poster_path: '/a.jpg', release_date: '2024-11-07', genre_ids: [18] },
    { id: 2, media_type: 'tv', name: 'Sem pôster' }
  ] });
  return t.Catalog.search({ text: 'ainda estou', cat: null, year: null }).then(function (res) {
    assert.ok(/\/search\/multi\?/.test(t.urls[0]) && /query=ainda%20estou/.test(t.urls[0]) && /language=pt-BR/.test(t.urls[0]), t.urls[0]);
    assert.strictEqual(JSON.stringify(res.people.map(function (p) { return p.title; })), '["Fernanda Torres"]');
    assert.strictEqual(titles(res.items), '["Ainda Estou Aqui"]');
    assert.ok(t.Catalog.searchKnown({ text: 'ainda estou', cat: null, year: null }), 'kept for a letter deleted later');
  });
});

testAsync('catalog search: text + filter -> /search/movie and /search/tv with the year', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { results: [] });
  return t.Catalog.search({ text: 'duna', cat: { movie: 878, tv: 10765 }, year: { from: 2024, to: 2024 } }).then(function () {
    var mv = t.urls.filter(function (u) { return u.indexOf('/search/movie?') !== -1; })[0];
    var tv = t.urls.filter(function (u) { return u.indexOf('/search/tv?') !== -1; })[0];
    assert.ok(/primary_release_year=2024/.test(mv) && /query=duna/.test(mv), mv);
    assert.ok(/first_air_date_year=2024/.test(tv), tv);
    assert.ok(mv.indexOf('with_genres') === -1, 'genres are checked on the answer');
  });
});

testAsync('catalog search: no text + filters -> /discover with genres, dates and no anime; one type for a TV-only genre', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { results: [] });
  return t.Catalog.search({ text: '', cat: { movie: 878, tv: 10765 }, year: { from: 2010, to: 2019 } }).then(function () {
    var mv = t.urls.filter(function (u) { return u.indexOf('/discover/movie?') !== -1; })[0];
    var tv = t.urls.filter(function (u) { return u.indexOf('/discover/tv?') !== -1; })[0];
    assert.ok(/with_genres=878/.test(mv) && /primary_release_date\.gte=2010-01-01/.test(mv) && /primary_release_date\.lte=2019-12-31/.test(mv), mv);
    assert.ok(/sort_by=popularity\.desc/.test(mv) && /without_keywords=210024/.test(mv), mv);
    assert.ok(/with_genres=10765/.test(tv) && /first_air_date\.gte=2010-01-01/.test(tv) && /first_air_date\.lte=2019-12-31/.test(tv), tv);
    var n = t.urls.length;
    return t.Catalog.search({ text: '', cat: { movie: null, tv: 10764 }, year: { from: null, to: 1989 } }).then(function () {
      var more = t.urls.slice(n);
      assert.strictEqual(more.length, 1, more.join(' '));
      assert.ok(/\/discover\/tv\?/.test(more[0]) && /first_air_date\.lte=1989-12-31/.test(more[0]) && more[0].indexOf('first_air_date.gte') === -1, more[0]);
    });
  });
});

testAsync('catalog search: filters only + Nota + Só streaming -> discover on the TV apps in BR', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { results: [] });
  return t.Catalog.search({ text: '', cat: null, year: null, rating: 7, stream: [8, 337] }).then(function () {
    var mv = t.urls.filter(function (u) { return u.indexOf('/discover/movie?') !== -1; })[0];
    var tv = t.urls.filter(function (u) { return u.indexOf('/discover/tv?') !== -1; })[0];
    assert.ok(/vote_average\.gte=7(&|$)/.test(mv) && /vote_count\.gte=100(&|$)/.test(mv), mv);
    assert.ok(/vote_count\.gte=50(&|$)/.test(tv), tv);
    assert.ok(/watch_region=BR/.test(mv) && /with_watch_providers=8%7C337/.test(mv), mv);
    assert.ok(/with_watch_monetization_types=flatrate%7Cfree%7Cads/.test(tv), tv);
    var n = t.urls.length;
    return t.Catalog.search({ text: '', cat: null, year: { from: 2020, to: 2029 }, rating: null, stream: null }).then(function () {
      var u = t.urls.slice(n).join(' ');
      assert.ok(u.indexOf('watch_region') === -1 && u.indexOf('vote_average') === -1 && /vote_count\.gte=20/.test(u), u);
    });
  });
});

testAsync('catalog search: text + Nota -> /search/movie and /search/tv (score checked on the answer)', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { results: [] });
  return t.Catalog.search({ text: 'casa', cat: null, year: null, rating: 8, stream: [8] }).then(function () {
    assert.strictEqual(t.urls.length, 2, t.urls.join(' '));
    t.urls.forEach(function (u) {
      assert.ok(/\/search\/(movie|tv)\?/.test(u) && u.indexOf('vote_average') === -1 && u.indexOf('watch_providers') === -1, u);
    });
  });
});

testAsync('catalog: a discover page thinned by the filter is topped up once with the next page', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { results: [
    { id: 1, media_type: 'tv', name: 'K-drama', poster_path: '/a.jpg', genre_ids: [18], original_language: 'ko', origin_country: ['KR'] },
    { id: 2, media_type: 'tv', name: 'Shogun', poster_path: '/b.jpg', genre_ids: [18], original_language: 'en', origin_country: ['US'] }
  ] });
  return t.Catalog.discover({ type: 'tv', providers: [8] }).then(function (list) {
    assert.strictEqual(t.urls.length, 2, t.urls.join(' '));
    assert.ok(/[?&]page=2(&|$)/.test(t.urls[1]), t.urls[1]);
    assert.strictEqual(titles(list), '["Shogun"]', 'deduplicated, Korean title left out');
    return t.Catalog.discover({ type: 'tv', providers: [8], page: 2 });
  }).then(function () {
    assert.strictEqual(t.urls.length, 2, 'page 2 is cached and not topped up again');
  });
});

testAsync('catalog: Novidades -> discover with release types / air dates on the app, flatrate|free|ads', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { results: [] });
  var now = new Date(2026, 9, 26, 15, 0, 0).getTime();
  var mq = Smart.newArrivals('movie', now); mq.providers = [8];
  var tq = Smart.newArrivals('tv', now); tq.providers = [337, 619];
  return Promise.all([t.Catalog.discover(mq), t.Catalog.discover(tq)]).then(function () {
    var mv = t.urls.filter(function (u) { return u.indexOf('/discover/movie?') !== -1; })[0];
    var tv = t.urls.filter(function (u) { return u.indexOf('/discover/tv?') !== -1; })[0];
    assert.ok(/release_date\.gte=2026-07-28/.test(mv) && /release_date\.lte=2026-10-26/.test(mv) && /with_release_type=4%7C5%7C6/.test(mv), mv);
    assert.ok(/region=BR/.test(mv) && /watch_region=BR/.test(mv) && /with_watch_providers=8(&|$)/.test(mv), mv);
    assert.ok(/with_watch_monetization_types=flatrate%7Cfree%7Cads/.test(mv) && /vote_count\.gte=10/.test(mv), mv);
    assert.ok(mv.indexOf('primary_release_date') === -1 && mv.indexOf('air_date') === -1, mv);
    assert.ok(/air_date\.gte=2026-08-27/.test(tv) && /air_date\.lte=2026-10-26/.test(tv) && /with_watch_providers=337%7C619/.test(tv), tv);
    assert.ok(tv.indexOf('release_date') === -1 && tv.indexOf('first_air_date') === -1, tv);
  });
});

testAsync('catalog: rows keep flatrate only unless asked', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { results: [] });
  return t.Catalog.discover({ type: 'movie', providers: [8] }).then(function () {
    assert.ok(/with_watch_monetization_types=flatrate(&|$)/.test(t.urls[0]), t.urls[0]);
  });
});

testAsync('catalog: the Disney / Pixar allowlist is read page by page once, and fills the rule', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { total_pages: 2, results: [{ id: 7, title: 'Toy Story' }, { id: 8, title: 'Up' }] });
  return t.Catalog.loadAnimationAllow().then(function (n) {
    assert.strictEqual(t.urls.length, 4, t.urls.join(' '));                       // 2 pages x films, series
    var mv = t.urls.filter(function (u) { return u.indexOf('/discover/movie?') !== -1; });
    assert.ok(/with_genres=16/.test(mv[0]) && /with_companies=6125%7C3%7C2%7C3475/.test(mv[0]) && /vote_count\.gte=50/.test(mv[0]), mv[0]);
    assert.ok(mv.some(function (u) { return /[?&]page=2(&|$)/.test(u); }));
    assert.strictEqual(n, 8);
    assert.ok(t.Catalog.hide.allow['movie:7'] && t.Catalog.hide.allow['tv:8']);
    return t.Catalog.loadAnimationAllow();
  }).then(function () {
    assert.strictEqual(t.urls.length, 4, 'cached for a week');
  });
});

testAsync('catalog search: "Animação" with no text asks only Disney / Pixar companies', function () {
  var t = catalogWith({ tmdbToken: 'test' }, { results: [] });
  return t.Catalog.search({ text: '', cat: { movie: 16, tv: 16 }, year: null, rating: null, stream: null }).then(function () {
    t.urls.forEach(function (u) { assert.ok(/with_genres=16/.test(u) && /with_companies=6125%7C3%7C2%7C3475/.test(u), u); });
    var n = t.urls.length;
    return t.Catalog.search({ text: '', cat: { movie: 18, tv: 18 }, year: null, rating: null, stream: null }).then(function () {
      t.urls.slice(n).forEach(function (u) { assert.ok(u.indexOf('with_companies') === -1, u); });
    });
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
