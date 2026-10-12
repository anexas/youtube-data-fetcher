# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Commands
- Run application: `node index.js` (no `npm start` script configured in `package.json`; listens on `PORT` or 3000).
- Tests / Lint: None configured.

## Environment & Secrets
- Requires `YOUTUBE_API_KEY` in `.env` in the project root.
- `.env`, `data/`, and `*.log` are gitignored; keep credentials out of the public repo.

## Storage & Routing Gotchas
- Playlist cache: Stored as individual JSON files in `data/<playlistId>.json` using `{ playlistUrl, playlistTitle, videos: [{ title, url, embedUrl }] }`.
- Static assets: `/js`, `/css`, and `/html` (serving `favicon.ico`, `yt.png`, etc.) are exposed via `express.static()`.
- URL parsing: `getPlaylistIdFromUrl` in `js/youtube.js` extracts IDs solely from `list=` query parameters (`/[&?]list=([^&]+)/i`).
