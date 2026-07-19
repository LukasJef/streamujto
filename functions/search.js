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

  let finalResults = [];

  try {
    // KROK 1: Vyhledáme film na CZDB (ČSFD) podle přesné struktury results
    let czdbRes = await fetch(CZDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    let czdbData = czdbRes.ok ? await czdbRes.json() : null;

    if (czdbData && czdbData.results && czdbData.results.length > 0) {
      finalResults = normalizeCzdb(czdbData.results, 'csfd');
    } else {
      // KROK 2: Nic nevychází -> Vyhledáme na iamidiot (IMDb API)
      let imdbRes = await fetch(IMDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      let imdbData = imdbRes.ok ? await imdbRes.json() : null;

      if (imdbData && imdbData.description && imdbData.description.length > 0) {
        // KROK 3: Vezmeme originální název z prvního zápisu a zkusíme ho poslat zpět do CZDB
        const origTitle = imdbData.description[0]["#TITLE"] || imdbData.description[0]["#AKA"];
        
        if (origTitle) {
          let retryCzdbRes = await fetch(`https://api.czdb.cz/search?q=${encodeURIComponent(origTitle)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          let retryCzdbData = retryCzdbRes.ok ? await retryCzdbRes.json() : null;
          
          if (retryCzdbData && retryCzdbData.results && retryCzdbData.results.length > 0) {
            finalResults = normalizeCzdb(retryCzdbData.results, 'both');
          }
        }

        // KROK 4: Pokud CZDB po 4. kroku stále nevychází, IMDb poslouží jako kompletní fallback
        if (finalResults.length === 0) {
          finalResults = normalizeImdb(imdbData.description, 'imdb');
        }
      }
    }

    return new Response(JSON.stringify({ results: finalResults }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

function normalizeCzdb(items, source) {
  return items.map(item => ({
    id: String(item.csfd_id || item.id),
    title: item.nazev,
    originalTitle: item.original || '',
    year: item.rok || '---',
    poster: '', 
    actors: '',
    source: source,
    imdbLink: null,
    csfdLink: item.csfd_url || `https://www.csfd.cz/film/${item.csfd_id}`
  })).slice(0, 12);
}

function normalizeImdb(items, source) {
  return items.map(item => ({
    id: item["#IMDB_ID"] || Math.random().toString(),
    title: item["#TITLE"] || item["#AKA"] || "Neznámý název",
    originalTitle: item["#TITLE"] || '',
    year: item["#YEAR"] || '---',
    poster: item["#IMG_POSTER"] || '',
    actors: item["#ACTORS"] || '',
    source: source,
    imdbLink: item["#IMDB_URL"] || `https://www.imdb.com/title/${item["#IMDB_ID"]}`,
    csfdLink: null
  })).slice(0, 12);
}
