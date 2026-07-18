export async function onRequest(context) {
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
