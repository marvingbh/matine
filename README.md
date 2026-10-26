# Matinê

*Matinê*: the afternoon cinema session, in Brazil. A home screen for a Samsung TV (QN50Q60DAGXZD, Tizen 9, Brazil), laid out like the Apple TV (tvOS) home screen: a Top Shelf at the top (the focused app's suggestions over their artwork, full bleed), a grid of app tiles below it (5 per row, the focused one lifts with a shadow and a sheen), and under the grid the film and series poster rows from TMDB: which app each one is on, a "Para você" row built from what you open and mark here, and a "Minha lista" view of what you are watching, want to see and have seen. The clock sits top right with the weather beside it. It is plain HTML, CSS and JS, with no build step. The same code also runs on LG webOS TVs (see "LG TVs (webOS)" below).

## What it does

- **App grid.** The installed apps as tiles, 5 per row, in the order of `js/apps-data.js` (each tile is the app's brand color with its name as a wordmark: `tile` in that file; apps without one get a muted color and the TV's icon). Left/Right move within a row, Up/Down between rows; the name shows under the focused tile. **Top Shelf**: while the first row has the focus, the top of the screen shows the focused streaming app's own suggestions (what you were watching in it, then the first titles of each poster row that are on it) over the title's artwork, with title, score, year, genres and two lines of synopsis; it turns to the next suggestion every 8 seconds. Apps without suggestions show their name over the landscape photo. On a lower row the grid moves up and the photo goes dark, like the tvOS wallpaper. Vertical focus is one loop: top bar → grid → poster rows → (Down on the last poster row) the first grid row; Up from the top bar goes to the last poster row. What you were watching is not a tile: it is the "Continuar assistindo" poster rows (below).
- **Top bar (top left, home screen).** Four pills like the CleanYourTV launchers: **Buscar** (below), **Entradas**, **Wi-Fi** (named after the network: the Wi-Fi name, "Rede cabeada" or "Sem rede") and **Ajustes**. Up from the first grid row focuses it; Left/Right move between the pills; Down or Back returns; Up again goes on round the loop to the last poster row. Entradas opens a small panel with the inputs that have something connected (all of them when the TV does not say) and "TV ao vivo". Wi-Fi opens the TV's network settings, Ajustes the TV's settings. When the TV refuses, a toast says so.
  - Samsung: the inputs come from `tizen.systeminfo` `VIDEOSOURCE` (with a connected flag). Choosing one sets it as the source of the TV Window API's MAIN window (privilege `tv.window`) and opens the TV's own viewer (`org.tizen.tv-viewer`), so the remote reaches the device. With `samsungInput: 'window'` the input is shown full screen inside this app instead (OK or Back returns). Network settings: `com.samsung.tv.coba.setting.networksettings`, then `org.tizen.NetworkSetting-Tizen`, then Settings (`com.samsung.tv.coba.setting`).
  - LG: the inputs come from Luna `com.webos.service.eim/getAllInputStatus`; if the TV refuses it, the input apps `com.webos.app.hdmi1`…`4` that exist (without the connected flag). Choosing one launches that app, as the CleanYourTV LG launcher does. Network settings: the CleanYourTV candidates (`com.webos.app.firstuse-overlay` and `com.palm.app.settings` with `target: "network"`, then plain Settings).
- **Buscar (search), the first pill of the top bar** (`S` or `/` on a real keyboard). A tvOS-style screen: the query at the top, four filters under it (**Categoria**, **Ano**, **Nota**, **Só streaming**), an on-screen keyboard moved with the arrows (a–z, 0–9, ç, ã, é, Apagar, Espaço, Limpar; the TVs' own keyboards are slow and differ per model), and the results under it as poster rows, **Filmes**, **Séries** and **Pessoas**, kept apart. A real keyboard and the LG remote's number keys type too. Vertical focus is one loop: filters → keyboard → result rows → (Down on the last row) the filters; Up from the first result row returns to the key you were on. Back closes a filter list, then a person's titles, then the search (focus goes back to where it was). No remote key opens it: Red, Green, Yellow, Blue and Info are all taken, and the Samsung remote has no search key.
  - **Data.** TMDB in pt-BR, 350 ms after the last letter, at the front of the request queue; an answer for an older query is dropped, and answers are kept in memory (not in `localStorage`), so deleting a letter or setting a filter back shows the earlier results at once. Text alone: `/search/multi` (films, series and people in one answer). Text with a filter: `/search/movie` and `/search/tv` (one year: `primary_release_year` / `first_air_date_year`; the genre and a range of years are checked on the answer). Filters without text: `/discover/movie` and `/discover/tv` by popularity, with `with_genres`, `primary_release_date` / `first_air_date` ranges and the anime keyword excluded. With nothing typed or chosen, the "em alta" rows of the home screen are shown (no network).
  - **Categoria** lists the TMDB genres (fetched once with the rows' genre lists, cached 7 days), one entry per genre with its film and series id ("Aventura" uses "Ação e Aventura" for series). A genre that exists for only one type says so ("só filmes", "só séries") and the other row is left out. **Ano**: Qualquer ano, one year (Left/Right change it), Anos 2020, 2010, 2000, 1990, Antes de 1990. **Nota**: Qualquer, 6+, 7+, 7,5+, 8+, counting only titles with enough votes (100 for films, 50 for series; `vote_average.gte` and `vote_count.gte` in discover, checked on the answer with text). The chosen filters also show at the right of the query bar.
  - **Só streaming** (on by default; OK on the chip turns it off): only titles on an app of this TV, the same "installed apps" the rows use, not every service in Brazil. With filters only, discover asks for them (`watch_region=BR`, `with_watch_monetization_types=flatrate|free|ads`, `with_watch_providers` = the provider ids of the installed apps). With text, TMDB cannot filter, so the apps of the results are looked up in the background when the answer arrives (the cached details request, 4 at a time, never on a key press): the rows wait for the first 8 answers ("Procurando onde assistir…"), then show each row's titles in order up to the first one still being checked, so cards are only added at the end. Titles on no app (or whose check failed) are left out. The app's name shows on each result card, top left.
  - The same rules as the rows: no anime (`hideAnime`), titles marked "Já vi" left out (also right after marking one in the details). OK on a title opens the same details, Hold OK the same "Abrir em…" and launch (deep links, providers); OK on a person shows their films and series ("Filmes com …", one request), Back returns to the results. Moving between results does no network; cards are the rows' cards, posters at the same sizes, with only a window of cards in the DOM.
- **Descobrir (right, then full screen): one vertical list of rows, films and series in pairs.** Every category appears twice, the film row first and then the series row, and each row holds only its own type (built from TMDB's movie or tv endpoints only). Empty rows are skipped. While the app grid has focus, the first row peeks under it. Down from the last grid row moves into the posters: the grid goes up, the focused poster lifts (scale, shadow, its title under it), the title's backdrop crossfades in behind the whole screen, and the Top Shelf shows title, TMDB score (or IMDb with an OMDb key), year, length or seasons, genres, two lines of synopsis and the apps it is on ("Netflix", "Prime Video"). Up/Down move between rows; Up on the first row goes back to the grid, Down on the last row to the first grid row (in Minha lista the rows loop). The rows, in order:
  - **Continuar assistindo · Filmes / · Séries**: titles you opened from here or marked "Assistindo" (last 60 days), as poster rows like the others. The first of them peeks under the app grid.
  - **Novidades nos streamings · Filmes / · Séries**: what arrived lately on your apps, one discover request per installed app (so each card shows the app it is on, top left), refreshed with the other rows (6 h cache). TMDB has no "added to the service on" date, so films use their Brazilian digital, physical or TV release (`with_release_type=4|5|6`, `release_date` in the last 90 days, `region=BR`), or, when that finds fewer than 6, their first release in the last 90 days; newest first. Series: anything aired in the last 60 days (`air_date`), so new seasons count too, by popularity; the hero says "Estreia" (first aired in that window) or "Nova temporada". Both ask `with_watch_monetization_types=flatrate|free|ads` and at least 10 votes. Anime, Asian titles and "Já vi" are left out as everywhere.
  - **Filmes para você / Séries para você**: TMDB recommendations of your latest titles of that type ("Porque você viu Ruptura") plus the best-rated titles of that type in your favourite genres on your apps ("Porque você gosta de drama"), ranked by your taste profile. Titles you marked "Já vi" are left out.
  - **Quero ver · Filmes / · Séries**: your list.
  - **A mood row for films, then one for series**, that change with the weather and the clock. Films: "Dia de chuva: um filme longo e bom", "Noite de cinema em casa" on Friday and Saturday nights, "Domingo em família", "Antes de dormir: até 100 minutos", "Calor lá fora" above 30 °C, documentaries in the morning, otherwise "Joias escondidas" (high scores, few votes). Series: "Dia de chuva: séries para maratonar", "Para maratonar no fim de semana", "Domingo em família", "Episódios curtos: até 30 minutos" late at night, documentaries in the morning, otherwise "Minisséries: começo, meio e fim" (TMDB's miniseries type). A mood title that does not say films or series gets " · Filmes" / " · Séries".
  - **Filmes em alta no Brasil / Séries em alta no Brasil** (popular now on your apps) and **Filmes mais bem avaliados / Séries mais bem avaliadas**.
  - **No anime** in any of these rows (`hideAnime`, on by default): the TMDB discover calls exclude TMDB's "anime" keyword (`without_keywords=210024`), and every list (recommendations too) drops animation (genre 16) whose original language is Japanese or whose origin country is Japan. Western animation stays.
  - **No East, Southeast or South Asian titles** anywhere (rows, Continuar / Quero ver, the Top Shelf, search, a person's titles; `hideLanguages` and `hideCountries`, on by default): a title is left out when its original language is ko, ja, zh, cn, th, vi, id, ms, tl, hi, ta, te, ml, kn, bn, mr, pa or ur, or its origin countries (given for series, and for films in newer TMDB answers) include KR, JP, CN, TW, HK, TH, VN, ID, MY, PH, IN or SG. One rule (`Smart.hideRule` / `isHidden`) on what the answers already hold; no request is made to check. TMDB has no "without original language" filter, so a discover page that the filter leaves with fewer than 12 titles is topped up once with the next page. Minha lista keeps what you marked yourself, and titles in the history from before this filter have no language recorded, so they stay until they leave the history.
- **OK on a poster** opens the details (below). **Holding OK** opens the title in its app: directly when the title is on one installed app, or through a small "Abrir em…" chooser (most used app first) when it is on several. A toast says what to look for: "Abrindo Netflix — procure por “Wandinha”". The title goes into your history.
- **Green on a poster = "Já vi".** Green always marks the focused title: every mark stands on its own and is saved at once. Each physical press counts once: key repeats (a press held a little long), a second keydown before the keyup, and a press less than 700 ms after the previous mark are ignored, so a repeat can't mark the next title after the card fades out. The card fades out and the title leaves every row; it goes to Minha lista → Já vi and feeds "Para você". The toast "Marcado como visto · Amarelo para desfazer" shows for 5 seconds; Yellow while it shows undoes only the last mark. A title can also be unmarked any time from its details ("✓ Já vi", e.g. from Minha lista → Já vi). Watched titles are left out of every row, also when a background refresh lands after the mark.
- **OK (or Info) on a poster** opens the details: synopsis, tagline, TMDB and IMDb scores, where it is available, "Abrir em …" buttons and the marks **Quero ver**, **Assistindo** and **Já vi** (press again to remove).
- **Minha lista** (Red menu, a glass bar under the clock): Assistindo, Quero ver and Já vi, each as a film row then a series row, with a one-line taste summary ("Você curte drama, ficção científica e mistério · mais usados: Netflix e Max").
- **Score on every poster** (rows and search): "★ 7,8" in a small dark pill, top right, drawn with the card (no request, no layer of its own); left out when the title has no score or fewer than 50 votes.
- **Backgrounds** follow the time of day (dawn 05–08, day 08–17, dusk 17–19, night 19–05) and take turns every 20 minutes within a slot, with a slow crossfade.
- **Weather** (Open-Meteo, no key): current temperature, condition, today's max/min, refreshed every 30 minutes.

### What is possible, and what is not

- **Watch history of other apps: not possible.** Tizen apps are sandboxed. No public API lets a third-party app read what you watched in Netflix, Prime Video, Globoplay, Max, Disney+ and so on. So "Continuar" and "Minha lista" only know what happens on this screen: the apps you open from it, the titles you open from its suggestions, and the marks you set. The app says so in a small note in "Minha lista".
- **Opening a specific title inside a streaming app: not possible.** Those apps have no public deep-link contract for third-party Tizen apps, and TMDB does not give their internal title IDs. OK opens the app and the toast names the title to search for. YouTube's TV app also has no documented app-control payload to open a search or a video, so it is opened plainly too.
- **Which app has a title** comes from TMDB's watch-provider data (from JustWatch) for Brazil, subscription ("flatrate") offers only. Rentals and add-on channels ("Paramount+ Amazon Channel", "HBO Max Amazon Channel") are ignored, because they play inside another app. Only installed apps are suggested, and the discover queries ask TMDB only for titles on them.
- **Art Mode**: this TV has none, and there is no public web API for it. "Modo Arte" only shows a message.

Everything (history, marks, API answers) is kept in `localStorage` on the TV. API answers are cached for 6 hours (genres and IMDb scores for 7 days, the place for a year), so the TV does not refetch on every start and still shows the last suggestions when it is offline.

## Configuration

Copy `js/config.local.example.js` to `js/config.local.js` and fill it in. The file is optional: without it, or without a token, the home screen works as before, the suggestions are replaced by a one-line hint, and the weather is hidden when no place is set. **Keep `js/config.local.js` out of version control: it holds your keys.**

| Key | What |
|---|---|
| `tmdbToken` | TMDB **API Read Access Token** (the long token; sent as `Authorization: Bearer`). Get it at https://www.themoviedb.org: create an account, then **Settings → API**, request a developer (personal, non-commercial) key, and copy "API Read Access Token". |
| `omdbKey` | Optional. An OMDb key (https://www.omdbapi.com/apikey.aspx, free tier 1,000 requests/day) to show IMDb scores in the hero and the details. Without it the TMDB score is shown. |
| `city`, `lat`, `lon` | Weather location. With `lat`/`lon` no lookup is needed; with only `city` the place is looked up once with Open-Meteo's geocoding API. Currently set to Belo Horizonte (-19.9167, -43.9345). |
| `region`, `language` | `BR` and `pt-BR`. |
| `cacheHours` | How long API answers are reused (default 6). |
| `hideAnime` | Optional. Anime is left out of every suggestion row; `false` shows it again. |
| `samsungInput` | Optional, Samsung. `'window'` shows a chosen input full screen inside this app instead of opening the TV's viewer on it. |
| `lite` | Optional. `true`/`false` forces the lite mode for slow TVs (see "Lite mode"); left out, it follows the browser version. |

To tie a streaming service to an app, edit `tmdb` on the app's entry in `js/apps-data.js` (TMDB provider ids and normalized names). The current BR ids, checked against TMDB's `/watch/providers` list: Netflix 8 (and 1796 "with Ads"), Prime Video 119 (2100 "with Ads"), Disney+ 337 (Star+ 619 merged into it), HBO Max 1899 (old 384), Globoplay 307, Apple TV 350, Paramount+ 531 / 2303, Crunchyroll 283, Pluto TV 300, YouTube Premium 188.

## Preview in a browser

Serve the folder (`python3 -m http.server` in this folder, then `http://localhost:8000`) or open `index.html` in Chrome. Without `window.tizen` the app list comes from mock data, launches are simulated, and:

- with a `tmdbToken` in `js/config.local.js`, the suggestions use the **real TMDB data and images**, the same code path as the TV (TMDB and image.tmdb.org send CORS headers). If a TMDB request fails (offline, no cache), that call falls back to the bundled sample catalogue.
- without a token, or with `?mock` in the URL, everything comes from `js/mock-data.js` (sample titles, gradient posters, the abstract backdrops in `mock/`) and fixed weather, with no network at all.

Keys: arrows to move, Enter for the details (hold Enter to open the title in its app), Esc or Backspace for Back, `G` for Green ("Já vi"), `Y` for Yellow (undo the last "Já vi" while its toast shows; otherwise the IDs screen), `R` for Red (menu), `B` for Blue (all apps), `I` for Info (details on a poster), `S` or `/` for Buscar (then letters type, Backspace deletes). The sample catalogue has a few people (Fernanda Torres, Christopher Nolan, …) and one anime title (hidden by `hideAnime`) to try the search.

## On the TV

| Button | Action |
|---|---|
| Up / Down | Move in the app list; it loops (Down on the last app goes to the first; Up on the first goes to the top bar, and Up again to the last app). In the posters: change rows, the same way (Up on the first row: the top bar, then the last row) |
| Left / Right in the top bar | Buscar, Entradas, Wi-Fi, Ajustes; OK opens; Down or Back returns |
| In Buscar | Arrows move over the filters, the keyboard and the results; OK types a key, opens a filter's list or a title's details; Hold OK on a title opens it in its app; Back closes the list / the person / the search |
| Red | Opens the bottom-right menu from anywhere (R in a browser); Red, Up, Left from its first item or Back returns to where you were |
| Green | On a poster: "Já vi" (every press marks the focused title) |
| Yellow | While the "Já vi" toast shows: undo the last mark. Otherwise: the IDs screen (below) |
| Right / Left | From the list, Right goes to the posters. In a row, Left/Right move; Left from the first poster goes back to the list |
| OK | On a poster: the details ("Abrir em …", "Quero ver", "Assistindo", "Já vi"); in the details, activates the focused button; on an app or menu item, opens it |
| Hold OK | On a poster: opens the title in its app (the "Abrir em…" chooser when it is on several) |
| Info | On a poster: the details, like OK |
| Back | Closes the details/chooser; from the posters or the menu, back to where you were / the list; from the other screens, back to the home screen; on the home list it does nothing |
| Blue | Shows or hides "Todos os apps" |
| Yellow (no "Já vi" toast) or Info on the list | "IDs dos apps": every ID the TV reports, including hidden ones. Use it to fix the IDs in `js/apps-data.js` |

## Files

- `config.xml`: the Tizen widget config. Package `TvHome0001`, app `TvHome0001.Home`, profile `tv-samsung`. Privileges `application.launch`, `application.info`, `tv.inputdevice` and `internet`. A packaged Tizen app reaches only the origins in its `<access>` elements (W3C WARP), so it lists `https://api.themoviedb.org`, `https://image.tmdb.org`, `https://www.omdbapi.com`, `https://api.open-meteo.com` and `https://geocoding-api.open-meteo.com`. There is no `tizen:content-security-policy` element: the app needs no inline scripts and no `eval`, so one can be added later without code changes.
- `js/apps-data.js`: the background photos and their schedule, the curated app list and its order, the known IDs, each app's glyph and TMDB providers, the TV and Settings entries, and the system-app filters. **Edit this file to configure the app list.**
- `js/config.local.example.js` / `js/config.local.js`: keys and place (see above).
- `js/platform.js`: the platform layer, chosen at runtime: Tizen API calls, LG webOS Luna calls (through `PalmServiceBridge`, the way LG's webOSTV.js does it), or the browser mock; the remote's key codes; the lite mode.
- `js/store.js`: `localStorage` helpers (every access wrapped in try/catch) and the API cache with TTL.
- `js/smart.js`: pure logic, also run by node: provider-to-app mapping, the history model (with per-type filters), the taste profile, "Para você" ranking, the mood rows, and the "Já vi" mark/undo.
- `js/catalog.js`: TMDB v3 (`discover/movie`, `discover/tv` with `watch_region=BR`, `with_watch_monetization_types=flatrate`, `with_watch_providers`, vote and runtime filters, `with_type=2` for miniseries; `/{type}/{id}?append_to_response=watch/providers,external_ids`; `/{type}/{id}/recommendations`; `/genre/{type}/list`), OMDb, caching, at most 4 requests at a time. Posters are `w342`, backdrops `w1280`.
- `js/mock-data.js`: the sample catalogue for the browser preview.
- `js/weather.js`: Open-Meteo and the weather icons (inline SVG).
- `js/discover.js`: the rows, the hero, the details overlay and the chooser.
- `js/search.js`: the Buscar screen (query, filters, on-screen keyboard, result rows).
- `js/app.js`: the app list, the film/series row pairs, focus zones, keys, menu, history updates, backgrounds, clock and weather.
- **Speed on the TV** (`js/discover.js`): moving focus does no network and no layout reads. Each row is fetched once per installed app (`with_watch_providers` with that app's ids), so every title arrives tagged with the apps it is on. Runtime, genres, IMDb and the availability of "Para você" recommendations come from a background queue (2 requests at a time, paused while keys are pressed, cached 6 h). One shared focus ring and the row tracks move with `translate3d`; key repeats only update the model and the DOM is updated once per animation frame; only the current row ±1 is in the DOM, each with about 11 cards, and images are set only on those cards. Hero text waits 200 ms after focus settles, the backdrop 450 ms. Posters are w185 (w342 in the details), backdrops w780. A background refresh never reorders cards already on screen.
- `css/style.css`: the layout at 1920x1080. No `backdrop-filter` or blur (the TV is slow): the glass is plain rgba fills, and only `transform`/`opacity` animate. Cards have no shadows, filters or focus restyling; the focus ring is a separate element.
- `img/*.jpg`: the six background photos, 1920x1080, each about 300 KB or less.
- `mock/bd-*.jpg`: abstract backdrops for the sample catalogue (browser only; regenerate with `python3 tools/make_mock.py`).
- `fonts/inter-latin-400.woff2`, `fonts/inter-latin-600.woff2`: Inter, Latin subset; `fonts/OFL.txt` is its licence.
- `icon.png`: the launcher icon, the name as the logo like the streaming apps' tiles: "Matinê" in Inter ExtraBold, warm cream on a deep plum gradient, with a short amber-to-rose bar under it. 512x423, 24-bit RGB PNG, full bleed, as Samsung asks for TV app icons.
- `webos/appinfo.json`, `webos/icon.png` (80x80), `webos/largeIcon.png` (130x130): the LG package files. `python3 tools/make_icon.py` (needs Pillow) draws all three icons, each for its own size (4x supersampled), with `tools/fonts/inter-latin-800-normal.woff` (Inter, OFL, used only for the icons, not packaged); `--preview DIR` also writes previews on dark and light backgrounds. Raise `version` in `webos/appinfo.json` when the icon changes, or the LG launcher keeps the old one.
- The app is named **Matinê** (`config.xml` `<name>`, `webos/appinfo.json` `title`, the page title). The ids stay `TvHome0001.Home` (Samsung) and `com.marcus.tvhome` (LG), so a new build installs over the old one and whatever launches the app by id (LG Home Helper, "Autorun Last App") still finds it.
- `tools/build-webos.sh`: builds the LG `.ipk` (see "LG TVs (webOS)").
- `tools/test-smart.js`: unit checks for `js/smart.js` (`node tools/test-smart.js`), including the provider mapping against the real BR provider list, the search rows and filters, and the search requests `js/catalog.js` builds.

## Credits

- Film and series data and images: [TMDB](https://www.themoviedb.org). **This product uses the TMDB API but is not endorsed or certified by TMDB.** The app shows this notice (in Portuguese) in the details overlay and in "Minha lista".
- Watch-provider data: JustWatch, through TMDB.
- IMDb scores (optional): [OMDb API](https://www.omdbapi.com).
- Weather and geocoding: [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Background photos, all CC0 1.0 (public domain), from Wikimedia Commons; cropped to 16:9, softened slightly and recompressed:
  - `img/yosemite-dusk.jpg`: "Yosemite Valley (Unsplash)" by Matthias Mullie. https://commons.wikimedia.org/wiki/File:Yosemite_Valley_(Unsplash).jpg
  - `img/yosemite-day.jpg`: "“Tunnel View” overlook showing famous rock formations in Yosemite Valley 01" by EF5. https://commons.wikimedia.org/wiki/File:%E2%80%9CTunnel_View%E2%80%9D_overlook_showing_famous_rock_formations_in_Yosemite_Valley_01.jpg
  - `img/dawn-aoraki.jpg`: "Aoraki Sunrise (Unsplash)" by Aleks Dahlberg. https://commons.wikimedia.org/wiki/File:Aoraki_Sunrise_(Unsplash).jpg
  - `img/day-valley.jpg`: "Sunrise over tropical valley (Unsplash)" by Gez Xavier Mansfield. https://commons.wikimedia.org/wiki/File:Sunrise_over_tropical_valley_(Unsplash).jpg
  - `img/night-milkyway.jpg`: "Milky Way Lake Mountains (Unsplash)" by Andrew Coelho. https://commons.wikimedia.org/wiki/File:Milky_Way_Lake_Mountains_(Unsplash).jpg
  - `img/night-tatras.jpg`: "Starry sky over the Tatras (Unsplash)" by Štefan Štefančík. https://commons.wikimedia.org/wiki/File:Starry_sky_over_the_Tatras_(Unsplash).jpg
- Inter by The Inter Project Authors (https://github.com/rsms/inter), SIL Open Font License 1.1 (`fonts/OFL.txt`). The woff2 Latin subsets come from the Fontsource package `@fontsource/inter` 5.1.0.

## Packaging (done by someone else)

```
tizen build-web -e ".*" -e "README.md" -e "tools/*" -e "mock/*" -e "webos/*" -e "js/config.local.example.js" -- <this folder>
tizen package -t wgt -s <profile> -- <this folder>/.buildResult
```

`js/config.local.js` must be in the folder when you build, or the package has no suggestions. The Tizen CLI may need the folder to be imported into, or created as, a Tizen web project first. Signing, the certificate profile and installing on the TV are outside this repo.

## LG TVs (webOS)

The same files run on LG webOS TVs. `js/platform.js` detects webOS (`window.PalmSystem` / `PalmServiceBridge`, user agent `Web0S`) and then:

- **App list.** It asks `luna://com.webos.applicationManager/listLaunchPoints`, then `listApps`. LG documents neither for third-party apps, and on webOS 6 and later a Developer Mode app gets `Denied method call "listLaunchPoints"`: those methods are not in the "public" security group that dev-mode apps get ([LG forum](https://forum.webostv.developer.lge.com/t/denied-method-call-listapps-for-category/8572), [free-my-tv PR 96](https://github.com/simbasjungles/free-my-tv/pull/96), [webosbrew: Luna bus](https://www.webosbrew.org/pages/luna-service-bus.html)). When both are refused, the list is built from the `webos` ids in `js/apps-data.js`: each is checked with `getAppLoadStatus` (public, webOS 4.0+, [LG docs](https://webostv.developer.lge.com/develop/references/application-manager)) and only installed apps are shown. "Todos os apps" is then empty, and the IDs screen (yellow) says "lista fixa". On the 2018 TV (webOS 4.x) listing may still work; the IDs screen shows which call answered ("Fonte: listLaunchPoints").
- **Launch.** `luna://com.webos.applicationManager/launch` with `{ id }` (public API).
- **Keys.** Back is 461 (`appinfo.json` has `"disableBackHistoryAPI": true`, so the app gets it), Red/Green/Yellow/Blue 403/404/405/406. 457 is used for Info, but LG does not document an Info key; the Magic Remote may have none. Use OK for the details.
- **Coming back.** `visibilitychange`, and `webOSRelaunch` (the app is launched again while running; it calls `PalmSystem.activate()`) reload the list and focus it.
- **Network.** No WARP list on webOS; TMDB, OMDb and Open-Meteo send CORS headers.
- webOSTV.js is not bundled: `platform.js` calls `PalmServiceBridge` directly, the same way `webOS.service.request` does. If `js/vendor/webOSTV.js` is added (LG's download: https://webostv.developer.lge.com/assets/library/webOSTVjs-1.2.13.zip) and loaded before `platform.js`, it is used instead.

### Lite mode (the 2018 TV)

The 2018 TV (webOS 4.x) runs Chromium 53 on a slow CPU. All JS is ES5, and all CSS works on Chromium 53. Check it with `npx esbuild --target=chrome53` or acorn with `ecmaVersion: 5`. Lite mode turns on by itself when the user agent's Chromium is older than 68 (webOS 4.x and older, Tizen 5.0 and older). It can also be forced with `?lite` / `?nolite` or `lite: true|false` in `js/config.local.js`. In lite mode:

- posters are `w154` in the rows and `w185` in the details;
- backgrounds and title backdrops change at once, with no crossfade, and the backdrop waits 800 ms after focus settles;
- tiles, posters, the hero text and the menu change at once (no fades, no lift animation; the focused tile and poster are still scaled, with their shadow), and the posters are not given their own compositor layers (the GPU memory is small);
- the glass panels are solid (Chromium 53 has no `backdrop-filter`), and the poster rows do not preload the neighbours' artwork;
- only the current and the next row are in the DOM, with one spare card on each side;
- the background prefetch fetches details for 4 cards per row.

### Install on the TVs

The two TVs are the LG 86QNED73ASA (2025, webOS 25, Chromium 120) at 192.168.100.17 and the LG SM8600PSA (2018, webOS 4.x, Chromium 53) at 192.168.100.18.

**Once on each TV:**

1. Create an LG account at https://webostv.developer.lge.com (Sign in → create account) and sign in with it on the TV.
2. On the TV, open LG Content Store / Apps, search for **Developer Mode** and install it.
3. Open Developer Mode, sign in with the LG account, and turn **Dev Mode Status** on. The TV restarts.
4. Open Developer Mode again and turn **Key Server** on. Note the **Passphrase** it shows: 6 characters, case-sensitive.

**Once on the Mac:** the LG CLI, installed locally rather than globally. The current `@webos-tools/cli` (3.2.x) needs Node 20 or newer.

```sh
mkdir -p ~/.webos-cli && cd ~/.webos-cli && echo '{"private":true}' > package.json && npm i @webos-tools/cli
export PATH="$HOME/.webos-cli/node_modules/.bin:$PATH"

ares-setup-device -a lg86   -i "{'username':'prisoner','host':'192.168.100.17','port':'9922'}"
ares-setup-device -a lg2018 -i "{'username':'prisoner','host':'192.168.100.18','port':'9922'}"
ares-novacom --device lg86 --getkey      # enter that TV's passphrase
ares-novacom --device lg2018 --getkey
ares-device --system-info --device lg86  # checks the connection
```

**Build and install:**

```sh
tools/build-webos.sh                     # -> ../webos-build/com.marcus.tvhome_1.0.0_all.ipk
ares-install --device lg86   ../webos-build/com.marcus.tvhome_1.0.0_all.ipk
ares-install --device lg2018 ../webos-build/com.marcus.tvhome_1.0.0_all.ipk
ares-launch  --device lg86 com.marcus.tvhome
ares-inspect --device lg86 --app com.marcus.tvhome --open   # remote Web Inspector
```

`tools/build-webos.sh` copies the app (with `js/config.local.js`, without `mock/`, `tools/`, README and the Samsung files) into `../webos-build/app` and runs `ares-package`. Raise `version` in `webos/appinfo.json` when you reinstall over an older build, if the TV refuses the install.

**The developer session.** A Developer Mode session lasts about 50 hours. The Developer Mode app shows "Remain Session"; press **Extend** before it runs out (the TV must be online). If it expires, the TV removes the developer apps and you install again. Community tools such as Home Assistant automations (https://elis.nu/blog/2022/07/keeping-webos-developer-mode-alive-with-home-assistant/) extend it automatically.

**Limits on LG.** The app cannot replace LG's Home button or launcher; it is an app you open (for example pinned first in the launcher bar). `appinfo.json` declares `requiredACG` (`application.launcher`, `application.query`), which webOS 26 and later use. Older webOS ignores the field.
