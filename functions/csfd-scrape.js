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

    // 1. PŘÍMÝ SOUBOR TRAILERU (Hledání MP4/M3U8 odkazu na video.csfd.cz)
    const trailerMatch = html.match(/(https:\/\/video\.csfd\.cz\/[^"\s]+\.(?:mp4|m3u8|webm))/i);
    if (trailerMatch) {
      // Odstraníme případná utíkající zpětná lomítka, pokud byl odkaz v JSONu uvnitř skriptu
      data.trailer = trailerMatch[1].replace(/\\/g, ''); 
    }

    // 2. PLAKÁT FILMU
    const posterMatch = html.match(/<div[^>]+class="[^"]*film-poster[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i) 
                        || html.match(/(https:\/\/(?:image\.pmoviestat\.com|img\.csfd\.cz)\/files\/images\/film\/posters\/[^"\s>]+)/i);
    if (posterMatch) {
      data.poster = posterMatch[1];
    }

    // 3. POPIS / DĚJ FILMU
    const plotMatch = html.match(/<div[^>]+class="[^"]*plot-full[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
                      || html.match(/<div[^>]+class="[^"]*plot-preview[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (plotMatch) {
      data.description = plotMatch[1].replace(/<[^>]*>/g, '').trim();
    } else {
      // Nouzová záloha pro textové výpisy bez plných tříd
      const obsahyIdx = html.indexOf('Obsahy');
      if (obsahyIdx !== -1) {
        const block = html.substring(obsahyIdx, obsahyIdx + 1200).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
        const textMatch = block.match(/(?:Obsahy\s*\(\d+\)|Obsahy)\s*(.+)/i);
        if (textMatch && textMatch[1].length > 40) {
          data.description = textMatch[1].substring(0, 450).trim() + "...";
        }
      }
    }

    // 4. ŽÁNRY
    const genresMatch = html.match(/<div[^>]+class="[^"]*genres[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (genresMatch) {
      data.genres = genresMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    // 5. OBSAZENÍ / HRAJÍ
    const castMatch = html.match(/h4[^>]*>Hrají:[\s\S]*?<\/h4>([\s\S]*?)(?:<\/div>|h4|$)/i)
                    || html.match(/h6[^>]*>Hrají:[\s\S]*?<\/h6>([\s\S]*?)(?:<\/div>|h6|$)/i)
                    || html.match(/Hrají:[\s\S]*?([\s\S]*?)(?:\n\n|\r\n|$)/i);
    if (castMatch) {
      let cleanCast = castMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').replace(/[\(\[\{\}\]\)]/g, '').trim();
      if (cleanCast.includes('více')) {
        cleanCast = cleanCast.split('více')[0].trim();
      }
      data.cast = cleanCast.replace(/,\s*$/, ''); // Odstranění visící čárky
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
