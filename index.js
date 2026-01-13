require('dotenv').config();
const express = require('express');
const path = require('path');
const { getPlaylistIdFromUrl, getPlaylistData, saveDataToJson } = require('./js/youtube.js');
const fs = require('fs/promises');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

// Serve static files from their respective directories
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));

// Route for the homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'html', 'index.html'));
});

// API endpoint to get the list of saved playlists
app.get('/api/playlists', async (req, res) => {
    const dataDir = path.join(__dirname, 'data');
    try {
        // Check if directory exists, if not, return an empty list.
        try {
            await fs.access(dataDir);
        } catch {
            return res.json({ success: true, playlists: [] });
        }
        const files = await fs.readdir(dataDir);
        const jsonFiles = files.filter(file => path.extname(file).toLowerCase() === '.json');

        const playlists = [];
        for (const file of jsonFiles) {
            const filePath = path.join(dataDir, file);
            const fileContent = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(fileContent);
            if (data.playlistTitle && data.playlistUrl) {
                playlists.push({
                    title: data.playlistTitle,
                    url: data.playlistUrl,
                });
            }
        }
        res.json({ success: true, playlists });
    } catch (error) {
        console.error('Error reading playlists directory:', error);
        res.status(500).json({ success: false, message: 'Could not read saved playlists.' });
    }
});

// API endpoint to load a single playlist from a local file
app.post('/api/load-playlist', async (req, res) => {
    const { url } = req.body;
    const playlistId = getPlaylistIdFromUrl(url);

    if (!playlistId) {
        return res.status(400).json({ success: false, message: 'Invalid playlist URL provided.' });
    }

    const filePath = path.join(__dirname, 'data', `${playlistId}.json`);
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(fileContent);
        res.json({ success: true, playlistData: data, savedFilePath: path.relative(process.cwd(), filePath) });
    } catch (error) {
        console.error('Error loading local playlist file:', error);
        res.status(404).json({ success: false, message: `Could not find a saved file for playlist ID: ${playlistId}. Please fetch it as a new URL first.` });
    }
});

// API endpoint to fetch playlist data
app.post('/api/fetch-playlist', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ success: false, message: 'Playlist URL is required.' });
    }

    const playlistId = getPlaylistIdFromUrl(url);
    if (!playlistId) {
        return res.status(400).json({ success: false, message: 'Could not find a valid playlist ID in the URL. Example URL: https://www.youtube.com/playlist?list=PL... ' });
    }

    try {
        const playlistData = await getPlaylistData(playlistId);
        const savedFilePath = await saveDataToJson(url, playlistId, playlistData);

        res.json({
            success: true,
            playlistData,
            savedFilePath: path.relative(process.cwd(), savedFilePath), // Make path relative for display
            message: 'Data fetched and saved successfully.'
        });
    } catch (error) {
        console.error('Error fetching playlist data:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`YouTube Data Fetcher web app running at http://localhost:${PORT}`);
    console.log('Open your web browser and navigate to this address.');
});