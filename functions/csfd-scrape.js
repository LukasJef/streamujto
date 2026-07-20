import { csfd } from 'node-csfd-api';

export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const url = searchParams.get('url');

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=3600'
  };

  if (!url) {
    return new Response(JSON.stringify({ error: "Chybí parametr 'url'" }), { 
      status: 400, 
      headers: corsHeaders 
    });
  }

  try {
    // Extrahujeme číselné ČSFD ID z předané URL (např. z csfd.cz/film/535121-nazev -> 535121)
    const idMatch = url.match(/\/film\/(\d+)/);
    if (!idMatch) {
      throw new Error("Z adresy se nepodařilo získat ID filmu.");
    }

    const movieId = parseInt(idMatch[1], 10);

    // Načtení dat pomocí knihovny node-csfd-api
    const movie = await csfd.movie(movieId);

    if (!movie) {
      throw new Error("Film nebyl na ČSFD nalezen.");
    }

    // Příprava dat pro frontend v přesně takové struktuře, jakou očekává app.js
    const result = {
      poster: movie.poster || null,
      description: (movie.descriptions && movie.descriptions.length > 0) 
        ? movie.descriptions[0] 
        : (movie.plot || "Popis filmu není k dispozici."),
      cast: movie.creators?.actors 
        ? movie.creators.actors.slice(0, 12).map(actor => actor.name).join(', ') 
        : "",
      genres: movie.genres ? movie.genres.join(', ') : "Neznámý žánr",
      rating: movie.rating || null
    };

    return new Response(JSON.stringify(result), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}
