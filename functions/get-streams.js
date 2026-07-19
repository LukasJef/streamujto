export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const title = searchParams.get('title');

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (!title) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'title'" }), { status: 400, headers: corsHeaders });
  }

  const url = `https://prehraj.to/hledej/${encodeURIComponent(title)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'kodi/prehraj.to',
        'Referer': 'https://prehraj.to/'
      }
    });

    if (!response.ok) throw new Error("Selhalo stahování z Přehraj.to");

    const html = await response.text();
    const streams = [];

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
      const sizeMatch = innerHtml.match(sizeRegex);
      const durationMatch = innerHtml.match(durationRegex);

      if (titleMatch && !seenLinks.has(link)) {
        seenLinks.add(link);

        const rawTitle = titleMatch[1].replace(/<[^>]*>/g, '').trim();
        
        // BLOKACE SERIÁLOVÝCH JEDNOTEK (S01E09, s01e12, atd.)
        if (/[sS]\d{2}[eE]\d{2}/.test(rawTitle) || /epizoda|série/i.test(rawTitle)) {
          continue; 
        }

        const size = sizeMatch ? sizeMatch[1].replace(/<[^>]*>/g, '').trim() : 'Neznámá velikost';
        const duration = durationMatch ? durationMatch[1].replace(/<[^>]*>/g, '').trim() : '';

        // Detekce kvality a dabingu pro hezčí UI bez .mkv přípon
        let label = "Standardní kvalita";
        if (/1080p/i.test(rawTitle)) label = "HD rozlišení (1080p)";
        else if (/720p/i.test(rawTitle)) label = "SD rozlišení (720p)";
        else if (/2160p|4k/i.test(rawTitle)) label = "UltraHD rozlišení (4K)";

        if (/cz|dabing|titulky/i.test(rawTitle)) {
          label += ` [${/dabing/i.test(rawTitle) || /cz/i.test(rawTitle) ? 'CZ Dabing' : 'Titulky'}]`;
        }

        streams.push({
          link: link,
          name: `${label} — ${size} (${duration})`
        });
      }
    }

    return new Response(JSON.stringify({ streams }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
