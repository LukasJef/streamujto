async function search() {
  const query = document.getElementById('searchQuery').value.trim();
  if (!query) return;

  const resultsContainer = document.getElementById('results');
  resultsContainer.innerHTML = '<div class="loader">Vyhledávám...</div>';

  document.getElementById('playerContainer').style.display = 'none';

  let globalPosterUrl = '';

  // 1. KROK: Vytáhneme plakát z IMDb (který nám prokazatelně funguje!)
  try {
    const imdbApiUrl = `https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(query)}`;
    const imdbResponse = await fetch(imdbApiUrl);

    if (imdbResponse.ok) {
      const imdbData = await imdbResponse.json();
      if (imdbData && imdbData.description && imdbData.description.length > 0) {
        const firstMatch = imdbData.description.find(item => item["#IMG_POSTER"]);
        if (firstMatch) {
          globalPosterUrl = firstMatch["#IMG_POSTER"];
        }
      }
    }
  } catch (imdbError) {
    console.log("IMDb API selhalo, ale pokračujeme dál:", imdbError.message);
  }

  // 2. KROK: Načtení dat z Přehraj.to přes AllOrigins proxy
  const targetUrl = `https://prehraj.to/hledej/${encodeURIComponent(query)}`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
  
  try {
    // 2. KROK: Stažení vyhledávání z Přehraj.to přes AllOrigins CORS Proxy
  // Přidáno koncové lomítko, které Přehraj.to někdy vyžaduje pro správné směrování
  const targetUrl = `https://prehraj.to/hledej/${encodeURIComponent(query)}/`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
  
  try {
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("CORS Proxy neodpovídá");
    
    const proxyData = await response.json();
    
    // Extrémně bezpečná kontrola obsahu - AllOrigins může vrátit string i objekt
    let html = '';
    if (proxyData && proxyData.contents) {
      html = proxyData.contents;
    } else if (typeof proxyData === 'string') {
      html = proxyData;
    }
    
    if (!html || html.trim() === "") {
      throw new Error("Proxy vrátila prázdný obsah.");
    }

    const results = [];
    // Upravený regulární výraz, který je méně náchylný na změny mezer v HTML kódu Přehraj.to
    const videoBlockRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const titleRegex = /<h3[^>]*>([\s\S]*?)<\/h3>/;
    const sizeRegex = /<div[^>]+class="[^"]*video__tag--size[^"]*"[^>]*>([\s\S]*?)<\/div>/;
    const durationRegex = /<div[^>]+class="[^"]*video__tag--time[^"]*"[^>]*>([\s\S]*?)<\/div>/;
    const imageRegex = /<img[^>]+(?:src|data-src)="([^"]+)"/;
    
    while ((match = videoBlockRegex.exec(html)) !== null) {
      const link = match[1];
      const innerHtml = match[2];

      const titleMatch = innerHtml.match(titleRegex);
      const sizeMatch = innerHtml.match(sizeRegex);
      const durationMatch = innerHtml.match(durationRegex);
      const imageMatch = innerHtml.match(imageRegex);

      if (titleMatch && !seenLinks.has(link)) {
        seenLinks.add(link);
        
        const title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
        const size = sizeMatch ? sizeMatch[1].replace(/<[^>]*>/g, '').trim() : '';
        const duration = durationMatch ? durationMatch[1].replace(/<[^>]*>/g, '').trim() : '';
        
        let backupThumb = imageMatch ? imageMatch[1] : '';
        if (backupThumb && backupThumb.startsWith('/')) {
          backupThumb = `https://prehraj.to${backupThumb}`;
        }

        results.push({
          link: link,
          title: title,
          size: size,
          duration: duration,
          thumb: globalPosterUrl || backupThumb
        });
      }
    }

    if (results.length === 0) {
      resultsContainer.innerHTML = '<div class="loader">Nebyly nalezeny žádné výsledky na Přehraj.to.</div>';
      return;
    }

    // 3. KROK: Vykreslení výsledků do mřížky
    resultsContainer.style.display = "flex";
    resultsContainer.style.flexWrap = "wrap";
    resultsContainer.style.gap = "20px";
    resultsContainer.style.justifyContent = "center";
    resultsContainer.style.padding = "10px 0";

    resultsContainer.innerHTML = results.map(item => {
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
    // Zachráníme situaci: Proxy pro videa selhala, ale ukážeme aspoň ten nalezený plakát z IMDb jako info!
    if (globalPosterUrl) {
      resultsContainer.innerHTML = `
        <div style="text-align: center; color: white; max-width: 300px;">
          <p style="color: var(--accent); font-weight: bold;">Videa z Přehraj.to se nepodařilo načíst (CORS limit), ale film jsme našli:</p>
          <img src="${globalPosterUrl}" style="width: 200px; height: 280px; object-fit: cover; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
          <h3 style="margin-top: 10px;">${query}</h3>
        </div>
      `;
    } else {
      resultsContainer.innerHTML = '<div class="loader" style="color: var(--accent);">Došlo k chybě sítě. Zkuste hledání opakovat za chvíli.</div>';
    }
    console.error("Chyba vyhledávání:", error);
  }
}
