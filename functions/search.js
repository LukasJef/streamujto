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
          thumb: backupThumb // Jako základ dáme náhled z Přehraj.to
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
