export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'url'" }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Zajistíme, že URL vede na prehraj.to
  const targetUrl = videoUrl.startsWith('http') 
    ? videoUrl 
    : `https://prehraj.to${videoUrl}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://prehraj.to/'
      }
    });

    if (!response.ok) {
      throw new Error(`Selhalo stažení stránky: ${response.status}`);
    }

    const html = await response.text();

    // 1. Regex pro vytažení 'sources' (video soubory)
    // Hledáme text typu: var sources = [...] uvnitř <script>
    const sourcesRegex = /var\s+sources\s*=\s*(\[[^\]]+\])/;
    const sourcesMatch = html.match(sourcesRegex);

    // 2. Regex pro vytažení 'tracks' (titulky) - nepovinné
    const tracksRegex = /var\s+tracks\s*=\s*(\[[^\]]+\])/;
    const tracksMatch = html.match(tracksRegex);

    if (!sourcesMatch) {
      return new Response(JSON.stringify({ error: "Nepodařilo se najít zdroj videa. Je video dostupné?" }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Odchycený text v JS může mít klíče bez uvozovek (např. {file: "..."} místo {"file": "..."})
    // Pro jednoduchost a spolehlivost na Cloudflare použijeme regexové čištění, abychom z toho udělali validní JSON
    const cleanJsonString = (rawJsArray) => {
      return rawJsArray
        .replace(/'/g, '"') // Nahradí jednoduché uvozovky dvojitými
        .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":'); // Přidá uvozovky kolem klíčů
    };

    let sources = [];
    let tracks = [];

    try {
      sources = JSON.parse(cleanJsonString(sourcesMatch[1]));
    } catch (e) {
      // Pokud parsování selže, pošleme alespoň syrový text pro debugování
      return new Response(JSON.stringify({ error: "Chyba při zpracování video zdrojů", debug: sourcesMatch[1] }), { status: 500 });
    }

    if (tracksMatch) {
      try {
        tracks = JSON.parse(cleanJsonString(tracksMatch[1]));
      } catch (e) {
        // Ignorujeme chybu titulků, video je důležitější
      }
    }

    return new Response(JSON.stringify({ sources, tracks }), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
