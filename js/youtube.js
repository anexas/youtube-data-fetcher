const { google } = require('googleapis');
const fs = require('fs/promises');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// Initialize the YouTube API client
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY,
});

const DATA_DIR = path.join(__dirname, '..', 'data');

// Playlist IDs only ever contain these characters. Anything else (a path
// separator, a dot, an encoded escape) is rejected, which is what stops a value
// such as '../secret' from becoming a path outside DATA_DIR.
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;

/**
 * Extracts the playlist ID from a YouTube URL.
 * @param {string} url - The full YouTube playlist URL.
 * @returns {string|null} The playlist ID, or null when the URL is not a string
 * or its `list` parameter is not a well-formed playlist ID.
 */
function getPlaylistIdFromUrl(url) {
    if (typeof url !== 'string') {
        return null;
    }
    const match = url.match(/[&?]list=([^&]+)/i);
    if (!match) {
        return null;
    }
    // Percent-decoding is deliberately skipped: an encoded ID is not a valid ID,
    // and decoding first would reintroduce path separators.
    return PLAYLIST_ID_PATTERN.test(match[1]) ? match[1] : null;
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

    const playlistItems = playlistResponse.data.items || [];
    if (playlistItems.length === 0) {
        throw new Error('Playlist not found or is private.');
    }
    const playlistTitle = playlistItems[0].snippet.title;

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

        allItems = allItems.concat(response.data.items || []);
        nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    // 3. Format the data. Entries the API returns without a usable video id
    // (deleted or unavailable videos) are skipped rather than failing the fetch.
    const videos = allItems
        .filter(item => item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId)
        .map(item => ({
            title: item.snippet.title,
            url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
            embedUrl: `https://www.youtube.com/embed/${item.snippet.resourceId.videoId}`,
        }));

    const skippedCount = allItems.length - videos.length;
    if (skippedCount > 0) {
        console.warn(`Skipped ${skippedCount} playlist entr${skippedCount === 1 ? 'y' : 'ies'} without a usable video ID.`);
    }

    return { playlistTitle, videos };
}

/**
 * Saves the fetched playlist data to a JSON file in the /data directory.
 * The file is written to a temporary path and then renamed into place, so a
 * reader can never observe a half-written file.
 * @param {string} playlistUrl - The original URL for reference.
 * @param {string} playlistId - The ID of the playlist, used for the filename.
 * @param {object} data - The data object containing playlistTitle and videos.
 */
async function saveDataToJson(playlistUrl, playlistId, data) {
    const content = { playlistUrl, ...data };
    // Use the unique playlist ID for a stable and predictable filename.
    const filePath = path.join(DATA_DIR, `${playlistId}.json`);

    await fs.mkdir(DATA_DIR, { recursive: true });

    // The temporary file lives in the same directory as the target, because a
    // rename is only atomic within a single filesystem.
    const tempPath = path.join(DATA_DIR, `.${playlistId}.${process.pid}.${Date.now()}.tmp`);
    try {
        await fs.writeFile(tempPath, JSON.stringify(content, null, 2));
        await fs.rename(tempPath, filePath);
    } catch (error) {
        await fs.rm(tempPath, { force: true });
        throw error;
    }

    return filePath;
}

module.exports = { getPlaylistIdFromUrl, getPlaylistData, saveDataToJson };