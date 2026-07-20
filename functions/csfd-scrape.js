export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const url = searchParams.get('url');

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=3600'
  };

  if (!url || !url.includes('csfd.cz')) {
    return new Response(JSON.stringify({ error: "Neplatná nebo chybějící ČSFD URL" }), { 
      status: 400, 
      headers: corsHeaders 
    });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.csfd.cz/'
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `ČSFD nelze načíst (status ${response.status})` }), { 
        status: response.status, 
        headers: corsHeaders 
      });
    }

    const html = await response.text();

    // 1. PLAKÁT (Poster) - Vyhledáme velký plakát z profilu, záložně OpenGraph
    let poster = null;
    const posterMatch = html.match(/<div class="film-poster">[\s\S]*?<img[^>]+src="([^"]+)"/) || 
                        html.match(/<meta property="og:image" content="([^"]+)"/);
    if (posterMatch) {
      poster = posterMatch[1];
      if (poster.startsWith('//')) poster = 'https:' + poster;
    }

    // 2. POPIS (Description) - Zkusíme plný plot, kompaktní plot, nebo OpenGraph
    let description = null;
    const plotMatch = html.match(/<div class="plot-full">([\s\S]*?)<\/div>/) || 
                      html.match(/<p class="plot-compact">([\s\S]*?)<\/p>/) || 
                      html.match(/<div class="video-content">([\s\S]*?)<\/div>/);
    if (plotMatch) {
      description = plotMatch[1].replace(/<[^>]*>/g, '').trim();
    } else {
      const ogDescMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
      if (ogDescMatch) description = ogDescMatch[1].trim();
    }
    if (!description) description = "Popis filmu není k dispozici.";

    // 3. ŽÁNRY (Genres)
    let genres = "Neznámý žánr";
    const genreMatch = html.match(/<div class="genres">([\s\S]*?)<\/div>/);
    if (genreMatch) {
      genres = genreMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    // 4. HRAJÍ (Cast) - Vytáhneme pouze jména z odkazů
    let cast = "";
    const castMatch = html.match(/<h4>Hrají:<\/h4>([\s\S]*?)<\/div>/);
    if (castMatch) {
      const castHtml = castMatch[1];
      const actorRegex = /<a[^>]*>([^<]+)<\/a>/g;
      let actorMatch;
      const actors = [];
      while ((actorMatch = actorRegex.exec(castHtml)) !== null) {
        const name = actorMatch[1].trim();
        if (name && !name.toLowerCase().includes('více')) {
          actors.push(name);
        }
      }
      cast = actors.slice(0, 12).join(', ');
    }

    // 5. TRAILER - Přímý odkaz na MP4 video
    let trailer = null;
    const trailerMatch = html.match(/(https:\/\/video\.csfd\.cz\/[^"]+\.mp4)/) || 
                         html.match(/"file"\s*:\s*"([^"]+\.mp4[^"]*)"/) || 
                         html.match(/src="([^"]+\.mp4[^"]*)"/);
    if (trailerMatch) {
      trailer = trailerMatch[1].replace(/\\/g, '');
      if (trailer.startsWith('//')) trailer = 'https:' + trailer;
    }

    return new Response(JSON.stringify({
      poster,
      description,
      cast,
      genres,
      trailer
    }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
