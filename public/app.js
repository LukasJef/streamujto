const searchInput = document.getElementById('searchQuery');
const resultsDiv = document.getElementById('results');
const playerContainer = document.getElementById('playerContainer');
const videoPlayer = document.getElementById('videoPlayer');

let currentFilesList = [];
let trailerPlayer = null; // Pro Youtube Iframe API
let trailerMuted = true;

searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchMovies(); });
document.addEventListener('DOMContentLoaded', () => { updateCacheMenuLists(); });

// 1. VYHLEDÁNÍ ČISTÝCH FILMŮ (Z IMDb entit)
async function searchMovies() {
    const query = searchInput.value.trim();
    if (!query) return;

    closeMovieDetail();
    resultsDiv.innerHTML = '<div class="loader">Vyhledávám filmy v databázi...</div>';

    try {
        const res = await fetch(`/search?q=${encodeURIComponent(query)}&mode=movies`);
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            resultsDiv.innerHTML = '<div class="no-results">Nebyly nalezeny žádné tituly.</div>';
            return;
        }

        renderMovieGrid(data.results);
    } catch (err) {
        resultsDiv.innerHTML = '<div class="error">Chyba sítě.</div>';
    }
}

// 2. VYKRESLENÍ MATICE ČISTÝCH KARET
function renderMovieGrid(movies) {
    resultsDiv.innerHTML = '';
    resultsDiv.style = "display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; padding: 20px 0;";

    movies.forEach(movie => {
        const card = document.createElement('div');
        card.style = "width: 160px; background: var(--card-bg); padding: 10px; border-radius: 6px; cursor: pointer; text-align: center; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: transform 0.2s;";
        card.innerHTML = `
            <img src="${movie.poster || 'https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?q=80&w=200'}" style="width:100%; height:220px; object-fit:cover; border-radius:4px;">
            <h4 style="font-size:13px; margin: 8px 0 4px 0; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${movie.title}</h4>
            <span style="font-size:11px; color:var(--text-dim);">${movie.year || ''}</span>
        `;
        card.onclick = () => openMovieDetail(movie);
        resultsDiv.appendChild(card);
    });
}

// 3. FLIPPED PROCES VYHLEDÁVÁNÍ DATA & DETAIL FILMU
async function openMovieDetail(movie) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const detailView = document.getElementById('movieDetailView');
    document.getElementById('mainSearchBox').style.display = 'none';
    resultsDiv.style.display = 'none';
    detailView.style.display = 'block';

    // Výchozí vizuály z IMDb
    document.getElementById('detailBillboard').style.backgroundImage = `url('${movie.poster}')`;
    document.getElementById('detailTitle').innerText = movie.title;
    document.getElementById('detailMetaRow').innerText = movie.year ? `Rok: ${movie.year}` : '';
    document.getElementById('detailCrewRow').innerHTML = movie.actors ? `<strong>Hrají:</strong> ${movie.actors}` : '';
    document.getElementById('detailDescription').innerText = 'Načítám detaily filmu a české streamy...';

    // Nastavení tlačítek
    setupLinkButton('imdbLinkBtn', movie.id ? `https://www.imdb.com/title/${movie.id}` : null);
    setupLinkButton('csfdLinkBtn', null); // zatím skryté

    // Správa oblíbených položek uvnitř detailu
    const favBtn = document.getElementById('detailFavBtn');
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    const isFav = favorites.some(f => f.id === movie.id);
    favBtn.innerText = isFav ? '★' : '+';
    favBtn.onclick = () => {
        let favs = JSON.parse(localStorage.getItem('favorites')) || [];
        const idx = favs.findIndex(f => f.id === movie.id);
        if (idx > -1) { favs.splice(idx, 1); favBtn.innerText = '+'; }
        else { favs.push({ id: movie.id, title: movie.title, poster: movie.poster, year: movie.year }); favBtn.innerText = '★'; }
        localStorage.setItem('favorites', JSON.stringify(favs));
        updateCacheMenuLists();
    };

    let czdbData = null;
    let searchTitle = movie.title;

    // A. Pokus CZDB s primárním názvem
    try {
        let czdbRes = await fetch(`https://api.czdb.cz?q=${encodeURIComponent(searchTitle)}`);
        let data = await czdbRes.json();
        if (data !== false) czdbData = Array.isArray(data) ? data[0] : data;
    } catch(e){}

    // B. Druhý pokus s rokem, pokud první selhal
    if (!czdbData && movie.year) {
        try {
            let czdbRes = await fetch(`https://api.czdb.cz?q=${encodeURIComponent(searchTitle)}&y=${movie.year}`);
            let data = await czdbRes.json();
            if (data !== false) czdbData = Array.isArray(data) ? data[0] : data;
        } catch(e){}
    }

    // C. Aplikace nalezených metadat z CZDB/ČSFD
    if (czdbData && czdbData.url) {
        setupLinkButton('csfdLinkBtn', czdbData.url);
        
        // Pokus o stažení popisku a českého plakátu přes náš scraper
        try {
            let csfdScrape = await fetch(`/csfd-poster?url=${encodeURIComponent(czdbData.url)}`);
            let scrapeData = await csfdScrape.json();
            if (scrapeData.poster) document.getElementById('detailBillboard').style.backgroundImage = `url('${scrapeData.poster}')`;
        } catch(e){}
    }

    // Pokud chybí CZDB popisek, necháme prázdno nebo IMDb fallback text
    document.getElementById('detailDescription').innerText = czdbData?.description || "Popis filmu nebyl nalezen.";

    // NAČTENÍ SOUBORŮ Z PŘEHRAJ.TO NA POZADÍ (Podle názvu z CZDB nebo IMDb)
    loadSourceFiles(czdbData?.title || movie.title);

    // NAČTENÍ TRAILERU Z YOUTUBE EMBED
    loadTrailerEmbed(movie.title);
}

// 4. ASYNCHRONNÍ ZÍSKÁNÍ SOUBORŮ PRO DROPDOWNY
async function loadSourceFiles(searchQuery) {
    const streamSel = document.getElementById('streamSelector');
    const downSel = document.getElementById('downloadSelector');
    streamSel.innerHTML = '<option>Hledám streamy...</option>';
    downSel.innerHTML = '<option>...</option>';

    try {
        const res = await fetch(`/search?q=${encodeURIComponent(searchQuery)}&mode=files`);
        const data = await res.json();
        currentFilesList = data.files || [];

        if (currentFilesList.length === 0) {
            streamSel.innerHTML = '<option>Žádné soubory nenalezeny</option>';
            downSel.innerHTML = '<option>X</option>';
            return;
        }

        // Naplnění výběrových boxů vyčištěnými názvy velikostí souborů
        const optionsHtml = currentFilesList.map((file, idx) => 
            `<option value="${idx}">${file.title.slice(0, 30)}... (${file.size || file.duration})</option>`
        ).join('');

        streamSel.innerHTML = optionsHtml;
        downSel.innerHTML = optionsHtml;
    } catch (e) {
        streamSel.innerHTML = '<option>Chyba načítání streamů</option>';
    }
}

// OVLÁDÁNÍ AKCÍ (Přehrát / Stáhnout)
function syncSelectedStream() {
    document.getElementById('downloadSelector').value = document.getElementById('streamSelector').value;
}

async function playSelectedFile() {
    const idx = document.getElementById('streamSelector').value;
    const file = currentFilesList[idx];
    if (!file) return alert('Není vybrán žádný soubor.');

    playerContainer.style.display = 'block';
    videoPlayer.src = '';
    
    // Stop traileru při spuštění filmu
    if (trailerPlayer) trailerPlayer.innerHTML = '';

    try {
        const res = await fetch(`/get-video?url=${encodeURIComponent(file.link)}`);
        const data = await res.json();
        if (data.sources?.[0]?.file) {
            videoPlayer.src = data.sources[0].file;
            videoPlayer.load();
            videoPlayer.play();
            window.removeAttribute('watchHistory'); // Integrace stávající rozkoukanosti...
        }
    } catch(e) { alert('Stream se nepodařilo inicializovat.'); }
}

async function downloadSelectedFile() {
    const idx = document.getElementById('downloadSelector').value;
    const file = currentFilesList[idx];
    if (!file) return;
    
    try {
        const res = await fetch(`/get-video?url=${encodeURIComponent(file.link)}`);
        const data = await res.json();
        if (data.sources?.[0]?.file) {
            window.open(data.sources[0].file, '_blank');
        }
    } catch(e){}
}

// TRAILER Z YOUTUBE
function loadTrailerEmbed(title) {
    const container = document.getElementById('trailerEmbedContainer');
    // Vytvoříme jednoduchý bezpečný YouTube Embed hledající trailer
    container.innerHTML = `
        <iframe width="100%" height="100%" 
            src="https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(title + ' official trailer')}&autoplay=1&mute=1&controls=0&loop=1&playlist=" 
            frameborder="0" allow="autoplay; encrypted-media" style="transform: scale(1.35); width: 100%; height: 100%;">
        </iframe>`;
    trailerMuted = true;
    document.getElementById('detailSoundBtn').innerText = '🔇';
}

function toggleTrailerMute() {
    // Vzhledem k tomu, že čistý iframe bez API nelze snadno zvenčí odmutovat bez načtení skriptů, 
    // přepínáme zvuk jednoduchým reloadem s parametrem mute=0 / mute=1 pro maximální spolehlivost
    const iframe = document.getElementById('trailerEmbedContainer').querySelector('iframe');
    if (!iframe) return;
    
    trailerMuted = !trailerMuted;
    let src = iframe.src;
    src = trailerMuted ? src.replace('mute=0', 'mute=1') : src.replace('mute=1', 'mute=0');
    if (!src.includes('mute=')) src += `&mute=${trailerMuted ? 1 : 0}`;
    iframe.src = src;
    document.getElementById('detailSoundBtn').innerText = trailerMuted ? '🔇' : '🔊';
}

function closeMovieDetail() {
    document.getElementById('movieDetailView').style.display = 'none';
    document.getElementById('trailerEmbedContainer').innerHTML = '';
    videoPlayer.pause();
    document.getElementById('mainSearchBox').style.display = 'flex';
    resultsDiv.style.display = 'flex';
}

function setupLinkButton(id, url) {
    const btn = document.getElementById(id);
    if (url) { btn.href = url; btn.style.display = 'flex'; }
    else { btn.style.display = 'none'; }
}

function toggleCacheMenu() {
    const menu = document.getElementById('cacheMenu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// AKTUALIZACE OBLÍBENÝCH A ROZKOUKANÝCH PRO HLAVNÍ STRÁNKU (Hvězdička)
function updateCacheMenuLists() {
    const favList = document.getElementById('favoritesList');
    if (!favList) return;
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    
    if (favorites.length === 0) {
        favList.innerHTML = '<p style="font-size:12px; color:#777; margin:0;">Žádné oblíbené filmy.</p>';
    } else {
        favList.innerHTML = favorites.map(item => `
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px; cursor:pointer; background:#2a2a2a; padding:6px; border-radius:4px;" onclick="closeMovieDetail(); openMovieDetail({id:'${item.id}', title:'${item.title}', poster:'${item.poster}', year:'${item.year}'})">
                <img src="${item.poster}" style="width:35px; height:50px; object-fit:cover; border-radius:2px;">
                <div style="flex:1; font-size:12px; font-weight:bold; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title}</div>
            </div>
        `).join('');
    }
}
