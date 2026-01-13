# YouTube Data Fetcher

A simple Node.js and Express web application that allows users to fetch metadata and video details for a public YouTube playlist, save it locally as a JSON file, and view previously saved playlists.

## Features

- **Fetch Playlist Data**: Enter a YouTube playlist URL to fetch its title, description, and a list of all videos it contains.
- **Save Data Locally**: The fetched playlist data is automatically saved into a `.json` file in the `data/` directory, named after the playlist ID.
- **List Saved Playlists**: The application automatically lists all playlists that have been previously fetched and saved.
- **Load from Cache**: You can load the data for a saved playlist directly from its local file without needing to fetch it from YouTube again.
- **Simple Web Interface**: An easy-to-use web page to interact with the backend services.

## Project Structure

```
youtube-data-fetcher/
├── data/                  # Directory for storing saved playlist JSON files
├── css/                   # Stylesheets for the frontend
│   └── styles.css         # Main CSS file for styling
├── html/                  # HTML files for the frontend
│   └── index.html
├── js/
│   ├── youtube.js         # Core logic for YouTube API interaction
│   └── client.js          # Frontend JavaScript for index.html
├── .env                   # Environment variables (e.g., API keys)
├── .dockerignore          # Files to exclude from Docker context
├── docker-compose.yml     # Docker Compose configuration
├── Dockerfile             # Docker image definition
├── index.js               # Main Express server file
├── package.json           # Project dependencies and scripts
└── README.md              # This documentation file
```

## Prerequisites

- Node.js (v14 or newer recommended)
- A **YouTube Data API v3 Key**. You can obtain one from the Google Cloud Console.

## Installation and Setup (also see Docker Setup below)

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
    Create a file named `.env` in the root of the project directory and add your YouTube API key. The `youtube.js` module will use this key to make requests.

    ```
    YOUTUBE_API_KEY=YOUR_API_KEY_HERE
    ```

4.  **Create Data Directory:**
    Create a directory named `data` in the root of the project to store the JSON files.
    ```bash
    mkdir data
    ```

5.  **Start the server:**
    ```bash
    node index.js
    ```

    You should see the following output in your console:
    ```
    YouTube Data Fetcher web app running at http://localhost:3000
    Open your web browser and navigate to this address.
    ```

## Docker Setup

You can also run the application using Docker and Docker Compose.

1.  **Prerequisites:**
    - Docker installed on your machine.
    - Docker Compose installed (often included with Docker Desktop).

2.  **Configuration:**
    Ensure you have created the `.env` file with your `YOUTUBE_API_KEY` as described in the installation steps above.
    Also, ensure the `data` directory exists locally to avoid permission issues when mounted:
    ```bash
    mkdir data
    ```

3.  **Run the Application:**
    Open your terminal in the project root and run:
    ```bash
    docker-compose up --build -d
    ```
    The application will be available at `http://localhost:3000`. The `./data` folder is mounted to the container, ensuring your saved playlists persist even if the container is stopped or removed.

4.  **View Logs (Optional):**
    To view the application logs in real-time, run:
    ```bash
    docker-compose logs -f
    ```

5.  **Stop the Application:**
    To stop and remove the containers, run:
    ```bash
    docker-compose down
    ```

## API Endpoints

The application exposes several API endpoints to handle different functionalities.

### `GET /`

- **Description**: Serves the main homepage (`html/index.html`).
- **Response**: The HTML content of the main page.

### `GET /api/playlists`

- **Description**: Retrieves a list of all playlists that have been saved locally in the `data/` directory.
- **Response**: A JSON object containing a list of playlists.
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
  - **On Error**: `500 Internal Server Error` if the directory cannot be read.

### `POST /api/load-playlist`

- **Description**: Loads playlist data from a local JSON file based on the provided playlist URL.
- **Request Body**:
  ```json
  { "url": "https://www.youtube.com/playlist?list=PLAYLIST_ID" }
  ```
- **Response**:
  - **On Success**: `200 OK` with the playlist data.
  - **On Error**: `400 Bad Request` for an invalid URL or `404 Not Found` if the local file doesn't exist.

### `POST /api/fetch-playlist`

- **Description**: Fetches playlist data from the YouTube API using the provided URL, saves it to a local JSON file, and returns the data.
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
      "savedFilePath": "data\\PLAYLIST_ID.json",
      "message": "Data fetched and saved successfully."
    }
    ```
  - **On Error**: `400 Bad Request` for a missing or invalid URL, or `500 Internal Server Error` if the YouTube API fetch fails.