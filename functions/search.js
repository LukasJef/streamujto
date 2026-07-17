export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'q'" }), { status: 400 });
  }

  // 1. Zavoláme vyhledávání na Přehraj.to
  const url = `https://prehraj.to/hledej/${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...'
    }
  });

  const html = await response.text();

  // 2. Tady v reálném kódu použijeme regulární výrazy (regex) 
  // k vytahání odkazů, názvů a obrázků z HTML. (Cloudflare nepodporuje BeautifulSoup, musíme jít cestou RegExp)
  const results = [];
  // (Příklad regexu pro ilustraci)
  const regex = /<a href="([^"]+)" class="video-link">([\s\S]*?)<\/a>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    results.push({
      link: match[1],
      title: match[2].trim()
    });
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}