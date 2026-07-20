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
let currentSeason = 1;
let currentEpisode = 1;

// Řízení stornování starých/neplatných požadavků
let currentFetchController = null;
let searchRequestId = 0;

const FALLBACK_POSTER = 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=300&auto=format&fit=crop';

// --- POMOCNÉ FUNKCE PRO BODOVÁNÍ A KLÍČE PRO PROGRESS ---

function getWatchKey() {
    if (!currentMovieData) return '';
    if (currentMovieData.isSeries) {
        const s = String(currentSeason).padStart(2, '0');
        const e = String(currentEpisode).padStart(2, '0');
        return `progress_${currentMovieData.title}_S${s}E${e}`;
    }
    return `progress_${currentMovieData.title}`;
}

function parseSizeToGB(stream) {
    if (stream.size && typeof stream.size === 'number') {
        return stream.size / (1024 * 1024 * 1024);
    }
    
    if (stream.size && typeof stream.size === 'string') {
        const sizeText = stream.size.toLowerCase();
        const gbMatch = sizeText.match(/(\d+(?:[.,]\d+)?)\s*gb/);
        if (gbMatch) return parseFloat(gbMatch[1].replace(',', '.'));
        
        const mbMatch = sizeText.match(/(\d+(?:[.,]\d+)?)\s*mb/);
        if (mbMatch) return parseFloat(mbMatch[1].replace(',', '.')) / 1024;
    }
    
    const nameLower = String(stream.name || '').toLowerCase();
    const gbMatchName = nameLower.match(/(\d+(?:[.,]\d+)?)\s*gb/);
    if (gbMatchName) return parseFloat(gbMatchName[1].replace(',', '.'));
    
    const mbMatchName = nameLower.match(/(\d+(?:[.,]\d+)?)\s*mb/);
    if (mbMatchName) return parseFloat(mbMatchName[1].replace(',', '.')) / 1024;

    return 0;
}

// --- NOVÉ: Extrakce délky v minutách z názvu streamu ---
function parseDurationToMinutes(text) {
    if (!text) return 0;
    const str = String(text);
    // Hledá časové kódy v názvu, např. (01:58:07) nebo (58:30)
    const timeMatch = str.match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);
    if (timeMatch) {
        const hours = timeMatch[1] ? parseInt(timeMatch[1], 10) : 0;
        const minutes = parseInt(timeMatch[2], 10);
        return (hours * 60) + minutes;
    }
    const minMatch = str.match(/(\d+)\s*min/i);
    if (minMatch) return parseInt(minMatch[1], 10);
    return 0;
}

// --- NOVÉ: Bodové ohodnocení shody délky ---
function getDurationScore(streamMinutes, expectedMinutes) {
    if (!streamMinutes || !expectedMinutes) return 0;
    const diff = Math.abs(streamMinutes - expectedMinutes);
    if (diff <= 3) return 50;        // Perfektní shoda
    if (diff <= 10) return -20;      // Drobné odchylky (jiné úvodní/závěrečné znělky)
    return -150;                     // Velká odchylka (trailer, ukázka, jiný film)
}

function isWrongSequel(streamName, movieTitle) {
    if (currentMovieData && currentMovieData.isSeries) return false;

    let cleanTitle = String(movieTitle || '').toLowerCase().replace(/\b(19|20)\d{2}\b/g, ' ');
    let cleanStream = String(streamName || '').toLowerCase().replace(/\b(19|20)\d{2}\b/g, ' ');

    cleanStream = cleanStream.replace(/\b(2\.0|5\.1|7\.1)\b/g, ' ');
    cleanStream = cleanStream.replace(/\b(480|576|720|1080|2160)p?\b/g, ' ');

    let moviePart = 1;
    const moviePartMatch = cleanTitle.match(/\b([1-9]|10)\b/);
    if (moviePartMatch) {
        moviePart = parseInt(moviePartMatch[1], 10);
    }

    let streamPart = 1;
    const streamPartMatch = cleanStream.match(/\b([1-9]|10)\b/);
    if (streamPartMatch) {
        streamPart = parseInt(streamPartMatch[1], 10);
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

// Vykreslení mřížky výsledků
function renderGrid(movies, targetElement, lazyLoadPosters = false) {
    targetElement.innerHTML = '';

    movies.forEach(movie => {
        const movieTitle = movie.nazev || movie.title;
        const movieYear = movie.rok || movie.year || '';
        const csfdUrl = movie.csfd_url || movie.csfdLink;

        const card = document.createElement('div');
        card.className = "movie-card";
        card.id = `card-${btoa(encodeURIComponent(movieTitle)).replace(/=/g, '')}`;
        card.onclick = () => openMovieDetail({ ...movie, title: movieTitle, year: movieYear, csfdLink: csfdUrl });

        const progress = getWatchProgressForCard(movieTitle, movie.isSeries);
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
                <h3>${movieTitle}</h3>
                <p>${movieYear}</p>
            </div>
            ${progressBarHtml}
        `;
        targetElement.appendChild(card);

        if (lazyLoadPosters && csfdUrl) {
            fetch(`/csfd-scrape?url=${encodeURIComponent(csfdUrl)}`)
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

// Přechod na detail filmu / seriálu
async function openMovieDetail(movie) {
    currentMovieData = movie;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    movieDetail.style.display = 'block';
    document.getElementById('detailContent').innerHTML = '<div class="loader">Sosám data z ČSFD a připravuji streamy...</div>';
    movieDetail.style.backgroundImage = 'none';

    const csfdTargetUrl = movie.csfd_url || movie.csfdLink;
    const imdbTargetUrl = movie.imdbLink || movie.imdb_url || movie.imdbUrl; 

    try {
        let deepDetails = { 
            poster: movie.poster || FALLBACK_POSTER, 
            description: 'Popis filmu se připravuje.', 
            actors: movie.actors || '', 
            genres: 'Film', 
            rating: null,
            isSeries: false,
            runtime: null // NOVÉ: Uložení délky filmu
        };
        
        if (csfdTargetUrl) {
            try {
                const detailRes = await fetch(`/csfd-scrape?url=${encodeURIComponent(csfdTargetUrl)}`);
                if (detailRes.ok) {
                    const scrapedData = await detailRes.json();
                    deepDetails.poster = (scrapedData.poster && scrapedData.poster.trim() !== "") ? scrapedData.poster : deepDetails.poster;
                    deepDetails.description = scrapedData.description || deepDetails.description;
                    deepDetails.actors = scrapedData.cast || deepDetails.actors;
                    deepDetails.genres = scrapedData.genres || deepDetails.genres;
                    deepDetails.rating = scrapedData.rating || null;
                    deepDetails.isSeries = scrapedData.isSeries || false;

                    // NOVÉ: Extrakce délky z ČSFD dat
                    if (scrapedData.duration || scrapedData.runtime) {
                        const durStr = String(scrapedData.duration || scrapedData.runtime);
                        const numMatch = durStr.match(/\d+/);
                        if (numMatch) deepDetails.runtime = parseInt(numMatch[0], 10);
                    }
                }
            } catch (e) { 
                console.log("ČSFD Scraper nedostupný."); 
            }
        }

        currentMovieData.isSeries = deepDetails.isSeries;
        currentMovieData.poster = deepDetails.poster;
        currentMovieData.description = deepDetails.description;
        currentMovieData.actors = deepDetails.actors;
        currentMovieData.genres = deepDetails.genres;
        currentMovieData.runtime = deepDetails.runtime; // NOVÉ

        // Pokud jde o seriál, načteme naposledy zvolenou řadu/díl
        if (currentMovieData.isSeries) {
            const lastEp = JSON.parse(localStorage.getItem(`last_ep_${currentMovieData.title}`)) || { season: 1, episode: 1 };
            currentSeason = parseInt(lastEp.season, 10) || 1;
            currentEpisode = parseInt(lastEp.episode, 10) || 1;
        }

        movieDetail.style.backgroundImage = `linear-gradient(to top, #0c0c0c 12%, rgba(12,12,12,0.4) 50%, rgba(12,12,12,0.85) 100%), url('${currentMovieData.poster}')`;

        let dbButtons = '';
        if (csfdTargetUrl) {
            dbButtons += `<a href="${csfdTargetUrl}" target="_blank" rel="noopener" class="db-btn-csfd">ČSFD ${deepDetails.rating ? `(${deepDetails.rating}%)` : ''}</a>`;
        }
        if (imdbTargetUrl) {
            dbButtons += `<a href="${imdbTargetUrl}" target="_blank" rel="noopener" class="db-btn-imdb">IMDb</a>`;
        }

        let seriesControlsHtml = '';
        if (currentMovieData.isSeries) {
            seriesControlsHtml = `
                <div class="series-select-wrapper">
                    <label>Řada:</label>
                    <select id="seasonSelect" onchange="onEpisodeOrSeasonChange()">
                        ${[...Array(15).keys()].map(i => `<option value="${i+1}" ${i+1 === currentSeason ? 'selected' : ''}>${i+1}</option>`).join('')}
                    </select>
                    
                    <label>Díl:</label>
                    <select id="episodeSelect" onchange="onEpisodeOrSeasonChange()">
                        ${[...Array(30).keys()].map(i => `<option value="${i+1}" ${i+1 === currentEpisode ? 'selected' : ''}>${i+1}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        const isFav = isMovieInFavorites(movie.title);

        document.getElementById('detailContent').innerHTML = `
            <h1 class="detail-title">${movie.title}</h1>
            
            <div class="action-row">
                <button class="btn-play" onclick="startStreaming()">▶ Přehrát</button>
                ${seriesControlsHtml}
                <div id="streamSelectWrapper">
                    <span style="color:var(--text-dim);font-size:14px;">Načítám streamy...</span>
                </div>
                ${dbButtons}
                <button class="btn-download" onclick="startDownloading()">⬇ Stáhnout</button>
            </div>

            <div class="control-icons">
                <button id="favBtn" class="icon-circle" onclick="toggleFavoriteCurrent()">${isFav ? '★' : '＋'}</button>
            </div>

            <div class="meta-layout">
                <div class="meta-left">
                    <p style="color:var(--accent); font-weight:bold; font-size:18px; margin-bottom:10px;">${deepDetails.genres}</p>
                    <p style="margin-bottom:15px;"><strong>Rok:</strong> ${movie.year || 'Neznámý'}</p>
                    <p style="color:var(--text-dim); line-height:1.6; font-size:15px;">${deepDetails.description}</p>
                </div>
                <div class="meta-right">
                    <p><strong>Hrají / Tvorba:</strong><br><span style="color:var(--text-dim); font-size:14px;">${deepDetails.actors || 'Neznámé.'}</span></p>
                </div>
            </div>
        `;

        // Načteme streamy pro zvolený film nebo konkrétní díl seriálu
        await fetchAndRenderStreams();
        addToHistory(currentMovieData);

    } catch (err) {
        document.getElementById('detailContent').innerHTML = '<div class="error">Chyba při načítání detailu filmu.</div>';
    }
}

// Vyhledání a obnova dropdownu se streamy
async function fetchAndRenderStreams() {
    const streamWrapper = document.getElementById('streamSelectWrapper');
    if (!streamWrapper) return;

    // 1. Zrušíme případný rozehraný dotaz, aby nás starší nevalidní data nepřepsala
    if (currentFetchController) {
        currentFetchController.abort();
    }
    currentFetchController = new AbortController();
    const signal = currentFetchController.signal;

    // Unikátní sekvenční ID pro tento konkrétní požadavek
    const thisRequestId = ++searchRequestId;

    streamWrapper.innerHTML = '<span style="color:var(--text-dim);font-size:14px;">Hledám streamy...</span>';

    currentSeason = parseInt(currentSeason, 10) || 1;
    currentEpisode = parseInt(currentEpisode, 10) || 1;

    let searchQuery = currentMovieData.title;
    if (currentMovieData.isSeries) {
        const s = String(currentSeason).padStart(2, '0');
        const e = String(currentEpisode).padStart(2, '0');
        searchQuery += ` S${s}E${e}`;

        // Uložíme do paměti naposledy vybranou řadu/díl
        localStorage.setItem(`last_ep_${currentMovieData.title}`, JSON.stringify({ season: currentSeason, episode: currentEpisode }));
    }

    try {
        // Dotaz se zachovanou původní syntaxí URL
        const streamRes = await fetch(`/get-streams?title=${encodeURIComponent(searchQuery)}&_t=${Date.now()}`, { signal });
        const streamData = await streamRes.json();
        
        // Pokud uživatel mezitím kliknul jinam, tento vypršený výsledek zahodíme
        if (thisRequestId !== searchRequestId) return;

        let rawStreams = streamData.streams || [];

        // FALLBACK: Pokud server nenašel formát "S01E05", zkusí tvar "1x05"
        if (rawStreams.length === 0 && currentMovieData.isSeries) {
            const altQuery = `${currentMovieData.title} ${currentSeason}x${String(currentEpisode).padStart(2, '0')}`;
            const altRes = await fetch(`/get-streams?title=${encodeURIComponent(altQuery)}&_t=${Date.now()}`, { signal });
            const altData = await altRes.json();

            if (thisRequestId !== searchRequestId) return;
            rawStreams = altData.streams || [];
        }

        activeStreams = rawStreams.map(stream => {
            let score = 100;
            const nameLower = stream.name.toLowerCase();
            const sizeInGB = parseSizeToGB(stream);

            // --- NOVÉ: Bodování podle délky (stopáže) ---
            if (!currentMovieData.isSeries && currentMovieData.runtime) {
                const streamMinutes = parseDurationToMinutes(stream.name);
                if (streamMinutes > 0) {
                    score += getDurationScore(streamMinutes, currentMovieData.runtime);
                }
            }

            if (isWrongSequel(stream.name, currentMovieData.title)) score -= 80;

            if (sizeInGB > 0) {
                if (sizeInGB >= 1.3) score += 30;
                if (sizeInGB < 0.4) score -= 60;
            }

            if (nameLower.includes('soundtrack') || nameLower.includes('trailer') || nameLower.includes('ukázka') || nameLower.includes('ost')) {
                score -= 60;
            }

            if (nameLower.includes('cz') || nameLower.includes('dabing') || nameLower.includes('czdab')) score += 15;
            if (nameLower.includes('titulky') || nameLower.includes('cztit')) score += 5;

            let sizeDisplay = "";
            if (sizeInGB > 0) {
                sizeDisplay = sizeInGB >= 1.0 ? `[${sizeInGB.toFixed(1)} GB] ` : `[${(sizeInGB * 1024).toFixed(0)} MB] `;
            } else if (stream.size && typeof stream.size === 'string') {
                sizeDisplay = `[${stream.size}] `;
            }

            return { ...stream, score: score, sizeDisplay: sizeDisplay };
        });

        activeStreams.sort((a, b) => b.score - a.score);

        if (activeStreams.length > 0) {
            streamWrapper.innerHTML = `
                <div class="context-select-wrapper">
                    <select id="streamSelect" class="context-arrow">
                        ${activeStreams.map((s, idx) => `<option value="${idx}">${s.sizeDisplay}${s.name}</option>`).join('')}
                    </select>
                </div>
            `;
        } else {
            const epTag = `S${String(currentSeason).padStart(2,'0')}E${String(currentEpisode).padStart(2,'0')}`;
            streamWrapper.innerHTML = `<span style="color:var(--text-dim);font-size:14px;">Žádný stream pro ${currentMovieData.isSeries ? epTag : 'film'} nenalezen</span>`;
        }
    } catch (e) {
        if (e.name === 'AbortError') return; // Zrušené požadavky ignorujeme
        if (thisRequestId === searchRequestId) {
            streamWrapper.innerHTML = `<span style="color:var(--accent);font-size:14px;">Chyba načítání streamů</span>`;
        }
    }
}

// Změna v rozevíracím seznamu Řada / Díl
function onEpisodeOrSeasonChange() {
    const sSelect = document.getElementById('seasonSelect');
    const eSelect = document.getElementById('episodeSelect');

    if (sSelect) currentSeason = parseInt(sSelect.value, 10) || 1;
    if (eSelect) currentEpisode = parseInt(eSelect.value, 10) || 1;

    // Zastavíme případně běžící video
    if (playerContainer.style.display === 'block') {
        videoPlayer.pause();
        playerContainer.style.display = 'none';
    }

    fetchAndRenderStreams();
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
                
                const savedProgress = getWatchProgress();
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
                const fileNameSuffix = currentMovieData.isSeries ? ` S${String(currentSeason).padStart(2,'0')}E${String(currentEpisode).padStart(2,'0')}` : '';
                a.download = `${currentMovieData.title}${fileNameSuffix}.mp4`;
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
        
        const storageKey = getWatchKey();
        if (storageKey) {
            localStorage.setItem(storageKey, JSON.stringify(progress));
        }
    });
}

function getWatchProgress() {
    const key = getWatchKey();
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
}

function getWatchProgressForCard(title, isSeries) {
    let key = `progress_${title}`;
    if (isSeries) {
        const lastEp = JSON.parse(localStorage.getItem(`last_ep_${title}`));
        if (lastEp) {
            const s = String(lastEp.season).padStart(2, '0');
            const e = String(lastEp.episode).padStart(2, '0');
            key = `progress_${title}_S${s}E${e}`;
        }
    }
    const data = localStorage.getItem(key);
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

    if (favorites.length === 0) favGrid.innerHTML = '<div style="color:var(--text-dim); padding:10px;">Žádné oblíbené filmy ani seriály.</div>';
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
