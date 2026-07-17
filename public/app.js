async function search() {
  const query = document.getElementById('searchQuery').value.trim();
  if (!query) return;

  const resultsContainer = document.getElementById('results');
  resultsContainer.innerHTML = '<div class="loader">Vyhledávám videa a plakáty...</div>';

  document.getElementById('playerContainer').style.display = 'none';

  let globalPosterUrl = '';

  // 1. KROK: Získání plakátu z IMDb API
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
    console.log("IMDb API momentálně nedostupné:", imdbError.message);
  }

  // 2. KROK: Stažení vyhledávání z Přehraj.to přes AllOrigins CORS Proxy
  const targetUrl = `https://prehraj.to/hledej/${encodeURIComponent(query)}`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
  
  try {
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("CORS Proxy selhala");
    
    const proxyData = await response.json();
    const html = proxyData.contents; // AllOrigins ukládá HTML kód do proměnné contents
    
    if (!html) {
      throw new Error("Nepodařilo se načíst obsah stránky.");
    }

    const results = [];
    const videoBlockRegex = /<a[^>]+class="[^"]*video--link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const titleRegex = /<h3[^>]+class="[^"]*video__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/;
    const sizeRegex = /<div[^>]+class="[^"]*video__tag--size[^"]*"[^>]*>([\s\S]*?)<\/div>/;
    const durationRegex = /<div[^>]+class="[^"]*video__tag--time[^"]*"[^>]*>([\s\S]*?)<\/div>/;
    const imageRegex = /<img[^>]+(?:src|data-src)="([^"]+)"/;

    let match;
    const seenLinks = new Set();

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
      resultsContainer.innerHTML = '<div class="loader">Nebyly nalezeny žádné výsledky.</div>';
      return;
    }

    // Zapnutí flexbox mřížky pro karty
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
    resultsContainer.innerHTML = '<div class="loader" style="color: var(--accent);">Chyba: Nepodařilo se spojit s vyhledáváním. Zkuste to znovu.</div>';
    console.error(error);
  }
}
