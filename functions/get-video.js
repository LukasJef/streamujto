export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const videoUrl = searchParams.get('url');

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (!videoUrl) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'url'" }), { status: 400, headers: corsHeaders });
  }

  const targetUrl = videoUrl.startsWith('http') ? videoUrl : `https://prehraj.to${videoUrl}`;

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

    const sourcesRegex = /var\s+sources\s*=\s*(\[[^\]]+\])/;
    const sourcesMatch = html.match(sourcesRegex);

    const tracksRegex = /var\s+tracks\s*=\s*(\[[^\]]+\])/;
    const tracksMatch = html.match(tracksRegex);

    if (!sourcesMatch) {
      return new Response(JSON.stringify({ error: "Nepodařilo se najít zdroj videa. Je video dostupné?" }), { status: 404, headers: corsHeaders });
    }

    const cleanJsonString = (rawJsArray) => {
      return rawJsArray
        .replace(/'/g, '"')
        .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
    };

    let sources = [];
    let tracks = [];

    try {
      sources = JSON.parse(cleanJsonString(sourcesMatch[1]));
    } catch (e) {
      return new Response(JSON.stringify({ error: "Chyba při zpracování video zdrojů", debug: sourcesMatch[1] }), { status: 500, headers: corsHeaders });
    }

    if (tracksMatch) {
      try {
        tracks = JSON.parse(cleanJsonString(tracksMatch[1]));
      } catch (e) {
        // Ignorujeme chybu titulků
      }
    }

    return new Response(JSON.stringify({ sources, tracks }), { headers: corsHeaders });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
}
