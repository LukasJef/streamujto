// Globální stav aplikace
let trailerMuted = true;
let currentMovie = null;

// ==========================================
// OPRAVA PRO HTML: Zpřístupnění funkce pro starý onclick="searchMovies()"
// ==========================================
window.searchMovies = function() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        performSearch(searchInput.value.trim());
    }
};

// Inicializace po načtení stránky
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const closeDetailBtn = document.getElementById('closeDetailBtn');
    const detailSoundBtn = document.getElementById('detailSoundBtn');

    // Spuštění hledání kliknutím na lupu (jako pojistka)
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            performSearch(searchInput.value.trim());
        });
    }

    // Spuštění hledání stiskem klávesy Enter v políčku
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch(searchInput.value.trim());
            }
        });
    }

    // Zavření detailu filmu
    if (closeDetailBtn) {
        closeDetailBtn.addEventListener('click', closeMovieDetail);
    }

    // Přepínání zvuku u traileru
    if (detailSoundBtn) {
        detailSoundBtn.addEventListener('click', toggleTrailerMute);
    }
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
            movieGrid.innerHTML = '<div class="no-results">Nebyly nalezeny žádné filmy. Zkuste jiný název.</div>';
            return;
        }

        renderMovieGrid(data.results);
    } catch (err) {
        console.error("Chyba při hledání filmů:", err);
        if (movieGrid) movieGrid.innerHTML = '<div class="error">Nepodařilo se připojit k serveru vyhledávání.</div>';
    }
}

// Vykreslení nalezených filmů do hlavní mřížky Netflix stylu
function renderMovieGrid(movies) {
    const movieGrid = document.getElementById('movieGrid');
    if (!movieGrid) return;

    movieGrid.innerHTML = '';

    movies.forEach(movie => {
        const card = document.createElement('div');
        card.className = 'movie-card';
        
        // Pokud nemáme plakát, dáme tam stylový tmavý placeholder s textem
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

        // Po kliknutí na kartu otevřeme detail filmu
        card.addEventListener('click', () => openMovieDetail(movie));
        movieGrid.appendChild(card);
    });
}

// Otevření detailního modálního okna filmu
async function openMovieDetail(movie) {
    currentMovie = movie;
    const modal = document.getElementById('movieDetailModal');
    if (!modal) return;

    // Reset zvuku do výchozího ztlumeného stavu
    trailerMuted = true;
    document.getElementById('detailSoundBtn').innerText = '🔇';

    // Naplnění základních dat, která už známe z vyhledávače
    document.getElementById('detailTitle').innerText = movie.title;
    document.getElementById('detailDescription').innerText = movie.description || "Načítám popis filmu z ČSFD...";
    document.getElementById('detailMetaRow').innerText = movie.year ? `Rok: ${movie.year}` : 'Rok: -';
    document.getElementById('detailCrewRow').innerHTML = ''; // Vyčistit herce
    
    // Nastavení základního pozadí (pokud je z IMDb)
    if (movie.poster) {
        document.getElementById('detailBillboard').style.backgroundImage = `url('${movie.poster}')`;
    } else {
        document.getElementById('detailBillboard').style.backgroundImage = 'none';
    }

    // Zobrazení modálního okna a skrytí posuvníku stránky
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Spuštění hledání reálných video souborů na Přehraj.to
    loadMovieFiles(movie.title);

    // KOMPLETNÍ ČESKÉ OBOHACENÍ DAT PŘÍMO Z ČSFD
    if (movie.url) {
        try {
            let csfdScrape = await fetch(`/csfd-scrape?url=${encodeURIComponent(movie.url)}`);
            let scrapeData = await csfdScrape.json();
            
            // A. Plakát v plné kvalitě z ČSFD (nahradí IMDb malý náhled)
            if (scrapeData.poster) {
                document.getElementById('detailBillboard').style.backgroundImage = `url('${scrapeData.poster}')`;
            }
            // B. Plnohodnotný lokalizovaný děj filmu
            if (scrapeData.description) {
                document.getElementById('detailDescription').innerText = scrapeData.description;
            }
            // C. Kompletní herecké obsazení
            if (scrapeData.cast) {
                document.getElementById('detailCrewRow').innerHTML = `<strong>Hrají:</strong> ${scrapeData.cast}`;
            }
            // D. Žánry filmu (Přidáme k řádku s rokem)
            if (scrapeData.genres) {
                document.getElementById('detailMetaRow').innerText = (movie.year ? `Rok: ${movie.year} | ` : '') + `Žánr: ${scrapeData.genres}`;
            }
            // E. Přímý MP4 Trailer z ČSFD do HTML5 Video Tagu (Žádné YouTube reklamy!)
            if (scrapeData.trailer) {
                const trailerContainer = document.getElementById('trailerEmbedContainer');
                trailerContainer.innerHTML = `
                    <video id="csfdTrailerVideo" width="100%" height="100%" autoplay muted loop playsinline style="object-fit: cover; width:100%; height:100%; transform: scale(1.15);">
                        <source src="${scrapeData.trailer}" type="video/mp4">
                    </video>
                `;
            } else {
                // Pokud ČSFD trailer nemá, použijeme jako zálohu YouTube vyhledávání podle originálního názvu
                loadTrailerEmbed(movie.originalTitle || movie.title);
            }
        } catch(e) {
            console.error("ČSFD obohacení selhalo, zůstává základ z DB:", e);
            loadTrailerEmbed(movie.originalTitle || movie.title);
        }
    } else {
        // Film nemá ČSFD url link, jedeme čistou YouTube zálohu
        loadTrailerEmbed(movie.originalTitle || movie.title);
    }
}

// Načtení záložního YouTube traileru, pokud ČSFD nemá přímé video
function loadTrailerEmbed(searchTerm) {
    const trailerContainer = document.getElementById('trailerEmbedContainer');
    if (!trailerContainer) return;

    // Sestavíme vyhledávací dotaz pro YouTube embed bez reklam a prvků
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

// Hledání přehrávatelných souborů na Přehraj.to
async function loadMovieFiles(query) {
    const fileListContainer = document.getElementById('fileListContainer');
    if (!fileListContainer) return;

    fileListContainer.innerHTML = '<div class="loading-files">Hledám dostupné streamy na Přehraj.to...</div>';

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
                    ${file.duration ? `<span class="file-duration">⏱ ${file.duration}</span>` : ''}
                    ${file.size ? `<span class="file-size">💾 ${file.size}</span>` : ''}
                </div>
            `;

            // Po kliknutí na soubor ho otevřeme v novém okně na Přehraj.to
            row.addEventListener('click', () => {
                window.open(file.link, '_blank');
            });

            fileListContainer.appendChild(row);
        });

    } catch (err) {
        console.error("Chyba při stahování souborů:", err);
        fileListContainer.innerHTML = '<div class="error-files">Nepodařilo se načíst soubory ze serveru Přehraj.to.</div>';
    }
}

// Inteligentní přepínání zvuku traileru (Podporuje HTML5 video i YouTube iframe)
function toggleTrailerMute() {
    const videoElement = document.getElementById('trailerEmbedContainer').querySelector('video');
    const iframe = document.getElementById('trailerEmbedContainer').querySelector('iframe');
    
    trailerMuted = !trailerMuted;
    document.getElementById('detailSoundBtn').innerText = trailerMuted ? '🔇' : '🔊';

    if (videoElement) {
        // Ovládání nativního HTML5 videa z ČSFD
        videoElement.muted = trailerMuted;
    } else if (iframe) {
        // Ovládání YouTube iframe přenačtením URL parametru s patřičným mute stavem
        let src = iframe.src;
        src = trailerMuted ? src.replace('mute=0', 'mute=1') : src.replace('mute=1', 'mute=0');
        if (!src.includes('mute=')) src += `&mute=${trailerMuted ? 1 : 0}`;
        iframe.src = src;
    }
}

// Zavření modálního okna s detailem filmu a zastavení přehrávání na pozadí
function closeMovieDetail() {
    const modal = document.getElementById('movieDetailModal');
    if (modal) modal.classList.remove('active');
    
    // Vrátíme stránce klasický posuvník
    document.body.style.overflow = 'auto';

    // Kompletně vymažeme kontejner přehrávače, aby video/zvuk ihned utichlo
    const trailerContainer = document.getElementById('trailerEmbedContainer');
    if (trailerContainer) trailerContainer.innerHTML = '';
    
    currentMovie = null;
}
