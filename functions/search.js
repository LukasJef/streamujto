export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');
  const mode = searchParams.get('mode') || 'movies';

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400 });
  }

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

  // REŽIM 1: Vyhledávání filmů pro hlavní mřížku
  if (mode === 'movies') {
    try {
      let finalResults = [];

      // KROK 1: První rychlý pokus přímo přes české CZDB (OPRAVENÁ URL)
      try {
        const czdbRes = await fetch(`http://api.czdb.cz/search?q=${encodeURIComponent(query)}`, { headers });
        const czdbData = await czdbRes.json();

        if (czdbData && czdbData !== false) {
          const normalized = Array.isArray(czdbData) ? czdbData : [czdbData];
          if (normalized.length > 0 && normalized[0] !== null) {
            finalResults = normalized.filter(item => item && item.title).map(item => ({
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
      } catch (e) {
        console.log("Prvotní CZDB dotaz selhal:", e.message);
      }

      // KROK 2: Pokud CZDB napřímo nic nenašlo, zapojíme IMDb
      if (finalResults.length === 0) {
        let imdbData = null;
        
        // Pokus A: Vyhledávání s původním textem
        try {
          const imdbRes = await fetch(`https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(query)}`, { headers });
          if (imdbRes.ok) imdbData = await imdbRes.json();
        } catch (e) {}

        // Pokus B: Očištění od diakritiky jako záloha pro IMDb
        if (!imdbData || !imdbData.description || imdbData.description.length === 0) {
          const cleanQ = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          try {
            const imdbRes = await fetch(`https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(cleanQ)}`, { headers });
            if (imdbRes.ok) imdbData = await imdbRes.json();
          } catch (e) {}
        }

        // Pokud máme z IMDb data, zkusíme je zpětně počeštit přes CZDB
        if (imdbData && imdbData.description && imdbData.description.length > 0) {
          const imdbItems = imdbData.description.filter(item => item["#TITLE"]);

          for (const item of imdbItems.slice(0, 6)) {
            const engTitle = item["#TITLE"];
            const year = item["#YEAR"];
            const imdbId = item["#IMDB_ID"];
            const actors = item["#ACTORS"];
            const imdbPoster = item["#IMG_POSTER"];

            let czechTitle = engTitle;
            let czdbUrl = '';
            let czdbDesc = '';

            // Obrácený proces: Dotaz do CZDB přes EN název + rok z IMDb (OPRAVENÁ URL)
            try {
              const czCheckUrl = year 
                ? `http://api.czdb.cz/search?q=${encodeURIComponent(engTitle)}&y=${year}`
                : `http://api.czdb.cz/search?q=${encodeURIComponent(engTitle)}`;
              
              const czCheck = await fetch(czCheckUrl, { headers });
              const czCheckData = await czCheck.json();

              if (czCheckData && czCheckData !== false) {
                const single = Array.isArray(czCheckData) ? czCheckData[0] : czCheckData;
                if (single && single.title) {
                  czechTitle = single.title; 
                  czdbUrl = single.url || '';
                  czdbDesc = single.description || '';
                }
              }
            } catch (e) {}

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

      return new Response(JSON.stringify({ results: finalResults }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
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
