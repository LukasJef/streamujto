// Pomocná funkce pro bezpečné stahování a parsování JSONu bez rizika pádu na HTML textu
async function safeFetchJson(url, headers) {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    
    const text = await res.text();
    if (text.trim().startsWith('<')) return null; // Ochrana proti HTML chybovým stránkám
    
    return JSON.parse(text);
  } catch (e) {
    console.log(`Chyba stahování z URL ${url}:`, e.message);
    return null;
  }
}

export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');
  const mode = searchParams.get('mode') || 'movies';

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400 });
  }

  const headers = { 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  };

  // REŽIM 1: Inteligentní vyhledávání filmů pro hlavní mřížku
  if (mode === 'movies') {
    try {
      let finalResults = [];

      // KROK 1: Vyhledávání přímo přes české CZDB
      const czdbData = await safeFetchJson(`http://api.czdb.cz/search?q=${encodeURIComponent(query)}`, headers);
      
      // Bezpečně vytáhneme pole výsledků z objektu (podle struktury "results")
      let czdbItems = [];
      if (czdbData && czdbData.results && Array.isArray(czdbData.results)) {
        czdbItems = czdbData.results;
      } else if (czdbData && Array.isArray(czdbData)) {
        czdbItems = czdbData;
      }

      if (czdbItems.length > 0) {
        // Použijeme správné české klíče: nazev, original, rok, csfd_url
        finalResults = czdbItems.filter(item => item && (item.nazev || item.title)).map(item => ({
          id: item.imdb_id || item.csfd_id || item.id || null,
          title: item.nazev || item.title,
          originalTitle: item.original || item.originalTitle || item.nazev || item.title,
          year: item.rok || item.year || '',
          poster: item.poster || null,
          description: item.description || '',
          url: item.csfd_url || item.url || '',
          source: 'czdb',
          userQuery: query
        }));
      }

      // KROK 2: Pokud CZDB na přímý dotaz nic nenašlo, nastupuje IMDb fallback
      if (finalResults.length === 0) {
        let imdbData = await safeFetchJson(`https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(query)}`, headers);

        // Záloha pro IMDb: Pokud dotaz s diakritikou selhal, zkusíme to bez ní
        if (!imdbData || !imdbData.description || imdbData.description.length === 0) {
          const cleanQ = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          imdbData = await safeFetchJson(`https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(cleanQ)}`, headers);
        }

        if (imdbData && imdbData.description && Array.isArray(imdbData.description)) {
          // Filtrujeme položky, které mají validní #TITLE podle IMDb struktury
          const imdbItems = imdbData.description.filter(item => item && item["#TITLE"]);

          for (const item of imdbItems.slice(0, 6)) {
            const engTitle = item["#TITLE"];
            const year = item["#YEAR"];
            const imdbId = item["#IMDB_ID"];
            const actors = item["#ACTORS"];
            const imdbPoster = item["#IMG_POSTER"];

            let czechTitle = engTitle;
            let czdbUrl = '';
            let czdbDesc = '';

            // KROK 3: Vezmeme originální název z IMDb a zkusíme ho dodatečně počeštit přes CZDB
            const czCheckUrl = year 
              ? `http://api.czdb.cz/search?q=${encodeURIComponent(engTitle)}&y=${year}`
              : `http://api.czdb.cz/search?q=${encodeURIComponent(engTitle)}`;
            
            const czCheckData = await safeFetchJson(czCheckUrl, headers);
            
            let czCheckItems = [];
            if (czCheckData && czCheckData.results && Array.isArray(czCheckData.results)) {
              czCheckItems = czCheckData.results;
            } else if (czCheckData && Array.isArray(czCheckData)) {
              czCheckItems = czCheckData;
            }

            if (czCheckItems.length > 0) {
              const single = czCheckItems[0];
              if (single && (single.nazev || single.title)) {
                czechTitle = single.nazev || single.title;
                czdbUrl = single.csfd_url || single.url || '';
                czdbDesc = single.description || '';
              }
            }

            // KROK 4: Pokud počeštění přes originální název nevyšlo, data zůstanou v EN z IMDb (fallback)
            finalResults.push({
              id: imdbId,
              title: czechTitle, 
              originalTitle: engTitle, 
              year: year || '',
              poster: imdbPoster || null,
              actors: actors || '',
              description: czdbDesc,
              url: czdbUrl || (imdbId ? `https://www.imdb.com/title/${imdbId}` : ''),
              source: 'imdb',
              userQuery: query
            });
          }
        }
      }

      return new Response(JSON.stringify({ results: finalResults }), {
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Interní chyba: " + err.message, results: [] }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // REŽIM 2: Hledání souborů na Přehraj.to
  if (mode === 'files') {
    const url = `https://prehraj.to/hledej/${encodeURIComponent(query)}`;
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'kodi/prehraj.to', 'Referer': 'https://prehraj.to/' }
      });

      const html = await response.text();
      const results = [];
      const videoBlockRegex = /<a[^>]+class="[^"]*video--link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const titleRegex = /<h3[^>]+class="[^"]*video__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/;
      const sizeRegex = /<div[^>]+class="[^"]*video__tag--size[^"]*"[^>]*>([\s\S]*?)<\/div>/;
      const durationRegex = /<div[^>]+class="[^"]*video__tag--time[^"]*"[^>]*>([\s\S]*?)<\/div>/;

      let match;
      const seenLinks = new Set();

      while ((match = videoBlockRegex.exec(html)) !== null) {
        const link = match[1];
        const innerHtml = match[2];
        const titleMatch = innerHtml.match(titleRegex);
        
        if (titleMatch && !seenLinks.has(link)) {
          seenLinks.add(link);
          results.push({
            link: link,
            title: titleMatch[1].replace(/<[^>]*>/g, '').trim(),
            size: innerHtml.match(sizeRegex) ? innerHtml.match(sizeRegex)[1].replace(/<[^>]*>/g, '').trim() : '',
            duration: innerHtml.match(durationRegex) ? innerHtml.match(durationRegex)[1].replace(/<[^>]*>/g, '').trim() : ''
          });
        }
      }
      return new Response(JSON.stringify({ files: results }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }
}
