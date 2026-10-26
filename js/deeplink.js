/*
 * Opening a title inside its streaming app ("deep links"). Pure logic, no DOM and no
 * network: the Wikidata query that finds a title's id on each service, and the launch
 * request each app understands on each platform. Runs in the TV (window.DeepLink) and in
 * node (module.exports) for tools/test-smart.js.
 *
 * WHERE THE IDS COME FROM
 * TMDB gives a title's Wikidata item (external_ids.wikidata_id); Wikidata holds the
 * title's id on each service. js/catalog.js asks for them in batches, in the background.
 *   P1874  Netflix ID                 70143836        netflix.com/title/$1
 *   P7595  Disney+ movie ID           5f9Y4Fphlz7f    disneyplus.com/movies/wd/$1
 *   P7596  Disney+ series ID          6P4ZI3bWwSDj    disneyplus.com/series/wp/$1
 *   P8298  HBO Max ID                 show/<uuid>     play.hbomax.com/$1 (older values
 *                                     are "series/urn:hbo:…" from the first HBO Max: unused)
 *   P9586  Apple TV movie ID          umc.cmc.…       tv.apple.com/movie/$1
 *   P9751  Apple TV show ID           umc.cmc.…       tv.apple.com/show/$1
 *   P12356 Globoplay ID               W7gfVsrnLk      globoplay.globo.com/-/t/$1/
 * Prime Video (P8055) is left out: Wikidata has US ASINs, and almost no BR title has one.
 *
 * HOW EACH APP IS OPENED ON A TITLE
 * `sure` means the format is used by published tools that drive real TVs; the others are
 * educated guesses (the web URL as contentTarget) to be confirmed on the TV. For a guess
 * the toast still says what to look for, in case the app ignores it.
 *   webOS (Luna applicationManager/launch, { id, params }):
 *     Netflix  params.contentTarget = 'm=https://www.netflix.com/watch/<id>&source_type=4'
 *              (sure: the DIAL launch string Netflix's TV app parses; bscpylgtv/aiopylgtv
 *              send it as contentId, which the TV hands to the app as contentTarget)
 *     YouTube  params.contentTarget = 'https://www.youtube.com/tv?v=<videoId>' (sure)
 *     Netflix and YouTube confirmed on both LGs (Netflix asks for the profile first).
 *     Disney+, Max, Apple TV, Globoplay: params.contentTarget = the title's web URL (guess;
 *     Disney+ tried on the 86" LG: it ignores it and opens its home).
 *   Tizen: plain launch for every app. Tried on the Samsung (Tizen 9), none worked: the
 *     TV's DIAL server answers 401 to an app on the TV; DIAL from another device opens
 *     Netflix on its home; YouTube's PAYLOAD '#play?v=…' app control opens its home too.
 * Any refused deep launch falls back to a plain launch (js/platform.js launchDeep).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DeepLink = api;
})(this, function () {
  'use strict';

  // Wikidata property -> field in the ids object.
  var PROPS = {
    P1874: 'netflix',
    P7595: 'disneyMovie',
    P7596: 'disneySeries',
    P8298: 'max',
    P9586: 'appleMovie',
    P9751: 'appleShow',
    P12356: 'globoplay'
  };

  // Only well-formed ids are kept (they end up in URLs handed to other apps).
  var VALID = {
    netflix: /^\d{5,9}$/,
    disneyMovie: /^[0-9A-Za-z]{12}$/,
    disneySeries: /^[0-9A-Za-z]{12}$/,
    max: /^(show|movie|series|feature)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    appleMovie: /^umc\.cmc\.[a-z0-9]{20,30}$/,
    appleShow: /^umc\.cmc\.[a-z0-9]{20,30}$/,
    globoplay: /^[0-9A-Za-z_-]{4,20}$/
  };

  // SPARQL for the ids of several Wikidata items (['Q1079', …]): only the properties above.
  function sparql(qids) {
    var items = qids.filter(function (q) { return /^Q\d+$/.test(q); }).map(function (q) { return 'wd:' + q; });
    var props = Object.keys(PROPS).map(function (p) { return 'wdt:' + p; });
    return 'SELECT ?i ?p ?v WHERE{VALUES ?i{' + items.join(' ') + '}VALUES ?p{' + props.join(' ') + '}?i ?p ?v}';
  }

  function tail(uri) { return String(uri || '').split('/').pop(); }

  // SPARQL JSON answer -> { Q1079: { netflix: '70143836', appleShow: '…' }, … }.
  // Every asked item gets an object (empty when Wikidata knows none), so it is not asked
  // again. With several values for one service the first is kept.
  function fromSparql(res, qids) {
    var out = {};
    (qids || []).forEach(function (q) { out[q] = {}; });
    var rows = (res && res.results && res.results.bindings) || [];
    rows.forEach(function (b) {
      if (!b.i || !b.p || !b.v) return;
      var q = tail(b.i.value), field = PROPS[tail(b.p.value)], v = String(b.v.value || '');
      if (!out[q] || !field || out[q][field] || !VALID[field].test(v)) return;
      out[q][field] = v;
    });
    return out;
  }

  function webTarget(url) { return { params: { contentTarget: url } }; }

  // How to open a title in an installed app. appKey: the curated key ('netflix', …);
  // item: { type: 'movie'|'tv' }; ids: from fromSparql (or null).
  // Returns { sure, webos } or null when there is no way for this app/title.
  function request(appKey, item, ids) {
    ids = ids || {};
    var tv = item && item.type === 'tv';
    var id;
    switch (appKey) {
      case 'netflix':
        if (!ids.netflix) return null;
        id = 'm=https://www.netflix.com/watch/' + ids.netflix + '&source_type=4';
        return { sure: true, webos: { params: { contentTarget: id } } };
      case 'disney':
        id = tv ? ids.disneySeries : ids.disneyMovie;
        if (!id) return null;
        return { sure: false, webos: webTarget('https://www.disneyplus.com/' + (tv ? 'series/wp/' : 'movies/wd/') + id) };
      case 'max':
        if (!ids.max) return null;
        return { sure: false, webos: webTarget('https://play.hbomax.com/' + ids.max) };
      case 'appletv':
        id = tv ? ids.appleShow : ids.appleMovie;
        if (!id) return null;
        return { sure: false, webos: webTarget('https://tv.apple.com/' + (tv ? 'show/' : 'movie/') + id) };
      case 'globoplay':
        if (!ids.globoplay) return null;
        return { sure: false, webos: webTarget('https://globoplay.globo.com/-/t/' + ids.globoplay + '/') };
    }
    return null;
  }

  // A YouTube video (the trailer from TMDB).
  function youtube(videoId) {
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId || '')) return null;
    return { sure: true, webos: webTarget('https://www.youtube.com/tv?v=' + videoId) };
  }

  return {
    PROPS: PROPS,
    sparql: sparql,
    fromSparql: fromSparql,
    request: request,
    youtube: youtube
  };
});
