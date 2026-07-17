export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400 });
  }

  const userAgents = [
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  ];
  const randomAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

  const url = `https://prehraj.to/hledej/${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': randomAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'cs,en;q=0.5',
        'Referer': 'https://prehraj.to/'
      }
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Přehraj.to uplatňuje IP limit. Zkuste to za chvíli." }), { status: 429 });
    }

    const html = await response.text();
    const results = [];
    const seenLinks = new Set();

    // Hledáme všechny odkazy <a> s jejich vnitřním textem (názvem videa)
    const regex = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const link = match[1];
      let title = match[2].replace(/<[^>]*>/g, '').trim(); // Odstraníme vnitřní HTML (obrázky, spany)

      // ODSTRANÍME NEŽÁDOUCÍ ODKAZY
      // Skutečné video nemá v URL otazníky, neobsahuje "hledej", "login", "register", "javascript", atd.
      const isSystemLink = link.includes('?') || 
                           link.includes('hledej') || 
                           link.includes('javascript:') || 
                           link.includes('static') ||
                           link.includes('public') ||
                           link.startsWith('#') ||
                           link === '/' ||
                           link.includes('dmca') ||
                           link.includes('podminky') ||
                           link.includes('kontakt');

      if (!isSystemLink && title.length > 2 && !seenLinks.has(link)) {
        seenLinks.add(link);
        results.push({
          link: link,
          title: title
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
