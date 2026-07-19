export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const csfdUrl = searchParams.get('url');

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (!csfdUrl) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'url'" }), { status: 400, headers: corsHeaders });
  }

  try {
    const response = await fetch(csfdUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!response.ok) throw new Error("Nelze načíst ČSFD stránku filmu.");

    const html = await response.text();

    // 1. PLAKÁT
    const posterRegex = /<div class="film-poster">[\s\S]*?<img src="([^"]+)"/;
    const posterMatch = html.match(posterRegex);
    let poster = posterMatch ? posterMatch[1] : '';
    if (poster && poster.startsWith('//')) poster = 'https:' + poster;

    // 2. POPIS
    const plotRegex = /<div class="plot-full">([\s\S]*?)<\/div>/;
    const videoContentRegex = /<div class="video-content">([\s\S]*?)<\/div>/;
    let plotMatch = html.match(plotRegex) || html.match(videoContentRegex);
    let description = plotMatch ? plotMatch[1].replace(/<[^>]*>/g, '').trim() : 'Popis filmu se připravuje.';

    // 3. ÚČINKUJÍCÍ
    const castRegex = /<h4>Hrají:<\/h4>([\s\S]*?)<\/div>/;
    const castMatch = html.match(castRegex);
    let actors = castMatch ? castMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';

    // 4. ŽÁNR
    const genreRegex = /<div class="genres">([\s\S]*?)<\/div>/;
    const genreMatch = html.match(genreRegex);
    let genres = genreMatch ? genreMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : 'Neznámý žánr';

    // 5. TRAILER (video.csfd.cz .mp4)
    const trailerRegex = /https:\/\/video\.csfd\.cz\/[^"]+\.mp4/;
    const trailerMatch = html.match(trailerRegex);
    let trailerUrl = trailerMatch ? trailerMatch[0].replace(/\\/g, '') : '';

    return new Response(JSON.stringify({
      poster,
      description,
      actors,
      genres,
      trailerUrl
    }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
