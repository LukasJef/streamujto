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
    // KROK 1: První ostrý pokus vyhledat film na CZDB
    let czdbRes = await fetch(CZDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
    let czdbData = czdbRes && czdbRes.ok ? await czdbRes.json() : null;
    let items = czdbData && czdbData.results ? czdbData.results : [];

    let imdbResults = [];

    // KROK 2: Pokud CZDB na první pokus nic nevrátí (např. chybí čárka v "Já padouch")
    if (items.length === 0) {
      let imdbRes = await fetch(IMDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
      let imdbData = imdbRes && imdbRes.ok ? await imdbRes.json() : null;
      imdbResults = imdbData && imdbData.description ? imdbData.description : [];

      // KROK 3: Vezmeme originální název z prvního nalezeného IMDb hitu a pošleme ho zpět do CZDB
      if (imdbResults.length > 0) {
        const origTitle = imdbResults[0]["#TITLE"] || imdbResults[0]["#AKA"];
        if (origTitle) {
          let retryCzdbRes = await fetch(`https://api.czdb.cz/search?q=${encodeURIComponent(origTitle)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
          let retryCzdbData = retryCzdbRes && retryCzdbRes.ok ? await retryCzdbRes.json() : null;
          
          if (retryCzdbData && retryCzdbData.results && retryCzdbData.results.length > 0) {
            items = retryCzdbData.results; // Našli jsme film na CZDB přes jeho originální název!
          }
        }
      }
    } else {
      // BONUS KROK: Pokud CZDB prošel napoprvé, stejně na pozadí dotáhneme IMDb kvůli plakátům a IMDb tlačítku
      let imdbRes = await fetch(IMDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
      let imdbData = imdbRes && imdbRes.ok ? await imdbRes.json() : null;
      imdbResults = imdbData && imdbData.description ? imdbData.description : [];
    }

    let finalResults = [];
    const normalizeStr = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (items.length > 0) {
      // Spárování nalezených CZDB filmů s detaily z IMDb (přiřazení plakátů a tlačítek)
      items.forEach(czItem => {
        const match = imdbResults.find(imItem => {
          const sameYear = Math.abs(Number(czItem.rok) - Number(imItem["#YEAR"])) <= 1;
          const sameTitle = normalizeStr(czItem.original) === normalizeStr(imItem["#TITLE"]) ||
                            normalizeStr(czItem.nazev) === normalizeStr(imItem["#TITLE"]) ||
                            normalizeStr(czItem.alt_nazev || '').includes(normalizeStr(imItem["#TITLE"])) ||
                            normalizeStr(czItem.original || '').includes(normalizeStr(imItem["#TITLE"]));
          return sameYear && sameTitle;
        });

        finalResults.push({
          id: String(czItem.csfd_id || czItem.id),
          title: czItem.nazev,
          originalTitle: czItem.original || (match ? match["#TITLE"] : ''),
          year: czItem.rok || (match ? match["#YEAR"] : '---'),
          poster: match ? match["#IMG_POSTER"] : '', // IMDb plakát okamžitě k dispozici
          actors: match ? match["#ACTORS"] : '',
          source: match ? 'both' : 'csfd',
          imdbLink: match ? (match["#IMDB_URL"] || `https://www.imdb.com/title/${match["#IMDB_ID"]}`) : null,
          csfdLink: czItem.csfd_url || `https://www.csfd.cz/film/${czItem.csfd_id}`
        });
      });
    } else if (imdbResults.length > 0) {
      // KROK 4: Pokud CZDB selhal i po druhém pokusu, IMDb slouží jako kompletní čistý fallback
      finalResults = imdbResults.map(imItem => ({
        id: imItem["#IMDB_ID"] || Math.random().toString(),
        title: imItem["#TITLE"] || imItem["#AKA"] || "Neznámý název",
        originalTitle: imItem["#TITLE"] || '',
        year: imItem["#YEAR"] || '---',
        poster: imItem["#IMG_POSTER"] || '',
        actors: imItem["#ACTORS"] || '',
        source: 'imdb',
        imdbLink: imItem["#IMDB_URL"] || `https://www.imdb.com/title/${imItem["#IMDB_ID"]}`,
        csfdLink: null
      }));
    }

    return new Response(JSON.stringify({ results: finalResults.slice(0, 14) }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
