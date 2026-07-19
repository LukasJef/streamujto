const searchInput = document.getElementById('searchQuery');
const resultsContainer = document.getElementById('resultsContainer');
const resultsDiv = document.getElementById('results');
const movieDetail = document.getElementById('movieDetail');
const playerContainer = document.getElementById('playerContainer');
const videoPlayer = document.getElementById('videoPlayer');
const libraryContainer = document.getElementById('libraryContainer');
const resumeToast = document.getElementById('resumeToast');

let activeStreams = [];
let currentMovieData = null;

const FALLBACK_POSTER = 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=300&auto=format&fit=crop';

// Pomocná funkce pro extrakci čísla dílu
function extractSequelNumber(text) {
    let clean = String(text || '').toLowerCase();
    clean = clean.replace(/\b(19|20)\d{2}\b/g, ' '); // Ignorovat roky

    const arabicMatch = clean.match(/\b([1-9]|10)\b/);
    if (arabicMatch) return parseInt(arabicMatch[1], 10);

    const romanMatch = clean.match(/\b(i{1,3}|iv|v|vi{1,3}|ix|x)\b/);
    if (romanMatch) {
        const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
        return romanMap[romanMatch[1]];
    }
    return 1;
}

// Pomocná funkce pro detekci velikosti souboru v GB z textu nebo vlastnosti
function parseSizeToGB(stream) {
    // Pokud API vrací velikost přímo jako číslo v bajtech
    if (stream.size && typeof stream.size === 'number') {
        return stream.size / (1024 * 1024 * 1024);
    }
    
    // Jinak se pokusíme velikost vyčíst z názvu souboru (často bývá např. "Film (1.8 GB).mp4" nebo "700 MB")
    const text = String(stream.size || stream.name || '').toLowerCase();
    const gbMatch = text.match(/(\d+(?:\.\d+)?)\s*gb/);
    if (gbMatch) return parseFloat(gbMatch[1]);
    
    const mbMatch = text.match(/(\d+(?:\.\d+)?)\s*mb/);
    if (mbMatch) return parseFloat(mbMatch[1]) / 1024;

    return 1.0; // Výchozí odhad, pokud velikost vůbec nezjistíme
}

window.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    setupPositionTracker();
});

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') search();
});

function showMainPage() {
    movieDetail.style.display = 'none';
    playerContainer.style.display = 'none';
    videoPlayer.pause();
    resultsContainer.style.display = 'none';
    libraryContainer.style.display = 'block';
    loadLibrary();
}

async function search() {
    const query = searchInput.value.trim();
    if (!query) return;

    libraryContainer.style.display = 'none';
    movieDetail.style.display = 'none';
    playerContainer.style.display = 'none';
    videoPlayer.pause();
    
    resultsContainer.style.display = 'block';
    resultsDiv.innerHTML = '<div class="loader">Prohledávám filmové databáze...</div>';

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.error || !data.results || data.results.length === 0) {
            resultsDiv.innerHTML = '<div class="no-results">Nebylo nic nalezeno.</div>';
            return;
        }

        renderGrid(data.results, resultsDiv, true);
    } catch (err) {
        resultsDiv.innerHTML = '<div class="error">Chyba sítě při vyhledávání.</div>';
    }
}

function renderGrid(movies, targetElement, lazyLoadPosters = false) {
    targetElement.innerHTML = '';

    movies.forEach(movie => {
        const card = document.createElement('div');
        card.className = "movie-card";
        card.id = `card-${btoa(encodeURIComponent(movie.title)).replace(/=/g, '')}`;
        card.onclick = () => openMovieDetail(movie);

        const progress = getWatchProgress(movie.title);
        let progressBarHtml = '';
        if (progress && progress.percent > 1) {
            progressBarHtml = `
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${progress.percent}%"></div>
                </div>
            `;
        }

        card.innerHTML = `
            <img id="img-${card.id}" src="${movie.poster || FALLBACK_POSTER}" referrerpolicy="no-referrer" onerror="this.src='${FALLBACK_POSTER}';">
            <div class="card-info">
                <h3>${movie.title}</h3>
                <p>${movie.year}</p>
            </div>
            ${progressBarHtml}
        `;
        targetElement.appendChild(card);

        if (lazyLoadPosters && movie.csfdLink) {
            fetch(`/get-movie-details?url=${encodeURIComponent(movie.csfdLink)}`)
                .then(res => res.json())
                .then(details => {
                    if (details.poster && details.poster.trim() !== "") {
                        movie.poster = details.poster;
                        const imgEl = document.getElementById(`img-${card.id}`);
                        if (imgEl) imgEl.src = details.poster;
                    }
                }).catch(() => {});
        }
    });
}

async function openMovieDetail(movie) {
    currentMovieData = movie;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    movieDetail.style.display = 'block';
    document.getElementById('detailContent').innerHTML = '<div class="loader">Vyhledávám data a připravuji streamy...</div>';
    movieDetail.style.backgroundImage = 'none';

    try {
        let deepDetails = { 
            poster: movie.poster, 
            description: 'Popis filmu se připravuje.', 
            actors: movie.actors, 
            genres: 'Film', 
            trailerUrl: '' 
        };
        
        if (movie.csfdLink) {
            try {
                const detailRes = await fetch(`/get-movie-details?url=${encodeURIComponent(movie.csfdLink)}`);
                if (detailRes.ok) {
                    const scrapedData = await detailRes.json();
                    deepDetails.poster = (scrapedData.poster && scrapedData.poster.trim() !== "") ? scrapedData.poster : movie.poster;
                    deepDetails.description = scrapedData.description || deepDetails.description;
                    deepDetails.actors = scrapedData.actors || deepDetails.actors;
                    deepDetails.genres = scrapedData.genres || deepDetails.genres;
                    deepDetails.trailerUrl = scrapedData.trailerUrl || '';
                }
            } catch (e) { console.log("ČSFD Scraper nedostupný."); }
        }

        const targetSequel = extractSequelNumber(movie.title);

        // Načtení surových streamů
        const streamRes = await fetch(`/get-streams?title=${encodeURIComponent(movie.title)}`);
        const streamData = await streamRes.json();
        const rawStreams = streamData.streams || [];

        // ZDE ZAČÍNÁ NOVÝ BODOVACÍ ENGINE (SCORING SYSTÉM)
        activeStreams = rawStreams.map(stream => {
            let score = 0;
            const streamNameLower = stream.name.toLowerCase();
            const sizeInGB = parseSizeToGB(stream);

            // 1. FILTR VELIKOSTI (Tvůj nápad)
            if (sizeInGB >= 1.5) {
                score += 60; // Velký bonus pro plnohodnotné filmy
            } else if (sizeInGB < 0.4) {
                score -= 100; // Obří penalizace pro soundtracky, trailery a balast
            }

            // 2. KONTROLA DÍLU (SEQUELU)
            const streamSequel = extractSequelNumber(stream.name);
            if (streamSequel === targetSequel) {
                score += 40; // Odpovídá hledanému dílu
            } else {
                score -= 80; // Penalizace, pokud jde očividně o jiný díl (např. v názvu je "2" ale hledáme "1")
            }

            // 3. JAZYKOVÝ BONUS (Preferujeme lokalizované verze)
            if (streamNameLower.includes('cz') || streamNameLower.includes('dabing') || streamNameLower.includes('czdab')) {
                score += 15;
            }
            if (streamNameLower.includes('titulky') || streamNameLower.includes('cztit')) {
                score += 5;
            }

            return { ...stream, score: score };
        });

        // Seřadíme streamy sestupně – nejvyšší skóre (nejlepší shoda a velikost) bude nahoře
        activeStreams.sort((a, b) => b.score - a.score);

        currentMovieData.poster = deepDetails.poster || FALLBACK_POSTER;
        currentMovieData.description = deepDetails.description;
        currentMovieData.actors = deepDetails.actors;
        currentMovieData.genres = deepDetails.genres;

        movieDetail.style.backgroundImage = `linear-gradient(to top, #0c0c0c 12%, rgba(12,12,12,0.4) 50%, rgba(12,12,12,0.85) 100%), url('${currentMovieData.poster}')`;

        let dbButtons = '';
        if (movie.source === 'csfd' || movie.source === 'both') {
            dbButtons += `<a href="${movie.csfdLink}" target="_blank" class="db-btn-csfd">ČSFD</a>`;
        }
        if (movie.source === 'imdb' || movie.source === 'both' || movie.imdbLink) {
            const finalImdbUrl = movie.imdbLink || `https://www.imdb.com/title/${movie.id}`;
            dbButtons += `<a href="${finalImdbUrl}" target="_blank" class="db-btn-imdb">IMDb</a>`;
        }

        let streamDropdownHtml = '';
        if (activeStreams.length > 0) {
            // Do závorky vedle názvu souboru pro přehlednost vypíšeme vypočítané skóre kvality
            streamDropdownHtml = `
                <div class="context-select-wrapper">
                    <select id="streamSelect" class="context-arrow">
                        ${activeStreams.map((s, idx) => `<option value="${idx}">${s.name} (Match: ${s.score}p)</option>`).join('')}
                    </select>
                </div>
            `;
        } else {
            streamDropdownHtml = `<span style="color:var(--text-dim);font-size:14px;">Žádné soubory nebyly nalezeny</span>`;
        }

        const isFav = isMovieInFavorites(movie.title);

        document.getElementById('detailContent').innerHTML = `
            ${deepDetails.trailerUrl ? `
                <video id="bgTrailerVideo" autoplay loop muted playsinline style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index:-1; opacity:0.25;">
                    <source src="${deepDetails.trailerUrl}" type="video/mp4">
                </video>
            ` : ''}

            <h1 class="detail-title">${movie.title}</h1>
            
            <div class="action-row">
                <button class="btn-play" ${activeStreams.length === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} onclick="startStreaming()">▶ Přehrát</button>
                ${streamDropdownHtml}
                
                ${dbButtons}
                
                <button class="btn-download" ${activeStreams.length === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} onclick="startDownloading()">⬇ Stáhnout</button>
            </div>

            <div class="control-icons">
                <button id="favBtn" class="icon-circle" onclick="toggleFavoriteCurrent()">${isFav ? '★' : '＋'}</button>
                <button id="muteBtn" class="icon-circle" onclick="toggleMuteTrailer()">🔇</button>
            </div>

            <div class="meta-layout">
                <div class="meta-left">
                    <p style="color:var(--accent); font-weight:bold; font-size:18px; margin-bottom:10px;">${deepDetails.genres}</p>
                    <p style="margin-bottom:15px;"><strong>Rok:</strong> ${movie.year} • <strong>Spárováno přes:</strong> ${movie.source.toUpperCase()}</p>
                    <p style="color:var(--text-dim); line-height:1.6; font-size:15px;">${deepDetails.description}</p>
                </div>
                <div class="meta-right">
                    <p><strong>Obsazení a tvorba:</strong><br><span style="color:var(--text-dim); font-size:14px;">${deepDetails.actors || 'Neznámé.'}</span></p>
                </div>
            </div>
        `;

        addToHistory(currentMovieData);

    } catch (err) {
        document.getElementById('detailContent').innerHTML = '<div class="error">Chyba při sestavování detailu.</div>';
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
                
                const savedProgress = getWatchProgress(currentMovieData.title);
                if (savedProgress && savedProgress.time > 5) {
                    videoPlayer.currentTime = savedProgress.time;
                    showResumeToast();
                }
                
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

function setupPositionTracker() {
    videoPlayer.addEventListener('timeupdate', () => {
        if (!currentMovieData || videoPlayer.duration === 0) return;
        const progress = {
            time: videoPlayer.currentTime,
            percent: (videoPlayer.currentTime / videoPlayer.duration) * 100
        };
        localStorage.setItem(`progress_${currentMovieData.title}`, JSON.stringify(progress));
    });
}

function getWatchProgress(title) {
    const data = localStorage.getItem(`progress_${title}`);
    return data ? JSON.parse(data) : null;
}

function showResumeToast() {
    resumeToast.style.display = 'block';
    setTimeout(() => { resumeToast.style.display = 'none'; }, 4000);
}

function loadLibrary() {
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    let history = JSON.parse(localStorage.getItem('watch_history')) || [];

    const favGrid = document.getElementById('favoritesGrid');
    const histGrid = document.getElementById('historyGrid');

    if (favorites.length === 0) favGrid.innerHTML = '<div style="color:var(--text-dim); padding:10px;">Žádné oblíbené filmy.</div>';
    else renderGrid(favorites, favGrid, false);

    if (history.length === 0) histGrid.innerHTML = '<div style="color:var(--text-dim); padding:10px;">Žádná historie sledování.</div>';
    else renderGrid(history, histGrid, false);
}

function addToHistory(movie) {
    let history = JSON.parse(localStorage.getItem('watch_history')) || [];
    history = history.filter(h => h.title !== movie.title);
    history.unshift(movie);
    localStorage.setItem('watch_history', JSON.stringify(history.slice(0, 12)));
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
