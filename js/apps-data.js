/*
 * All app data in one place. Edit this file to change what the home screen shows.
 *
 * HOW MATCHING WORKS
 * On the TV, tizen.application.getAppsInfo() returns the installed apps with their
 * on-device Tizen application IDs (package-style, e.g. "org.tizen.netflix-app" or
 * "9Ur5IzDKqV.TizenYouTube"). Samsung's 12/13-digit numeric IDs (e.g. Netflix
 * 3201907018807) are Smart Hub / store IDs used by the remote-control (WebSocket /
 * SmartThings) API; they are kept here too because some firmware lists them, and the
 * launcher tries them as a last resort. An app is matched by, in order:
 *   1. its id appearing in `ids`
 *   2. its normalized name (lowercase, no accents, letters+digits only) equal to one of `names`
 *   3. its normalized name starting with one of `prefixes`
 * The app is always launched with the id the TV itself reported.
 *
 * `curated` order = order on the home screen. Entries not installed on the TV are hidden.
 * `glyph` (optional) picks a small line icon: 'play', 'music', 'globe', 'tv' or 'film'.
 * Without it the app gets a letter mark.
 * `tmdb` (optional) ties the app to the streaming services TMDB reports for a film or
 * series (TMDB's watch-provider data comes from JustWatch). A provider matches when its
 * provider_id is in `ids`, or its normalized name ("Disney Plus" -> "disneyplus",
 * "Apple TV+" -> "appletvplus") is in `names` or starts with one of `prefixes`.
 * Add-on channels ("Paramount Plus Amazon Channel") never match: they play inside another app.
 * Only installed apps are suggested, and discover queries ask TMDB only for their ids.
 * "verified" in the comments means the id was seen in a published real-device listing.
 *
 * LG webOS: `webos` holds the webOS app ids (checked like `ids`). On webOS 6 and later a
 * developer-mode app may not list the installed apps, so there the home list is built from
 * these ids: each is checked with getAppLoadStatus and the first installed one is used.
 * Add or fix ids here; the "IDs" screen (yellow) shows what the TV reported.
 */
window.TVHOME_DATA = {
  // Background photos (1920x1080 JPEG in img/, credits in README.md), picked by the time
  // of day. Within a slot the photos take turns every `backgroundMinutes` minutes with a
  // slow crossfade. Slots: dawn 05-08, day 08-17, dusk 17-19, night 19-05.
  // To always show one photo, set `background: 'img/yosemite-dusk.jpg'` instead.
  background: null,
  backgrounds: {
    dawn: ['img/dawn-aoraki.jpg'],
    day: ['img/yosemite-day.jpg', 'img/day-valley.jpg'],
    dusk: ['img/yosemite-dusk.jpg'],
    night: ['img/night-milkyway.jpg', 'img/night-tatras.jpg']
  },
  backgroundMinutes: 20,

  curated: [
    { key: 'netflix', name: 'Netflix',
      tile: { bg: '#0a0a0a', fg: '#e50914', text: 'NETFLIX', style: 'caps' },
      ids: ['org.tizen.netflix-app', '3201907018807', '11101200001'], // tizen id verified
      webos: ['netflix'], // webOS: verified
      names: ['netflix'],
      tmdb: { ids: [8, 1796], prefixes: ['netflix'] } },
    { key: 'youtube', name: 'YouTube', glyph: 'play',
      tile: { bg: '#ffffff', fg: '#0f0f0f', accent: '#ff0033' },
      ids: ['9Ur5IzDKqV.TizenYouTube', '111299001912'], // tizen id verified
      webos: ['youtube.leanback.v4'], // webOS: verified
      names: ['youtube'],
      tmdb: { ids: [188], names: ['youtubepremium'] } },
    { key: 'globoplay', name: 'Globoplay',
      tile: { bg: 'linear-gradient(135deg, #ff7a18 0%, #ff2e63 100%)', fg: '#ffffff', text: 'globoplay', style: 'lower' },
      ids: [], // no public id found; matched by name
      webos: ['globoplaywebos'], // webOS: verified (2025 LG device dump)
      names: ['globoplay'], prefixes: ['globoplay'],
      tmdb: { ids: [307], prefixes: ['globoplay'] } },
    { key: 'primevideo', name: 'Prime Video',
      tile: { bg: 'linear-gradient(160deg, #1b2a3a 0%, #0f171e 100%)', fg: '#ffffff', accent: '#1a98ff', text: 'prime video', style: 'lower' },
      ids: ['org.tizen.primevideo', '3201910019365', '3201512006785'], // tizen id verified
      webos: ['amazon', 'lovefilm.de'], // webOS: 'amazon' verified; 'lovefilm.de' older/regional
      names: ['primevideo', 'amazonprimevideo'],
      tmdb: { ids: [119, 9, 2100], prefixes: ['amazonprimevideo', 'primevideo'] } },
    { key: 'disney', name: 'Disney+',
      tile: { bg: 'radial-gradient(circle at 50% 120%, #1d6fd6 0%, #0d2a6b 45%, #071233 100%)', fg: '#ffffff' },
      ids: ['MCmYXNxgcu.DisneyPlus', '3201901017640', '3202009021709', '3202204027038'], // tizen id verified
      webos: ['com.disney.disneyplus-prod'], // webOS: verified
      names: ['disney', 'disneyplus'],
      tmdb: { ids: [337, 619], names: ['disneyplus', 'starplus'] } }, // Star+ moved into Disney+ in 2024
    { key: 'max', name: 'Max',
      tile: { bg: 'linear-gradient(135deg, #0029ff 0%, #001a9e 100%)', fg: '#ffffff', text: 'max', style: 'lower' },
      ids: ['3202301029760', '3201601007230'], // store ids only
      webos: ['com.wbd.stream', 'com.hbo.hbomax', 'hbo-go-2'], // webOS: com.wbd.stream reported on a TV, others older; unverified
      names: ['max', 'hbomax', 'hbo'],
      tmdb: { ids: [1899, 384], names: ['max', 'hbomax'] } },
    { key: 'appletv', name: 'Apple TV',
      tile: { bg: 'linear-gradient(180deg, #2c2c2e 0%, #0d0d0f 100%)', fg: '#ffffff' },
      ids: ['com.samsung.tv.aria-video', '3201807016597'], // tizen id verified
      webos: ['com.apple.appletv', 'com.apple.tv'], // webOS: sources disagree; unverified
      names: ['appletv', 'appletvplus'],
      tmdb: { ids: [350], names: ['appletvplus', 'appletv'] } },
    { key: 'paramount', name: 'Paramount+',
      tile: { bg: 'linear-gradient(160deg, #0a64ff 0%, #0039c4 100%)', fg: '#ffffff' },
      ids: ['3201710014981', '3202110025305'],
      webos: ['com.cbs-ent.paramountplus'], // webOS: guessed (one source)
      names: ['paramount', 'paramountplus'],
      tmdb: { ids: [531, 2303, 2616], prefixes: ['paramountplus'] } },
    { key: 'spotify', name: 'Spotify', glyph: 'music',
      tile: { bg: '#121212', fg: '#ffffff', accent: '#1ed760' },
      ids: ['rJeHak5zRg.Spotify', '3201606009684'], // tizen id verified
      webos: ['spotify-beehive'], // webOS: verified
      names: ['spotify'], prefixes: ['spotify'] },
    { key: 'twitch', name: 'Twitch',
      tile: { bg: '#9146ff', fg: '#ffffff', text: 'twitch', style: 'lower' },
      ids: ['3202203026841'],
      webos: ['tv.twitch.tv.starshot.lg', 'twitch'], // webOS: sources disagree; unverified
      names: ['twitch'] },
    { key: 'tvplus', name: 'Samsung TV Plus', glyph: 'tv',
      tile: { bg: 'linear-gradient(160deg, #2b4bd8 0%, #1428a0 100%)', fg: '#ffffff', text: 'TV Plus' },
      ids: [], // no public id found; matched by name
      webos: [],
      names: ['samsungtvplus', 'tvplus'] },
    { key: 'lgchannels', name: 'LG Channels', glyph: 'tv',
      tile: { bg: 'linear-gradient(160deg, #c8104d 0%, #8a0036 100%)', fg: '#ffffff' },
      ids: [],
      webos: ['com.webos.app.lgchannels'], // webOS: verified (LG's free channels, like Samsung TV Plus)
      names: ['lgchannels'] },
    { key: 'pluto', name: 'Pluto TV', glyph: 'tv',
      tile: { bg: '#0b0b0b', fg: '#fff200' },
      ids: ['3201808016802'],
      webos: ['com.plutotv.app'], // webOS: guessed (one source)
      names: ['plutotv', 'pluto'],
      tmdb: { ids: [300], names: ['plutotv'] } },
    { key: 'crunchyroll', name: 'Crunchyroll',
      tile: { bg: '#f47521', fg: '#ffffff' },
      ids: ['3202302030097'],
      webos: ['com.crunchyroll.webapp', 'crunchyroll'], // webOS: sources disagree; unverified
      names: ['crunchyroll'],
      tmdb: { ids: [283], names: ['crunchyroll'] } },
    { key: 'deezer', name: 'Deezer', glyph: 'music',
      tile: { bg: 'linear-gradient(135deg, #a238ff 0%, #6b1fd1 100%)', fg: '#ffffff', text: 'deezer', style: 'lower' },
      ids: ['3201608010191'],
      webos: [], // webOS: no id found; matched by name
      names: ['deezer'] },
    { key: 'browser', name: 'Internet', glyph: 'globe',
      tile: { bg: 'linear-gradient(160deg, #3d8bfd 0%, #1f5fd1 100%)', fg: '#ffffff' },
      ids: ['org.tizen.browser', '3201907018784', '3202010022079'], // org.tizen.browser verified
      webos: ['com.webos.app.browser'], // webOS: verified
      names: ['internet', 'samsunginternet', 'webbrowser', 'navegadordaweb'] }
  ],

  /*
   * Best-effort system entries. The TV's own list (including hidden entries) is searched
   * by `ids` then `names`; if nothing matches, the entry still shows when `alwaysShow`
   * is true and launching tries each id in `ids` in turn.
   * NONE of the Tizen ids is verified (the webOS ones are, see `webos`). Use the "IDs" screen (yellow button) on the TV to
   * find the real ones and put them here.
   */
  special: [
    { key: 'livetv', name: 'TV', glyph: 'tv', alwaysShow: true,
      tile: { bg: 'linear-gradient(180deg, #3a3a3c 0%, #1c1c1e 100%)', fg: '#ffffff' },
      ids: ['org.tizen.tv-viewer', 'com.samsung.tv.tv-viewer', 'com.samsung.tv.channel'],
      webos: ['com.webos.app.livetv'], // webOS: verified
      names: ['tv', 'tvaovivo', 'livetv', 'tvviewer'] },
    { key: 'settings', name: 'Configurações', alwaysShow: true,
      ids: ['com.samsung.tv.coba.setting', 'com.samsung.tv.settings', 'org.tizen.setting', 'com.samsung.tv.menu'], // first: QN50Q60 (2026-10-26); the others are not on it
      webos: ['com.palm.app.settings'], // webOS: verified
      names: ['configuracoes', 'settings', 'definicoes'] }
  ],
  // Where the special entries go: 'start' or 'end' of the home list.
  // The 'settings' entry is not in the list: the "Ajustes" menu item launches it.
  specialPosition: 'end',

  // Ids/names that are never shown in "Todos os apps" (case-insensitive substring of the id).
  systemIdPatterns: [
    'org.tizen.', 'com.samsung.tv.', 'com.samsung.', 'samsung.tv.', 'tizen.',
    'service', 'daemon', 'agent', 'widget', 'launcher', 'homescreen', 'home-screen',
    'installer', 'update', 'keyboard', '.ime', 'remote', 'xwalk', 'webapis',
    'nativeime', 'smarthub', 'firstscreen', 'eden', 'notification', 'popup',
    // LG webOS system launch points
    'com.palm.', 'com.webos.service.', 'com.webos.app.home', 'com.webos.app.discovery',
    'com.webos.app.membership', 'com.webos.app.customersupport', 'com.webos.app.notificationcenter'
  ],
  systemNamePatterns: [
    'service', 'daemon', 'agent', 'widget', 'launcher', 'installer', 'update',
    'teclado', 'keyboard', 'notification', 'notificacao'
  ]
};
