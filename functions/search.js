export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');
  const mode = searchParams.get('mode') || 'movies';

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400 });
  }

  // REŽIM 1: Inteligentní vyhledávání filmů pro hlavní mřížku (S počeštěním)
  if (mode === 'movies') {
    try {
      let finalResults = [];

      // KROK 1: Zkusíme nejdříve české CZDB
      const czdbRes = await fetch(`http://api.czdb.cz?q=${encodeURIComponent(query)}`);
      const czdbData = await czdbRes.json();

      if (czdbData && czdbData !== false) {
        const normalized = Array.isArray(czdbData) ? czdbData : [czdbData];
        finalResults = normalized.map(item => ({
          id: item.imdb_id || null,
          title: item.title,
          originalTitle: item.title,
          year: item.year || '',
          poster: item.poster || null,
          description: item.description || '',
          url: item.url || '',
          source: 'czdb'
        }));
      }

      // KROK 2: Pokud CZDB nic nenašlo, jdeme na IMDb a budeme překládat zpět
      if (finalResults.length === 0) {
        const imdbRes = await fetch(`https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(query)}`);
        if (imdbRes.ok) {
          const imdbData = await imdbRes.json();
          const imdbItems = imdbData.description || [];

          // Vezmeme top 6 výsledků z IMDb a zkusíme je poslat zpět do CZDB pro český název
          for (const item of imdbItems.slice(0, 6)) {
            const engTitle = item["#TITLE"];
            const year = item["#YEAR"];
            const imdbId = item["#IMDB_ID"];
            const actors = item["#ACTORS"];
            const imdbPoster = item["#IMG_POSTER"];

            let czechTitle = engTitle; // výchozí fallback
            let czdbUrl = '';
            let czdbDesc = '';

            // OBRÁCENÝ PROCES: Vezmeme EN název + ROK z IMDb a zkusíme znovu CZDB
            try {
              const czCheckUrl = year 
                ? `http://api.czdb.cz?q=${encodeURIComponent(engTitle)}&y=${year}`
                : `http://api.czdb.cz?q=${encodeURIComponent(engTitle)}`;
              
              const czCheck = await fetch(czCheckUrl);
              const czCheckData = await czCheck.json();

              if (czCheckData && czCheckData !== false) {
                const single = Array.isArray(czCheckData) ? czCheckData[0] : czCheckData;
                if (single.title) {
                  czechTitle = single.title; // HURÁ! Máme český název (např. Pasažéři místo Passengers)
                  czdbUrl = single.url || '';
                  czdbDesc = single.description || '';
                }
              }
            } catch (e) { console.log("Chyba při zpětném překladu přes CZDB"); }

            finalResults.push({
              id: imdbId,
              title: czechTitle, // Český název (pokud byl nalezen)
              originalTitle: engTitle, // Anglický název (skvělé pro vyhledávání trailerů!)
              year: year || '',
              poster: imdbPoster || null,
              actors: actors || '',
              description: czdbDesc,
              url: czdbUrl,
              source: 'imdb'
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

  // REŽIM 2: Hledání souborů na Přehraj.to (zůstává stejné, spouští se na pozadí)
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
}export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');
  const mode = searchParams.get('mode') || 'movies'; // 'movies' nebo 'files'

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400 });
  }

  // REŽIM 1: Hledání čistých filmů pro hlavní mřížku karet
  if (mode === 'movies') {
    try {
      const imdbApiUrl = `https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(query)}`;
      const imdbResponse = await fetch(imdbApiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      
      if (imdbResponse.ok) {
        const imdbData = await imdbResponse.json();
        const movies = (imdbData.description || [])
          .filter(item => item["#TITLE"] && (item["#ACTORS"] || item["#YEAR"])) // filtrace na skutečné filmy/seriály
          .map(item => ({
            id: item["#IMDB_ID"],
            title: item["#TITLE"],
            year: item["#YEAR"],
            poster: item["#IMG_POSTER"],
            actors: item["#ACTORS"]
          }));
        
        return new Response(JSON.stringify({ results: movies }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // REŽIM 2: Hledání souborů na Přehraj.to (spouští se na pozadí po rozkliknutí filmu)
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
