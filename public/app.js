const searchInput = document.getElementById('searchQuery');
const resultsDiv = document.getElementById('results');
const movieDetail = document.getElementById('movieDetail');
const playerContainer = document.getElementById('playerContainer');
const videoPlayer = document.getElementById('videoPlayer');

let activeStreams = [];
let currentMovieData = null;

const BACKUP_POSTER_URL = 'https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?q=80&w=300&auto=format&fit=crop';

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') search();
});

async function search() {
    const query = searchInput.value.trim();
    if (!query) return;

    resultsDiv.innerHTML = '<div class="loader">Vyhledávám film v databázích...</div>';
    movieDetail.style.display = 'none';
    playerContainer.style.display = 'none';
    videoPlayer.pause();

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.error || !data.results || data.results.length === 0) {
            resultsDiv.innerHTML = '<div class="no-results">Nebylo nic nalezeno.</div>';
            return;
        }

        renderGrid(data.results);
    } catch (err) {
        resultsDiv.innerHTML = '<div class="error">Chyba sítě při vyhledávání.</div>';
    }
}

function renderGrid(movies) {
    resultsDiv.innerHTML = '';
    resultsDiv.className = "movie-grid";

    movies.forEach(movie => {
        const card = document.createElement('div');
        card.className = "movie-card";
        card.onclick = () => openMovieDetail(movie);

        card.innerHTML = `
            <img src="${movie.poster || BACKUP_POSTER_URL}" referrerpolicy="no-referrer" onerror="this.src='${BACKUP_POSTER_URL}';">
            <h3>${movie.title}</h3>
            <p>${movie.year}</p>
        `;
        resultsDiv.appendChild(card);
    });
}

async function openMovieDetail(movie) {
    currentMovieData = movie;
    resultsDiv.innerHTML = '<div class="loader">Stahuji filmové detaily z ČSFD/IMDb a hledám streamy...</div>';
    
    activeStreams = [];

    try {
        // Souběžné získání detailů z ČSFD a streamů z Přehraj.to
        let deepDetails = { poster: movie.poster, description: 'Popis není k dispozici.', actors: movie.actors, genres: 'Film', trailerUrl: '' };
        
        if (movie.csfdLink) {
            try {
                const detailRes = await fetch(`/get-movie-details?url=${encodeURIComponent(movie.csfdLink)}`);
                if (detailRes.ok) deepDetails = await detailRes.json();
            } catch (e) { console.log("Nepodařilo se načíst detailní data z ČSFD parseru."); }
        }

        const streamRes = await fetch(`/get-streams?title=${encodeURIComponent(movie.title)}`);
        const streamData = await streamRes.json();
        activeStreams = streamData.streams || [];

        // Aktualizace objektu filmu o čerstvě získaná data
        currentMovieData.poster = deepDetails.poster || movie.poster || BACKUP_POSTER_URL;
        currentMovieData.description = deepDetails.description;
        currentMovieData.actors = deepDetails.actors || movie.actors;
        currentMovieData.genres = deepDetails.genres;

        resultsDiv.innerHTML = '';
        movieDetail.style.display = 'block';

        // Tvorba tlačítek podle toho, zda ČSFD/IMDb prošlo přes 4-krokový filtr
        let dbButtons = '';
        if (movie.source === 'csfd' || movie.source === 'both') {
            dbButtons += `<a href="${movie.csfdLink}" target="_blank" class="db-link-logo"><img src="https://www.csfd.cz/favicon.ico" style="width:24px;height:24px;vertical-align:middle;margin-right:5px;"> ČSFD</a>`;
        }
        if (movie.source === 'imdb' || movie.source === 'both') {
            dbButtons += `<a href="${movie.imdbLink || ('https://www.imdb.com/find?q='+encodeURIComponent(movie.title))}" target="_blank" class="db-btn-imdb">IMDb</a>`;
        }

        let streamDropdownHtml = '';
        if (activeStreams.length > 0) {
            streamDropdownHtml = `
                <select id="streamSelect" class="context-arrow">
                    ${activeStreams.map((s, idx) => `<option value="${idx}">${s.name}</option>`).join('')}
                </select>
            `;
        } else {
            streamDropdownHtml = `<span class="no-streams-notice">Žádný kompatibilní stream (S01E01 odfiltrováno)</span>`;
        }

        const isFav = isMovieInFavorites(movie.title);

        document.getElementById('detailContent').innerHTML = `
            <!-- Video Trailer na pozadí karty filmu -->
            ${deepDetails.trailerUrl ? `
                <video id="bgTrailerVideo" autoplay loop muted playsinline style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index:-1; opacity:0.3;">
                    <source src="${deepDetails.trailerUrl}" type="video/mp4">
                </video>
            ` : ''}

            <h1 class="detail-title">${movie.title}</h1>
            
            <div class="action-row">
                <button class="btn-play" onclick="startStreaming()">▶ Přehrát</button>
                ${streamDropdownHtml}
                
                ${dbButtons}
                
                <button class="btn-download" onclick="startDownloading()">⬇ Stáhnout</button>
            </div>

            <div class="control-icons">
                <button id="favBtn" class="icon-circle" onclick="toggleFavoriteCurrent()">${isFav ? '★' : '＋'}</button>
                <button id="muteBtn" class="icon-circle" onclick="toggleMuteTrailer()">🔇</button>
            </div>

            <div class="meta-layout">
                <div class="meta-left">
                    <p style="color:var(--accent); font-weight:bold;">${deepDetails.genres}</p>
                    <p><strong>Země a Rok:</strong> ${movie.year} • 110 min</p>
                    <p style="font-size:13px; color:var(--text-dim); line-height:1.5;">${deepDetails.description}</p>
                </div>
                <div class="meta-right">
                    <p><strong>Režie & Hrají:</strong> ${deepDetails.actors || 'Neznámé obsazení.'}</p>
                </div>
            </div>
        `;

    } catch (err) {
        resultsDiv.innerHTML = '<div class="error">Chyba při sestavování filmové karty.</div>';
    }
}

function startStreaming() {
    if (activeStreams.length === 0) return;
    const selectEl = document.getElementById('streamSelect');
    const idx = selectEl ? selectEl.value : 0;
    const targetLink = activeStreams[idx].link;

    playerContainer.style.display = 'block';
    window.scrollTo({ top: playerContainer.offsetTop - 20, behavior: 'smooth' });

    fetch(`/get-video?url=${encodeURIComponent(targetLink)}`)
        .then(res => res.json())
        .then(data => {
            if (data.sources?.[0]?.file) {
                videoPlayer.src = data.sources[0].file;
                videoPlayer.load();
                videoPlayer.play();
            }
        });
}

function startDownloading() {
    if (activeStreams.length === 0) return;
    const selectEl = document.getElementById('streamSelect');
    const idx = selectEl ? selectEl.value : 0;
    const targetLink = activeStreams[idx].link;

    fetch(`/get-video?url=${encodeURIComponent(targetLink)}`)
        .then(res => res.json())
        .then(data => {
            if (data.sources?.[0]?.file) {
                const a = document.createElement('a');
                a.href = data.sources[0].file;
                a.download = `${currentMovieData.title}.mp4`;
                a.click();
            }
        });
}

function isMovieInFavorites(title) {
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    return favorites.some(f => f.title === title);
}

function toggleFavoriteCurrent() {
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    const idx = favorites.findIndex(f => f.title === currentMovieData.title);
    const btn = document.getElementById('favBtn');

    if (idx > -1) {
        favorites.splice(idx, 1);
        if (btn) btn.innerText = '＋';
    } else {
        favorites.push(currentMovieData);
        if (btn) btn.innerText = '★';
    }
    localStorage.setItem('favorites', JSON.stringify(favorites));
}

function toggleMuteTrailer() {
    const bgVideo = document.getElementById('bgTrailerVideo');
    const btn = document.getElementById('muteBtn');
    if (!bgVideo) return;

    bgVideo.muted = !bgVideo.muted;
    btn.innerText = bgVideo.muted ? "🔇" : "🔊";
}
