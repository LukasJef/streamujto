// Pomocné prvky z DOMu
const searchInput = document.getElementById('searchQuery');
const resultsDiv = document.getElementById('results');
const playerContainer = document.getElementById('playerContainer');
const videoPlayer = document.getElementById('videoPlayer');

// Globální proměnná pro sledování aktuálně spuštěného videa pro timestampy
let currentVideoId = null;
let currentVideoTitle = null;
let currentVideoPoster = null;

// Adresa tvého záložního obrázku
const BACKUP_POSTER_URL = 'https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?q=80&w=300&auto=format&fit=crop';

// Spuštění vyhledávání při stisku Enteru
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        search();
    }
});

// Inicializace menu při načtení stránky
document.addEventListener('DOMContentLoaded', () => {
    updateCacheMenuLists();
    
    // Každých 5 sekund uložíme aktuální čas videa, pokud zrovna hraje
    setInterval(() => {
        if (videoPlayer && !videoPlayer.paused && currentVideoId) {
            saveVideoProgress(currentVideoId, currentVideoTitle, currentVideoPoster, videoPlayer.currentTime);
        }
    }, 5000);
});

// Extrémně rychlá vestavěná "AI" filtrace na hovadiny
function jeToValidniFilm(title) {
    const lowerTitle = title.toLowerCase();
    const zakazanaSlova = [
        'gameplay', 'letsplay', 'let\'s play', 'walkthrough', 'tutorial', 
        'navod', 'návod', 'soundtrack', 'ost', 'trailer', 'teaser', 'game'
    ];
    return !zakazanaSlova.some(slovo => lowerTitle.includes(slovo));
}

// 1. Funkce pro vyhledávání filmů
async function search() {
    const query = searchInput.value.trim();
    if (!query) return;

    resultsDiv.innerHTML = '<div class="loader">Hledám filmy na Přehraj.to...</div>';
    playerContainer.style.display = 'none';
    videoPlayer.pause();

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.error) {
            resultsDiv.innerHTML = `<div class="error">Chyba: ${data.error}</div>`;
            return;
        }

        if (!data.results || data.results.length === 0) {
            resultsDiv.innerHTML = '<div class="no-results">Nebyly nalezeny žádné výsledky.</div>';
            return;
        }

        const prefiltrovaneVysledky = data.results.filter(item => jeToValidniFilm(item.title));
        const top12Results = prefiltrovaneVysledky.slice(0, 12);

        if (top12Results.length === 0) {
            resultsDiv.innerHTML = '<div class="no-results">Nebyly nalezeny žádné filmové výsledky.</div>';
            return;
        }

        renderResults(top12Results);
        fetchPostersOneByOne(top12Results);

    } catch (err) {
        resultsDiv.innerHTML = '<div class="error">Chyba sítě nebo serveru.</div>';
        console.error(err);
    }
}

// 2. Vykreslení základních 12 karet
function renderResults(results) {
    resultsDiv.innerHTML = '';
    
    resultsDiv.style.display = "flex";
    resultsDiv.style.flexWrap = "wrap";
    resultsDiv.style.gap = "20px";
    resultsDiv.style.justifyContent = "center";
    resultsDiv.style.padding = "20px 0";
    
    results.forEach((item, index) => {
        const card = document.createElement('div');
        card.style.width = "180px";
        card.style.backgroundColor = "var(--card-bg)";
        card.style.padding = "12px";
        card.style.borderRadius = "6px";
        card.style.boxSizing = "border-box";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.justifyContent = "space-between";
        card.style.boxShadow = "0 4px 6px rgba(0,0,0,0.2)";
        card.style.position = "relative";

        const isFav = isFavorite(item.link);

        card.innerHTML = `
            <!-- Tlačítko pro přidání do oblíbených přímo na plakátu -->
            <button onclick="toggleFavorite('${item.link}', '${item.title.replace(/'/g, "\\'")}', document.getElementById('movie-poster-${index}').src)" 
                    style="position: absolute; top: 18px; right: 18px; background: rgba(0,0,0,0.7); border: none; color: ${isFav ? '#ffca28' : '#fff'}; font-size: 18px; padding: 5px 8px; border-radius: 4px; cursor: pointer; z-index: 10;">
                ${isFav ? '★' : '☆'}
            </button>

            <div>
                <img id="movie-poster-${index}" src="${BACKUP_POSTER_URL}" 
                     onerror="this.onerror=null; this.src='${BACKUP_POSTER_URL}';"
                     style="width: 100%; height: 240px; object-fit: cover; border-radius: 4px; background-color: #000; display: block; margin-bottom: 10px;" referrerpolicy="no-referrer">
                <h3 style="font-size: 14px; margin: 0 0 6px 0; color: var(--text); line-height: 1.3; max-height: 36px; overflow: hidden; text-align: left;">${item.title}</h3>
                <p style="font-size: 11px; color: var(--text-dim); margin: 0 0 12px 0; text-align: left;">${item.size || item.duration || 'Video'}</p>
            </div>
            <div>
                <button class="play-btn" style="width: 100%; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 6px;" onclick="playVideo('${item.link}', '${item.title.replace(/'/g, "\\'")}', document.getElementById('movie-poster-${index}').src)">Spustit</button>
                <button class="download-btn" style="width: 100%; padding: 6px; border: 1px solid #444; background: transparent; color: #ccc; border-radius: 4px; cursor: pointer; font-size: 12px;" onclick="downloadVideo('${item.link}', '${item.title.replace(/'/g, "\\'")}')">Stáhnout film</button>
            </div>
        `;
        resultsDiv.appendChild(card);
    });
}

// Pomocná funkce na porovnání podobnosti dvou textů (0 = úplně jiný, 1 = dokonalá shoda)
function calculateTextSimilarity(str1, str2) {
    const s1 = str1.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const s2 = str2.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    
    const words1 = new Set(s1.split(/\s+/).filter(w => w.length > 1));
    const words2 = new Set(s2.split(/\s+/).filter(w => w.length > 1));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    // Spočítáme, kolik slov mají společných
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size; // Jaccardův index similarity
}

// 3. Hledání plakátů na pozadí (STRIKTNÍ WHITELIST FILTR + PŘEHRAJTO FALLBACK)
async function fetchPostersOneByOne(results) {
    for (let i = 0; i < results.length; i++) {
        const item = results[i];
        const imgElement = document.getElementById(`movie-poster-${i}`);
        if (!imgElement) continue;

        // 1. Vytáhneme rok vydání z názvu (např. 2025)
        const yearMatch = item.title.match(/\b(19\d\d|20\d\d)\b/);
        const movieYear = yearMatch ? yearMatch[0] : '';

        // 2. Vyčištění názvu od balastu z Přehraj.to
        let cleanTitle = item.title
            .replace(/(1080p|720p|4k|uhd|cz|sk|dabing|titulky|hdtv|x264|bluray|phdteam|remastered|xvid|avi|mp4|camrip|kinorip|cam|komedie|akcni|sci-fi|horor|drama|sportovni)/gi, '')
            .replace(/[\._,\!\?\|"'\(\)\[\]\-–—]/g, ' ')
            .trim();

        // 3. Vytvoříme pole základních slov pro whitelist
        let whitelistWords = cleanTitle.toLowerCase()
            .split(/\s+/)
            .filter(word => word !== movieYear && word.length > 1);

        const baseQuery = whitelistWords.slice(0, 3).join(' ');
        const imdbQuery = movieYear ? `${baseQuery} ${movieYear}` : baseQuery;

        let posterUrl = null;

        try {
            const imdbApiUrl = `https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(imdbQuery)}`;
            const imdbResponse = await fetch(imdbApiUrl);

            if (imdbResponse.ok) {
                const imdbData = await imdbResponse.json();
                
                if (imdbData && imdbData.description && imdbData.description.length > 0) {
                    for (let element of imdbData.description) {
                        if (!element["#IMG_POSTER"]) continue;

                        const imdbTitle = (element["#TITLE"] || '').toLowerCase();
                        const imdbYear = element["#YEAR"];

                        const vsechnaSlovaSedi = whitelistWords.every(word => imdbTitle.includes(word));

                        let rokSedi = true;
                        if (movieYear && imdbYear) {
                            rokSedi = Math.abs(parseInt(imdbYear) - parseInt(movieYear)) <= 1;
                        }

                        if (vsechnaSlovaSedi && rokSedi) {
                            posterUrl = element["#IMG_POSTER"];
                            break; 
                        }
                    }
                }
            }
        } catch (err) {
            console.log(`Chyba vyhledávání pro: ${imdbQuery}`, err.message);
        }

        // --- Zobrazení výsledku (Chytrý Fallback) ---
        if (posterUrl) {
            // A. Máme originální plakát z IMDb
            imgElement.src = posterUrl;
            updateFavoritePoster(item.link, posterUrl);
        } else if (item.thumbnail) {
            // B. IMDb nic nenašlo -> Použijeme oříznutý náhled z Přehraj.to!
            console.log(`[Fallback] IMDb selhalo, nasazuji náhled z Přehraj.to pro: ${item.title}`);
            imgElement.src = item.thumbnail;
            updateFavoritePoster(item.link, item.thumbnail);
        } else {
            // C. Úplná nouzovka -> Žlutá klapka z Unsplashe
            if (imgElement.src !== BACKUP_POSTER_URL) {
                imgElement.src = BACKUP_POSTER_URL;
            }
        }
    }
}

// 4. Načtení konkrétního videa do přehrávače + Ověření Timestampu
async function playVideo(videoUrl, title, posterUrl) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    resultsDiv.insertAdjacentHTML('afterbegin', '<div class="loading-overlay">Načítám video stream...</div>');

    // Nastavíme globální proměnné pro autosave
    currentVideoId = videoUrl;
    currentVideoTitle = title;
    currentVideoPoster = posterUrl;

    try {
        const response = await fetch(`/get-video?url=${encodeURIComponent(videoUrl)}`);
        const data = await response.json();

        const overlay = document.querySelector('.loading-overlay');
        if (overlay) overlay.remove();

        if (data.error) {
            alert(`Nepodařilo se přehrát: ${data.error}`);
            return;
        }

        const videoSource = data.sources && data.sources[0];
        if (!videoSource || !videoSource.file) {
            alert('Nebyl nalezen žádný přehrávatelný soubor.');
            return;
        }

        playerContainer.style.display = 'block';
        videoPlayer.src = videoSource.file;

        const existingTracks = videoPlayer.querySelectorAll('track');
        existingTracks.forEach(track => track.remove());

        if (data.tracks && data.tracks.length > 0) {
            data.tracks.forEach(trackData => {
                const track = document.createElement('track');
                track.kind = 'subtitles';
                track.label = trackData.label || 'Čeština';
                track.srclang = trackData.srclang || 'cs';
                track.src = trackData.file;
                track.default = trackData.default || false;
                videoPlayer.appendChild(track);
            });
        }

        videoPlayer.load();

        // KONTROLA HISTORIE SLEDOVÁNÍ (TIMESTAMP)
        const savedTime = getVideoProgress(videoUrl);
        if (savedTime > 10) {
            // Zptáme se uživatele, zda chce pokračovat
            const odZnova = confirm(`Našli jsme rozkoukanou pozici u filmu "${title}". \n\nKlikněte na "OK" pro pokračování (odečteno 10s), nebo na "Zrušit" pro přehrávání od začátku.`);
            if (odZnova) {
                // Nastavíme čas o 10 sekund zpět (ale ne do mínusu)
                videoPlayer.currentTime = Math.max(0, savedTime - 10);
            } else {
                videoPlayer.currentTime = 0;
            }
        }

        videoPlayer.play().catch(e => {
            console.log("Automatické přehrávání zablokováno. Klikněte na Play.");
        });

    } catch (err) {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) overlay.remove();
        alert('Chyba při získávání video streamu.');
        console.error(err);
    }
}

// 5. Přímé stáhnutí souboru do PC / Mobilu
async function downloadVideo(videoUrl, title) {
    const btn = event.target;
    const puvodniText = btn.innerText;
    btn.innerText = 'Získávám odkaz...';
    btn.disabled = true;

    try {
        const response = await fetch(`/get-video?url=${encodeURIComponent(videoUrl)}`);
        const data = await response.json();

        if (data.error || !data.sources || !data.sources[0] || !data.sources[0].file) {
            alert('Nepodařilo se získat odkaz ke stažení.');
            btn.innerText = puvodniText;
            btn.disabled = false;
            return;
        }

        const directLink = data.sources[0].file;
        const a = document.createElement('a');
        a.href = directLink;
        a.download = `${title}.mp4`;
        a.target = '_blank'; 
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

    } catch (err) {
        console.error(err);
        alert('Chyba při komunikaci se serverem.');
    }

    btn.innerText = puvodniText;
    btn.disabled = false;
}


// ==========================================
// LOGIKA PRO LOCAL STORAGE & INDEX MENU
// ==========================================

// Otevření / Zavření pravého menu
function toggleCacheMenu() {
    const menu = document.getElementById('cacheMenu');
    if (menu.style.display === 'none') {
        updateCacheMenuLists();
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
}

// Pomocné funkce pro Ukládání a Načítání historie sledování
function saveVideoProgress(url, title, poster, time) {
    let history = JSON.parse(localStorage.getItem('watchHistory')) || {};
    history[url] = { title, poster, time, updated: Date.now() };
    localStorage.setItem('watchHistory', JSON.stringify(history));
    updateCacheMenuLists();
}

function getVideoProgress(url) {
    let history = JSON.parse(localStorage.getItem('watchHistory')) || {};
    return history[url] ? history[url].time : 0;
}

// Pomocné funkce pro Oblíbené filmy
function isFavorite(url) {
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    return favorites.some(item => item.url === url);
}

function toggleFavorite(url, title, poster) {
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    const index = favorites.findIndex(item => item.url === url);

    if (index > -1) {
        favorites.splice(index, 1); // Odebrat
    } else {
        favorites.push({ url, title, poster }); // Přidat
    }

    localStorage.setItem('favorites', JSON.stringify(favorites));
    
    // Refresh aktuálního stavu vyhledávání a menu
    updateCacheMenuLists();
    if (searchInput.value.trim()) {
        // Pokud zrovna něco vyhledáváme, zachováme stav hvězdiček na kartách
        const favButtons = document.querySelectorAll('button[onclick^="toggleFavorite"]');
        search(); 
    }
}

function updateFavoritePoster(url, realPoster) {
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    let history = JSON.parse(localStorage.getItem('watchHistory')) || {};
    
    let updatedFav = false;
    favorites = favorites.map(item => {
        if (item.url === url) { item.poster = realPoster; updatedFav = true; }
        return item;
    });
    
    if (history[url]) {
        history[url].poster = realPoster;
        localStorage.setItem('watchHistory', JSON.stringify(history));
    }
    
    if (updatedFav) {
        localStorage.setItem('favorites', JSON.stringify(favorites));
    }
}

// Aktualizace seznamů uvnitř Index Menu na pravé straně
function updateCacheMenuLists() {
    const historyList = document.getElementById('continueWatchingList');
    const favList = document.getElementById('favoritesList');
    
    if (!historyList || !favList) return;

    // 1. Vykreslení Rozkoukaných
    let history = JSON.parse(localStorage.getItem('watchHistory')) || {};
    // Seřadíme podle času změny, abychom viděli nejnovější nahoře
    let sortedHistory = Object.keys(history)
        .map(key => ({ url: key, ...history[key] }))
        .sort((a, b) => b.updated - a.updated)
        .slice(0, 5); // Max 5 rozkoukaných v menu

    if (sortedHistory.length === 0) {
        historyList.innerHTML = '<p style="font-size:12px; color:#777; margin:0;">Žádná rozkoukaná videa.</p>';
    } else {
        historyList.innerHTML = sortedHistory.map(item => `
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px; cursor:pointer; background:#2a2a2a; padding:6px; border-radius:4px;" onclick="playVideo('${item.url}', '${item.title.replace(/'/g, "\\'")}', '${item.poster}')">
                <img src="${item.poster}" style="width:40px; height:55px; object-fit:cover; border-radius:2px;">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:12px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title}</div>
                    <div style="font-size:10px; color:#aaa;">Zbývá od: ${Math.floor(item.time / 60)} min</div>
                </div>
            </div>
        `).join('');
    }

    // 2. Vykreslení Oblíbených
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    if (favorites.length === 0) {
        favList.innerHTML = '<p style="font-size:12px; color:#777; margin:0;">Žádné oblíbené filmy.</p>';
    } else {
        favList.innerHTML = favorites.map(item => `
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px; cursor:pointer; background:#2a2a2a; padding:6px; border-radius:4px;" onclick="playVideo('${item.url}', '${item.title.replace(/'/g, "\\'")}', '${item.poster}')">
                <img src="${item.poster}" style="width:40px; height:55px; object-fit:cover; border-radius:2px;">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:12px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title}</div>
                </div>
                <button onclick="event.stopPropagation(); toggleFavorite('${item.url}')" style="background:transparent; border:none; color:#ffca28; cursor:pointer; font-size:16px;">★</button>
            </div>
        `).join('');
    }
}
