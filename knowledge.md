# knowledge.md

High-signal notes about this repository for agents and contributors.

## What this project is
A small Node/Express web app ("YouTube Data Fetcher") that takes a YouTube playlist URL,
fetches the playlist title and all of its videos via YouTube Data API v3, caches the result
as a JSON file on disk, and renders it in a browser UI with view filters and an inline player.
See [README.md](README.md) for the user-facing documentation (incl. Docker setup).

Key code:
- [index.js](index.js) — Express server, all HTTP routes, playlist listing/loading.
- [js/youtube.js](js/youtube.js) — YouTube API client, URL parsing, fetch + disk cache.
- [js/client.js](js/client.js) — Browser logic: fetch calls, rendering, filters, click-to-play.
- [html/index.html](html/index.html) — Single page UI (form, saved-playlist dropdown, player, output divs).
- [css/styles.css](css/styles.css) — Styles. [html/favicon.ico](html/favicon.ico) is the site icon.
- `data/*.json` — Cached playlists, one file per playlist ID (gitignored).

## Commands
- Install: `npm install`
- Run: `node index.js` — no `npm start` script exists. Listens on `process.env.PORT` or `3000`.
  Open http://localhost:3000.
- Docker: `docker compose up` (see [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml)).
- Tests: none configured (`npm test` is the default failing placeholder).
- Lint/build: none configured.

## Environment
- Requires `YOUTUBE_API_KEY` in a `.env` file at the project root (loaded by `dotenv`).
- `.env`, `data/`, and `*.log` are gitignored — keep it that way; this repo is public and the
  key must never be committed. If `.env` ever appears staged, stop and unstage it.

## HTTP API
- `GET  /` — serves the SPA page.
- `GET  /api/playlists` — lists saved playlists as `{ title, url }`; returns an empty list if
  the `data/` directory does not exist yet.
- `POST /api/load-playlist` — reads `data/<playlistId>.json` for the given URL; 404 if absent.
- `POST /api/fetch-playlist` — fetches from the YouTube API, writes the cache file, returns data.

## Data format & conventions
- Cache file path: `data/<playlistId>.json`, content:
  `{ playlistUrl, playlistTitle, videos: [{ title, url, embedUrl }] }`
  (`embedUrl` is the iframe form, `url` is the watch form).
- `getPlaylistIdFromUrl` extracts the ID ONLY from a `list=` query parameter
  (`/[&?]list=([^&]+)/i`) — bare IDs or `/playlist/PL...` paths will not work.
- Pagination: `getPlaylistData` loops `playlistItems.list` at `maxResults: 50` following
  `nextPageToken` until exhausted.
- Static mounts: `/js` and `/css` map to their folders; `html/` is also mounted at the site
  root via `express.static`, so `favicon.ico` resolves at `/favicon.ico`. There is no `/html` URL prefix.
- Client sends `Content-Type: application/json`; the server uses `express.json()`.

## Gotchas
- `blessed` is listed in `dependencies` but is unused by application code (dead dependency).
- Server code is CommonJS (`require`), not ESM. Source files use CRLF line endings — match them.
- Inline player coupling: `js/client.js` renders `.video-item` elements carrying `data-embed-url`
  and drives `singlePlayerContainer` / `videoPlayer` in the markup. Keep the two in sync — if you
  change one, change the other, or the player silently does nothing.
- The client decides saved-vs-new by comparing the dropdown value to the URL input value;
  keep that coupling in mind when editing form behavior in [js/client.js](js/client.js).
- No error-handling middleware and no rate limiting; API errors are surfaced verbatim
  to the browser via `error.message`.
