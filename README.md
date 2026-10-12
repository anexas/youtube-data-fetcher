# YouTube Data Fetcher

A small Node.js and Express web application that fetches the title and full video list of a
public YouTube playlist, saves it locally as a JSON file, and lets you browse and play the
results in the browser — including loading previously saved playlists without hitting the
YouTube API again.

## Features

- **Fetch Playlist Data**: Enter a YouTube playlist URL to fetch its title and a list of all videos it contains.
- **Inline Video Player**: Click any video in the list to play it immediately in an embedded player on the page.
- **View Filters**: Switch the video list between Title, URL, Embed URL, or All fields.
- **Save Data Locally**: Fetched playlist data is automatically saved as a `.json` file in `data/`, named after the playlist ID.
- **List Saved Playlists**: The app automatically lists every playlist that has been fetched and saved.
- **Load from Cache**: Load a saved playlist straight from its local file without calling the YouTube API again.
- **Simple Web Interface**: One page covering fetching, saved-playlist selection, filtering, and playback.

## Project Structure

```
youtube-data-fetcher/
├── data/                  # Saved playlist JSON files (auto-created, gitignored)
├── css/
│   └── styles.css         # Stylesheet for the frontend
├── html/
│   ├── index.html         # Single-page UI
│   └── favicon.ico        # Site icon (served at the site root)
├── js/
│   ├── youtube.js         # Core logic for YouTube API interaction and disk cache
│   └── client.js          # Frontend JavaScript for index.html
├── .env                   # Environment variables (create locally; gitignored)
├── .dockerignore          # Files to exclude from the Docker build context
├── .gitignore
├── docker-compose.yml     # Docker Compose configuration
├── Dockerfile             # Docker image definition
├── index.js               # Main Express server file
├── package.json           # Project dependencies and scripts
├── package-lock.json
├── AGENTS.md              # Code conventions and architecture notes for agents
└── README.md              # This documentation file
```

## Prerequisites

- **Node.js 18 or newer** (the dependencies require Node >= 18; the Docker image uses Node 20).
- A **YouTube Data API v3 Key** from the [Google Cloud Console](https://console.cloud.google.com/).

## Installation and Setup

(Also see [Docker Setup](#docker-setup) below.)

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd youtube-data-fetcher
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Create a file named `.env` in the project root and add your YouTube API key. The
    `youtube.js` module uses this key for requests.

    ```
    YOUTUBE_API_KEY=YOUR_API_KEY_HERE
    ```

    > `.env` is gitignored — keep it that way. This repository is public, so the key must never
    > be committed.

4.  **Start the server:**
    ```bash
    node index.js
    ```

    There is no `npm start` script. The server listens on port `3000` by default, or on `PORT`
    if that environment variable is set:

    ```bash
    PORT=8080 node index.js
    ```

    You should see the following output in your console:
    ```
    YouTube Data Fetcher web app running at http://localhost:3000
    Open your web browser and navigate to this address.
    ```

    The `data/` directory is created automatically the first time a playlist is fetched, so
    there is nothing to set up by hand.

## Docker Setup

You can also run the application with Docker and Docker Compose.

1.  **Prerequisites:**
    - Docker installed on your machine.
    - Docker Compose (usually included with Docker Desktop).

2.  **Configuration:**
    Ensure the `.env` file with your `YOUTUBE_API_KEY` exists as described above. Also ensure a
    local `data` directory exists, so the bind mount below does not get created as root-owned:

    ```bash
    mkdir -p data
    ```

    The API key is not baked into the image — `.env` is listed in `.dockerignore` and injected at
    runtime by Compose.

3.  **Build and run:**
    ```bash
    docker compose up --build -d
    ```

    The application will be available at `http://localhost:3000`. The local `./data` folder is
    mounted into the container, so saved playlists persist even if the container is stopped or
    removed.

4.  **View logs (optional):**
    ```bash
    docker compose logs -f
    ```

5.  **Stop the application:**
    ```bash
    docker compose down
    ```

## API Endpoints

All endpoint requests and responses use JSON. When sending a request body, set
`Content-Type: application/json`.

### `GET /`

- **Description**: Serves the main homepage (`html/index.html`).
- **Response**: The HTML content of the main page.

### `GET /api/playlists`

- **Description**: Retrieves a list of all playlists saved locally in `data/`. If the `data/`
  directory does not exist yet, this returns an empty list rather than an error.
- **Response**:
  - **On Success**: `200 OK`
    ```json
    {
      "success": true,
      "playlists": [
        { "title": "Playlist Title 1", "url": "https://youtube.com/playlist?list=PL..." },
        { "title": "Playlist Title 2", "url": "https://youtube.com/playlist?list=PL..." }
      ]
    }
    ```
  - **On Error**: `500 Internal Server Error` if the directory exists but cannot be read.

### `POST /api/load-playlist`

- **Description**: Loads playlist data from a local JSON file based on the provided playlist URL.
- **Request Body**:
  ```json
  { "url": "https://www.youtube.com/playlist?list=PLAYLIST_ID" }
  ```
- **Response**:
  - **On Success**: `200 OK` with the playlist data and the path of the file it was read from.
    ```json
    {
      "success": true,
      "playlistData": { ... },
      "savedFilePath": "data/PLAYLIST_ID.json"
    }
    ```
  - **On Error**: `400 Bad Request` for an invalid URL, or `404 Not Found` if no saved file exists
    for that playlist ID.

### `POST /api/fetch-playlist`

- **Description**: Fetches playlist data from the YouTube API using the provided URL, saves it to
  a local JSON file, and returns the data.
- **Request Body**:
  ```json
  { "url": "https://www.youtube.com/playlist?list=PLAYLIST_ID" }
  ```
- **Response**:
  - **On Success**: `200 OK` with the fetched playlist data and the path to the saved file.
    ```json
    {
      "success": true,
      "playlistData": { ... },
      "savedFilePath": "data/PLAYLIST_ID.json",
      "message": "Data fetched and saved successfully."
    }
    ```
  - **On Error**: `400 Bad Request` for a missing or invalid URL, or `500 Internal Server Error`
    if the YouTube API fetch fails.

## Notes

- Only public playlists can be fetched; a private or nonexistent playlist ID results in an error.
- The playlist ID is read exclusively from the `list=` query parameter of the URL, so links such
  as `https://www.youtube.com/playlist?list=PL...` or
  `https://www.youtube.com/watch?v=...&list=PL...` both work.
- There are no automated tests configured (`npm test` is the default placeholder).
- For code conventions, storage format, and architecture, see [AGENTS.md](AGENTS.md).
