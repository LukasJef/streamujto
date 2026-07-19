export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const url = searchParams.get('url');

  if (!url || !url.includes('csfd.cz')) {
    return new Response(JSON.stringify({ error: "Neplatná nebo chybějící ČSFD URL" }), { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.csfd.cz/'
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "ČSFD stránku nelze načíst" }), { status: response.status });
    }

    const html = await response.text();
    const data = {
      poster: null,
      description: null,
      cast: null,
      genres: null,
      trailer: null
    };

    // 1. Poster (Plakát) - Využijeme OpenGraph tag, který je nejstabilnější
    const ogPosterMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (ogPosterMatch) data.poster = ogPosterMatch[1];

    // 2. Description (Obsah/Popis filmu)
    // Zkusíme najít hlavní text distributora/obsahu, jinak použijeme OG popis jako fallback
    const plotMatch = html.match(/<p class="plot-compact">([\s\S]*?)<\/p>/) || html.match(/<div class="plot-full">[\s\S]*?<p>([\s\S]*?)<\/p>/);
    if (plotMatch) {
      data.description = plotMatch[1].replace(/<[^>]*>/g, '').trim();
    } else {
      const ogDescMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
      if (ogDescMatch) data.description = ogDescMatch[1].trim();
    }

    // 3. Genres (Žánry)
    const genresMatch = html.match(/<div class="genres">([\s\S]*?)<\/div>/);
    if (genresMatch) {
      data.genres = genresMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    // 4. Cast (Hrají)
    const castMatch = html.match(/<h4>Hrají:<\/h4>([\s\S]*?)<\/div>/);
    if (castMatch) {
      const castHtml = castMatch[1];
      const actorRegex = /<a[^>]*>([^<]+)<\/a>/g;
      let actorMatch;
      const actors = [];
      while ((actorMatch = actorRegex.exec(castHtml)) !== null) {
        actors.push(actorMatch[1].trim());
      }
      data.cast = actors.slice(0, 12).join(', '); // Vezmeme prvních 12 herců
    }

    // 5. Trailer (Hledání přímého MP4 videa v konfiguraci JWPlayeru nebo JS na ČSFD)
    const trailerMatch = html.match(/"file"\s*:\s*"([^"]+\.mp4[^"]*)"/) || html.match(/src="([^"]+\.mp4[^"]*)"/);
    if (trailerMatch) {
      // Odstraníme případná zpětná lomítka z JSON stringu
      data.trailer = trailerMatch[1].replace(/\\/g, '');
    }

    return new Response(JSON.stringify(data), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // Kešovat na 1 hodinu pro úsporu požadavků
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
