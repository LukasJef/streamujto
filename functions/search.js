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
    // Spuštění obou dotazů současně pro maximální rychlost
    const [czdbRes, imdbRes] = await Promise.all([
      fetch(CZDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(IMDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null)
    ]);

    const czdbData = czdbRes && czdbRes.ok ? await czdbRes.json() : null;
    const imdbData = imdbRes && imdbRes.ok ? await imdbRes.json() : null;

    const czdbResults = czdbData && czdbData.results ? czdbData.results : [];
    const imdbResults = imdbData && imdbData.description ? imdbData.description : [];

    let finalResults = [];

    // Pomocná funkce pro normalizaci textu při porovnávání shod
    const normalizeStr = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // KROK 1 & 2: Projdeme ČSFD výsledky a zkusíme k nim z IMDb naráz napárovat plakát a ID
    czdbResults.forEach(czItem => {
      const match = imdbResults.find(imItem => {
        const sameYear = Math.abs(Number(czItem.rok) - Number(imItem["#YEAR"])) <= 1;
        const sameTitle = normalizeStr(czItem.original) === normalizeStr(imItem["#TITLE"]) ||
                            normalizeStr(czItem.nazev) === normalizeStr(imItem["#TITLE"]) ||
                            normalizeStr(czItem.alt_nazev).includes(normalizeStr(imItem["#TITLE"]));
        return sameYear && sameTitle;
      });

      finalResults.push({
        id: String(czItem.csfd_id || czItem.id),
        title: czItem.nazev,
        originalTitle: czItem.original || (match ? match["#TITLE"] : ''),
        year: czItem.rok || (match ? match["#YEAR"] : '---'),
        // Pokud najde shodu, vezme IMDb plakát okamžitě jako primární podklad
        poster: match ? match["#IMG_POSTER"] : '', 
        actors: match ? match["#ACTORS"] : '',
        source: match ? 'both' : 'csfd',
        imdbLink: match ? (match["#IMDB_URL"] || `https://www.imdb.com/title/${match["#IMDB_ID"]}`) : null,
        csfdLink: czItem.csfd_url || `https://www.csfd.cz/film/${czItem.csfd_id}`
      });
    });

    // KROK 3: Pokud zbyla nějaká exkluzivní data na IMDb, která ČSFD vůbec nezná, přidáme je samostatně
    imdbResults.forEach(imItem => {
      const isAlreadyAdded = finalResults.some(f => f.imdbLink && f.imdbLink.includes(imItem["#IMDB_ID"]));
      if (!isAlreadyAdded) {
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

    return new Response(JSON.stringify({ results: finalResults.slice(0, 14) }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
