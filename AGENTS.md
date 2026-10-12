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
- Tests: none configured — `npm test` is the default failing placeholder.
- Lint / build / typecheck: none configured.

## Environment & secrets
- Requires `YOUTUBE_API_KEY` in a `.env` file at the project root (loaded by `dotenv`).
- `.env`, `data/`, and `*.log` are gitignored. This repository is PUBLIC, so the key must never
  be committed: if `.env` ever appears staged, stop and unstage it.
- `.env` is excluded from the Docker build context via [.dockerignore](.dockerignore) and injected
  at runtime by `docker compose` (`env_file`), so it is not baked into images.

## HTTP API
- `GET  /` — serves the SPA page.
- `GET  /api/playlists` — lists saved playlists as `{ title, url }`; returns an empty list if
  the `data/` directory does not exist yet.
- `POST /api/load-playlist` — reads `data/<playlistId>.json` for the given URL; 404 if absent.
- `POST /api/fetch-playlist` — fetches from the YouTube API, writes the cache file, returns data.

## Storage format & conventions
- Cache file path: `data/<playlistId>.json`, content:
  `{ playlistUrl, playlistTitle, videos: [{ title, url, embedUrl }] }`
  (`embedUrl` is the iframe form, `url` is the watch form).
- `getPlaylistIdFromUrl` extracts the ID ONLY from a `list=` query parameter
  (`/[&?]list=([^&]+)/i`) — bare IDs or `/playlist/PL...` paths will not work.
- Pagination: `getPlaylistData` loops `playlistItems.list` at `maxResults: 50`, following
  `nextPageToken` until exhausted.
- Static mounts: `/js` → `js/` and `/css` → `css/`. The `html/` directory is mounted at the
  site ROOT via `express.static`, so `favicon.ico` resolves at `/favicon.ico` — there is no
  `/html` URL prefix.
- Client sends `Content-Type: application/json`; the server parses with `express.json()`.

## Gotchas
- Server code is CommonJS (`require`), not ESM. Files are stored LF in git; the app sources use
  CRLF, so match the surrounding file's endings when editing.
- Inline player coupling: `js/client.js` renders `.video-item` elements carrying `data-embed-url`
  and drives `singlePlayerContainer` / `videoPlayer` in the markup. Keep the two in sync — if you
  change one and not the other, the player silently does nothing.
- The client decides saved-vs-new by comparing the dropdown value to the URL input value; keep
  that coupling in mind when editing form behavior in [js/client.js](js/client.js).
- No error-handling middleware and no rate limiting; API errors are surfaced verbatim to the
  browser via `error.message`.
- Keep the dependency list honest: `blessed` was removed after being unused.
