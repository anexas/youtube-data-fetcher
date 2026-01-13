document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('playlistForm');
    const playlistUrlInput = document.getElementById('playlistUrl');
    const summaryOutputDiv = document.getElementById('summaryOutput');
    const videoOutputDiv = document.getElementById('videoOutput');
    const filterContainer = document.getElementById('filterContainer');
    const singlePlayerContainer = document.getElementById('singlePlayerContainer');
    const videoPlayer = document.getElementById('videoPlayer');
    const savedPlaylistsSelect = document.getElementById('savedPlaylists');

    let currentVideos = []; // To store the fetched video data

    /**
     * Fetches the list of saved playlists and populates the dropdown.
     */
    async function loadSavedPlaylists() {
        try {
            const response = await fetch('/api/playlists');
            const result = await response.json();
            if (response.ok && result.success) {
                savedPlaylistsSelect.innerHTML = '<option value="">-- Select a playlist --</option>'; // Default option
                if (result.playlists.length > 0) {
                    savedPlaylistsSelect.disabled = false;
                    result.playlists.forEach(playlist => {
                        const option = new Option(playlist.title, playlist.url);
                        savedPlaylistsSelect.add(option);
                    });
                } else {
                    // If there are no saved playlists, disable the dropdown.
                    savedPlaylistsSelect.innerHTML = '<option value="">-- No saved playlists found --</option>';
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
        if (currentVideos.length === 0) {
            videoOutputDiv.innerHTML = '<p>No video data to display.</p>';
            return;
        }

        let videoHtml = '<ul>';
        currentVideos.forEach(video => {
            videoHtml += '<li>';
            switch (filter) {
                case 'title':
                    videoHtml += `${video.title}`;
                    break;
                case 'url':
                    videoHtml += `<a href="${video.url}" target="_blank">${video.url}</a>`;
                    break;
                case 'embed':
                    videoHtml += `${video.embedUrl}`;
                    break;
                case 'all':
                default:
                    videoHtml += `<div class="video-item" data-embed-url="${video.embedUrl}">
                        <div><strong>Title:</strong> ${video.title}</div>
                        <div><strong>Link:</strong> <a href="${video.url}" target="_blank">${video.url}</a></div>
                        <div><strong>Embed:</strong> ${video.embedUrl}</div>
                        </div>`;
                    break;
            }
            videoHtml += '</li>';
        });
        videoHtml += '</ul>';
        videoOutputDiv.innerHTML = videoHtml;
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

        // Show the player
        singlePlayerContainer.style.display = 'block';

        // Update the iframe src
        const embedUrl = videoItem.dataset.embedUrl;
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
            summaryOutputDiv.innerHTML = '<p class="error">Please enter a playlist URL.</p>';
            return;
        }

        summaryOutputDiv.innerHTML = '<p class="loading">Fetching data... please wait.</p>';
        videoOutputDiv.innerHTML = ''; // Clear previous results
        filterContainer.style.display = 'none'; // Hide filters during fetch
        singlePlayerContainer.style.display = 'none'; // Hide player
        savedPlaylistsSelect.value = ''; // Reset dropdown

        try {
            // Choose the correct API endpoint
            const endpoint = isSavedPlaylist ? '/api/load-playlist' : '/api/fetch-playlist';

            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
            const result = await response.json();

            if (response.ok && result.success) {
                let successMessage;
                if (isSavedPlaylist) {
                    successMessage = `<p class="success">SUCCESS: Data fetched from saved file: ${result.savedFilePath}</p>`;
                } else {
                    successMessage = `<p class="success">SUCCESS: Data fetched and saved to: ${result.savedFilePath}</p>`;
                }
                summaryOutputDiv.innerHTML = `${successMessage}<h3>Playlist: ${result.playlistData.playlistTitle}</h3>`;

                currentVideos = result.playlistData.videos;
                filterContainer.style.display = 'block'; // Show filters
                document.getElementById('filterAll').checked = true; // Reset to 'All'
                renderVideos('all'); // Initial render
                if (!isSavedPlaylist) {
                    loadSavedPlaylists(); // Refresh the list only if we fetched a new playlist
                }
            } else {
                summaryOutputDiv.innerHTML = `<p class="error">ERROR: ${result.message || 'An unknown error occurred.'}</p>`;
            }
        } catch (error) {
            summaryOutputDiv.innerHTML = `<p class="error">Network or server error: ${error.message}</p>`;
            console.error('Client-side fetch error:', error);
        }
    });

    // Load the saved playlists when the page first loads
    loadSavedPlaylists();
});