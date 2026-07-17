// Pomocné prvky z DOMu
const searchInput = document.getElementById('searchQuery');
const resultsDiv = document.getElementById('results');
const playerContainer = document.getElementById('playerContainer');
const videoPlayer = document.getElementById('videoPlayer');

// Spuštění vyhledávání při stisku Enteru
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        search();
    }
});

// 1. Funkce pro vyhledávání filmů
async function search() {
    const query = searchInput.value.trim();
    if (!query) return;

    resultsDiv.innerHTML = '<div class="loader">Hledám filmy na Přehraj.to...</div>';
    playerContainer.style.display = 'none';
    videoPlayer.pause();

    try {
        // Zavoláme tvůj backend
        const response = await fetch(`/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.error) {
            resultsDiv.innerHTML = `<div class="error">Chyba: ${data.error}</div>`;
            return;
        }

        if (!data.results || data.results.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results">Nebyly nalezeny žádné výsledky.</div>';
            return;
        }

        // Ořízneme výsledky natvrdo jen na prvních 10 prvků
        const top10Results = data.results.slice(0, 10);

        // Vykreslíme karty s dočasnými náhledy
        renderResults(top10Results);

        // Spustíme vyhledávání reálných plakátů pro každou kartu zvlášť
        fetchPostersOneByOne(top10Results);

    } catch (err) {
        resultsDiv.innerHTML = '<div class="error">Chyba sítě nebo serveru.</div>';
        console.error(err);
    }
}

// 2. Vykreslení základních 10 karet (zatím s backup plakátem)
function renderResults(results) {
    resultsDiv.innerHTML = '';
    
    resultsDiv.style.display = "flex";
    resultsDiv.style.flexWrap = "wrap";
    resultsDiv.style.gap = "20px";
    resultsDiv.style.justifyContent = "center";
    resultsDiv.style.padding = "20px 0";
    
    results.forEach((item, index) => {
        // Výchozí vzhled karty používá tvůj univerzální "Coming Soon / Bez Plakátu" styl
        const defaultImg = 'https://via.placeholder.com/200x280/1f1f1f/ffffff?text=Hledám+Plakát...';

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

        // Každý obrázek má unikátní id="movie-poster-XYZ", abychom ho uměli na pozadí vyměnit
        card.innerHTML = `
            <div>
                <img id="movie-poster-${index}" src="${defaultImg}" style="width: 100%; height: 240px; object-fit: cover; border-radius: 4px; background-color: #000; display: block; margin-bottom: 10px;" referrerpolicy="no-referrer">
                <h3 style="font-size: 14px; margin: 0 0 6px 0; color: var(--text); line-height: 1.3; max-height: 36px; overflow: hidden; text-align: left;">${item.title}</h3>
                <p style="font-size: 11px; color: var(--text-dim); margin: 0 0 12px 0; text-align: left;">${item.size || item.duration || 'Video'}</p>
            </div>
            <button class="play-btn" style="width: 100%; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin: 0;" onclick="playVideo('${item.link}')">Spustit</button>
        `;
        resultsDiv.appendChild(card);
    });
}

// 3. Hledání plakátů na pozadí: Výsledek po výsledku
async function fetchPostersOneByOne(results) {
    for (let i = 0; i < results.length; i++) {
        const item = results[i];
        
        // Vyčistíme název od nejčastějšího balastu, aby mělo IMDb přesnější shodu
        const cleanTitle = item.title
            .replace(/(1080p|720p|4k|uhd|cz|sk|dabing|titulky|hdtv|x264|bluray|phdteam|remastered|xvid|avi|mp4)/gi, '')
            .replace(/[()\[\]\-–—]/g, ' ') // Odstraní závorky a pomlčky
            .replace(/\s+/g, ' ')            // Smaže zdvojené mezery
            .trim();

        try {
            const imdbApiUrl = `https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(cleanTitle)}`;
            const imdbResponse = await fetch(imdbApiUrl);

            if (imdbResponse.ok) {
                const imdbData = await imdbResponse.json();
                
                if (imdbData && imdbData.description && imdbData.description.length > 0) {
                    // Najdeme v datech z IMDb první validní plakát
                    const match = imdbData.description.find(element => element["#IMG_POSTER"]);
                    const imgElement = document.getElementById(`movie-poster-${i}`);
                    
                    if (match && imgElement) {
                        // Blesková výměna placeholderu za reálný plakát přímo před očima
                        imgElement.src = match["#IMG_POSTER"];
                        continue; // Úspěšně vyměněno, skáčeme na další film
                    }
                }
            }
        } catch (err) {
            console.log(`Nepodařilo se načíst plakát pro: ${cleanTitle}`, err.message);
        }

        // ZÁLOHA: Pokud IMDb nic nenašlo (nebo šlo o gameplay / hovadinu), dáme tam tvůj nativní přebal
        const imgElement = document.getElementById(`movie-poster-${i}`);
        if (imgElement) {
            // Sem si klidně hoď přímou url tvého "Coming Soon" obrázku z projektu
            imgElement.src = 'https://via.placeholder.com/200x280/1f1f1f/aaaaaa?text=Bez+Plakátu';
        }
    }
}

// 4. Načtení konkrétního videa do přehrávače
async function playVideo(videoUrl) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    resultsDiv.insertAdjacentHTML('afterbegin', '<div class="loading-overlay">Načítám video stream...</div>');

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
