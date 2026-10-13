require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { DATA_DIR, getPlaylistIdFromUrl, getPlaylistData, saveDataToJson } = require('./js/youtube.js');
const fs = require('fs/promises');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_URL_LENGTH = 2048;

/** Uses an environment override when it is a positive number, otherwise the fallback. */
function positiveNumberFromEnv(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Rate limits. Both are tunable per environment so the budgets can be relaxed for
// local development without editing code.
const RATE_LIMIT_WINDOW_MS = positiveNumberFromEnv(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const RATE_LIMIT_MAX = positiveNumberFromEnv(process.env.RATE_LIMIT_MAX, 100);
const FETCH_RATE_LIMIT_MAX = positiveNumberFromEnv(process.env.FETCH_RATE_LIMIT_MAX, 20);

// Only trust the X-Forwarded-For header when a reverse proxy is actually in front
// of the app (set TRUST_PROXY=true). Blindly trusting it would let clients spoof
// the address that rate limiting keys on.
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

// Security headers. The CSP is loosened only for what this page legitimately
// loads: the YouTube iframe player. `upgrade-insecure-requests` is dropped because
// the app is served over plain HTTP.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'frame-src': ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
            'upgrade-insecure-requests': null,
        },
    },
}));

/**
 * Builds a rate limiter that answers excess requests with a JSON 429.
 * @param {number} limit - How many requests a single IP may make per window.
 */
function createRateLimiter(limit) {
    return rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { success: false, message: 'Too many requests. Please slow down and try again later.' },
    });
}

// Middleware to parse JSON request bodies. A playlist URL is tiny, so anything
// larger than this is rejected with a 413 rather than being buffered.
app.use(express.json({ limit: '10kb' }));

// Serve static files from their respective directories
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use(express.static(path.join(__dirname, 'html')));

/**
 * Validates the `url` field of a JSON request body. Returns `{ url }` with the
 * trimmed value, or `{ errorMessage }` describing why it is unusable.
 * @param {object|undefined} body - The parsed request body (undefined when absent).
 */
function readPlaylistUrl(body) {
    if (!body || typeof body.url !== 'string') {
        return { errorMessage: 'Playlist URL is required.' };
    }
    const url = body.url.trim();
    if (!url) {
        return { errorMessage: 'Playlist URL is required.' };
    }
    if (url.length > MAX_URL_LENGTH) {
        return { errorMessage: `Playlist URL must be at most ${MAX_URL_LENGTH} characters long.` };
    }
    return { url };
}

/**
 * Strips credential-shaped text out of a message before it is returned to the
 * browser. Google API errors can echo the request URL, which carries the API key.
 * @param {string} message - The raw error message.
 */
function redactSecrets(message) {
    let text = typeof message === 'string' ? message : '';
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
        text = text.split(apiKey).join('[redacted]');
    }
    return text.replace(/([?&]key=)[^&\s"']*/gi, '$1[redacted]');
}

// Every /api request counts against a general budget; the endpoint that spends
// YouTube quota has its own tighter budget on the route itself.
app.use('/api', createRateLimiter(RATE_LIMIT_MAX));

// Route for the homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'html', 'index.html'));
});

// API endpoint to get the list of saved playlists
app.get('/api/playlists', async (req, res) => {
    try {
        // Check if directory exists, if not, return an empty list.
        try {
            await fs.access(DATA_DIR);
        } catch {
            return res.json({ success: true, playlists: [] });
        }
        const files = await fs.readdir(DATA_DIR);
        const jsonFiles = files.filter(file => path.extname(file).toLowerCase() === '.json');

        const playlists = [];
        for (const file of jsonFiles) {
            // One unreadable file must not hide every other saved playlist.
            try {
                const fileContent = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
                const data = JSON.parse(fileContent);
                if (data.playlistTitle && data.playlistUrl) {
                    playlists.push({
                        title: data.playlistTitle,
                        url: data.playlistUrl,
                    });
                }
            } catch (error) {
                console.warn(`Skipping unreadable playlist file ${file}: ${error.message}`);
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
    const parsed = readPlaylistUrl(req.body);
    if (parsed.errorMessage) {
        return res.status(400).json({ success: false, message: parsed.errorMessage });
    }

    const playlistId = getPlaylistIdFromUrl(parsed.url);
    if (!playlistId) {
        return res.status(400).json({ success: false, message: 'Invalid playlist URL provided.' });
    }

    const filePath = path.join(DATA_DIR, `${playlistId}.json`);
    let fileContent;
    try {
        fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading local playlist file:', error);
        }
        return res.status(404).json({ success: false, message: `Could not find a saved file for playlist ID: ${playlistId}. Please fetch it as a new URL first.` });
    }

    let data;
    try {
        data = JSON.parse(fileContent);
    } catch (error) {
        console.error(`Corrupted playlist file ${filePath}: ${error.message}`);
        return res.status(500).json({ success: false, message: 'The saved file for this playlist is unreadable. Fetch the playlist again to repair it.' });
    }

    res.json({ success: true, playlistData: data, savedFilePath: path.relative(process.cwd(), filePath) });
});

// API endpoint to fetch playlist data
app.post('/api/fetch-playlist', createRateLimiter(FETCH_RATE_LIMIT_MAX), async (req, res) => {
    const parsed = readPlaylistUrl(req.body);
    if (parsed.errorMessage) {
        return res.status(400).json({ success: false, message: parsed.errorMessage });
    }

    const playlistId = getPlaylistIdFromUrl(parsed.url);
    if (!playlistId) {
        return res.status(400).json({ success: false, message: 'Could not find a valid playlist ID in the URL. Example URL: https://www.youtube.com/playlist?list=PL... ' });
    }

    try {
        const playlistData = await getPlaylistData(playlistId);
        const savedFilePath = await saveDataToJson(parsed.url, playlistId, playlistData);

        res.json({
            success: true,
            playlistData,
            savedFilePath: path.relative(process.cwd(), savedFilePath), // Make path relative for display
            message: 'Data fetched and saved successfully.'
        });
    } catch (error) {
        console.error('Error fetching playlist data:', error);
        res.status(500).json({ success: false, message: redactSecrets(error.message) || 'Could not fetch playlist data.' });
    }
});

// Unknown API routes answer with JSON so that every response from /api is JSON.
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'Unknown API endpoint.' });
});

// Final error handler: always answers with JSON and never leaks internals.
// Express identifies it as an error handler by its four arguments.
app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, message: 'Malformed JSON in request body.' });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, message: 'Request body is too large.' });
    }

    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    console.error('Unhandled request error:', err);
    const message = status >= 500 ? 'Internal server error.' : redactSecrets(err.message) || 'Request could not be processed.';
    res.status(status).json({ success: false, message });
});

// Start the server only when this file is run directly. Requiring it — as the
// test suite does — hands back the app without opening a port.
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`YouTube Data Fetcher web app running at http://localhost:${PORT}`);
        console.log('Open your web browser and navigate to this address.');
    });
}

module.exports = app;