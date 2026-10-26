/*
 * Personal settings. Copy this file to js/config.local.js and fill it in.
 * config.local.js is optional: without it (or without a TMDB token) the home screen still
 * works; it just hides the film/series suggestions (and the weather when no place is set).
 * Keep config.local.js out of version control: it holds your API keys.
 */
window.TVHOME_CONFIG = {
  // TMDB "API Read Access Token" (the long v4 token, used as a Bearer token for API v3).
  // Get it at https://www.themoviedb.org → log in → Settings → API → request a personal
  // (developer) key → copy "API Read Access Token". Free for personal, non-commercial use.
  tmdbToken: '',

  // Optional: an OMDb key (https://www.omdbapi.com/apikey.aspx, free tier 1,000 requests/day)
  // to show IMDb ratings ("IMDb 8,3") in the details. Without it the TMDB score is shown.
  omdbKey: '',

  // Weather (Open-Meteo, no key). Give lat/lon, or just a city name and it is looked up
  // once with Open-Meteo's geocoding API. Leave all empty to hide the weather.
  city: 'São Paulo',
  lat: null,
  lon: null,

  // Where the streaming catalogue and texts come from. Rarely changed.
  region: 'BR',
  language: 'pt-BR',

  // How long API answers are kept in localStorage before they are fetched again.
  cacheHours: 6

  // Anime (Japanese animation) is left out of every suggestion row. false shows it again.
  // hideAnime: false

  // East, Southeast and South Asian titles are left out everywhere too: by original language
  // and (when TMDB gives it) origin country. A list replaces the default; false shows them.
  // hideLanguages: ['ko', 'ja', 'zh', 'cn', 'th', 'vi', 'id', 'ms', 'tl', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'ur'],
  // hideCountries: ['KR', 'JP', 'CN', 'TW', 'HK', 'TH', 'VN', 'ID', 'MY', 'PH', 'IN', 'SG']

  // Animation (films and series) is left out, except what these TMDB companies made: Walt
  // Disney Animation Studios, Pixar, Walt Disney Pictures, Disney Television Animation.
  // hideAnimation: false shows all animation again.
  // hideAnimation: false
  // animationAllowCompanies: [6125, 3, 2, 3475]

  // Samsung, top bar "Entradas": 'window' shows the chosen input full screen inside this app
  // instead of opening the TV's own viewer on it.
  // samsungInput: 'window'

  // Opening a title directly inside Netflix, Disney+ & co. (js/deeplink.js). Leave it out
  // for all known formats; 'sure' keeps only the confirmed ones (Netflix, YouTube); false
  // just opens the app and says what to look for.
  // deepLinks: 'sure'

  // Lite mode for slow TVs (smaller images, no crossfades). Leave it out to decide from the
  // browser version (on for Chromium < 68, e.g. LG webOS 4.x); true/false forces it.
  // lite: true
};
