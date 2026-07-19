export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400, headers: corsHeaders });
  }

  const CZDB_API = `https://api.czdb.cz/search?q=${encodeURIComponent(query)}`;
  const IMDB_API = `https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(query)}`;

  try {
    // KROK 1: První pokus na CZDB
    let czdbRes = await fetch(CZDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
    let czdbData = czdbRes && czdbRes.ok ? await czdbRes.json() : null;
    let czdbItems = czdbData && czdbData.results ? czdbData.results : [];

    let imdbResults = [];

    // KROK 2: Pokud CZDB napoprvé nic neví, prohledáme IMDb a zkusíme CZDB znovu s originálním názvem
    if (czdbItems.length === 0) {
      let imdbRes = await fetch(IMDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
      let imdbData = imdbRes && imdbRes.ok ? await imdbRes.json() : null;
      imdbResults = imdbData && imdbData.description ? imdbData.description : [];

      if (imdbResults.length > 0) {
        const origTitle = imdbResults[0]["#TITLE"] || imdbResults[0]["#AKA"];
        if (origTitle) {
          let retryCzdbRes = await fetch(`https://api.czdb.cz/search?q=${encodeURIComponent(origTitle)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
          let retryCzdbData = retryCzdbRes && retryCzdbRes.ok ? await retryCzdbRes.json() : null;
          if (retryCzdbData && retryCzdbData.results && retryCzdbData.results.length > 0) {
            czdbItems = retryCzdbData.results;
          }
        }
      }
    } else {
      // Pokud CZDB prošlo hned, i tak stáhneme IMDb data kvůli plakátům a informacím
      let imdbRes = await fetch(IMDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
      let imdbData = imdbRes && imdbRes.ok ? await imdbRes.json() : null;
      imdbResults = imdbData && imdbData.description ? imdbData.description : [];
    }

    let finalResults = [];
    const normalizeStr = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // KROK 3: Zpracování CZDB výsledků pomocí inteligentního bodovacího párování posterů
    czdbItems.forEach(czItem => {
      const czTitle = normalizeStr(czItem.nazev);
      const czOrig = normalizeStr(czItem.original);
      const czYear = parseInt(czItem.rok) || 0;

      let bestMatch = null;
      let highestScore = 0;

      imdbResults.forEach(imItem => {
        const imTitle = normalizeStr(imItem["#TITLE"]);
        const imAka = normalizeStr(imItem["#AKA"]);
        const imYear = parseInt(imItem["#YEAR"]) || 0;

        let score = 0;
        
        // Hodnocení shody názvů
        if (czTitle === imTitle || czOrig === imTitle || czTitle === imAka) {
          score += 10;
        } else if (czTitle.includes(imTitle) || imTitle.includes(czTitle) || czOrig.includes(imTitle)) {
          score += 5;
        }

        // Hodnocení shody roku vydání
        if (czYear > 0 && imYear > 0) {
          if (czYear === imYear) score += 5;
          else if (Math.abs(czYear - imYear) === 1) score += 2;
        }

        if (score > highestScore) {
          highestScore = score;
          bestMatch = imItem;
        }
      });

      // Pokud máme dostatečně spolehlivou shodu (aspoň shoda jména), provážeme je
      if (highestScore >= 5 && bestMatch) {
        bestMatch.wasMatched = true; // Označíme jako spárovaný, abychom ho neduplikovali
      } else {
        bestMatch = null;
      }

      finalResults.push({
        id: String(czItem.csfd_id || czItem.id),
        title: czItem.nazev,
        originalTitle: czItem.original || (bestMatch ? bestMatch["#TITLE"] : ''),
        year: czItem.rok || (bestMatch ? bestMatch["#YEAR"] : '---'),
        poster: (bestMatch && bestMatch["#IMG_POSTER"]) ? bestMatch["#IMG_POSTER"] : '',
        actors: bestMatch ? bestMatch["#ACTORS"] : '',
        source: bestMatch ? 'both' : 'csfd',
        imdbLink: bestMatch ? (bestMatch["#IMDB_URL"] || `https://www.imdb.com/title/${bestMatch["#IMDB_ID"]}`) : null,
        csfdLink: czItem.csfd_url || `https://www.csfd.cz/film/${czItem.csfd_id}`
      });
    });

    // KROK 4: Přidání všech zbývajících/nespárovaných filmů z IMDb (Garantuje, že se neztratí novinky jako Backrooms 2026)
    imdbResults.forEach(imItem => {
      if (!imItem.wasMatched) {
        finalResults.push({
          id: imItem["#IMDB_ID"] || Math.random().toString(),
          title: imItem["#TITLE"] || imItem["#AKA"] || "Neznámý název",
          originalTitle: imItem["#TITLE"] || '',
          year: imItem["#YEAR"] || '---',
          poster: imItem["#IMG_POSTER"] || '',
          actors: imItem["#ACTORS"] || '',
          source: 'imdb',
          imdbLink: imItem["#IMDB_URL"] || `https://www.imdb.com/title/${imItem["#IMDB_ID"]}`,
          csfdLink: null
        });
      }
    });

    // Seřadíme výsledky tak, aby ty s dostupným streamem (CZDB/Both) byly na předních pozicích
    finalResults.sort((a, b) => {
      if (a.source !== 'imdb' && b.source === 'imdb') return -1;
      if (a.source === 'imdb' && b.source !== 'imdb') return 1;
      return 0;
    });

    return new Response(JSON.stringify({ results: finalResults.slice(0, 16) }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
