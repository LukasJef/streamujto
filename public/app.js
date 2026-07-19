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

// --- POMOCNÉ FUNKCE PRO INTELIGENTNÍ ŘAZENÍ STREAMŮ ---

// Vytáhne velikost přímo z metadat souboru (případně z názvu jako záloha)
function parseSizeToGB(stream) {
    // 1. Pokud backend posílá velikost přímo jako číslo v bajtech (nejlepší případ)
    if (stream.size && typeof stream.size === 'number') {
        return stream.size / (1024 * 1024 * 1024);
    }
    
    // 2. Pokud backend posílá velikost jako samostatný textový údaj (např. stream.size = "1.8 GB")
    if (stream.size && typeof stream.size === 'string') {
        const sizeText = stream.size.toLowerCase();
        const gbMatch = sizeText.match(/(\d+(?:[.,]\d+)?)\s*gb/);
        if (gbMatch) return parseFloat(gbMatch[1].replace(',', '.'));
        
        const mbMatch = sizeText.match(/(\d+(?:[.,]\d+)?)\s*mb/);
        if (mbMatch) return parseFloat(mbMatch[1].replace(',', '.')) / 1024;
    }
    
    // 3. Nouzová záloha: Pokud pole size chybí, zkusíme to vyčíst z názvu souboru
    const nameLower = String(stream.name || '').toLowerCase();
    const gbMatchName = nameLower.match(/(\d+(?:[.,]\d+)?)\s*gb/);
    if (gbMatchName) return parseFloat(gbMatchName[1].replace(',', '.'));
    
    const mbMatchName = nameLower.match(/(\d+(?:[.,]\d+)?)\s*mb/);
    if (mbMatchName) return parseFloat(mbMatchName[1].replace(',', '.')) / 1024;

    return 0; // Velikost nelze zjistit
}

// Zkontroluje, zda stream prokazatelně nepatří jinému dílu (sequelu) než hledaný film
function isWrongSequel(streamName, movieTitle) {
    let cleanTitle = String(movieTitle || '').toLowerCase().replace(/\b(19|20)\d{2}\b/g, ' ');
    let cleanStream = String(streamName || '').toLowerCase().replace(/\b(19|20)\d{2}\b/g, ' ');

    // Odstraníme běžné audio formáty a rozlišení, aby nevznikaly falešné shody (např. 5.1 -> 5. díl)
    cleanStream = cleanStream.replace(/\b(2\.0|5\.1|7\.1)\b/g, ' ');
    cleanStream = cleanStream.replace(/\b(480|576|720|1080|2160)p?\b/g, ' ');

    // Zjistíme díl filmu (výchozí je 1)
    let moviePart = 1;
    const moviePartMatch = cleanTitle.match(/\b([1-9]|10)\b/);
    if (moviePartMatch) {
        moviePart = parseInt(moviePartMatch[1], 10);
    } else {
        const movieRomanMatch = cleanTitle.match(/\b(i{1,3}|iv|v|vi{1,3}|ix|x)\b/);
        if (movieRomanMatch) {
            const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
            moviePart = romanMap[movieRomanMatch[1]];
        }
    }

    // Zjistíme díl streamu (výchozí je 1)
    let streamPart = 1;
    const streamPartMatch = cleanStream.match(/\b([1-9]|10)\b/);
    if (streamPartMatch) {
        streamPart = parseInt(streamPartMatch[1], 10);
    } else {
        const streamRomanMatch = cleanStream.match(/\b(i{1,3}|iv|v|vi{1,3}|ix|x)\b/);
        if (streamRomanMatch) {
            const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
            streamPart = romanMap[streamRomanMatch[1]];
        }
    }

    return moviePart !== streamPart;
}

// Spuštění po načtení stránky
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

// Opravené vykreslení mřížky s okamžitým IMDb plakátem a inteligentním líným načítáním
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

// Opravený přechod na detail filmu (Prioritizuje ČSFD, ale drží IMDb jako tvrdou zálohu)
async function openMovieDetail(movie) {
    currentMovieData = movie;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    movieDetail.style.display = 'block';
    document.getElementById('detailContent').innerHTML = '<div class="loader">Sosám data z ČSFD/IMDb a připravuji streamy...</div>';
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
            } catch (e) { console.log("ČSFD Scraper nedostupný, přecházím na IMDb metadata."); }
        }

        const streamRes = await fetch(`/get-streams?title=${encodeURIComponent(movie.title)}`);
        const streamData = await streamRes.json();
        const rawStreams = streamData.streams || [];

        // --- ZDE PROBÍHÁ BEZPEČNÉ BODOVÁNÍ NA ZÁKLADĚ INFORMACÍ O SOUBORU ---
        activeStreams = rawStreams.map(stream => {
            let score = 100; // Každý soubor začíná na 100 bodech
            const nameLower = stream.name.toLowerCase();
            const sizeInGB = parseSizeToGB(stream);

            // 1. Penalizace za očividně jiný díl (sequel)
            if (isWrongSequel(stream.name, movie.title)) {
                score -= 80;
            }

            // 2. Vyhodnocení velikosti souboru z informací
            if (sizeInGB > 0) {
                if (sizeInGB >= 1.3) score += 30; // Bonus pro plnohodnotné filmařské releasy
                if (sizeInGB < 0.4) score -= 60; // Penalizace pro prokazatelně malé soubory (soundtracky)
            }

            // 3. Odstranění balastu podle textových klíčových slov
            if (nameLower.includes('soundtrack') || nameLower.includes('trailer') || nameLower.includes('ukázka') || nameLower.includes('ost')) {
                score -= 60;
            }

            // 4. Jazykové preference
            if (nameLower.includes('cz') || nameLower.includes('dabing') || nameLower.includes('czdab')) {
                score += 15;
            }
            if (nameLower.includes('titulky') || nameLower.includes('cztit')) {
                score += 5;
            }

            // Příprava popisku velikosti do dropdownu
            let sizeDisplay = "";
            if (sizeInGB > 0) {
                sizeDisplay = sizeInGB >= 1.0 ? `[${sizeInGB.toFixed(1)} GB] ` : `[${(sizeInGB * 1024).toFixed(0)} MB] `;
            } else if (stream.size && typeof stream.size === 'string') {
                sizeDisplay = `[${stream.size}] `; // Pokud backend vrátil hezký text rovnou
            }

            return { ...stream, score: score, sizeDisplay: sizeDisplay };
        });

        // Seřadíme soubory podle finálního skóre dolů
        activeStreams.sort((a, b) => b.score - a.score);
        // --- KONEC BODOVÁNÍ ---

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
            const finalImdbUrl = movie.imdbLink || `https://www.imdb.com/find?q=${encodeURIComponent(movie.title)}`;
            dbButtons += `<a href="${finalImdbUrl}" target="_blank" class="db-btn-imdb">IMDb</a>`;
        }

        let streamDropdownHtml = '';
        if (activeStreams.length > 0) {
            streamDropdownHtml = `
                <div class="context-select-wrapper">
                    <select id="streamSelect" class="context-arrow">
                        ${activeStreams.map((s, idx) => `<option value="${idx}">${s.sizeDisplay}${s.name}</option>`).join('')}
                    </select>
                </div>
            `;
        } else {
            streamDropdownHtml = `<span style="color:var(--text-dim);font-size:14px;">Žádný filmový stream nenalezen</span>`;
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
        document.getElementById('detailContent').innerHTML = '<div class="error">Chyba při sestavování karty s IMDb fallbackem.</div>';
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
