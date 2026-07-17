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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'cs,en-US;q=0.7,en;q=0.3',
        'Referer': 'https://prehraj.to/'
      }
    });

    if (!response.ok) {
      throw new Error(`Přehraj.to vrátilo status ${response.status}`);
    }

    const html = await response.text();
    const results = [];

    // Nový, flexibilnější regex pro vyhledání odkazů na videa a jejich názvů.
    // Přehraj.to často používá formát <a href="/video/..." class="...">Název</a>
    // Tento regex hledá jakékoliv odkazy, které v href obsahují "/video/"
    const regex = /<a\s+[^>]*href="(\/video\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    const seenLinks = new Set(); // Abychom neměli duplicity

    while ((match = regex.exec(html)) !== null) {
      const link = match[1];
      let title = match[2];

      // Vyčistíme název od HTML tagů (např. pokud je uvnitř <span>, <img> nebo silný text)
      title = title.replace(/<[^>]*>/g, '').trim();

      // Odfiltrujeme prázdné názvy a duplicitní odkazy
      if (title && !seenLinks.has(link)) {
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
        'Access-Control-Allow-Origin': '*' // Pro jistotu povolit CORS
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
