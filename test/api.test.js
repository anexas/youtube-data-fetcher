'use strict';

// HTTP tests for the Express app. Each test file is run in its own process, so
// the environment set here cannot leak into another suite.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A distinctive value the responses must never contain, whatever goes wrong.
const API_KEY_SENTINEL = 'sentinel-api-key-must-not-leak';
process.env.YOUTUBE_API_KEY = API_KEY_SENTINEL;

// Fixtures live in a temporary directory, never in the real data/.
const ROOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdf-api-'));
const DATA_DIR = path.join(ROOT_DIR, 'data');
process.env.DATA_DIR = DATA_DIR;

const PAYLOAD_ID = 'PLpayload00000000001';
const MISSING_ID = 'PLmissing00000000001';
const PAYLOAD_TITLE = '<img src=x onerror="window.__xss=1">';
const CANARY_MARKER = 'CANARY_OUTSIDE_DATA_DIR';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, `${PAYLOAD_ID}.json`), JSON.stringify({
    playlistUrl: `https://www.youtube.com/playlist?list=${PAYLOAD_ID}`,
    playlistTitle: PAYLOAD_TITLE,
    videos: [{ title: 'A video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }],
}));
fs.writeFileSync(path.join(DATA_DIR, 'corrupt.json'), 'this is not json');
// A file one level above the cache: the traversal used to be able to read it.
fs.writeFileSync(path.join(ROOT_DIR, 'canary.json'), JSON.stringify({ playlistTitle: CANARY_MARKER, playlistUrl: 'https://example.com/' }));

// Stand in for the YouTube call before index.js destructures it, so the suite
// runs offline and never spends quota.
const youtube = require('../js/youtube.js');
let upstreamError = new Error('upstream exploded');
youtube.getPlaylistData = async () => { throw upstreamError; };

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
const postJson = (pathname, body) => fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});
const loadPlaylist = value => postJson('/api/load-playlist', { url: value });
const playlistUrlFor = value => `https://www.youtube.com/playlist?list=${value}`;

/** Fails the test if a response body contains something it must never expose. */
function assertNoSecrets(text, context) {
    assert.ok(!text.includes(API_KEY_SENTINEL), `${context} exposed the API key`);
    assert.ok(!text.includes(CANARY_MARKER), `${context} exposed the canary file`);
    assert.ok(!/(^|[^a-z])at .*\.js:\d+/m.test(text), `${context} exposed a stack trace`);
    assert.ok(!text.includes('node_modules'), `${context} exposed an internal path`);
    assert.ok(!/[A-Za-z]:\\\\?Users/.test(text), `${context} exposed an absolute filesystem path`);
}

test('serves the page with the hardened security headers', async () => {
    const response = await get('/');
    assert.equal(response.status, 200);

    const csp = response.headers.get('content-security-policy');
    assert.ok(csp.includes("frame-src 'self' https://www.youtube.com"), `CSP would block the player: ${csp}`);
    assert.ok(!csp.includes('upgrade-insecure-requests'), 'CSP would rewrite plain-HTTP requests');

    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-powered-by'), null, 'the Express banner is still advertised');
});

test('lists saved playlists and skips a file it cannot parse', async () => {
    const response = await get('/api/playlists');
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.playlists.length, 1, 'the corrupt file should be skipped, not fail the listing');
    // The title is returned verbatim: escaping data is the client's job, which
    // test/client.test.js covers.
    assert.equal(body.playlists[0].title, PAYLOAD_TITLE);
});

test('loads a saved playlist', async () => {
    const response = await loadPlaylist(playlistUrlFor(PAYLOAD_ID));
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.playlistData.playlistTitle, PAYLOAD_TITLE);
    // The path is reported relative to the server's working directory, for display.
    assert.equal(body.savedFilePath, path.relative(process.cwd(), path.join(DATA_DIR, `${PAYLOAD_ID}.json`)));
    assert.equal(path.isAbsolute(body.savedFilePath), false, 'the response should not expose an absolute path');
});

test('answers 404 for a playlist that was never saved', async () => {
    const response = await loadPlaylist(playlistUrlFor(MISSING_ID));
    assert.equal(response.status, 404);

    const body = await response.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes(MISSING_ID));
    assertNoSecrets(JSON.stringify(body), 'the missing-playlist response');
});

test('rejects a too-short playlist ID before reading any file', async () => {
    // corrupt.json really exists in the cache, but "corrupt" is not a valid ID,
    // so the request is refused without the filesystem being consulted.
    const response = await loadPlaylist(playlistUrlFor('corrupt'));
    assert.equal(response.status, 400);
});

// The traversal the audit demonstrated: list=../canary used to return the file.
const TRAVERSAL_VALUES = [
    '../canary',
    '../../package',
    '....//canary',
    '..%2Fcanary',
    '%2e%2e%2fcanary',
    '../canary%00',
    'a/../../b/canary',
    '/etc/hostname',
    'PLpayload00000000001/../../canary',
    'WL',
];

for (const value of TRAVERSAL_VALUES) {
    test(`refuses list=${value} without touching the filesystem`, async () => {
        const response = await loadPlaylist(playlistUrlFor(value));
        assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(value)}`);

        const text = await response.text();
        assertNoSecrets(text, `the response for ${JSON.stringify(value)}`);
    });
}

test('keeps a corrupt cache file from breaking the load path', async () => {
    // A valid-shaped ID whose file contains junk is a server-side problem (500),
    // which is what a partial write would have produced before writes were atomic.
    fs.writeFileSync(path.join(DATA_DIR, `${MISSING_ID}.json`), 'half a');
    const response = await loadPlaylist(playlistUrlFor(MISSING_ID));
    assert.equal(response.status, 500);

    const text = await response.text();
    assertNoSecrets(text, 'the corrupt-file response');
    fs.rmSync(path.join(DATA_DIR, `${MISSING_ID}.json`));
});

test('rejects a body that is not a usable URL', async () => {
    const bodies = [
        {},
        { url: 123 },
        { url: null },
        { url: ['a'] },
        { url: {} },
        { url: '' },
        { url: '   ' },
        { url: `https://example.com/?list=${'a'.repeat(2100)}` },
    ];

    for (const body of bodies) {
        for (const endpoint of ['/api/load-playlist', '/api/fetch-playlist']) {
            const response = await postJson(endpoint, body);
            assert.equal(response.status, 400, `${endpoint} accepted ${JSON.stringify(body).slice(0, 60)}`);
            assertNoSecrets(await response.text(), `${endpoint} with ${JSON.stringify(body).slice(0, 40)}`);
        }
    }
});

test('answers 400 with JSON for a request that carries no body at all', async () => {
    for (const endpoint of ['/api/load-playlist', '/api/fetch-playlist']) {
        const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST' });
        assert.equal(response.status, 400, `${endpoint} should treat a missing body as bad input`);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assertNoSecrets(await response.text(), `${endpoint} with no body`);
    }
});

test('answers JSON, not an HTML stack trace, for malformed JSON', async () => {
    const response = await postJson('/api/load-playlist', '{"url":');
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /application\/json/);

    const text = await response.text();
    assert.ok(text.includes('<pre>') === false, 'returned an HTML error page');
    assertNoSecrets(text, 'the malformed-JSON response');
    // The message is deliberately fixed: the body parser's own message quotes the
    // request bytes, which should never be echoed back.
    assert.equal(JSON.parse(text).message, 'Malformed JSON in request body.');
});

test('answers 413 for a body beyond the size limit', async () => {
    const response = await postJson('/api/fetch-playlist', { url: 'a'.repeat(12000) });
    assert.equal(response.status, 413);
    assert.match(response.headers.get('content-type'), /application\/json/);
});

test('answers JSON 404 for an unknown API path', async () => {
    const response = await get('/api/not-a-route');
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).success, false);
});

test('rejects a traversal value before spending any YouTube quota', async () => {
    const response = await postJson('/api/fetch-playlist', { url: playlistUrlFor('../canary') });
    assert.equal(response.status, 400);
    assertNoSecrets(await response.text(), 'the fetch-playlist traversal response');
});

test('redacts the API key from an upstream error message', async () => {
    upstreamError = new Error(`request failed: https://www.googleapis.com/youtube/v3/playlists?key=${API_KEY_SENTINEL}`);
    const response = await postJson('/api/fetch-playlist', { url: playlistUrlFor(PAYLOAD_ID) });
    assert.equal(response.status, 500);

    const body = await response.json();
    assert.ok(body.message.includes('[redacted]'), `expected a redacted message, got: ${body.message}`);
    assertNoSecrets(JSON.stringify(body), 'the upstream-error response');
});

test('redacts a key= parameter even when it is not the configured key', async () => {
    upstreamError = new Error('request failed: https://www.googleapis.com/youtube/v3/playlistItems?key=AIzaSySomeOtherKey');
    const response = await postJson('/api/fetch-playlist', { url: playlistUrlFor(PAYLOAD_ID) });
    assert.equal(response.status, 500);

    const text = await response.text();
    assert.ok(!text.includes('AIzaSySomeOtherKey'), `the key parameter survived: ${text}`);
});

test('passes a useful upstream message through to the client', async () => {
    upstreamError = new Error('Playlist not found or is private.');
    const response = await postJson('/api/fetch-playlist', { url: playlistUrlFor(PAYLOAD_ID) });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).message, 'Playlist not found or is private.');
});
