let trailerMuted = true;
let currentMovie = null;
let selectedFile = null; // Zde si držíme aktuálně vybraný stream z Přehraj.to
let availableFiles = [];

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const closeDetailBtn = document.getElementById('closeDetailBtn');
    const detailSoundBtn = document.getElementById('detailSoundBtn');
    const logoHome = document.getElementById('logoHome');
    
    const actionPlayBtn = document.getElementById('actionPlayBtn');
    const actionDownloadBtn = document.getElementById('actionDownloadBtn');
    const btnToggleStreams = document.getElementById('btnToggleStreams');

    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => performSearch(searchInput.value.trim()));
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch(searchInput.value.trim());
        });
    }

    if (closeDetailBtn) closeDetailBtn.addEventListener('click', closeMovieDetail);
    if (detailSoundBtn) detailSoundBtn.addEventListener('click', toggleTrailerMute);
    if (logoHome) logoHome.addEventListener('click', closeMovieDetail);

    // Šipka rozbalí / zabalí menu se soubory
    if (btnToggleStreams) {
        btnToggleStreams.addEventListener('click', () => {
            const streamsSection = document.getElementById('streamsSection');
            streamsSection.classList.toggle('visible');
            if (streamsSection.classList.contains('visible')) {
                streamsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }

    // HLAVNÍ AKCE: Přehrát aktivní soubor
    if (actionPlayBtn) {
        actionPlayBtn.addEventListener('click', () => {
            if (selectedFile && selectedFile.link) {
                // Oprava relativní cesty z Přehraj.to
                let targetUrl = selectedFile.link;
                if (targetUrl && !targetUrl.startsWith('http')) {
                    targetUrl = 'https://prehrajto.cz' + (targetUrl.startsWith('/') ? '' : '/') + targetUrl;
                }
                window.open(targetUrl, '_blank');
            } else {
                // Pokud ještě nejsou načtené soubory, rozbalíme nabídku
                document.getElementById('streamsSection').classList.add('visible');
                alert('Prosím, vyčkejte na načtení streamů nebo vyberte soubor pomocí šipky ⋁.');
            }
        });
    }

    // HLAVNÍ AKCE: Stáhnout aktivní soubor
    if (actionDownloadBtn) {
        actionDownloadBtn.addEventListener('click', () => {
            if (selectedFile && selectedFile.link) {
                let targetUrl = selectedFile.link;
                if (targetUrl && !targetUrl.startsWith('http')) {
                    targetUrl = 'https://prehrajto.cz' + (targetUrl.startsWith('/') ? '' : '/') + targetUrl;
                }
                // Otevřeme stejnou stránku Přehraj.to, kde je přímo tlačítko "Stáhnout"
                window.open(targetUrl, '_blank');
            } else {
                document.getElementById('streamsSection').classList.add('visible');
                alert('Prosím, vyčkejte na načtení streamů nebo vyberte soubor pomocí šipky ⋁.');
            }
        });
    }
});

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
        renderMovieGrid(data.results);
    } catch (err) {
        movieGrid.innerHTML = '<div>Chyba při komunikaci se serverem.</div>';
    }
}

function renderMovieGrid(movies) {
    const movieGrid = document.getElementById('movieGrid');
    movieGrid.innerHTML = '';

    movies.forEach(movie => {
        const card = document.createElement('div');
        card.className = 'movie-card';
        
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

        card.addEventListener('click', () => openMovieDetail(movie));
        movieGrid.appendChild(card);
    });
}

async function openMovieDetail(movie) {
    currentMovie = movie;
    selectedFile = null; 
    availableFiles = [];

    const modal = document.getElementById('movieDetailModal');
    document.getElementById('streamsSection').classList.remove('visible'); // Defaultně zavřené soubory

    trailerMuted = true;
    document.getElementById('detailSoundBtn').innerText = '🔇';

    // Reset UI detailu
    document.getElementById('detailTitle').innerText = movie.title;
    document.getElementById('detailDescription').innerText = "Načítám podrobnosti...";
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
        csfdBtn.onclick = () => window.open(movie.url, '_blank');
    } else {
        csfdBtn.style.display = 'none';
    }

    // Vyhledání na IMDb
    const imdbBtn = document.getElementById('btnImdbLink');
    imdbBtn.onclick = () => window.open(`https://www.google.com/search?q=${encodeURIComponent(movie.title + ' imdb')}`, '_blank');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Načtení souborů na pozadí
    loadMovieFiles(movie.title);

    // STRATEGIE PARSOVÁNÍ (ČSFD -> IMDb Fallback)
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
            console.warn("ČSFD selhalo nebo zablokovalo požadavek, přepínám na IMDb/Záložní zpracování.");
        }
    }

    // Pokud ČSFD nepovolí stažení nebo selže, použijeme bezpečný IMDb / YouTube simulátor
    if (!metaLoaded) {
        loadFallbackMetadata(movie);
    }
}

// Společná funkce pro nasazení struktury dat do UI
function applyMetadata(data, defaultYear) {
    const billboardImg = document.getElementById('detailBillboardImg');
    if (data.poster) billboardImg.src = data.poster;
    if (data.description) document.getElementById('detailDescription').innerText = data.description;
    
    if (data.genres) {
        document.getElementById('detailGenres').innerText = data.genres.replace(/,/g, ' ·');
    }
    
    document.getElementById('detailSpecs').innerText = `Kino · ${defaultYear || '-'} · Info z databáze`;

    let crewHtml = '';
    if (data.cast) {
        crewHtml += `<div><strong>Hlavní obsazení:</strong></div>`;
        crewHtml += `<div style="color: #aaa;">${data.cast}</div>`;
    } else {
        crewHtml += `<div><strong>Obsazení:</strong> Info nedostupné</div>`;
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

// IMPLEMENTACE ZÁLOŽNÍHO MÓDU PŘES IMDb / VYHLEDÁVAČE
function loadFallbackMetadata(movie) {
    document.getElementById('detailDescription').innerText = `Obsah pro film "${movie.title}" se nepodařilo z ČSFD získat (Ochrana proti skrapování). Tlačítka přehrávání a streamy jsou plně funkční níže.`;
    document.getElementById('detailGenres').innerText = "Kino · Film";
    document.getElementById('detailSpecs').innerText = `Rok: ${movie.year || '-'}`;
    document.getElementById('detailCrew').innerHTML = `<div><em>Detaily můžete otevřít manuálně kliknutím na tlačítko IMDb nebo ČSFD výše.</em></div>`;
    loadYoutubeTrailer(movie.title);
}

function loadYoutubeTrailer(title) {
    const q = encodeURIComponent(`${title} trailer cz`);
    document.getElementById('trailerEmbedContainer').innerHTML = `
        <iframe src="https://www.youtube.com/embed?listType=search&list=${q}&autoplay=1&mute=1&controls=0&rel=0&loop=1" 
                frameborder="0" allow="autoplay; encrypted-media" style="width:100%; height:100%; object-fit:cover; transform:scale(1.35);">
        </iframe>`;
}

// NAČTENÍ SOUBORŮ S CHYTRÝM VÝBĚREM
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
        
        // Automaticky předvolíme první soubor v seznamu (nejlepší shoda) jako výchozí
        selectedFile = availableFiles[0];

        availableFiles.forEach((file, index) => {
            const row = document.createElement('div');
            row.className = 'file-row';
            // Pokud je to první soubor, rovnou ho vizuálně označíme
            if (index === 0) row.classList.add('selected');

            row.innerHTML = `
                <div class="file-title-text"><span>▶</span> ${file.title}</div>
                <div class="file-meta-text">
                    ${file.duration ? `<span>⏱ ${file.duration}</span>` : ''}
                    ${file.size ? `<span>💾 ${file.size}</span>` : ''}
                </div>
            `;

            // KLIKNUTÍ NA SOUBOR: Teď už neotvírá okno, ale pouze mění výběr v aplikaci!
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Odstraníme označení z předchozího řádku
                document.querySelectorAll('.file-row').forEach(r => r.classList.remove('selected'));
                
                // Označíme nový řádek
                row.classList.add('selected');
                selectedFile = file;
            });

            container.appendChild(row);
        });
    } catch (err) {
        container.innerHTML = '<div>Nepodařilo se načíst soubory.</div>';
    }
}

function toggleTrailerMute() {
    const container = document.getElementById('trailerEmbedContainer');
    const video = container.querySelector('video');
    const iframe = container.querySelector('iframe');
    
    trailerMuted = !trailerMuted;
    document.getElementById('detailSoundBtn').innerText = trailerMuted ? '🔇' : '🔊';

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
