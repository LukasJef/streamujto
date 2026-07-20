import { csfd } from 'node-csfd-api';

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
    // KROK 1: Paralelní dotaz na ČSFD, CZDB i IMDb naráz (výrazně rychlejší načítání)
    const [csfdRes, czdbRes, imdbRes] = await Promise.allSettled([
      csfd.search(query).catch(() => null),
      fetch(CZDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => null),
      fetch(IMDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => null)
    ]);

    const csfdItems = (csfdRes.status === 'fulfilled' && csfdRes.value?.movies) ? csfdRes.value.movies : [];
    const czdbItems = (czdbRes.status === 'fulfilled' && czdbRes.value?.results) ? czdbRes.value.results : [];
    const imdbResults = (imdbRes.status === 'fulfilled' && imdbRes.value?.description) ? imdbRes.value.description : [];

    const finalResults = [];
    const seenKeys = new Set();
    const normalizeStr = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // KROK 2: Zpracování ČSFD výsledků (Nejvyšší priorita)
    csfdItems.forEach(csfdMovie => {
      const title = csfdMovie.title || csfdMovie.titleCz;
      const key = `${normalizeStr(title)}_${csfdMovie.year || ''}`;
      seenKeys.add(key);

      // Zkusíme najít shodu v IMDb pro herce / IMDb odkaz
      const matchedImdb = imdbResults.find(im => {
        const imTitle = normalizeStr(im["#TITLE"]);
        const imAka = normalizeStr(im["#AKA"]);
        const tNorm = normalizeStr(title);
        return imTitle === tNorm || imAka === tNorm;
      });

      if (matchedImdb) matchedImdb.wasMatched = true;

      // Zkusíme najít shodu v CZDB pro provázání
      const matchedCzdb = czdbItems.find(cz => normalizeStr(cz.nazev) === normalizeStr(title));
      if (matchedCzdb) matchedCzdb.wasMatched = true;

      finalResults.push({
        id: String(csfdMovie.id || Math.random()),
        title: title,
        originalTitle: csfdMovie.titleOriginal || (matchedImdb ? matchedImdb["#TITLE"] : ''),
        year: csfdMovie.year || '---',
        poster: csfdMovie.poster || (matchedImdb ? matchedImdb["#IMG_POSTER"] : ''),
        actors: matchedImdb ? matchedImdb["#ACTORS"] : '',
        source: 'csfd',
        imdbLink: matchedImdb ? (matchedImdb["#IMDB_URL"] || `https://www.imdb.com/title/${matchedImdb["#IMDB_ID"]}`) : null,
        csfdLink: csfdMovie.url || (csfdMovie.id ? `https://www.csfd.cz/film/${csfdMovie.id}` : null),
        csfd_url: csfdMovie.url || (csfdMovie.id ? `https://www.csfd.cz/film/${csfdMovie.id}` : null)
      });
    });

    // KROK 3: Doplnění výsledků z CZDB (které nebyly v ČSFD)
    czdbItems.forEach(czItem => {
      if (czItem.wasMatched) return;

      const czTitle = normalizeStr(czItem.nazev);
      const czYear = parseInt(czItem.rok) || 0;
      const key = `${czTitle}_${czYear}`;

      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      let bestMatch = null;
      let highestScore = 0;

      imdbResults.forEach(imItem => {
        if (imItem.wasMatched) return;
        const imTitle = normalizeStr(imItem["#TITLE"]);
        const imYear = parseInt(imItem["#YEAR"]) || 0;

        let score = 0;
        if (czTitle === imTitle) score += 10;
        if (czYear > 0 && czYear === imYear) score += 5;

        if (score > highestScore) {
          highestScore = score;
          bestMatch = imItem;
        }
      });

      if (bestMatch && highestScore >= 5) {
        bestMatch.wasMatched = true;
      }

      finalResults.push({
        id: String(czItem.csfd_id || czItem.id || Math.random()),
        title: czItem.nazev,
        originalTitle: czItem.original || (bestMatch ? bestMatch["#TITLE"] : ''),
        year: czItem.rok || (bestMatch ? bestMatch["#YEAR"] : '---'),
        poster: (bestMatch && bestMatch["#IMG_POSTER"]) ? bestMatch["#IMG_POSTER"] : '',
        actors: bestMatch ? bestMatch["#ACTORS"] : '',
        source: 'czdb',
        imdbLink: bestMatch ? (bestMatch["#IMDB_URL"] || `https://www.imdb.com/title/${bestMatch["#IMDB_ID"]}`) : null,
        csfdLink: czItem.csfd_url || `https://www.csfd.cz/film/${czItem.csfd_id}`,
        csfd_url: czItem.csfd_url || `https://www.csfd.cz/film/${czItem.csfd_id}`
      });
    });

    // KROK 4: Doplnění zbývajících IMDb výsledků (např. nenašlo se nikde v ČR)
    imdbResults.forEach(imItem => {
      if (imItem.wasMatched) return;

      const imTitle = normalizeStr(imItem["#TITLE"]);
      const key = `${imTitle}_${imItem["#YEAR"] || ''}`;

      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      finalResults.push({
        id: imItem["#IMDB_ID"] || String(Math.random()),
        title: imItem["#TITLE"] || imItem["#AKA"] || "Neznámý název",
        originalTitle: imItem["#TITLE"] || '',
        year: imItem["#YEAR"] || '---',
        poster: imItem["#IMG_POSTER"] || '',
        actors: imItem["#ACTORS"] || '',
        source: 'imdb',
        imdbLink: imItem["#IMDB_URL"] || `https://www.imdb.com/title/${imItem["#IMDB_ID"]}`,
        csfdLink: null,
        csfd_url: null
      });
    });

    return new Response(JSON.stringify({ results: finalResults.slice(0, 20) }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
