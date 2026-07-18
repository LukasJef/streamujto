// Pomocná funkce pro bezpečné stahování a parsování JSONu bez rizika pádu na HTML textu
async function safeFetchJson(url, headers) {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.log(`Server ${url} vrátil status kód: ${res.status}`);
      return null;
    }
    
    const text = await res.text();
    
    // Pokud odpověď začíná znakem < (je to HTML stránka / Cloudflare block), odmítneme ji parsovat
    if (text.trim().startsWith('<')) {
      console.log(`Varování: URL ${url} vrátila HTML místo JSONu (pravděpodobně chybová stránka).`);
      return null;
    }
    
    return JSON.parse(text);
  } catch (e) {
    console.log(`Selhal pokus o bezpečné stažení z URL ${url}:`, e.message);
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

      // KROK 1: Rychlý pokus přímo přes české CZDB
      const czdbData = await safeFetchJson(`http://api.czdb.cz/search?q=${encodeURIComponent(query)}`, headers);

      if (czdbData && czdbData !== false) {
        const normalized = Array.isArray(czdbData) ? czdbData : [czdbData];
        // Odfiltrujeme případné nevalidní objekty
        const validItems = normalized.filter(item => item && item.title);
        
        if (validItems.length > 0) {
          finalResults = validItems.map(item => ({
            id: item.imdb_id || null,
            title: item.title,
            originalTitle: item.title,
            year: item.year || '',
            poster: item.poster || null,
            description: item.description || '',
            url: item.url || '',
            source: 'czdb',
            userQuery: query
          }));
        }
      }

      // KROK 2: Pokud CZDB napřímo nic nenašlo (nebo vrátilo chybu), zkusíme IMDb zálohu
      if (finalResults.length === 0) {
        // Pokus A: Vyhledávání s původním textem
        let imdbData = await safeFetchJson(`https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(query)}`, headers);

        // Pokus B: Pokud Pokus A nic nenašel, očistíme text od diakritiky (pro IMDb)
        if (!imdbData || !imdbData.description || imdbData.description.length === 0) {
          const cleanQ = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          imdbData = await safeFetchJson(`https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(cleanQ)}`, headers);
        }

        // Pokud jsme z IMDb dostali validní pole, zkusíme položky počeštit
        if (imdbData && imdbData.description && Array.isArray(imdbData.description)) {
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

            // Zpětný překlad přes CZDB (EN název + Rok)
            const czCheckUrl = year 
              ? `http://api.czdb.cz/search?q=${encodeURIComponent(engTitle)}&y=${year}`
              : `http://api.czdb.cz/search?q=${encodeURIComponent(engTitle)}`;
            
            const czCheckData = await safeFetchJson(czCheckUrl, headers);

            if (czCheckData && czCheckData !== false) {
              const single = Array.isArray(czCheckData) ? czCheckData[0] : czCheckData;
              if (single && single.title) {
                czechTitle = single.title;
                czdbUrl = single.url || '';
                czdbDesc = single.description || '';
              }
            }

            finalResults.push({
              id: imdbId,
              title: czechTitle, 
              originalTitle: engTitle, 
              year: year || '',
              poster: imdbPoster || null,
              actors: actors || '',
              description: czdbDesc,
              url: czdbUrl,
              source: 'imdb',
              userQuery: query
            });
          }
        }
      }

      // Vždy vrátíme čistou JSON odpověď, i kdyby byla prázdná
      return new Response(JSON.stringify({ results: finalResults }), {
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        }
      });

    } catch (err) {
      // Globální záchranná síť
      return new Response(JSON.stringify({ error: "Interní chyba serveru: " + err.message, results: [] }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // REŽIM 2: Hledání souborů na Přehraj.to (Tady parsujeme čistý text, takže pád nehrozí)
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
