export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const csfdUrl = searchParams.get('url');

  if (!csfdUrl) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'url'" }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  try {
    // 1. Vyčistíme URL a zacílíme přímo na galerii plakátů
    const cleanUrl = csfdUrl.split('?')[0].replace(/\/$/, '') + '/galerie/plakaty/';

    // 2. Stáhneme HTML stránky z ČSFD
    const response = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) throw new Error('Selhal přístup na ČSFD');
    const html = await response.text();
    let posterSrc = null;

    // 3. Najdeme index české nebo slovenské sekce
    let index = html.indexOf('<h3>Česko</h3>');
    if (index === -1) index = html.indexOf('<h3>Slovensko</h3>');

    if (index !== -1) {
      // Ořízneme si kus kódu za vlaječkou a najdeme v něm první obrázek
      const chunk = html.substring(index, index + 3000);
      const imgMatch = chunk.match(/<img[^>]+src="([^"]+)"/);
      if (imgMatch) posterSrc = imgMatch[1];
    }

    // 4. Fallback: Pokud český plakát není, vezmeme úplně první plakát z galerie
    if (!posterSrc) {
      const firstImgMatch = html.match(/<picture>[\s\S]*?<img[^>]+src="([^"]+)"/);
      if (firstImgMatch) posterSrc = firstImgMatch[1];
    }

    // Oprava relativní URL protokolu (//image.pmgstatic.com -> https://...)
    if (posterSrc && posterSrc.startsWith('//')) {
      posterSrc = 'https:' + posterSrc;
    }

    return new Response(JSON.stringify({ poster: posterSrc }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
