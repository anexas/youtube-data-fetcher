const { google } = require('googleapis');
const fs = require('fs/promises');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// Initialize the YouTube API client
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY,
});

/**
 * Extracts the playlist ID from a YouTube URL.
 * @param {string} url - The full YouTube playlist URL.
 * @returns {string|null} The playlist ID or null if not found.
 */
function getPlaylistIdFromUrl(url) {
    const match = url.match(/[&?]list=([^&]+)/i);
    return match ? match[1] : null;
}

/**
 * Fetches all video items from a given YouTube playlist.
 * Handles pagination to retrieve all videos.
 * @param {string} playlistId - The ID of the playlist.
 * @returns {Promise<object>} An object containing playlist details and a list of videos.
 */
async function getPlaylistData(playlistId) {
    // 1. Get Playlist Metadata (like the title)
    const playlistResponse = await youtube.playlists.list({
        part: 'snippet',
        id: playlistId,
    });

    if (playlistResponse.data.items.length === 0) {
        throw new Error('Playlist not found or is private.');
    }
    const playlistTitle = playlistResponse.data.items[0].snippet.title;

    // 2. Get all video items from the playlist, handling multiple pages
    let allItems = [];
    let nextPageToken = null;

    do {
        const response = await youtube.playlistItems.list({
            part: 'snippet',
            playlistId: playlistId,
            maxResults: 50, // Max allowed per page
            pageToken: nextPageToken,
        });

        allItems = allItems.concat(response.data.items);
        nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    // 3. Format the data
    const videos = allItems.map(item => ({
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
        embedUrl: `https://www.youtube.com/embed/${item.snippet.resourceId.videoId}`,
    }));

    return { playlistTitle, videos };
}

/**
 * Saves the fetched playlist data to a JSON file in the /data directory.
 * @param {string} playlistUrl - The original URL for reference.
 * @param {string} playlistId - The ID of the playlist, used for the filename.
 * @param {object} data - The data object containing playlistTitle and videos.
 */
async function saveDataToJson(playlistUrl, playlistId, data) {
    const content = { playlistUrl, ...data };
    // Use the unique playlist ID for a stable and predictable filename.
    const filePath = path.join(__dirname, '..', 'data', `${playlistId}.json`);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(content, null, 2));
    return filePath;
}

module.exports = { getPlaylistIdFromUrl, getPlaylistData, saveDataToJson };