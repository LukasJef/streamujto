let trailerMuted = true;
let currentMovie = null;
let selectedFile = null; 
let currentMoviesArray = [];
let availableFiles = [];

// UKLÁDÁNÍ GLOBÁLNÍCH EVENTŮ (Zabraňuje nefunkčnosti tlačítek v jakékoliv situaci)
document.addEventListener('click', (e) => {
    
    // 1. LOGO / ZAVŘÍT MODAL
    if (e.target.closest('#logoHome') || e.target.closest('#closeDetailBtn')) {
        closeMovieDetail();
        return;
    }

    // 2. TLAČÍTKO HLEDAT
    if (e.target.closest('#searchBtn')) {
        const input = document.getElementById('searchInput');
        if (input) performSearch(input.value.trim());
        return;
    }

    // 3. KLIKNUTÍ NA KARTU FILMU VE VYHLEDÁVÁNÍ
    const movieCard = e.target.closest('.movie-card');
    if (movieCard) {
        const idx = movieCard.getAttribute('data-index');
        if (idx !== null && currentMoviesArray[idx]) {
            openMovieDetail(currentMoviesArray[idx]);
        }
        return;
    }

    // 4. ŠIPKA PRO ROZBALENÍ SEZNAMU SOUBORŮ (⋁)
    if (e.target.closest('#btnToggleStreams')) {
        const sect = document.getElementById('streamsSection');
        if (sect) {
            sect.classList.toggle('visible');
            if (sect.classList.contains('visible')) {
                sect.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        return;
    }

    // 5. SEZNAM SOUBORŮ: KLIKNUTÍM POUZE OZNÁMÍME A VYBEREME SOUBOR
    const fileRow = e.target.closest('.file-row');
    if (fileRow) {
        const idx = fileRow.getAttribute('data-index');
        if (idx !== null && availableFiles[idx]) {
            document.querySelectorAll('.file-row').forEach(r => r.classList.remove('selected'));
            fileRow.classList.add('selected');
            selectedFile = availableFiles[idx];
        }
        return;
    }

    // 6. HLAVNÍ TLAČÍTKO PŘEHRÁT
    if (e.target.closest('#actionPlayBtn')) {
        if (selectedFile) {
            executeFileLink(selectedFile);
        } else {
            document.getElementById('streamsSection').classList.add('visible');
            alert('Vyčkejte prosím na načtení streamů nebo rozbalte nabídku šipkou ⋁ pro výběr souboru.');
        }
        return;
    }

    // 7. HLAVNÍ TLAČÍTKO STÁHNOUT
    if (e.target.closest('#actionDownloadBtn')) {
        if (selectedFile) {
            executeFileLink(selectedFile);
        } else {
            document.getElementById('streamsSection').classList.add('visible');
            alert('Vyčkejte prosím na načtení streamů nebo rozbalte nabídku šipkou ⋁ pro výběr souboru.');
        }
        return;
    }

    // 8. ZVUK TRAILERU
    if (e.target.closest('#detailSoundBtn')) {
        toggleTrailerMute();
        return;
    }

    // 9. TLAČÍTKO IMDB
    if (e.target.closest('#btnImdbLink')) {
        if (currentMovie) {
            const imdbUrl = getImdbUrl(currentMovie);
            window.open(imdbUrl, '_blank');
        }
        return;
    }
});

// Podpora pro vyhledávání stisknutím klávesy Enter
document.addEventListener('keydown', (e) => {
    if (e.target.id === 'searchInput' && e.key === 'Enter') {
        performSearch(e.target.value.trim());
    }
});

// SPUŠTĚNÍ VYHLEDÁVÁNÍ FILMU
async function performSearch(query) {
    if (!query) return;
    const movieGrid = document.getElementById('movieGrid');
    movieGrid.innerHTML = '<div class="loading-text">Hledám filmy v databázi...</div>';

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(query)}&mode=movies`);
        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            movieGrid.innerHTML = '<div>Žádné filmy nebyly nalezeny.</div>';
            return;
        }
        
        currentMoviesArray = data.results;
        movieGrid.innerHTML = '';

        currentMoviesArray.forEach((movie, index) => {
            const card = document.createElement('div');
            card.className = 'movie-card';
            card.setAttribute('data-index', index);
            
            const hasPoster = movie.poster && movie.poster !== 'null';
            const posterHtml = hasPoster 
                ? `<img src="${movie.poster}" referrerpolicy="no-referrer" alt="${movie.title}" loading="lazy">`
                : `<div class="poster-placeholder"><span>${movie.title}</span></div>`;

            card.innerHTML = `
                <div class="poster-container">${posterHtml}</div>
                <div class="movie-card-info">
                    <h3>${movie.title}</h3>
                    <span class="movie-card-year">${movie.year || '-'}</span>
                </div>
            `;
            movieGrid.appendChild(card);
        });
    } catch (err) {
        movieGrid.innerHTML = '<div>Chyba při komunikaci se serverem.</div>';
    }
}

// OTEVŘENÍ DETAILU FILMU
async function openMovieDetail(movie) {
    currentMovie = movie;
    selectedFile = null; 
    availableFiles = [];

    const modal = document.getElementById('movieDetailModal');
    const streamsSection = document.getElementById('streamsSection');
    if (streamsSection) streamsSection.classList.remove('visible'); // Skryté soubory při startu

    trailerMuted = true;
    const soundBtn = document.getElementById('detailSoundBtn');
    if (soundBtn) soundBtn.innerText = '🔇';

    document.getElementById('detailTitle').innerText = movie.title;
    document.getElementById('detailDescription').innerText = "Načítám podrobnosti z databáze...";
    document.getElementById('detailGenres').innerText = "";
    document.getElementById('detailSpecs').innerText = movie.year || '-';
    document.getElementById('detailCrew').innerHTML = '';
    
    const billboardImg = document.getElementById('detailBillboardImg');
    if (movie.poster) {
        billboardImg.src = movie.poster;
        billboardImg.style.display = 'block';
    } else {
        billboardImg.style.display = 'none';
    }

    const csfdBtn = document.getElementById('btnCsfdLink');
    if (movie.url) {
        csfdBtn.style.display = 'block';
        csfdBtn.onclick = (e) => { e.stopPropagation(); window.open(movie.url, '_blank'); };
    } else {
        csfdBtn.style.display = 'none';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Okamžitě na pozadí hledáme streamy
    loadMovieFiles(movie.title);

    // Načítání ČSFD dat
    let metaLoaded = false;
    if (movie.url) {
        try {
            const res = await fetch(`/csfd-scrape?url=${encodeURIComponent(movie.url)}`);
            if (res.ok) {
                const scrape = await res.json();
                applyMetadata(scrape, movie.year);
                metaLoaded = true;
            }
        } catch (e) {
            console.warn("ČSFD zablokovalo scraper. Aktivuji inteligentní IMDb fallback.");
        }
    }

    if (!metaLoaded) {
        loadFallbackMetadata(movie);
    }
}

// ASISTENT PRO GENERACI PŘÍMÉHO ODKAZU NA IMDB (Místo Googlu)
function getImdbUrl(movie) {
    // Kontrola, zda objekt obsahuje ID (zkoušíme běžné formáty z backendů)
    const imdbId = movie.imdb || movie.imdb_id || movie.imdbId || movie.id_imdb;
    if (imdbId) {
        const idStr = String(imdbId).trim();
        const fullId = idStr.startsWith('tt') ? idStr : 'tt' + idStr;
        return `https://www.imdb.com/title/${fullId}/`;
    }
    // Pokud ID v datech chybí, odkážeme přímo do vyhledávání na IMDb webu
    return `https://www.imdb.com/find?q=${encodeURIComponent(movie.title)}`;
}

function applyMetadata(data, defaultYear) {
    const billboardImg = document.getElementById('detailBillboardImg');
    if (data.poster) billboardImg.src = data.poster;
    if (data.description) document.getElementById('detailDescription').innerText = data.description;
    if (data.genres) document.getElementById('detailGenres').innerText = data.genres.replace(/,/g, ' ·');
    
    document.getElementById('detailSpecs').innerText = `Kino · ${defaultYear || '-'} · Info z ČSFD`;

    let crewHtml = '';
    if (data.cast) {
        crewHtml += `<div><strong>Hlavní obsazení:</strong></div>`;
        crewHtml += `<div style="color: #aaa; margin-top:4px;">${data.cast}</div>`;
    }
    document.getElementById('detailCrew').innerHTML = crewHtml;

    if (data.trailer) {
        document.getElementById('trailerEmbedContainer').innerHTML = `
            <video id="mainTrailerVideo" width="100%" height="100%" autoplay muted loop playsinline style="object-fit: cover;">
                <source src="${data.trailer}" type="video/mp4">
            </video>
        `;
    } else {
        loadYoutubeTrailer(currentMovie.title);
    }
}

function loadFallbackMetadata(movie) {
    document.getElementById('detailDescription').innerText = `Obsah k filmu "${movie.title}" byl stažen do knihovny. Tlačítka přehrávání a soubory níže jsou plně připravené.`;
    document.getElementById('detailGenres').innerText = "Kino · Film";
    document.getElementById('detailSpecs').innerText = `Rok vydání: ${movie.year || '-'}`;
    document.getElementById('detailCrew').innerHTML = `<div><em>Podrobnosti naleznete přímo na kartách IMDb a ČSFD přes tlačítka výše.</em></div>`;
    loadYoutubeTrailer(movie.title);
}

function loadYoutubeTrailer(title) {
    const q = encodeURIComponent(`${title} trailer cz`);
    document.getElementById('trailerEmbedContainer').innerHTML = `
        <iframe src="https://www.youtube.com/embed?listType=search&list=${q}&autoplay=1&mute=1&controls=0&rel=0&loop=1" 
                frameborder="0" allow="autoplay; encrypted-media" style="width:100%; height:100%; object-fit:cover; transform:scale(1.35);">
        </iframe>`;
}

// PARSOVÁNÍ SOUBORŮ Z PŘEHRAJ.TO
async function loadMovieFiles(query) {
    const container = document.getElementById('fileListContainer');
    container.innerHTML = '<div class="loading-text">Hledám dostupné streamy...</div>';

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(query)}&mode=files`);
        const data = await response.json();

        if (!data.files || data.files.length === 0) {
            container.innerHTML = '<div>Žádné online streamy nebyly pro tento film nalezeny.</div>';
            return;
        }

        availableFiles = data.files;
        container.innerHTML = '';
        
        // Automaticky předvolíme první soubor v poli, aby tlačítko Přehrát hned fungovalo
        selectedFile = availableFiles[0];

        availableFiles.forEach((file, index) => {
            const row = document.createElement('div');
            row.className = 'file-row' + (index === 0 ? ' selected' : '');
            row.setAttribute('data-index', index);

            row.innerHTML = `
                <div class="file-title-text"><span>▶</span> ${file.title}</div>
                <div class="file-meta-text">
                    ${file.duration ? `<span>⏱ ${file.duration}</span>` : ''}
                    ${file.size ? `<span>💾 ${file.size}</span>` : ''}
                </div>
            `;
            container.appendChild(row);
        });
    } catch (err) {
        container.innerHTML = '<div>Nepodařilo se načíst soubory.</div>';
    }
}

// FINÁLNÍ SPUŠTĚNÍ ODKAZU (Opravuje přesměrování na hlavní stránku)
function executeFileLink(file) {
    let targetUrl = file.link || file.url || file.href;
    if (!targetUrl) return;

    // Pokud je odkaz relativní (/video/nazev-filmu), doplníme doménu Přehraj.to
    if (!targetUrl.startsWith('http')) {
        targetUrl = 'https://prehrajto.cz' + (targetUrl.startsWith('/') ? '' : '/') + targetUrl;
    }
    window.open(targetUrl, '_blank');
}

function toggleTrailerMute() {
    const container = document.getElementById('trailerEmbedContainer');
    const video = container.querySelector('video');
    const iframe = container.querySelector('iframe');
    
    trailerMuted = !trailerMuted;
    const soundBtn = document.getElementById('detailSoundBtn');
    if (soundBtn) soundBtn.innerText = trailerMuted ? '🔇' : '🔊';

    if (video) {
        video.muted = trailerMuted;
    } else if (iframe) {
        let src = iframe.src;
        src = trailerMuted ? src.replace('mute=0', 'mute=1') : src.replace('mute=1', 'mute=0');
        iframe.src = src;
    }
}

function closeMovieDetail() {
    document.getElementById('movieDetailModal').classList.remove('active');
    document.body.style.overflow = 'auto';
    document.getElementById('trailerEmbedContainer').innerHTML = '';
    currentMovie = null;
    selectedFile = null;
}
