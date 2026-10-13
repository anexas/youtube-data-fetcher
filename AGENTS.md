# AGENTS.md

Single source of truth for agents working in this repository. (User-facing docs live in
[README.md](README.md); this file is the authoritative reference for code conventions.)

## What this project is
A small Node/Express web app ("YouTube Data Fetcher") that takes a YouTube playlist URL,
fetches the playlist title and all of its videos via YouTube Data API v3, caches the result
as a JSON file on disk, and renders it in a browser UI with view filters and an inline player.

## Key code map
- [index.js](index.js) — Express server, all HTTP routes, playlist listing/loading.
- [js/youtube.js](js/youtube.js) — YouTube API client, URL parsing, fetch + disk cache.
- [js/client.js](js/client.js) — Browser logic: fetch calls, rendering, filters, click-to-play.
- [html/index.html](html/index.html) — Single page UI (form, saved-playlist dropdown, player, output divs).
- [css/styles.css](css/styles.css) — Styles. [html/favicon.ico](html/favicon.ico) is the site icon.
- `data/*.json` — Cached playlists, one file per playlist ID (gitignored).

## Commands
- Install: `npm install`
- Run: `node index.js` — there is no `npm start` script. Listens on `process.env.PORT` or `3000`;
  open http://localhost:3000.
- Docker: `docker compose up` (see [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml)).
- Tests: `npm test` runs `node --test` over `test/*.test.js`.
- Lint / build / typecheck: none configured.

## Environment & secrets
- Requires `YOUTUBE_API_KEY` in a `.env` file at the project root (loaded by `dotenv`).
- `.env`, `data/`, and `*.log` are gitignored. This repository is PUBLIC, so the key must never
  be committed: if `.env` ever appears staged, stop and unstage it.
- `.env` is excluded from the Docker build context via [.dockerignore](.dockerignore) and injected
  at runtime by `docker compose` (`env_file`), so it is not baked into images.
- Optional tunables, all read once at startup: `PORT`, `RATE_LIMIT_WINDOW_MS` (default 900000),
  `RATE_LIMIT_MAX` (default 100, the budget for all of `/api`), `FETCH_RATE_LIMIT_MAX`
  (default 20, the tighter budget for the quota-spending `/api/fetch-playlist`), and
  `TRUST_PROXY=true` to honor `X-Forwarded-For` when a reverse proxy sits in front.

## HTTP API
- `GET  /` — serves the SPA page.
- `GET  /api/playlists` — lists saved playlists as `{ title, url }`; returns an empty list if
  the `data/` directory does not exist yet, and skips individual unreadable files.
- `POST /api/load-playlist` — reads `data/<playlistId>.json` for the given URL; 400 for an
  unusable body or playlist ID, 404 if absent, 500 if the saved file is corrupt.
- `POST /api/fetch-playlist` — fetches from the YouTube API, writes the cache file, returns data.
- Every response under `/api` is JSON, including unknown API paths and every error path.
- Status codes in play: 400 (validation), 404 (missing), 413 (body over 10 KB), 429 (rate limit),
  500 (upstream or disk failure).

## Storage format & conventions
- Cache file path: `data/<playlistId>.json`, content:
  `{ playlistUrl, playlistTitle, videos: [{ title, url, embedUrl }] }`
  (`embedUrl` is the iframe form, `url` is the watch form).
- `getPlaylistIdFromUrl` extracts the ID ONLY from a `list=` query parameter
  (`/[&?]list=([^&]+)/i`) — bare IDs or `/playlist/PL...` paths will not work.
- The captured value is then checked against `/^[A-Za-z0-9_-]{10,100}$/` and is deliberately NOT
  percent-decoded: that pattern is what keeps a value like `../secret` from becoming a path.
  Anything failing it (including a too-short `list=WL`) is rejected with 400. Non-string input
  returns `null` rather than throwing.
- Writes are atomic: `saveDataToJson` writes to `data/.<playlistId>.<pid>.<timestamp>.tmp` and
  renames it over the target, so a reader never sees a half-written file. The `.tmp` suffix also
  keeps the temporary file out of the `/api/playlists` listing.
- Pagination: `getPlaylistData` loops `playlistItems.list` at `maxResults: 50`, following
  `nextPageToken` until exhausted.
- Static mounts: `/js` → `js/` and `/css` → `css/`. The `html/` directory is mounted at the
  site ROOT via `express.static`, so `favicon.ico` resolves at `/favicon.ico` — there is no
  `/html` URL prefix.
- Client sends `Content-Type: application/json`; the server parses with `express.json()`.

## Tests
- `npm test` is `node --test`, which runs each `test/*.test.js` file in its own process. A file
  may therefore set environment variables before requiring the app.
- [test/youtube.test.js](test/youtube.test.js) — playlist ID validation and atomic cache writes.
- [test/api.test.js](test/api.test.js) — routes, status codes, headers, traversal, error bodies.
- [test/rate-limit.test.js](test/rate-limit.test.js) — both rate-limit budgets.
- [test/client.test.js](test/client.test.js) — jsdom, proving the client renders playlist data as text.
- Two hooks exist for the tests and should stay: `index.js` exports the app and only listens when
  run directly (`require.main === module`), and `DATA_DIR` overrides where the cache lives.
- Nothing in the suite needs the network or a real API key: `getPlaylistData` is replaced with a
  stub and all fixtures live in a temporary directory, never in `data/`.
- `jsdom` is a devDependency used only by the client suite; production dependencies are unchanged.

## Gotchas
- Server code is CommonJS (`require`), not ESM. Files are stored LF in git; the app sources use
  CRLF, so match the surrounding file's endings when editing.
- Inline player coupling: `js/client.js` renders `.video-item` elements carrying `data-embed-url`
  and drives `singlePlayerContainer` / `videoPlayer` in the markup. Keep the two in sync — if you
  change one and not the other, the player silently does nothing.
- The client decides saved-vs-new by comparing the dropdown value to the URL input value; keep
  that coupling in mind when editing form behavior in [js/client.js](js/client.js).
- Security middleware is `helmet` plus two `express-rate-limit` instances (general `/api`, and a
  tighter one on `/api/fetch-playlist`). The CSP needs `frame-src https://www.youtube.com` or the
  player silently stops working, and it omits `upgrade-insecure-requests` because the app is
  normally served over plain HTTP.
- The player also needs a **referrer**: helmet defaults to `Referrer-Policy: no-referrer`, which
  makes the iframe navigate to YouTube with no `Referer` at all, and YouTube answers with
  "Error 153: Video player configuration error" instead of the video. `index.js` therefore sets
  `referrerPolicy: 'strict-origin-when-cross-origin'` (only the origin is sent), the iframe in
  [html/index.html](html/index.html) carries the same `referrerpolicy` attribute as a second line
  of defence, and `test/api.test.js` asserts the header so a helmet upgrade cannot silently
  reintroduce the break.
- The browser is never sent `innerHTML`-able data by accident: `js/client.js` sets every value with
  `textContent`, and writes an `href` or `data-embed-url` only when the value matches its
  `WATCH_URL_PATTERN` / `EMBED_URL_PATTERN`. Titles and URLs are third-party data — keep it that way.
- Messages leaving the server through an error path pass `redactSecrets`, which strips the API key
  and any `key=` parameter. Route new error paths through it too.
- Keep the dependency list honest: `blessed` was removed after being unused.
