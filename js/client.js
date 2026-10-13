document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('playlistForm');
    const playlistUrlInput = document.getElementById('playlistUrl');
    const summaryOutputDiv = document.getElementById('summaryOutput');
    const videoOutputDiv = document.getElementById('videoOutput');
    const filterContainer = document.getElementById('filterContainer');
    const singlePlayerContainer = document.getElementById('singlePlayerContainer');
    const videoPlayer = document.getElementById('videoPlayer');
    const savedPlaylistsSelect = document.getElementById('savedPlaylists');

    // Playlist and video data comes from YouTube, so it is treated as untrusted:
    // it is only ever rendered as text, and a URL reaching an href or the player
    // has to match one of these shapes exactly.
    const WATCH_URL_PATTERN = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]+$/;
    const EMBED_URL_PATTERN = /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]+$/;

    let currentVideos = []; // To store the fetched video data

    /**
     * Creates a paragraph element. Text is always assigned with textContent, so
     * nothing in the data can be interpreted as markup.
     * @param {string} text - The message to show.
     * @param {string} [className] - Optional CSS class for the paragraph.
     */
    function createMessage(text, className) {
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        if (className) {
            paragraph.className = className;
        }
        return paragraph;
    }

    /** Replaces the summary area with a single message paragraph. */
    function showMessage(text, className) {
        summaryOutputDiv.replaceChildren(createMessage(text, className));
    }

    /**
     * Creates the anchor for a video. The href is only set for a real YouTube
     * watch URL; otherwise the same text is shown without a link.
     * @param {string} url - The video's watch URL.
     */
    function createVideoLink(url) {
        const link = document.createElement('a');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = url;
        if (WATCH_URL_PATTERN.test(url)) {
            link.href = url;
        }
        return link;
    }

    /**
     * Creates a `<div><strong>Label:</strong> value</div>` row.
     * @param {string} label - The field name, shown in bold.
     * @param {string|Node} content - Text or an element to show after the label.
     */
    function createLabelledRow(label, content) {
        const row = document.createElement('div');
        const labelElement = document.createElement('strong');
        labelElement.textContent = `${label}:`;
        const valueNode = content instanceof Node ? content : document.createTextNode(String(content ?? ''));
        row.append(labelElement, document.createTextNode(' '), valueNode);
        return row;
    }

    /**
     * Builds the full-detail card for one video. The embed URL is attached to
     * `data-embed-url` only when it is a valid YouTube embed URL, so an unexpected
     * value can never reach the player's src.
     * @param {object} video - A video object with title, url and embedUrl.
     */
    function createVideoItem(video) {
        const item = document.createElement('div');
        item.className = 'video-item';
        if (EMBED_URL_PATTERN.test(video.embedUrl)) {
            item.dataset.embedUrl = video.embedUrl;
        }
        item.append(
            createLabelledRow('Title', video.title),
            createLabelledRow('Link', createVideoLink(video.url)),
            createLabelledRow('Embed', video.embedUrl)
        );
        return item;
    }

    /**
     * Fetches the list of saved playlists and populates the dropdown.
     */
    async function loadSavedPlaylists() {
        try {
            const response = await fetch('/api/playlists');
            const result = await response.json();
            if (response.ok && result.success) {
                const playlists = Array.isArray(result.playlists) ? result.playlists : [];
                if (playlists.length > 0) {
                    // The Option constructor assigns the label as text, so a title
                    // containing markup stays text.
                    savedPlaylistsSelect.replaceChildren(new Option('-- Select a playlist --', ''));
                    playlists.forEach(playlist => {
                        savedPlaylistsSelect.add(new Option(playlist.title, playlist.url));
                    });
                    savedPlaylistsSelect.disabled = false;
                } else {
                    // If there are no saved playlists, disable the dropdown.
                    savedPlaylistsSelect.replaceChildren(new Option('-- No saved playlists found --', ''));
                    savedPlaylistsSelect.disabled = true;
                }
            }
        } catch (error) {
            console.error('Failed to load saved playlists:', error);
        }
    }

    /**
     * Renders the video list based on the selected filter.
     * @param {string} filter - The filter to apply ('all', 'title', 'url', 'embed').
     */
    function renderVideos(filter) {
        const videos = currentVideos.filter(video => video && typeof video === 'object');
        if (videos.length === 0) {
            videoOutputDiv.replaceChildren(createMessage('No video data to display.'));
            return;
        }

        const list = document.createElement('ul');
        videos.forEach(video => {
            const listItem = document.createElement('li');
            switch (filter) {
                case 'title':
                    listItem.textContent = video.title;
                    break;
                case 'url':
                    listItem.append(createVideoLink(video.url));
                    break;
                case 'embed':
                    listItem.textContent = video.embedUrl;
                    break;
                case 'all':
                default:
                    listItem.append(createVideoItem(video));
                    break;
            }
            list.append(listItem);
        });
        videoOutputDiv.replaceChildren(list);
    }

    // Add event listener for filter changes
    filterContainer.addEventListener('change', (event) => {
        if (event.target.name === 'videoFilter') {
            renderVideos(event.target.value);
        }
    });

    // Add event listener for clicking on a video title in the list
    videoOutputDiv.addEventListener('click', (event) => {
        const videoItem = event.target.closest('.video-item');
        if (!videoItem) return;

        // Re-checked here as well, so an unexpected value can never be played.
        const embedUrl = videoItem.dataset.embedUrl;
        if (!EMBED_URL_PATTERN.test(embedUrl || '')) return;

        // Show the player
        singlePlayerContainer.style.display = 'block';

        // Update the iframe src
        videoPlayer.src = embedUrl;

        // Highlight the active item
        // First, remove 'active' class from any previously selected item
        const currentlyActive = videoOutputDiv.querySelector('.video-item.active');
        if (currentlyActive) currentlyActive.classList.remove('active');
        // Then, add 'active' class to the clicked item
        videoItem.classList.add('active');
    });

    // When a saved playlist is selected, populate the URL input field
    savedPlaylistsSelect.addEventListener('change', (event) => {
        const selectedUrl = event.target.value;
        if (selectedUrl) {
            // When a saved playlist is selected, we clear the manual input field
            playlistUrlInput.value = selectedUrl;
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault(); // Prevent default form submission

        // Determine if we are loading a saved playlist or fetching a new one
        const isSavedPlaylist = savedPlaylistsSelect.value && savedPlaylistsSelect.value === playlistUrlInput.value;
        const url = isSavedPlaylist ? savedPlaylistsSelect.value : playlistUrlInput.value.trim();

        if (!url) {
            showMessage('Please enter a playlist URL.', 'error');
            return;
        }

        showMessage('Fetching data... please wait.', 'loading');
        videoOutputDiv.replaceChildren(); // Clear previous results
        filterContainer.style.display = 'none'; // Hide filters during fetch
        singlePlayerContainer.style.display = 'none'; // Hide player
        savedPlaylistsSelect.value = ''; // Reset dropdown

        try {
            // Choose the correct API endpoint
            const endpoint = isSavedPlaylist ? '/api/load-playlist' : '/api/fetch-playlist';

            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
            const result = await response.json();

            if (response.ok && result.success) {
                const playlistData = result.playlistData || {};
                const savedFilePath = result.savedFilePath || '(unknown path)';

                const summary = document.createDocumentFragment();
                summary.append(createMessage(
                    isSavedPlaylist
                        ? `SUCCESS: Data fetched from saved file: ${savedFilePath}`
                        : `SUCCESS: Data fetched and saved to: ${savedFilePath}`,
                    'success'
                ));
                const heading = document.createElement('h3');
                heading.textContent = `Playlist: ${playlistData.playlistTitle}`;
                summary.append(heading);
                summaryOutputDiv.replaceChildren(summary);

                currentVideos = Array.isArray(playlistData.videos) ? playlistData.videos : [];
                filterContainer.style.display = 'block'; // Show filters
                document.getElementById('filterAll').checked = true; // Reset to 'All'
                renderVideos('all'); // Initial render
                if (!isSavedPlaylist) {
                    loadSavedPlaylists(); // Refresh the list only if we fetched a new playlist
                }
            } else {
                showMessage(`ERROR: ${result.message || 'An unknown error occurred.'}`, 'error');
            }
        } catch (error) {
            showMessage(`Network or server error: ${error.message}`, 'error');
            console.error('Client-side fetch error:', error);
        }
    });

    // Load the saved playlists when the page first loads
    loadSavedPlaylists();
});