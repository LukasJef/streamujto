// Pomocná funkce, která vyčistí název videa z Přehraj.to, aby IMDb API našlo správný film
function cleanTitleForIMDb(title) {
  let clean = title.toLowerCase();
  
  // Odstraníme běžné přípony souborů
  clean = clean.replace(/\.(mp4|mkv|avi|avi|wmv|m4v)\b/g, '');
  
  // Odstraníme balast jako dabing, kvalitu, kodeky a skupiny
  clean = clean.replace(/(cz\s*dabing|dabing|cz|sk|titulky|hdtv|1080p|720p|2160p|4k|x264|x265|bluray|dvdrip|brrip|web-dl)/g, '');
  
  // Odstraníme závorky, tečky, podtržítka a nahradíme je mezerami
  clean = clean.replace(/[\[\]\(\)\-\._]/g, ' ');
  
  // Smažeme přebytečné mezery
  return clean.replace(/\s+/g, ' ').trim();
}

export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400 });
  }

  const url = `https://prehraj.to/hledej/${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'kodi/prehraj.to',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'cs,en;q=0.5',
        'Referer': 'https://prehraj.to/'
      }
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Přehraj.to vrátilo limit 429." }), { status: 429 });
    }

    const html = await response.text();
    const results = [];

    const videoBlockRegex = /<a[^>]+class="[^"]*video--link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const titleRegex = /<h3[^>]+class="[^"]*video__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/;
    const sizeRegex = /<div[^>]+class="[^"]*video__tag--size[^"]*"[^>]*>([\s\S]*?)<\/div>/;
    const durationRegex = /<div[^>]+class="[^"]*video__tag--time[^"]*"[^>]*>([\s\S]*?)<\/div>/;
    const imageRegex = /<img[^>]+(?:src|data-src)="([^"]+)"/;

    let match;
    const seenLinks = new Set();

    while ((match = videoBlockRegex.exec(html)) !== null) {
      const link = match[1];
      const innerHtml = match[2];

      const titleMatch = innerHtml.match(titleRegex);
      const sizeMatch = innerHtml.match(sizeRegex);
      const durationMatch = innerHtml.match(durationRegex);
      const imageMatch = innerHtml.match(imageRegex);

      if (titleMatch && !seenLinks.has(link)) {
        seenLinks.add(link);
        
        const title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
        const size = sizeMatch ? sizeMatch[1].replace(/<[^>]*>/g, '').trim() : '';
        const duration = durationMatch ? durationMatch[1].replace(/<[^>]*>/g, '').trim() : '';
        
        // Záložní thumbnail z Přehraj.to
        let backupThumb = imageMatch ? imageMatch[1] : '';
        if (backupThumb && backupThumb.startsWith('/')) {
          backupThumb = `https://prehraj.to${backupThumb}`;
        }

        // HLEDÁNÍ POSTERU PŘES IMDB API
        let imdbPosterUrl = '';
        try {
          const searchTitle = cleanTitleForIMDb(title);
          
          // Zavoláme to vtipné IMDb API bez nutnosti klíče
          const imdbApiUrl = `https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(searchTitle)}`;
          const imdbRes = await fetch(imdbApiUrl);
          
          if (imdbRes.ok) {
            const imdbData = await imdbRes.json();
            // Pokud API vrátilo výsledky a první z nich má popisek a poster
            if (imdbData.description && imdbData.description.length > 0) {
              const firstMatch = imdbData.description[0];
              // Ověříme, že to má fotku (poster)
              if (firstMatch["#IMG_POSTER"]) {
                imdbPosterUrl = firstMatch["#IMG_POSTER"];
              }
            }
          }
        } catch (e) {
          // Pokud IMDb API selže nebo neodpoví, tiše ignorujeme a použijeme zálohu
        }

        results.push({
          link: link,
          title: title,
          size: size,
          duration: duration,
          thumb: imdbPosterUrl || backupThumb // IMDb má přednost, Přehraj.to je záloha
        });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
