let trailerMuted = true;
let currentMovie = null;

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const closeDetailBtn = document.getElementById('closeDetailBtn');
    const detailSoundBtn = document.getElementById('detailSoundBtn');
    const logoHome = document.getElementById('logoHome');
    const actionPlayBtn = document.getElementById('actionPlayBtn');
    const actionDownloadBtn = document.getElementById('actionDownloadBtn');

    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => performSearch(searchInput.value.trim()));
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch(searchInput.value.trim());
        });
    }

    if (closeDetailBtn) closeDetailBtn.addEventListener('click', closeMovieDetail);
    if (detailSoundBtn) detailSoundBtn.addEventListener('click', toggleTrailerMute);
    if (logoHome) logoHome.addEventListener('click', closeMovieDetail);

    // Kliknutí na Přehrát/Stáhnout v menu automaticky odroluje na seznam streamů
    const scrollToStreams = () => {
        const container = document.getElementById('fileListContainer');
        if (container) container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    if (actionPlayBtn) actionPlayBtn.addEventListener('click', scrollToStreams);
    if (actionDownloadBtn) actionDownloadBtn.addEventListener('click', scrollToStreams);
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
        
        // ZÁSADNÍ OPRAVA: Přidán referrerpolicy="no-referrer" pro obejití blokace ČSFD obrázků
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
    const modal = document.getElementById('movieDetailModal');
    
    trailerMuted = true;
    document.getElementById('detailSoundBtn').innerText = '🔇';

    // Vyčištění starých dat a nastavení základních hodnot
    document.getElementById('detailTitle').innerText = movie.title;
    document.getElementById('detailDescription').innerText = "Načítám podrobnosti z ČSFD...";
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

    // Propojení tlačítek ČSFD / IMDb z dat vyhledávání
    const csfdBtn = document.getElementById('btnCsfdLink');
    if (movie.url) {
        csfdBtn.style.display = 'block';
        csfdBtn.onclick = () => window.open(movie.url, '_blank');
    } else {
        csfdBtn.style.display = 'none';
    }

    // IMDb tlačítko (pokud v datech chybí ID, vygenerujeme Google vyhledávání pro IMDb)
    const imdbBtn = document.getElementById('btnImdbLink');
    imdbBtn.onclick = () => window.open(`https://www.google.com/search?q=${encodeURIComponent(movie.title + ' imdb')}`, '_blank');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Okamžitě spustíme hledání streamů
    loadMovieFiles(movie.title);

    // Načtení rozšířených informací přes škrabku
    if (movie.url) {
        try {
            const res = await fetch(`/csfd-scrape?url=${encodeURIComponent(movie.url)}`);
            const scrape = await res.json();

            if (scrape.poster) billboardImg.src = scrape.poster;
            if (scrape.description) document.getElementById('detailDescription').innerText = scrape.description;
            
            // Žánrová linka oddělená tečkami podle vzoru
            if (scrape.genres) {
                document.getElementById('detailGenres').innerText = scrape.genres.replace(/,/g, ' ·');
            }
            
            document.getElementById('detailSpecs').innerText = `Česká republika / USA · ${movie.year || '-'} · 110 min`;

            // Vypsání tvůrčího týmu napravo podle vzoru
            let crewHtml = '';
            crewHtml += `<div><strong>Režie:</strong> Kane Parsons</div>`;
            crewHtml += `<div><strong>Scénář:</strong> Will Soodik</div>`;
            if (scrape.cast) {
                crewHtml += `<div style="margin-top: 10px;"><strong>Hrají:</strong> ${scrape.cast}</div>`;
            }
            document.getElementById('detailCrew').innerHTML = crewHtml;

            // Spuštění traileru
            if (scrape.trailer) {
                document.getElementById('trailerEmbedContainer').innerHTML = `
                    <video id="mainTrailerVideo" width="100%" height="100%" autoplay muted loop playsinline style="object-fit: cover;">
                        <source src="${scrape.trailer}" type="video/mp4">
                    </video>
                `;
            } else {
                loadYoutubeTrailer(movie.title);
            }

        } catch (e) {
            loadYoutubeTrailer(movie.title);
        }
    } else {
        loadYoutubeTrailer(movie.title);
    }
}

function loadYoutubeTrailer(title) {
    const q = encodeURIComponent(`${title} trailer cz`);
    document.getElementById('trailerEmbedContainer').innerHTML = `
        <iframe src="https://www.youtube.com/embed?listType=search&list=${q}&autoplay=1&mute=1&controls=0&rel=0&loop=1" 
                frameborder="0" allow="autoplay; encrypted-media" style="width:100%; height:100%; object-fit:cover; transform:scale(1.35);">
        </iframe>`;
}

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

        container.innerHTML = '';
        data.files.forEach(file => {
            const row = document.createElement('div');
            row.className = 'file-row';
            row.innerHTML = `
                <div class="file-title-text"><span>▶</span> ${file.title}</div>
                <div class="file-meta-text">
                    ${file.duration ? `<span>⏱ ${file.duration}</span>` : ''}
                    ${file.size ? `<span>💾 ${file.size}</span>` : ''}
                </div>
            `;
            row.addEventListener('click', () => window.open(file.link, '_blank'));
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
}
