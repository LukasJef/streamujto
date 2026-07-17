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
async function searchMovies() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  const resultsContainer = document.getElementById('results');
  resultsContainer.innerHTML = '<p>Vyhledávám...</p>';

  try {
    const response = await fetch(`/functions/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      resultsContainer.innerHTML = '<p>Nebyly nalezeny žádné výsledky.</p>';
      return;
    }

    resultsContainer.innerHTML = data.results.map(item => `
      <div class="video-card" style="display: inline-block; width: 200px; margin: 10px; vertical-align: top; background: #1a1a1a; padding: 10px; border-radius: 8px;">
        <img src="${item.thumb}" class="video-thumb" style="width: 100%; height: 280px; object-fit: cover; border-radius: 6px; margin-bottom: 8px;">
        <h3 style="font-size: 14px; height: 40px; overflow: hidden; margin: 5px 0; color: #fff;">${item.title}</h3>
        <p style="font-size: 12px; color: #aaa; margin-bottom: 10px;">${item.size} | ${item.duration}</p>
        <button onclick="window.open('${item.link}', '_blank')" style="width: 100%; padding: 8px; background: #e50914; color: white; border: none; border-radius: 4px; cursor: pointer;">Spustit</button>
      </div>
    `).join('');

  } catch (error) {
    resultsContainer.innerHTML = '<p>Nastala chyba při vyhledávání.</p>';
    console.error(error);
  }
}
// 2. Vykreslení výsledků do HTML
function renderResults(results) {
    resultsDiv.innerHTML = '';
    
    results.forEach(item => {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.innerHTML = `
            <div class="video-info">
                <h3>${item.title}</h3>
            </div>
            <button class="play-btn" onclick="playVideo('${item.link}')">Spustit</button>
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
