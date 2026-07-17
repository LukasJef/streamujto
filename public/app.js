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
  const query = document.getElementById('searchQuery').value.trim();
  if (!query) return;

  const resultsContainer = document.getElementById('results');
  resultsContainer.innerHTML = '<div class="loader">Vyhledávám videa a plakáty...</div>';

  // Skryjeme přehrávač při novém vyhledávání, pokud byl otevřený
  document.getElementById('playerContainer').style.display = 'none';

  try {
    // Volání tvého Cloudflare Workeru
    const response = await fetch(`/functions/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      resultsContainer.innerHTML = '<div class="loader">Nebyly nalezeny žádné výsledky.</div>';
      return;
    }

    // Přestavíme kontejner z řádků na moderní Netflix-style mřížku (Flexbox)
    resultsContainer.style.display = "flex";
    resultsContainer.style.flexWrap = "wrap";
    resultsContainer.style.gap = "20px";
    resultsContainer.style.justifyContent = "center";
    resultsContainer.style.padding = "10px 0";

    resultsContainer.innerHTML = data.results.map(item => {
      // Pokud backend z IMDb nebo Přehraj.to dodal obrázek, použije se. Jinak nastoupí elegantní záloha.
      const imgSrc = item.thumb ? item.thumb : 'https://via.placeholder.com/200x280/1f1f1f/ffffff?text=Bez+Plakátu';

      return `
        <div style="width: 180px; background-color: var(--card-bg); padding: 12px; border-radius: 6px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
          <div>
            <img src="${imgSrc}" style="width: 100%; height: 240px; object-fit: cover; border-radius: 4px; background-color: #000; display: block; margin-bottom: 10px;" referrerpolicy="no-referrer">
            <h3 style="font-size: 14px; margin: 0 0 6px 0; color: var(--text); line-height: 1.3; max-height: 36px; overflow: hidden; text-align: left;">${item.title}</h3>
            <p style="font-size: 11px; color: var(--text-dim); margin: 0 0 12px 0; text-align: left;">${item.size || item.duration || 'Video'}</p>
          </div>
          <button class="play-btn" onclick="window.open('${item.link}', '_blank')" style="width: 100%; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Spustit</button>
        </div>
      `;
    }).join('');

  } catch (error) {
    resultsContainer.innerHTML = '<div class="loader" style="color: var(--accent);">Nastala chyba při komunikaci se serverem.</div>';
    console.error(error);
  }
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
