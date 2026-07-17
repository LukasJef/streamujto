export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'url'" }), { status: 400 });
  }

  const targetUrl = videoUrl.startsWith('http') ? videoUrl : `https://prehraj.to${videoUrl}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'user-agent': 'kodi/prehraj.to',
        'Referer': 'https://prehraj.to/'
      }
    });

    const html = await response.text();

    // Vyhledáme JavaScriptový blok "var sources = [...]"
    const sourcesMatch = html.match(/var\s+sources\s*=\s*(\[[^\]]+\])/);
    
    if (!sourcesMatch) {
      return new Response(JSON.stringify({ error: "Ve stránce nebyly nalezeny zdroje videa." }), { status: 404 });
    }

    // Vytáhneme URL adresu souboru
    const fileUrlRegex = /"file"\s*:\s*"([^"]+)"/;
    const fileUrlMatch = sourcesMatch[1].match(fileUrlRegex);

    if (!fileUrlMatch) {
      return new Response(JSON.stringify({ error: "Nepodařilo se parsovat URL video souboru." }), { status: 404 });
    }

    const videoDirectUrl = fileUrlMatch[1];

    // Pokusíme se vytáhnout i případné titulky
    const tracksMatch = html.match(/var\s+tracks\s*=\s*(\[[^\]]+\])/);
    let tracks = [];
    if (tracksMatch) {
      const cleanTracks = tracksMatch[1]
        .replace(/'/g, '"')
        .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
      try { tracks = JSON.parse(cleanTracks); } catch (e) {}
    }

    return new Response(JSON.stringify({ 
      sources: [{ file: videoDirectUrl }], 
      tracks: tracks 
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
