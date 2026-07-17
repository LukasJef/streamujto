export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400 });
  }

  let globalPosterUrl = '';

  // 1. KROK: Dotaz na tajný našeptávač Bombuj.si přes POST
  try {
    const bombujSuggestUrl = `https://www.bombuj.si/4154q37rpc4dsvbp.php`;
    
    const bombujRes = await fetch(bombujSuggestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bombuj.si/'
      },
      body: `queryString=${encodeURIComponent(query)}`
    });

    if (bombujRes.ok) {
      const suggestHtml = await bombujRes.text();
      
      // Vytáhneme src prvního nalezeného obrázku z našeptávače
      const imgRegex = /<img[^>]+src="([^"]+)"/;
      const matchImg = suggestHtml.match(imgRegex);
      
      if (matchImg && matchImg[1]) {
        globalPosterUrl = matchImg[1];
        // Oprava relativní URL (např. //www.bombuj.si/... -> https://www.bombuj.si/...)
        if (globalPosterUrl.startsWith('//')) {
          globalPosterUrl = `https:${globalPosterUrl}`;
        } else if (globalPosterUrl.startsWith('/')) {
          globalPosterUrl = `https://www.bombuj.si${globalPosterUrl}`;
        }
      }
    }
  } catch (e) {
    console.log("Bombuj.si našeptávač selhal:", e.message);
  }

  // 2. KROK: Vyhledání videí na Přehraj.to
  const url = `https://prehraj.to/hledej/${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'kodi/prehraj.to',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
        
        let backupThumb = imageMatch ? imageMatch[1] : '';
        if (backupThumb && backupThumb.startsWith('/')) {
          backupThumb = `https://prehraj.to${backupThumb}`;
        }

        results.push({
          link: link,
          title: title,
          size: size,
          duration: duration,
          // Pokud máme přesný plakát z Bombuj, vyhraje. Jinak dáme screen z Přehraj.to
          thumb: globalPosterUrl || backupThumb
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
