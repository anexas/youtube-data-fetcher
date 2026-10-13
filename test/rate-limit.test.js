'use strict';

// The rate limits are read from the environment when index.js is first loaded,
// so this suite sets small budgets and runs in its own process.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WINDOW_MS = 60_000;
const API_BUDGET = 5;
const FETCH_BUDGET = 2;

process.env.RATE_LIMIT_WINDOW_MS = String(WINDOW_MS);
process.env.RATE_LIMIT_MAX = String(API_BUDGET);
process.env.FETCH_RATE_LIMIT_MAX = String(FETCH_BUDGET);
delete process.env.TRUST_PROXY;

const ROOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdf-limits-'));
process.env.DATA_DIR = path.join(ROOT_DIR, 'data');
process.env.YOUTUBE_API_KEY = 'not-a-real-key';

// Stand in for the YouTube call so no test needs the network.
const youtube = require('../js/youtube.js');
youtube.getPlaylistData = async () => { throw new Error('stubbed upstream failure'); };

const app = require('../index.js');

let server;
let baseUrl;

before(async () => {
    server = app.listen(0);
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(ROOT_DIR, { recursive: true, force: true });
});

const get = pathname => fetch(`${baseUrl}${pathname}`);
const fetchPlaylist = () => fetch(`${baseUrl}/api/fetch-playlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.youtube.com/playlist?list=PLrate1234567890abcd' }),
});

/** A throttled response has to be a JSON 429 that tells the client when to retry. */
async function assertThrottled(response) {
    assert.equal(response.status, 429);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.ok(response.headers.get('ratelimit'), 'no RateLimit header');
    assert.equal(response.headers.get('retry-after'), String(WINDOW_MS / 1000));

    const body = await response.json();
    assert.equal(body.success, false);
    assert.match(body.message, /too many requests/i);
}

test('does not throttle the static page or its assets', async () => {
    for (const pathname of ['/', '/js/client.js', '/css/styles.css']) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const response = await get(pathname);
            assert.equal(response.status, 200, `${pathname} was throttled on request ${attempt + 1}`);
        }
    }
});

test('holds the quota-spending endpoint to its own, smaller budget', async () => {
    for (let attempt = 1; attempt <= FETCH_BUDGET; attempt++) {
        const response = await fetchPlaylist();
        assert.notEqual(response.status, 429, `request ${attempt} was throttled too early`);
    }

    await assertThrottled(await fetchPlaylist());
});

test('throttles the rest of the API on its general budget', async () => {
    let throttled = null;

    // Requests made so far have already spent part of the general budget, so
    // walk it down rather than asserting an exact count.
    for (let attempt = 0; attempt < API_BUDGET + 3 && throttled === null; attempt++) {
        const response = await get('/api/playlists');
        if (response.status === 429) {
            throttled = response;
            break;
        }
        assert.equal(response.status, 200, `unexpected status ${response.status} before throttling`);
    }

    assert.ok(throttled, 'the general limiter never throttled');
    await assertThrottled(throttled);
});
