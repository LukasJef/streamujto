const searchInput = document.getElementById('searchQuery');
const resultsDiv = document.getElementById('results');
const movieDetail = document.getElementById('movieDetail');
const playerContainer = document.getElementById('playerContainer');
const videoPlayer = document.getElementById('videoPlayer');

let activeStreams = [];
let selectedStreamIndex = 0;
let currentMovieData = null;

const BACKUP_POSTER_URL = 'https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?q=80&w=300&auto=format&fit=crop';

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') search();
});

async function search() {
    const query = searchInput.value.trim();
    if (!query) return;

    resultsDiv.innerHTML = '<div class="loader">Hledám filmy v databázích...</div>';
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
    resultsDiv.innerHTML = '<div class="loader">Načítám detaily filmu a streamy...</div>';
    
    // Reset streamů
    activeStreams = [];
    selectedStreamIndex = 0;

    try {
        // Získání streamů z Přehraj.to na pozadí
        const streamRes = await fetch(`/get-streams?title=${encodeURIComponent(movie.title)}`);
        const streamData = await streamRes.json();
        activeStreams = streamData.streams || [];

        // Vykreslení filmové stránky podle zaslané předlohy
        resultsDiv.innerHTML = '';
        movieDetail.style.display = 'block';
        movieDetail.style.backgroundImage = `linear-gradient(to top, #141414 10%, rgba(20,20,20,0.6) 50%, rgba(20,20,20,0.9) 100%), url('${movie.poster || BACKUP_POSTER_URL}')`;

        // Generování tlačítek DB na základě tvého 4-krokového filtru
        let dbButtons = '';
        if (movie.source === 'csfd' || movie.source === 'both') {
            dbButtons += `<a href="${movie.csfdLink}" target="_blank" class="db-btn csfd-btn">ČSFD</a>`;
        }
        if (movie.source === 'imdb' || movie.source === 'both') {
            dbButtons += `<a href="${movie.imdbLink}" target="_blank" class="db-btn imdb-btn">IMDb</a>`;
        }

        // Sestavení výběrové šipky (Dropdown)
        let streamDropdownHtml = '';
        if (activeStreams.length > 0) {
            streamDropdownHtml = `
                <select id="streamSelect" onchange="selectedStreamIndex=this.value" class="context-arrow">
                    ${activeStreams.map((s, idx) => `<option value="${idx}">${s.name}</option>`).join('')}
                </select>
            `;
        } else {
            streamDropdownHtml = `<div class="no-streams-notice">Žádný volný stream nenalezen</div>`;
        }

        document.getElementById('detailContent').innerHTML = `
            <h1 class="detail-title">${movie.title}</h1>
            
            <div class="action-row">
                <button class="btn-play" onclick="startStreaming()">▶ Přehrát</button>
                ${streamDropdownHtml}
                
                ${dbButtons}
                
                <button class="btn-download" onclick="startDownloading()">⬇ Stáhnout</button>
            </div>

            <div class="control-icons">
                <button class="icon-circle" onclick="toggleFavoriteCurrent()">＋</button>
                <button id="muteBtn" class="icon-circle" onclick="toggleMuteTrailer()">🔊</button>
            </div>

            <div class="meta-layout">
                <div class="meta-left">
                    <p><strong>Rok:</strong> ${movie.year}</p>
                    <p><strong>Hlavní obsazení:</strong> ${movie.actors || 'Není k dispozici'}</p>
                </div>
                <div class="meta-right">
                    <p>Informace a popis filmu jsou čerpány přímo z propojených filmových databází ČSFD a IMDb.</p>
                </div>
            </div>
        `;

    } catch (err) {
        resultsDiv.innerHTML = '<div class="error">Chyba při otevírání karty filmu.</div>';
    }
}

async function startStreaming() {
    if (activeStreams.length === 0) return alert("Pro tento film není dostupný žádný stream.");
    const targetLink = activeStreams[selectedStreamIndex].link;

    playerContainer.style.display = 'block';
    window.scrollTo({ top: playerContainer.offsetTop - 20, behavior: 'smooth' });
    
    document.getElementById('videoPlayer').innerHTML = "Načítám video z proxy...";

    try {
        const response = await fetch(`/get-video?url=${encodeURIComponent(targetLink)}`);
        const data = await response.json();

        if (data.error || !data.sources?.[0]?.file) return alert("Stream se nepodařilo dešifrovat.");

        videoPlayer.src = data.sources[0].file;
        videoPlayer.load();
        videoPlayer.play();
    } catch {
        alert("Chyba spojení se streamovacím serverem.");
    }
}

async function startDownloading() {
    if (activeStreams.length === 0) return alert("Není co stáhnout.");
    const targetLink = activeStreams[selectedStreamIndex].link;

    try {
        const response = await fetch(`/get-video?url=${encodeURIComponent(targetLink)}`);
        const data = await response.json();

        if (data.error || !data.sources?.[0]?.file) return alert("Odkaz ke stažení nelze vygenerovat.");

        const a = document.createElement('a');
        a.href = data.sources[0].file;
        a.download = `${currentMovieData.title}.mp4`;
        a.target = '_blank';
        a.click();
    } catch {
        alert("Chyba stahování.");
    }
}

function toggleFavoriteCurrent() {
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    if (!favorites.some(f => f.title === currentMovieData.title)) {
        favorites.push(currentMovieData);
        localStorage.setItem('favorites', JSON.stringify(favorites));
        alert("Film přidán do oblíbených!");
    } else {
        alert("Film již v oblíbených máte.");
    }
}

function toggleMuteTrailer() {
    const btn = document.getElementById('muteBtn');
    if (btn.innerText === "🔊") {
        btn.innerText = "🔇";
    } else {
        btn.innerText = "🔊";
    }
}
