'use strict';

// Runs the real js/client.js against the real html/index.html inside jsdom, with
// a cached playlist whose fields contain markup. Anything the audit observed the
// browser doing with that data is turned into an assertion here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'html', 'index.html'), 'utf8');
const CLIENT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'client.js'), 'utf8');

const PAYLOAD_TITLE = '<img src=x onerror="window.__xss=1">';
const PAYLOAD_VIDEO_TITLE = '<script>window.__xss=2</script>';
const EVIL_URL = 'javascript:window.__xss=3';
const EVIL_EMBED = 'javascript:window.__xss=4';
const GOOD_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const GOOD_EMBED = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
const SAVED_URL = 'https://www.youtube.com/playlist?list=PLpayload00000000001';

const PLAYLIST = {
    playlistUrl: SAVED_URL,
    playlistTitle: PAYLOAD_TITLE,
    videos: [
        { title: PAYLOAD_VIDEO_TITLE, url: EVIL_URL, embedUrl: EVIL_EMBED },
        { title: 'Ordinary video', url: GOOD_URL, embedUrl: GOOD_EMBED },
    ],
};

// What each filter is expected to show. The url and embed views deliberately
// show only that field, so the title does not appear in them.
const FILTER_EXPECTATIONS = {
    title: PAYLOAD_VIDEO_TITLE,
    url: EVIL_URL,
    embed: EVIL_EMBED,
    all: PAYLOAD_VIDEO_TITLE,
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** Polls briefly so the test does not depend on a fixed number of ticks. */
async function waitFor(condition, description) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (condition()) return;
        await flush();
    }
    throw new Error(`timed out waiting for ${description}`);
}

/**
 * Boots the real page with the network stubbed out. The client script is inlined
 * so that jsdom runs it once and fires one DOMContentLoaded, exactly as a browser
 * loading the real page would.
 * @param {object} [options]
 * @param {boolean} [options.loadPlaylist] - Whether to submit the form as well.
 * @param {string} [options.failure] - Message the load endpoint should fail with.
 */
async function startPage({ loadPlaylist = true, failure = null } = {}) {
    const page = HTML.replace('</body>', `<script>${CLIENT_SOURCE}</script></body>`);

    const dom = new JSDOM(page, {
        runScripts: 'dangerously',
        url: 'http://localhost:3000/',
        beforeParse(window) {
            window.fetch = async target => {
                const url = String(target);
                if (url.endsWith('/api/playlists')) {
                    return { ok: true, json: async () => ({ success: true, playlists: [{ title: PAYLOAD_TITLE, url: SAVED_URL }] }) };
                }
                if (url.endsWith('/api/load-playlist')) {
                    if (failure) {
                        return { ok: false, json: async () => ({ success: false, message: failure }) };
                    }
                    return {
                        ok: true,
                        json: async () => ({ success: true, playlistData: PLAYLIST, savedFilePath: 'data/PLpayload00000000001.json' }),
                    };
                }
                throw new Error(`unexpected request to ${url}`);
            };
        },
    });

    const { window } = dom;
    const document = window.document;

    // The dropdown is populated by the script's own start-up call.
    if (loadPlaylist) {
        await waitFor(() => document.getElementById('savedPlaylists').options.length > 1, 'the saved playlist list');

        const select = document.getElementById('savedPlaylists');
        select.selectedIndex = 1;
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
        document.getElementById('playlistForm').requestSubmit();

        await waitFor(() => document.querySelectorAll('.video-item').length > 0, 'the playlist to render');
    }

    return {
        window,
        document,
        summary: document.getElementById('summaryOutput'),
        output: document.getElementById('videoOutput'),
        player: document.getElementById('videoPlayer'),
        playerContainer: document.getElementById('singlePlayerContainer'),
        items: () => [...document.querySelectorAll('.video-item')],
    };
}

/** Clicks the element the user would aim at, inside the given card. */
function click(window, element) {
    const target = element.querySelector('div') || element;
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

test('renders a playlist title containing markup as text', async () => {
    const page = await startPage();

    assert.equal(page.window.__xss, undefined, 'a payload in the data executed');
    assert.equal(page.window.document.title, 'YouTube Data Fetcher', 'a payload rewrote the document title');
    assert.equal(page.summary.querySelectorAll('img, script').length, 0, 'markup from the title became an element');
    // The escaped form is what should be in the markup, not the raw payload.
    assert.ok(page.summary.innerHTML.includes('&lt;img'), 'the title was not HTML-escaped');
    assert.ok(page.summary.textContent.includes(PAYLOAD_TITLE), 'the title was not shown as literal text');
});

test('renders video titles containing markup as text', async () => {
    const page = await startPage();

    assert.equal(page.window.__xss, undefined, 'a payload in the data executed');
    assert.equal(page.output.querySelectorAll('img, script').length, 0, 'markup from a video title became an element');
    assert.ok(page.output.innerHTML.includes('&lt;script'), 'the video title was not HTML-escaped');
    assert.ok(page.output.textContent.includes(PAYLOAD_VIDEO_TITLE), 'the video title was not shown as literal text');
});

test('never turns a javascript: watch URL into a link', async () => {
    const page = await startPage();
    const hrefs = [...page.output.querySelectorAll('a')].map(anchor => anchor.getAttribute('href'));

    assert.ok(!hrefs.some(href => href && href.startsWith('javascript:')), `a javascript: URL became an href: ${JSON.stringify(hrefs)}`);
    assert.equal(hrefs[0], null, 'the unsafe URL was given an href');
    assert.equal(hrefs[1], GOOD_URL, 'the genuine watch URL lost its href');
});

test('keeps a javascript: embed URL away from the player', async () => {
    const page = await startPage();
    const [unsafe, safe] = page.items();

    assert.equal(unsafe.dataset.embedUrl, undefined, 'an unsafe embed URL reached data-embed-url');
    assert.equal(safe.dataset.embedUrl, GOOD_EMBED);

    click(page.window, unsafe);
    assert.equal(page.playerContainer.style.display, 'none', 'clicking an unsafe card opened the player');
    assert.equal(page.player.getAttribute('src'), '', 'an unsafe URL reached the iframe');

    click(page.window, safe);
    assert.equal(page.playerContainer.style.display, 'block', 'clicking a real video did not open the player');
    assert.equal(page.player.getAttribute('src'), GOOD_EMBED);
});

test('escapes the saved-playlist dropdown label', async () => {
    const page = await startPage({ loadPlaylist: false });
    await waitFor(() => page.document.getElementById('savedPlaylists').options.length > 1, 'the saved playlist list');

    const options = page.document.getElementById('savedPlaylists').options;
    assert.equal(options.length, 2);
    assert.equal(options[1].textContent, PAYLOAD_TITLE, 'the option label was not treated as text');
    assert.equal(options[1].value, SAVED_URL);
});

test('renders every filter without interpreting markup', async () => {
    const page = await startPage();

    for (const [value, expected] of Object.entries(FILTER_EXPECTATIONS)) {
        const radio = page.document.querySelector(`input[name="videoFilter"][value="${value}"]`);
        radio.checked = true;
        radio.dispatchEvent(new page.window.Event('change', { bubbles: true }));

        assert.equal(page.output.querySelectorAll('img, script').length, 0, `the ${value} filter rendered markup`);
        assert.ok(page.output.textContent.includes(expected), `the ${value} filter did not show its field as text`);
    }
});

test('renders a failing server message as text', async () => {
    const page = await startPage({ loadPlaylist: false, failure: PAYLOAD_TITLE });

    const select = page.document.getElementById('savedPlaylists');
    await waitFor(() => select.options.length > 1, 'the saved playlist list');
    select.selectedIndex = 1;
    select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    page.document.getElementById('playlistForm').requestSubmit();

    await waitFor(() => page.summary.textContent.includes('ERROR'), 'the error message');

    assert.equal(page.window.__xss, undefined, 'an error message executed');
    assert.equal(page.summary.querySelectorAll('img, script').length, 0, 'an error message was interpreted as markup');
    assert.ok(page.summary.textContent.includes(PAYLOAD_TITLE), 'the error message was not shown as literal text');
});
