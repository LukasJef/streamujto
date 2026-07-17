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
        'Referer': 'https://prehraj.to/'
      }
    });

    const html = await response.text();
    const allLinks = [];

    // Zachytíme VŠECHNY href atributy na stránce
    const regex = /href="([^"]+)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      // Chceme vidět hlavně ty, co smrdí videem nebo vyhledáváním
      if (match[1].includes('video') || match[1].includes('hledej') || match[1].length > 5) {
        allLinks.push(match[1]);
      }
    }

    return new Response(JSON.stringify({
      message: "Testujeme strukturu odkazů",
      totalLinksFound: allLinks.length,
      sampleLinks: allLinks.slice(0, 40) // Ukážeme prvních 40 odkazů
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
