// Pomocné prvky z DOMu
const searchInput = document.getElementById('searchQuery');
const resultsDiv = document.getElementById('results');
const playerContainer = document.getElementById('playerContainer');
const videoPlayer = document.getElementById('videoPlayer');

// Adresa tvého záložního obrázku
const BACKUP_POSTER_URL = 'https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?q=80&w=300&auto=format&fit=crop';

// Spuštění vyhledávání při stisku Enteru
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        search();
    }
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

    resultsDiv.innerHTML = '<div class="loader">Hledám filmy...</div>';
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

// 2. Vykreslení základních 12 karet (přidáno tlačítko Stáhnout)
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

        // Do HTML pod tlačítko spustit vkládáme tlačítko pro stažení
        card.innerHTML = `
            <div>
                <img id="movie-poster-${index}" src="${BACKUP_POSTER_URL}" 
                     onerror="this.onerror=null; this.src='${BACKUP_POSTER_URL}';"
                     style="width: 100%; height: 240px; object-fit: cover; border-radius: 4px; background-color: #000; display: block; margin-bottom: 10px;" referrerpolicy="no-referrer">
                <h3 style="font-size: 14px; margin: 0 0 6px 0; color: var(--text); line-height: 1.3; max-height: 36px; overflow: hidden; text-align: left;">${item.title}</h3>
                <p style="font-size: 11px; color: var(--text-dim); margin: 0 0 12px 0; text-align: left;">${item.size || item.duration || 'Video'}</p>
            </div>
            <div>
                <button class="play-btn" style="width: 100%; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 6px;" onclick="playVideo('${item.link}')">Spustit</button>
                <button class="download-btn" style="width: 100%; padding: 6px; border: 1px solid #444; background: transparent; color: #ccc; border-radius: 4px; cursor: pointer; font-size: 12px;" onclick="downloadVideo('${item.link}', '${item.title.replace(/'/g, "\\'")}')">Stáhnout film</button>
            </div>
        `;
        resultsDiv.appendChild(card);
    });
}

// 3. Hledání plakátů na pozadí
async function fetchPostersOneByOne(results) {
    for (let i = 0; i < results.length; i++) {
        const item = results[i];
        
        const cleanTitle = item.title
            .replace(/(1080p|720p|4k|uhd|cz|sk|dabing|titulky|hdtv|x264|bluray|phdteam|remastered|xvid|avi|mp4|camrip|kinorip|cam)/gi, '')
            .replace(/[()\[\]\-–—]/g, ' ') 
            .replace(/\s+/g, ' ')            
            .trim();

        try {
            const imdbApiUrl = `https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(cleanTitle)}`;
            const imdbResponse = await fetch(imdbApiUrl);

            if (imdbResponse.ok) {
                const imdbData = await imdbResponse.json();
                
                if (imdbData && imdbData.description && imdbData.description.length > 0) {
                    const match = imdbData.description.find(element => element["#IMG_POSTER"]);
                    const imgElement = document.getElementById(`movie-poster-${i}`);
                    
                    if (match && imgElement && match["#IMG_POSTER"]) {
                        imgElement.src = match["#IMG_POSTER"];
                        continue; 
                    }
                }
            }
        } catch (err) {
            console.log(`Nepodařilo se načíst plakát pro: ${cleanTitle}`, err.message);
        }

        const imgElement = document.getElementById(`movie-poster-${i}`);
        if (imgElement && imgElement.src !== BACKUP_POSTER_URL) {
            imgElement.src = BACKUP_POSTER_URL;
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

// 5. NOVÁ FUNKCE: Přímé stáhnutí souboru do PC / Mobilu
async function downloadVideo(videoUrl, title) {
    // Vytvoříme dočasný loading text přímo na kliknutém tlačítku
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

        // Vytvoříme skrytý stahovací element a simulujeme kliknutí
        const a = document.createElement('a');
        a.href = directLink;
        // Pokusíme se vnutit hezký název souboru
        a.download = `${title}.mp4`;
        a.target = '_blank'; // Kdyby download selhal, otevře se v nové záložce, kde stačí dát pravé kliknout -> Uložit video jako
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

    } catch (err) {
        console.error(err);
        alert('Chyba při komunikaci se serverem.');
    }

    // Vrátíme tlačítko do původního stavu
    btn.innerText = puvodniText;
    btn.disabled = false;
}
