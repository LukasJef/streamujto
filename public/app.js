// Globální stav aplikace
let trailerMuted = true;
let currentMovie = null;

// Pojistka pro staré inline volání z HTML, kdyby náhodou zůstalo v cache
window.searchMovies = function() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) { performSearch(searchInput.value.trim()); }
};

// Spuštění po načtení DOMu
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const closeDetailBtn = document.getElementById('closeDetailBtn');
    const detailSoundBtn = document.getElementById('detailSoundBtn');
    const logoHome = document.getElementById('logoHome');

    // Kliknutí na vyhledávací tlačítko
    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            performSearch(searchInput.value.trim());
        });
    }

    // Stisk Enter ve vyhledávání
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch(searchInput.value.trim());
            }
        });
    }

    // Navigační prvky detailu
    if (closeDetailBtn) closeDetailBtn.addEventListener('click', closeMovieDetail);
    if (detailSoundBtn) detailSoundBtn.addEventListener('click', toggleTrailerMute);
    if (logoHome) logoHome.addEventListener('click', closeMovieDetail);
});

// Hlavní vyhledávací funkce pro filmy
async function performSearch(query) {
    if (!query) return;

    const movieGrid = document.getElementById('movieGrid');
    if (movieGrid) movieGrid.innerHTML = '<div class="loading">Hledám filmy v databázi...</div>';

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(query)}&mode=movies`);
        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            if (movieGrid) movieGrid.innerHTML = '<div class="no-results">Nebyly nalezeny žádné filmy. Zkuste jiný název.</div>';
            return;
        }

        renderMovieGrid(data.results);
    } catch (err) {
        console.error("Chyba vyhledávání:", err);
        if (movieGrid) movieGrid.innerHTML = '<div class="error">Nepodařilo se připojit k serveru vyhledávání.</div>';
    }
}

// Vykreslení filmů do CSS Gridu
function renderMovieGrid(movies) {
    const movieGrid = document.getElementById('movieGrid');
    if (!movieGrid) return;

    movieGrid.innerHTML = '';

    movies.forEach(movie => {
        const card = document.createElement('div');
        card.className = 'movie-card';
        
        const hasPoster = movie.poster && movie.poster !== 'null';
        const posterHtml = hasPoster 
            ? `<img src="${movie.poster}" alt="${movie.title}" loading="lazy">`
            : `<div class="poster-placeholder"><span>${movie.title}</span></div>`;

        card.innerHTML = `
            <div class="poster-container">
                ${posterHtml}
                <div class="movie-card-overlay">
                    <span class="play-icon">▶</span>
                </div>
            </div>
            <div class="movie-card-info">
                <h3>${movie.title}</h3>
                <span class="movie-card-year">${movie.year || 'Neznámý rok'}</span>
            </div>
        `;

        card.addEventListener('click', () => openMovieDetail(movie));
        movieGrid.appendChild(card);
    });
}

// Otevření kinomódu filmu
async function openMovieDetail(movie) {
    currentMovie = movie;
    const modal = document.getElementById('movieDetailModal');
    if (!modal) return;

    // Default reset zvuku
    trailerMuted = true;
    const soundBtn = document.getElementById('detailSoundBtn');
    if (soundBtn) soundBtn.innerText = '🔇';

    // Naplnění známých základních dat
    document.getElementById('detailTitle').innerText = movie.title;
    document.getElementById('detailDescription').innerText = movie.description || "Načítám plný popis a trailer z ČSFD...";
    document.getElementById('detailMetaRow').innerText = movie.year ? `Rok: ${movie.year}` : 'Rok: -';
    document.getElementById('detailCrewRow').innerHTML = ''; 
    
    if (movie.poster) {
        document.getElementById('detailBillboard').style.backgroundImage = `url('${movie.poster}')`;
    } else {
        document.getElementById('detailBillboard').style.backgroundImage = 'none';
    }

    // Aktivace modalu a uzamčení skrolu na pozadí
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Okamžitě začneme hledat videosoubory na Přehraj.to
    loadMovieFiles(movie.title);

    // Obohacení dat přímo z ČSFD skraperu
    if (movie.url) {
        try {
            let csfdScrape = await fetch(`/csfd-scrape?url=${encodeURIComponent(movie.url)}`);
            let scrapeData = await csfdScrape.json();
            
            if (scrapeData.poster) {
                document.getElementById('detailBillboard').style.backgroundImage = `url('${scrapeData.poster}')`;
            }
            if (scrapeData.description) {
                document.getElementById('detailDescription').innerText = scrapeData.description;
            }
            if (scrapeData.cast) {
                document.getElementById('detailCrewRow').innerHTML = `<strong>Hrají:</strong> ${scrapeData.cast}`;
            }
            if (scrapeData.genres) {
                document.getElementById('detailMetaRow').innerText = (movie.year ? `Rok: ${movie.year} | ` : '') + `Žánr: ${scrapeData.genres}`;
            }
            
            // Pokud máme MP4 trailer z ČSFD, načteme ho, jinak zkusíme YouTube zálohu
            if (scrapeData.trailer) {
                const trailerContainer = document.getElementById('trailerEmbedContainer');
                trailerContainer.innerHTML = `
                    <video id="csfdTrailerVideo" width="100%" height="100%" autoplay muted loop playsinline style="object-fit: cover; width:100%; height:100%; transform: scale(1.15);">
                        <source src="${scrapeData.trailer}" type="video/mp4">
                    </video>
                `;
            } else {
                loadTrailerEmbed(movie.originalTitle || movie.title);
            }
        } catch(e) {
            console.error("ČSFD scrape selhal, zapínám YouTube zálohu:", e);
            loadTrailerEmbed(movie.originalTitle || movie.title);
        }
    } else {
        loadTrailerEmbed(movie.originalTitle || movie.title);
    }
}

// Záložní přehrávač YouTube traileru
function loadTrailerEmbed(searchTerm) {
    const trailerContainer = document.getElementById('trailerEmbedContainer');
    if (!trailerContainer) return;

    const ytQuery = encodeURIComponent(`${searchTerm} trailer cz`);
    trailerContainer.innerHTML = `
        <iframe 
            src="https://www.youtube.com/embed?listType=search&list=${ytQuery}&autoplay=1&mute=1&controls=0&showinfo=0&rel=0&loop=1&iv_load_policy=3&playlist" 
            frameborder="0" 
            allow="autoplay; encrypted-media" 
            allowfullscreen
            style="width: 100%; height: 100%; pointer-events: none; transform: scale(1.35);">
        </iframe>
    `;
}

// Načítání a vypsání souborů z Přehraj.to
async function loadMovieFiles(query) {
    const fileListContainer = document.getElementById('fileListContainer');
    if (!fileListContainer) return;

    fileListContainer.innerHTML = '<div class="loading-files">Hledám dostupné online streamy...</div>';

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(query)}&mode=files`);
        const data = await response.json();

        if (!data.files || data.files.length === 0) {
            fileListContainer.innerHTML = '<div class="no-files">Pro tento film nebyly nalezeny žádné online streamy.</div>';
            return;
        }

        fileListContainer.innerHTML = '';
        
        data.files.forEach(file => {
            const row = document.createElement('div');
            row.className = 'file-item';
            row.innerHTML = `
                <div class="file-info-left">
                    <span class="file-play-icon">▶</span>
                    <span class="file-name" title="${file.title}">${file.title}</span>
                </div>
                <div class="file-info-right">
                    ${file.duration ? `<span>⏱ ${file.duration}</span>` : ''}
                    ${file.size ? `<span>💾 ${file.size}</span>` : ''}
                </div>
            `;

            row.addEventListener('click', () => {
                window.open(file.link, '_blank');
            });

            fileListContainer.appendChild(row);
        });

    } catch (err) {
        console.error("Chyba souborů:", err);
        fileListContainer.innerHTML = '<div class="error-files">Nepodařilo se načíst streamy ze serveru.</div>';
    }
}

// Přepínání zvuku ukázky
function toggleTrailerMute() {
    const container = document.getElementById('trailerEmbedContainer');
    if (!container) return;

    const videoElement = container.querySelector('video');
    const iframe = container.querySelector('iframe');
    
    trailerMuted = !trailerMuted;
    const soundBtn = document.getElementById('detailSoundBtn');
    if (soundBtn) soundBtn.innerText = trailerMuted ? '🔇' : '🔊';

    if (videoElement) {
        videoElement.muted = trailerMuted;
    } else if (iframe) {
        let src = iframe.src;
        src = trailerMuted ? src.replace('mute=0', 'mute=1') : src.replace('mute=1', 'mute=0');
        if (!src.includes('mute=')) src += `&mute=${trailerMuted ? 1 : 0}`;
        iframe.src = src;
    }
}

// Zavření kinomódu
function closeMovieDetail() {
    const modal = document.getElementById('movieDetailModal');
    if (modal) modal.classList.remove('active');
    
    document.body.style.overflow = 'auto';

    const trailerContainer = document.getElementById('trailerEmbedContainer');
    if (trailerContainer) trailerContainer.innerHTML = '';
    
    currentMovie = null;
}
