'use strict';

// Unit tests for the parsing and storage layer. No server is started here.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the cache at a throwaway directory before the module reads DATA_DIR.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdf-unit-'));
process.env.DATA_DIR = DATA_DIR;

const { getPlaylistIdFromUrl, saveDataToJson } = require('../js/youtube.js');

const PLAYLIST_ID = 'PLxss1234567890abcdef';
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;

after(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

/** Names of any temporary files the atomic writer failed to clean up. */
function tempFiles() {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs.readdirSync(DATA_DIR).filter(name => name.endsWith('.tmp'));
}

test('reads the ID from the list= parameter of a playlist or watch URL', () => {
    assert.equal(getPlaylistIdFromUrl(PLAYLIST_URL), PLAYLIST_ID);
    assert.equal(getPlaylistIdFromUrl(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${PLAYLIST_ID}`), PLAYLIST_ID);
    assert.equal(getPlaylistIdFromUrl(`https://www.youtube.com/playlist?LIST=${PLAYLIST_ID}`), PLAYLIST_ID);
});

test('returns null when there is no list= parameter', () => {
    assert.equal(getPlaylistIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
    assert.equal(getPlaylistIdFromUrl('https://www.youtube.com/playlist'), null);
});

// The ID becomes a filename, so anything that could escape the cache directory
// has to be refused. This is the traversal case from the security audit.
const REJECTED_VALUES = [
    '../canary',
    '../../package',
    '....//canary',
    '..../..../canary',
    '../canary%00',
    '..%2Fcanary',
    '%2e%2e%2fcanary',
    'a/../../b/canary',
    '/etc/hostname',
    'C:\\Windows\\win.ini',
    'PL\\..\\canary',
    'has space',
    'semi;colon',
    'PLxss1234567890abcdef\n',
    'PLxss1234567890abcdef\r',
    'PLxss1234567890abcdef/extra',
    'WL',
    'sh',
    '',
];

for (const value of REJECTED_VALUES) {
    test(`rejects list=${JSON.stringify(value)}`, () => {
        const url = `https://www.youtube.com/playlist?list=${value}`;
        assert.equal(getPlaylistIdFromUrl(url), null, `accepted a value it should have rejected: ${JSON.stringify(value)}`);
    });
}

test('enforces the length bounds of a playlist ID', () => {
    assert.equal(getPlaylistIdFromUrl('https://www.youtube.com/playlist?list=abcdefghij'), 'abcdefghij', 'rejected a 10 character ID');
    assert.equal(getPlaylistIdFromUrl(`https://www.youtube.com/playlist?list=${'a'.repeat(101)}`), null, 'accepted a 101 character ID');
});

test('returns null for non-string input instead of throwing', () => {
    for (const value of [undefined, null, 42, 0, {}, [], true, () => 'x']) {
        assert.equal(getPlaylistIdFromUrl(value), null, `threw or accepted ${String(value)}`);
    }
});

test('writes the documented cache shape and leaves no temporary file', async () => {
    const videos = [{ title: 'One', url: 'https://www.youtube.com/watch?v=one', embedUrl: 'https://www.youtube.com/embed/one' }];
    const filePath = await saveDataToJson(PLAYLIST_URL, PLAYLIST_ID, { playlistTitle: 'A playlist', videos });

    assert.equal(filePath, path.join(DATA_DIR, `${PLAYLIST_ID}.json`));
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
        playlistUrl: PLAYLIST_URL,
        playlistTitle: 'A playlist',
        videos,
    });
    assert.deepEqual(tempFiles(), [], 'a temporary file was left behind');
});

test('creates the cache directory when it does not exist yet', async () => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });

    const filePath = await saveDataToJson(PLAYLIST_URL, PLAYLIST_ID, { playlistTitle: 'Recreated', videos: [] });

    assert.equal(fs.existsSync(filePath), true);
    assert.deepEqual(tempFiles(), []);
});

test('replaces an existing cache file in place', async () => {
    await saveDataToJson(PLAYLIST_URL, PLAYLIST_ID, { playlistTitle: 'First', videos: [] });
    await saveDataToJson(PLAYLIST_URL, PLAYLIST_ID, { playlistTitle: 'Second', videos: [] });

    const written = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${PLAYLIST_ID}.json`), 'utf8'));
    assert.equal(written.playlistTitle, 'Second');
    assert.deepEqual(tempFiles(), []);
});

test('parallel writes never leave a reader a torn file', async () => {
    // Large payloads make a partial write easy to detect: if the rename were not
    // atomic, the body would not match its own title.
    const body = marker => 'x'.repeat(200000) + marker;
    const writers = [];

    for (let index = 0; index < 8; index++) {
        const marker = `MARKER${index}END`;
        writers.push(saveDataToJson(PLAYLIST_URL, PLAYLIST_ID, {
            playlistTitle: marker,
            videos: [{ title: body(marker), url: 'u', embedUrl: 'e' }],
        }));
    }

    const results = await Promise.allSettled(writers);
    assert.deepEqual(
        results.filter(result => result.status === 'rejected').map(result => result.reason.message),
        [],
        'a concurrent write failed'
    );

    const written = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${PLAYLIST_ID}.json`), 'utf8'));
    assert.match(written.playlistTitle, /^MARKER[0-7]END$/, `unexpected title: ${written.playlistTitle}`);
    assert.equal(written.videos[0].title, body(written.playlistTitle), 'the file was written by more than one writer at once');
    assert.deepEqual(tempFiles(), []);
});

test('removes its temporary file when the write fails', async () => {
    const blockedId = 'PLblocked00000000001';
    // A directory in the target's place makes the final rename fail.
    fs.mkdirSync(path.join(DATA_DIR, `${blockedId}.json`));

    await assert.rejects(
        saveDataToJson(PLAYLIST_URL, blockedId, { playlistTitle: 'x', videos: [] }),
        'a failing write should surface its error'
    );
    assert.deepEqual(tempFiles(), [], 'the temporary file was left behind after a failure');

    fs.rmSync(path.join(DATA_DIR, `${blockedId}.json`), { recursive: true, force: true });
});

test('retries a rename that fails while the target is briefly locked', async () => {
    // Mirrors the Windows case where another process holds the file open: the
    // first rename fails, the retry must still land the file.
    const fsp = require('fs/promises');
    const realRename = fsp.rename;
    let attempts = 0;

    fsp.rename = async (from, to) => {
        attempts++;
        if (attempts === 1) {
            const error = new Error('EPERM: operation not permitted');
            error.code = 'EPERM';
            throw error;
        }
        return realRename(from, to);
    };

    try {
        await saveDataToJson(PLAYLIST_URL, PLAYLIST_ID, { playlistTitle: 'Retried', videos: [] });
    } finally {
        fsp.rename = realRename;
    }

    assert.equal(attempts, 2, 'the rename should have been retried exactly once');
    const written = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${PLAYLIST_ID}.json`), 'utf8'));
    assert.equal(written.playlistTitle, 'Retried');
    assert.deepEqual(tempFiles(), []);
});
