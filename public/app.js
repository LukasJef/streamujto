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

// 1. Funkce pro vyhledávání filmů a plakátů
async function search() {
    const query = searchInput.value.trim();
    if (!query) return;

    resultsDiv.innerHTML = '<div class="loader">Hledám videa a plakáty...</div>';
    playerContainer.style.display = 'none'; // Skryjeme přehrávač při novém vyhledávání
    videoPlayer.pause();

    let globalPosterUrl = '';

    // PARALELNÍ KROK: Zkusíme bleskově vytáhnout plakát z funkčního IMDb API
    try {
        const imdbApiUrl = `https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(query)}`;
        const imdbResponse = await fetch(imdbApiUrl);

        if (imdbResponse.ok) {
            const imdbData = await imdbResponse.json();
            if (imdbData && imdbData.description && imdbData.description.length > 0) {
                // Najdeme první validní prvek, který obsahuje klíč pro obrázek
                const firstMatch = imdbData.description.find(item => item["#IMG_POSTER"]);
                if (firstMatch) {
                    globalPosterUrl = firstMatch["#IMG_POSTER"];
                }
            }
        }
    } catch (imdbError) {
        console.log("IMDb API selhalo, ale pokračujeme v načítání videí:", imdbError.message);
    }

    try {
        // Volání tvého stávajícího backend vyhledávání
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

        // Předáme výsledky i s případně nalezeným plakátem do renderu
        renderResults(data.results, globalPosterUrl);

    } catch (err) {
        resultsDiv.innerHTML = '<div class="error">Chyba sítě nebo serveru.</div>';
        console.error(err);
    }
}

// 2. Vykreslení výsledků do moderní dlaždicové mřížky s plakáty
function renderResults(results, globalPosterUrl) {
    resultsDiv.innerHTML = '';
    
    // Nastavení flexboxu na kontejner, aby byly karty vedle sebe v mřížce
    resultsDiv.style.display = "flex";
    resultsDiv.style.flexWrap = "wrap";
    resultsDiv.style.gap = "20px";
    resultsDiv.style.justifyContent = "center";
    resultsDiv.style.padding = "20px 0";
    
    results.forEach(item => {
        // Pokud IMDb vrátilo plakát, použijeme ho. Pokud ne, zkusíme vzít náhled z Přehraj (item.thumb), jinak dáme zálohu.
        const imgSrc = globalPosterUrl || item.thumb || 'https://via.placeholder.com/200x280/1f1f1f/ffffff?text=Bez+Plakátu';

        const card = document.createElement('div');
        // Stylování karty přímo přes JS, aby dokonale ladilo s tvým tmavým designem
        card.style.width = "180px";
        card.style.backgroundColor = "var(--card-bg)";
        card.style.padding = "12px";
        card.style.borderRadius = "6px";
        card.style.boxSizing = "border-box";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.justifyContent = "space-between";
        card.style.boxShadow = "0 4px 6px rgba(0,0,0,0.2)";

        card.innerHTML = `
            <div>
                <img src="${imgSrc}" style="width: 100%; height: 240px; object-fit: cover; border-radius: 4px; background-color: #000; display: block; margin-bottom: 10px;" referrerpolicy="no-referrer">
                <h3 style="font-size: 14px; margin: 0 0 6px 0; color: var(--text); line-height: 1.3; max-height: 36px; overflow: hidden; text-align: left;">${item.title}</h3>
                <p style="font-size: 11px; color: var(--text-dim); margin: 0 0 12px 0; text-align: left;">${item.size || item.duration || 'Video'}</p>
            </div>
            <button class="play-btn" style="width: 100%; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin: 0;" onclick="playVideo('${item.link}')">Spustit</button>
        `;
        resultsDiv.appendChild(card);
    });
}

// 3. Načtení konkrétního videa do přehrávače
async function playVideo(videoUrl) {
    // Scrollneme nahoru k přehrávači
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    resultsDiv.insertAdjacentHTML('afterbegin', '<div class="loading-overlay">Načítám video stream...</div>');

    try {
        // Zavoláme náš get-video endpoint
        const response = await fetch(`/get-video?url=${encodeURIComponent(videoUrl)}`);
        const data = await response.json();

        // Odstraníme loading overlay
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) overlay.remove();

        if (data.error) {
            alert(`Nepodařilo se přehrát: ${data.error}`);
            return;
        }

        // Najdeme nejlepší kvalitu (často první v poli 'sources')
        const videoSource = data.sources && data.sources[0];

        if (!videoSource || !videoSource.file) {
            alert('Nebyl nalezen žádný přehrávatelný soubor.');
            return;
        }

        // Zobrazíme kontejner s přehrávačem
        playerContainer.style.display = 'block';

        // Nastavíme zdroj videa
        videoPlayer.src = videoSource.file;

        // Pokud jsou k dispozici titulky, přidáme je
        // Nejdříve smažeme staré titulkové stopy
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

        // Spustíme přehrávání
        videoPlayer.load();
        videoPlayer.play().catch(e => {
            console.log("Automatické přehrávání bylo zablokováno prohlížečem. Klikněte na Play ručně.");
        });

    } catch (err) {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) overlay.remove();
        alert('Chyba při získávání video streamu.');
        console.error(err);
    }
}
