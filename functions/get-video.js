export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const videoUrlParam = searchParams.get('url');

  if (!videoUrlParam) {
    return new Response(JSON.stringify({ error: "Chybí parametr url" }), { status: 400 });
  }

  // ÚDAJE PRO VAŠE PREMIUM PŘIHLÁŠENÍ PODLE VAŠÍ KODI LOGIKY
  const email = "VÁS_EMAIL"; 
  const password = "VAŠE_HESLO";

  const baseHeaders = {
    'user-agent': 'kodi/prehraj.to',
    'Referer': 'https://prehraj.to/',
    'Origin': 'https://prehraj.to'
  };

  try {
    // KROK 1: Odeslání POST požadavku pro přihlášení uživatele
    const loginBody = new URLSearchParams();
    loginBody.append('email', email);
    loginBody.append('password', password);
    loginBody.append('_submit', 'Přihlásit se');
    loginBody.append('remember', 'on');
    loginBody.append('_do', 'login-loginForm-submit');

    const loginRes = await fetch('https://prehraj.to/', {
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: loginBody,
      redirect: 'manual'
    });

    // Vytáhneme session cookies z odpovědi serveru
    const setCookies = loginRes.headers.getSetCookie();
    const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');

    // Sestavení kompletní URL adresy videa
    let targetVideoUrl = videoUrlParam;
    if (!targetVideoUrl.startsWith('http')) {
      targetVideoUrl = `https://prehraj.to${targetVideoUrl.startsWith('/') ? '' : '/'}${targetVideoUrl}`;
    }

    // KROK 3: Načtení stránky videa a parsování JavaScriptového bloku sources
    const pageRes = await fetch(targetVideoUrl, {
      headers: { ...baseHeaders, 'Cookie': cookieHeader }
    });
    const html = await pageRes.text();

    // Regulární výraz pro vyhledání bloku zdrojů (odpovídá var sources = [...];)
    const sourcesRegex = /var sources = \[(.*?)(?=\];)/s;
    const sourcesMatch = html.match(sourcesRegex);

    if (!sourcesMatch) {
      return new Response(JSON.stringify({ error: "V kódu nebylo nalezeno var sources" }), { status: 404 });
    }

    const sourcesBlock = sourcesMatch[1];
    
    // Regulární výraz pro vytažení samotné URL adresy souboru z uvozovek
    const urlRegex = /"(https:\/\/.*?)"/;
    const urlMatch = sourcesBlock.match(urlRegex);

    if (!urlMatch) {
      return new Response(JSON.stringify({ error: "Z bloku nebylo možné vyextrahovat URL" }), { status: 404 });
    }

    const baseFileUrl = urlMatch[1];

    // KROK 4: Premium stahování - přidání parametru ?do=download a zachycení redirectu
    const premiumDownloadUrl = `${baseFileUrl}?do=download`;

    const streamRes = await fetch(premiumDownloadUrl, {
      headers: { ...baseHeaders, 'Cookie': cookieHeader },
      redirect: 'manual' // allow_redirects=False
    });

    // Vytáhneme finální přímý odkaz z hlavičky Location
    const directStreamUrl = streamRes.headers.get('Location');

    if (directStreamUrl) {
      return new Response(JSON.stringify({ sources: [{ file: directStreamUrl }] }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } else {
      // Pokud Location chybí, vrátíme základní vypreparovanou url adresu
      return new Response(JSON.stringify({ sources: [{ file: baseFileUrl }] }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
