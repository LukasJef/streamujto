export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400 });
  }

  // Seznam náhodných User-Agentů pro oklamání filtru
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
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    // Pokud stále hází 429, vrátíme srozumitelnou chybu pro frontend
    if (response.status === 429) {
      return new Response(JSON.stringify({ 
        error: "Přehraj.to blokuje servery Cloudflaru (Chyba 429). Budeme muset přepnout na klientské vyhledávání." 
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    const html = await response.text();
    const allLinks = [];
    const regex = /href="([^"]+)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (match[1].includes('video')) {
        allLinks.push(match[1]);
      }
    }

    return new Response(JSON.stringify({
      totalLinksFound: allLinks.length,
      sampleLinks: allLinks.slice(0, 40)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
