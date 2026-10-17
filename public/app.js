// =====================================================
// MOVIORA – frontend
// Backend běží na VPS (server.js), sem jde jen statika.
// =====================================================
const API_URL = 'https://api.moviora.win';

const FALLBACK_POSTER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="#231214"/><rect x="97" y="110" width="6" height="80" fill="#e50914"/></svg>'
);
const SOURCES_VISIBLE = 8;

// --- Prvky stránky ---
const $ = (id) => document.getElementById(id);
const searchInput = $('searchQuery');
const libraryContainer = $('libraryContainer');
const resultsContainer = $('resultsContainer');
const resultsDiv = $('results');
const movieDetail = $('movieDetail');
const detailContent = $('detailContent');
const videoPlayer = $('videoPlayer');
const playerEl = $('player');

// --- Stav ---
let currentMovieData = null;
let activeStreams = [];
let selectedStreamIdx = 0;
let showAllSources = false;
let currentSeason = 1;
let currentEpisode = 1;
let selectedLanguage = readJSON('lang', 'cz') === 'en' ? 'en' : 'cz';
let currentFetchController = null;
let searchRequestId = 0;
let detailRequestId = 0;

// =====================================================
// Pomocné funkce
// =====================================================
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
}

function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* plné úložiště */ }
}

async function apiGet(path, options = {}) {
    const res = await fetch(`${API_URL}${path}`, options);
    let data = {};
    try { data = await res.json(); } catch { /* neplatná odpověď */ }
    if (!res.ok && !data.error) data.error = `Server odpověděl chybou ${res.status}.`;
    return data;
}

const pad2 = (n) => String(n).padStart(2, '0');
const episodeTag = (s = currentSeason, e = currentEpisode) => `S${pad2(s)}E${pad2(e)}`;

function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

let toastTimer = null;
function toast(text, ms = 3500) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
};

// =====================================================
// Bodování streamů
// =====================================================
function parseSizeToGB(stream) {
    if (typeof stream.size === 'number') return stream.size / (1024 ** 3);
    const text = `${stream.size || ''} ${stream.title || ''}`.toLowerCase();
    const gb = text.match(/(\d+(?:[.,]\d+)?)\s*gb/);
    if (gb) return parseFloat(gb[1].replace(',', '.'));
    const mb = text.match(/(\d+(?:[.,]\d+)?)\s*mb/);
    if (mb) return parseFloat(mb[1].replace(',', '.')) / 1024;
    return 0;
}

// Backend posílá délku jako "02:10:46" nebo "45:12"
function parseStreamMinutes(stream) {
    const dur = String(stream.duration || '').trim();
    let m = dur.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) return +m[1] * 60 + +m[2];
    m = dur.match(/^(\d{1,3}):(\d{2})$/);
    if (m) return +m[1];
    const text = `${stream.title || ''} ${stream.name || ''}`;
    m = text.match(/\((\d{1,2}):(\d{2}):(\d{2})\)/);
    if (m) return +m[1] * 60 + +m[2];
    return null;
}

// Délka z ČSFD – číslo, "136 min" nebo "2 h 16 min"
function parseRuntime(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return value > 0 ? value : null;
    const str = String(value).toLowerCase();
    const h = str.match(/(\d+)\s*h/);
    const min = str.match(/(\d+)\s*min/);
    if (h) return +h[1] * 60 + (min ? +min[1] : 0);
    if (min) return +min[1];
    const num = str.match(/\d+/);
    return num ? +num[0] : null;
}

function detectQuality(title) {
    if (/2160p|\b4k\b|uhd/i.test(title)) return { label: '4K', cls: 'uhd' };
    if (/1080p|full\s?hd|fhd/i.test(title)) return { label: '1080p', cls: '' };
    if (/720p|\bhd\b/i.test(title)) return { label: '720p', cls: '' };
    if (/480p|dvdrip|xvid/i.test(title)) return { label: '480p', cls: '' };
    return { label: 'SD', cls: '' };
}

function detectLanguage(title) {
    if (/\b(sk|skdab|slovensky)\b/i.test(title) && !/\b(cz|czdab|cze|cesky|česky)\b/i.test(title)) return 'SK';
    if (/\b(cz|czdab|czdabing|dabing|cesky|česky|cze)\b/i.test(title)) return 'CZ';
    if (/\b(en|eng|english)\b/i.test(title)) return 'EN';
    if (/\b(tit|titulky|sub|subs)\b/i.test(title)) return 'TIT';
    return '';
}

function calculateStreamScore(stream, movie, lang) {
    let score = 100;
    const rawTitle = (stream.title || '').toLowerCase();
    const fullText = `${rawTitle} ${(stream.name || '').toLowerCase()}`;
    const targetTitle = (movie.title || '').toLowerCase();
    const targetYear = String(movie.year || '').match(/\d{4}/)?.[0] || '';

    // Čtyřmístná čísla z názvu (např. 2049) musí být i v souboru
    (targetTitle.match(/\b(19\d{2}|20\d{2})\b/g) || []).forEach(num => {
        if (!rawTitle.includes(num)) score -= 500;
    });

    // Jiný rok vydání
    if (targetYear) {
        (rawTitle.match(/\b(19\d{2}|20\d{2})\b/g) || []).forEach(y => {
            if (y !== targetYear && !targetTitle.includes(y)) score -= 400;
        });
    }

    // Stopáž – jen u filmů
    if (!movie.isSeries) {
        const streamMin = parseStreamMinutes(stream);
        const expected = parseRuntime(movie.runtime);
        if (streamMin && expected) {
            const diff = Math.abs(streamMin - expected);
            score += diff <= 3 ? 100 : diff <= 8 ? 10 : -500;
        }
    }

    // Velikost
    const gb = parseSizeToGB(stream);
    if (gb > 0) {
        if (gb >= 1.3) score += 30;
        if (gb < 0.4) score -= 80;
    }

    // Jazyk
    const hasCz = /\b(cz|czdab|czdabing|dabing|cesky|česky)\b/i.test(rawTitle);
    const hasEn = /\b(en|eng|english)\b/i.test(rawTitle);
    if (lang === 'cz') {
        if (hasCz) score += 150;
        if (hasEn && !hasCz) score -= 250;
    } else {
        if (hasEn) score += 150;
        if (hasCz && !hasEn) score -= 250;
    }

    // Ukázky a soundtracky
    if (/soundtrack|trailer|ukázka|\bost\b/i.test(fullText)) score -= 400;

    return score;
}

// =====================================================
// Navigace (funguje i tlačítko Zpět v prohlížeči)
// =====================================================
function setView(view) {
    libraryContainer.hidden = view !== 'home';
    resultsContainer.hidden = view !== 'results';
    movieDetail.hidden = view !== 'detail';
    window.scrollTo({ top: 0 });
}

function showMainPage(push = true) {
    if (push) history.pushState({ view: 'home' }, '', location.pathname);
    document.title = 'Moviora';
    searchInput.value = '';
    setView('home');
    loadLibrary();
}

let suppressNextPop = false;

window.addEventListener('popstate', (e) => {
    if (suppressNextPop) { suppressNextPop = false; return; }
    const state = e.state || { view: 'home' };

    // Zpět při otevřeném přehrávači jen zavře přehrávač
    if (!playerEl.hidden && !state.player) {
        closePlayer(true);
        return;
    }
    if (state.view === 'results') return search(state.q, false);
    if (state.view === 'detail' && state.movie) return openMovieDetail(state.movie, false);
    showMainPage(false);
});

// =====================================================
// Vyhledávání
// =====================================================
$('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    search(searchInput.value);
});

$('brandLink').addEventListener('click', (e) => {
    e.preventDefault();
    showMainPage();
});

// "/" skočí do vyhledávání
document.addEventListener('keydown', (e) => {
    if (e.key === '/' && playerEl.hidden && !/input|select|textarea/i.test(document.activeElement.tagName)) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
    }
});

async function search(rawQuery, push = true) {
    const query = String(rawQuery ?? searchInput.value).trim();
    if (!query) return;

    searchInput.value = query;
    searchInput.blur();
    if (push) history.pushState({ view: 'results', q: query }, '', `#hledat=${encodeURIComponent(query)}`);
    document.title = `${query} – Moviora`;

    setView('results');
    $('resultsTitle').textContent = `Výsledky pro „${query}“`;
    resultsDiv.innerHTML = '<p class="status">Hledám v ČSFD a IMDb…</p>';

    try {
        const data = await apiGet(`/search?q=${encodeURIComponent(query)}`);
        if (data.error) {
            resultsDiv.innerHTML = `<p class="status error">Vyhledávání selhalo: ${escapeHtml(data.error)}</p>`;
            return;
        }
        if (!data.results || data.results.length === 0) {
            resultsDiv.innerHTML = '<p class="status">Nic jsme nenašli. Zkus jiný název nebo originální anglický název.</p>';
            return;
        }
        renderGrid(data.results, resultsDiv, { lazyPosters: true });
    } catch {
        resultsDiv.innerHTML = '<p class="status error">Server neodpovídá. Zkontroluj připojení a zkus to znovu.</p>';
    }
}

// =====================================================
// Plakáty
// =====================================================
function renderGrid(movies, target, { lazyPosters = false } = {}) {
    target.innerHTML = '';

    movies.forEach(movie => {
        const title = movie.nazev || movie.title || 'Bez názvu';
        const year = movie.rok || movie.year || '';
        const csfdUrl = movie.csfd_url || movie.csfdLink;
        const normalized = { ...movie, title, year, csfdLink: csfdUrl };

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'poster';
        card.addEventListener('click', () => openMovieDetail(normalized));

        const frame = document.createElement('span');
        frame.className = 'poster-frame';

        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.src = movie.poster || FALLBACK_POSTER;
        img.onerror = () => { if (img.src !== FALLBACK_POSTER) img.src = FALLBACK_POSTER; };
        frame.appendChild(img);

        const progress = getWatchProgressForCard(title, movie.isSeries);
        if (progress && progress.percent > 1 && progress.percent < 98) {
            const bar = document.createElement('span');
            bar.className = 'playhead';
            bar.innerHTML = `<span style="width:${Math.min(100, progress.percent).toFixed(1)}%"></span>`;
            frame.appendChild(bar);
        }

        const t = document.createElement('span');
        t.className = 'poster-title';
        t.textContent = title;

        const y = document.createElement('span');
        y.className = 'poster-year';
        const lastEp = movie.isSeries ? readJSON(`last_ep_${title}`, null) : null;
        y.textContent = lastEp ? `${year ? year + ', ' : ''}${episodeTag(lastEp.season, lastEp.episode)}` : year;

        card.append(frame, t, y);
        target.appendChild(card);

        if (lazyPosters && csfdUrl) {
            apiGet(`/csfd-scrape?url=${encodeURIComponent(csfdUrl)}`)
                .then(d => {
                    if (d.poster && d.poster.trim()) {
                        normalized.poster = d.poster;
                        img.src = d.poster;
                    }
                })
                .catch(() => {});
        }
    });
}

// =====================================================
// Detail filmu / seriálu
// =====================================================
async function openMovieDetail(movie, push = true) {
    const reqId = ++detailRequestId;
    currentMovieData = { ...movie };
    activeStreams = [];
    showAllSources = false;

    if (push) history.pushState({ view: 'detail', movie }, '', '#film');
    document.title = `${movie.title} – Moviora`;
    setView('detail');

    $('detailBackdrop').style.backgroundImage = 'none';
    detailContent.innerHTML = '<p class="status">Načítám informace z ČSFD…</p>';

    const csfdUrl = movie.csfd_url || movie.csfdLink;
    const details = {
        poster: movie.poster || '',
        description: movie.description || '',
        actors: movie.actors || '',
        genres: movie.genres || '',
        rating: movie.rating || null,
        isSeries: Boolean(movie.isSeries),
        runtime: movie.runtime || null
    };

    if (csfdUrl) {
        try {
            const d = await apiGet(`/csfd-scrape?url=${encodeURIComponent(csfdUrl)}`);
            if (!d.error) {
                if (d.poster && d.poster.trim()) details.poster = d.poster;
                details.description = d.description || details.description;
                details.actors = d.cast || details.actors;
                details.genres = d.genres || details.genres;
                details.rating = d.rating || details.rating;
                details.isSeries = Boolean(d.isSeries);
                details.runtime = parseRuntime(d.duration ?? d.runtime) || details.runtime;
            }
        } catch { /* ČSFD nedostupné – zobrazíme, co máme */ }
    }

    if (reqId !== detailRequestId) return; // mezitím otevřen jiný film

    Object.assign(currentMovieData, details);

    if (currentMovieData.isSeries) {
        const lastEp = readJSON(`last_ep_${currentMovieData.title}`, { season: 1, episode: 1 });
        currentSeason = parseInt(lastEp.season, 10) || 1;
        currentEpisode = parseInt(lastEp.episode, 10) || 1;
    }

    renderDetail();
    addToHistory(currentMovieData);
    fetchAndRenderStreams();
}

function renderDetail() {
    const m = currentMovieData;
    const imdbUrl = m.imdbLink || m.imdb_url || m.imdbUrl;
    const csfdUrl = m.csfd_url || m.csfdLink;
    const poster = m.poster || FALLBACK_POSTER;

    if (m.poster) {
        $('detailBackdrop').style.backgroundImage = `url("${encodeURI(m.poster).replace(/"/g, '%22')}")`;
    }

    const facts = [];
    if (m.year && m.year !== '---') facts.push(`<li>${escapeHtml(m.year)}</li>`);
    if (m.isSeries) facts.push('<li>Seriál</li>');
    else if (m.runtime) facts.push(`<li>${escapeHtml(m.runtime)} min</li>`);
    if (m.genres) facts.push(`<li>${escapeHtml(m.genres)}</li>`);
    if (m.rating) facts.push(`<li class="rating">ČSFD ${escapeHtml(m.rating)} %</li>`);

    const showOriginal = m.originalTitle && m.originalTitle.toLowerCase() !== String(m.title).toLowerCase();
    const fav = isMovieInFavorites(m.title);

    const episodePicker = m.isSeries ? `
        <div class="episode-picker">
            <button class="icon-btn" id="epPrev" aria-label="Předchozí díl">${ICONS.prev}</button>
            <label>Řada
                <select id="seasonSelect">${range(1, 30).map(i => `<option value="${i}" ${i === currentSeason ? 'selected' : ''}>${i}</option>`).join('')}</select>
            </label>
            <label>Díl
                <select id="episodeSelect">${range(1, 60).map(i => `<option value="${i}" ${i === currentEpisode ? 'selected' : ''}>${i}</option>`).join('')}</select>
            </label>
            <button class="icon-btn" id="epNext" aria-label="Další díl">${ICONS.next}</button>
        </div>` : '';

    const links = [
        csfdUrl ? `<a href="${escapeHtml(csfdUrl)}" target="_blank" rel="noopener">Na ČSFD</a>` : '',
        imdbUrl ? `<a href="${escapeHtml(imdbUrl)}" target="_blank" rel="noopener">Na IMDb</a>` : ''
    ].join('');

    detailContent.innerHTML = `
        <div class="detail-hero">
            <img class="detail-poster" src="${escapeHtml(poster)}" alt="" referrerpolicy="no-referrer"
                 onerror="this.onerror=null;this.src='${FALLBACK_POSTER}'">
            <div class="detail-main">
                <h1 class="detail-title">${escapeHtml(m.title)}</h1>
                ${showOriginal ? `<p class="detail-original">${escapeHtml(m.originalTitle)}</p>` : ''}
                ${facts.length ? `<ul class="facts">${facts.join('')}</ul>` : ''}

                <div class="actions">
                    <button class="btn btn-primary" id="playBtn" disabled>${ICONS.play}<span>Hledám zdroje…</span></button>
                    <div class="segmented" role="group" aria-label="Jazyk">
                        <button type="button" data-lang="cz" aria-pressed="${selectedLanguage === 'cz'}">CZ dabing</button>
                        <button type="button" data-lang="en" aria-pressed="${selectedLanguage === 'en'}">Původní znění</button>
                    </div>
                    <button class="btn btn-quiet" id="favBtn" aria-pressed="${fav}">${ICONS.star}<span>${fav ? 'V oblíbených' : 'Přidat do oblíbených'}</span></button>
                </div>

                ${episodePicker}

                ${m.description ? `<p class="plot">${escapeHtml(m.description)}</p>` : ''}
                ${m.actors ? `<p class="cast"><strong>Hrají:</strong> ${escapeHtml(m.actors)}</p>` : ''}
                ${links ? `<div class="ext-links">${links}</div>` : ''}
            </div>
        </div>

        <section class="shelf" aria-labelledby="sourcesTitle">
            <div class="sources-head">
                <h2 class="shelf-title" id="sourcesTitle">Zdroje${m.isSeries ? ` pro ${episodeTag()}` : ''}</h2>
                <span class="count" id="sourcesCount"></span>
            </div>
            <div id="sourcesBody"><p class="status">Hledám na Přehraj.to…</p></div>
        </section>
    `;

    $('playBtn').addEventListener('click', () => startStreaming());
    $('favBtn').addEventListener('click', toggleFavoriteCurrent);
    detailContent.querySelectorAll('.segmented button').forEach(b =>
        b.addEventListener('click', () => onLanguageChange(b.dataset.lang)));

    if (m.isSeries) {
        $('seasonSelect').addEventListener('change', onEpisodeOrSeasonChange);
        $('episodeSelect').addEventListener('change', onEpisodeOrSeasonChange);
        $('epPrev').addEventListener('click', () => stepEpisode(-1));
        $('epNext').addEventListener('click', () => stepEpisode(1));
        updateEpisodeButtons();
    }
}

function range(from, to) {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function onLanguageChange(lang) {
    if (lang === selectedLanguage) return;
    selectedLanguage = lang;
    writeJSON('lang', lang);
    detailContent.querySelectorAll('.segmented button').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    fetchAndRenderStreams();
}

function onEpisodeOrSeasonChange() {
    currentSeason = parseInt($('seasonSelect').value, 10) || 1;
    currentEpisode = parseInt($('episodeSelect').value, 10) || 1;
    updateEpisodeButtons();
    $('sourcesTitle').textContent = `Zdroje pro ${episodeTag()}`;
    fetchAndRenderStreams();
}

function stepEpisode(delta) {
    const next = currentEpisode + delta;
    if (next < 1) return;
    currentEpisode = next;
    const sel = $('episodeSelect');
    if (sel) {
        if (![...sel.options].some(o => +o.value === next)) sel.add(new Option(next, next));
        sel.value = String(next);
    }
    updateEpisodeButtons();
    const title = $('sourcesTitle');
    if (title) title.textContent = `Zdroje pro ${episodeTag()}`;
    return fetchAndRenderStreams();
}

function updateEpisodeButtons() {
    const prev = $('epPrev');
    if (prev) prev.disabled = currentEpisode <= 1;
}

// =====================================================
// Zdroje z Přehraj.to
// =====================================================
async function fetchStreams(query, signal) {
    const data = await apiGet(`/get-streams?title=${encodeURIComponent(query)}`, { signal });
    if (data.error) throw new Error(data.error);
    return data.streams || [];
}

async function fetchAndRenderStreams() {
    if (!currentMovieData || !$('sourcesBody')) return;

    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();
    const { signal } = currentFetchController;
    const reqId = ++searchRequestId;
    const isCurrent = () => reqId === searchRequestId;

    activeStreams = [];
    selectedStreamIdx = 0;
    showAllSources = false;
    setPlayButton('loading');
    $('sourcesCount').textContent = '';
    $('sourcesBody').innerHTML = '<p class="status">Hledám na Přehraj.to…</p>';

    const m = currentMovieData;
    const suffix = selectedLanguage === 'en' ? ' ENG' : '';
    const queries = [];

    if (m.isSeries) {
        writeJSON(`last_ep_${m.title}`, { season: currentSeason, episode: currentEpisode });
        queries.push(`${m.title} ${episodeTag()}${suffix}`);
        queries.push(`${m.title} ${currentSeason}x${pad2(currentEpisode)}${suffix}`);
    } else {
        const year = String(m.year || '').match(/\d{4}/);
        if (year) queries.push(`${m.title} ${year[0]}${suffix}`);
        queries.push(`${m.title}${suffix}`);
        if (m.originalTitle && m.originalTitle.toLowerCase() !== m.title.toLowerCase()) {
            queries.push(`${m.originalTitle}${year ? ' ' + year[0] : ''}${suffix}`);
        }
    }

    try {
        let raw = [];
        for (const q of queries) {
            raw = await fetchStreams(q, signal);
            if (!isCurrent()) return;
            if (raw.length) break;
        }

        activeStreams = raw
            .map(s => ({ ...s, score: calculateStreamScore(s, m, selectedLanguage) }))
            .sort((a, b) => b.score - a.score);

        renderSources();
    } catch (e) {
        if (e.name === 'AbortError' || !isCurrent()) return;
        setPlayButton('none');
        $('sourcesBody').innerHTML = `<p class="status error">Zdroje se nepodařilo načíst: ${escapeHtml(e.message)}</p>`;
    }
}

function setPlayButton(state) {
    const btn = $('playBtn');
    if (!btn) return;
    const label = btn.querySelector('span');
    if (state === 'loading') { btn.disabled = true; label.textContent = 'Hledám zdroje…'; }
    else if (state === 'none') { btn.disabled = true; label.textContent = 'Nedostupné'; }
    else {
        btn.disabled = false;
        const p = getWatchProgress();
        label.textContent = p && p.time > 30 && p.percent < 97 ? `Pokračovat od ${formatTime(p.time)}` : 'Přehrát';
    }
}

function renderSources() {
    const body = $('sourcesBody');
    if (!body) return;

    if (activeStreams.length === 0) {
        setPlayButton('none');
        $('sourcesCount').textContent = '';
        const what = currentMovieData.isSeries ? `díl ${episodeTag()}` : 'tento film';
        const other = selectedLanguage === 'cz' ? 'Původní znění' : 'CZ dabing';
        body.innerHTML = `<p class="status">Pro ${what} jsme na Přehraj.to nic nenašli. Zkus přepnout na ${other}${currentMovieData.isSeries ? ' nebo jiný díl' : ''}.</p>`;
        return;
    }

    setPlayButton('ready');
    $('sourcesCount').textContent = `${activeStreams.length} ${activeStreams.length === 1 ? 'soubor' : activeStreams.length < 5 ? 'soubory' : 'souborů'}`;

    const wanted = selectedLanguage === 'cz' ? ['CZ', 'SK'] : ['EN', 'TIT'];
    const visible = showAllSources ? activeStreams : activeStreams.slice(0, SOURCES_VISIBLE);

    const items = visible.map((s, idx) => {
        const title = s.title || s.name || 'Neznámý soubor';
        const q = detectQuality(title);
        const lang = detectLanguage(title);
        const gb = parseSizeToGB(s);
        const size = gb > 0 ? (gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(gb * 1024)} MB`) : '';
        return `
            <li>
                <button type="button" class="source" data-idx="${idx}" aria-pressed="${idx === selectedStreamIdx}" title="${escapeHtml(title)}">
                    <span class="tag-q ${q.cls}">${q.label}</span>
                    <span class="tag-lang ${wanted.includes(lang) ? 'match' : ''}">${lang || '–'}</span>
                    <span class="source-name">${escapeHtml(title)}</span>
                    <span class="source-size">${size}</span>
                    <span class="source-dur">${escapeHtml(s.duration || '')}</span>
                </button>
            </li>`;
    }).join('');

    const moreBtn = !showAllSources && activeStreams.length > SOURCES_VISIBLE
        ? `<button class="btn btn-quiet" id="moreSources">Zobrazit všech ${activeStreams.length}</button>` : '';

    body.innerHTML = `
        <ol class="source-list">${items}</ol>
        <div class="source-actions">
            ${moreBtn}
            <button class="btn btn-quiet" id="downloadBtn">${ICONS.download}<span>Stáhnout vybraný</span></button>
        </div>`;

    body.querySelectorAll('.source').forEach(btn => {
        btn.addEventListener('click', () => selectSource(+btn.dataset.idx));
        btn.addEventListener('dblclick', () => { selectSource(+btn.dataset.idx); startStreaming(); });
    });
    $('moreSources')?.addEventListener('click', () => { showAllSources = true; renderSources(); });
    $('downloadBtn').addEventListener('click', startDownloading);
}

function selectSource(idx) {
    selectedStreamIdx = idx;
    document.querySelectorAll('.source').forEach(b =>
        b.setAttribute('aria-pressed', String(+b.dataset.idx === idx)));
}

function getSelectedStream() {
    return activeStreams[selectedStreamIdx] || activeStreams[0] || null;
}

async function getVideoData(stream) {
    const data = await apiGet(`/get-video?url=${encodeURIComponent(stream.link)}`);
    if (data.error) throw new Error(data.error);
    if (!data.sources || data.sources.length === 0) throw new Error('Video na Přehraj.to už není dostupné.');
    return data;
}

async function startDownloading() {
    const stream = getSelectedStream();
    if (!stream) return;
    toast('Připravuji odkaz ke stažení…');
    try {
        const data = await getVideoData(stream);
        const file = data.sources[0].file || data.sources[0].src;
        const a = document.createElement('a');
        a.href = file;
        a.target = '_blank';
        a.rel = 'noopener';
        a.download = `${currentMovieData.title}${currentMovieData.isSeries ? ' ' + episodeTag() : ''}.mp4`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (e) {
        toast(`Stažení se nepodařilo: ${e.message}`);
    }
}

// =====================================================
// Přehrávač
// =====================================================
const P = {
    center: $('playerCenter'),
    play: $('pPlay'), back: $('pBack'), fwd: $('pFwd'),
    mute: $('pMute'), volume: $('pVolume'), time: $('pTime'),
    seek: $('pSeek'), fill: $('pFill'), head: $('pHead'), buffer: $('pBuffer'), tip: $('pTip'),
    next: $('pNext'), subs: $('pSubs'), quality: $('pQuality'), qualityMenu: $('pQualityMenu'),
    full: $('pFull'), close: $('pClose'), title: $('pTitle'), subtitle: $('pSubtitle')
};
let idleTimer = null;
let lastSave = 0;
let currentSources = [];
let lastFocus = null;

function playerMessage(html, interactive = false) {
    P.center.innerHTML = html;
    P.center.classList.toggle('interactive', interactive);
}

async function startStreaming(streamOverride) {
    const stream = streamOverride || getSelectedStream();
    if (!stream) return;

    openPlayer();
    playerMessage('<div class="spinner"></div><p class="player-msg">Načítám video…</p>');

    try {
        const data = await getVideoData(stream);
        if (playerEl.hidden) return; // uživatel mezitím zavřel

        currentSources = data.sources;
        videoPlayer.innerHTML = '';
        videoPlayer.src = data.sources[0].file || data.sources[0].src;

        // Titulky – Přehraj.to posílá adresu v poli "src"
        const tracks = (data.tracks || []).filter(t => t.src || t.file);
        tracks.forEach((t, i) => {
            const el = document.createElement('track');
            el.kind = 'subtitles';
            el.label = t.label || 'Titulky';
            el.srclang = t.srclang || 'cs';
            el.src = t.src || t.file;
            if (i === 0) el.default = true;
            videoPlayer.appendChild(el);
        });
        P.subs.hidden = tracks.length === 0;
        P.subs.setAttribute('aria-pressed', String(tracks.length > 0));

        renderQualityMenu(0);

        const saved = getWatchProgress();
        videoPlayer.addEventListener('loadedmetadata', () => {
            if (videoPlayer.textTracks[0]) videoPlayer.textTracks[0].mode = tracks.length ? 'showing' : 'disabled';
            if (saved && saved.time > 5 && saved.percent < 97) {
                videoPlayer.currentTime = saved.time;
                toast(`Pokračuješ od ${formatTime(saved.time)}`);
            }
        }, { once: true });

        videoPlayer.load();
        videoPlayer.play().catch(() => playerMessage('', false));
    } catch (e) {
        playerMessage(`<p class="player-msg">${escapeHtml(e.message)}</p><button class="btn" id="pTryOther">Vybrat jiný zdroj</button>`, true);
        $('pTryOther').addEventListener('click', () => closePlayer());
    }
}

function openPlayer() {
    const m = currentMovieData;
    lastFocus = document.activeElement;
    P.title.textContent = m.title;
    P.subtitle.textContent = m.isSeries ? `Řada ${currentSeason}, díl ${currentEpisode}` : (m.year && m.year !== '---' ? String(m.year) : '');
    P.next.hidden = !m.isSeries;
    P.qualityMenu.hidden = true;

    if (playerEl.hidden) {
        playerEl.hidden = false;
        document.body.style.overflow = 'hidden';
        history.pushState({ ...(history.state || {}), player: true }, '', location.href);
    }
    updatePlayButton();
    updateMuteButton();
    wakeControls();
    P.play.focus({ preventScroll: true });
}

function closePlayer(fromPopState = false) {
    if (playerEl.hidden) return;
    saveProgress(true);
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.innerHTML = '';
    videoPlayer.load();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

    playerEl.hidden = true;
    document.body.style.overflow = '';
    playerMessage('');
    clearTimeout(idleTimer);

    if (!fromPopState && history.state?.player) {
        suppressNextPop = true; // návrat v historii nemá znovu načítat detail
        history.back();
    }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });

    // Obnovit "Pokračovat od…" a ukazatele postupu
    setPlayButton(activeStreams.length ? 'ready' : 'none');
}

function renderQualityMenu(activeIdx) {
    P.quality.hidden = currentSources.length <= 1;
    P.qualityMenu.innerHTML = currentSources.map((s, i) =>
        `<li><button role="menuitemradio" aria-checked="${i === activeIdx}" data-idx="${i}">${escapeHtml(s.label || s.res || `Kvalita ${i + 1}`)}</button></li>`
    ).join('');
    P.qualityMenu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        changeVideoQuality(+b.dataset.idx);
        P.qualityMenu.hidden = true;
        P.quality.setAttribute('aria-expanded', 'false');
    }));
}

function changeVideoQuality(idx) {
    const src = currentSources[idx];
    if (!src) return;
    const time = videoPlayer.currentTime;
    const wasPlaying = !videoPlayer.paused;
    videoPlayer.src = src.file || src.src;
    videoPlayer.addEventListener('loadedmetadata', () => {
        videoPlayer.currentTime = time;
        if (wasPlaying) videoPlayer.play().catch(() => {});
    }, { once: true });
    videoPlayer.load();
    renderQualityMenu(idx);
}

function togglePlay() {
    if (videoPlayer.paused) videoPlayer.play().catch(() => {});
    else videoPlayer.pause();
}

function skip(seconds) {
    if (!isFinite(videoPlayer.duration)) return;
    videoPlayer.currentTime = Math.max(0, Math.min(videoPlayer.duration, videoPlayer.currentTime + seconds));
    wakeControls();
}

function updatePlayButton() {
    const paused = videoPlayer.paused;
    P.play.innerHTML = paused ? ICONS.play : ICONS.pause;
    P.play.setAttribute('aria-label', paused ? 'Přehrát' : 'Pozastavit');
}

function updateMuteButton() {
    const muted = videoPlayer.muted || videoPlayer.volume === 0;
    P.mute.innerHTML = muted ? ICONS.mute : ICONS.vol;
    P.mute.setAttribute('aria-label', muted ? 'Zapnout zvuk' : 'Ztlumit');
    P.volume.value = videoPlayer.muted ? 0 : videoPlayer.volume;
}

function updateTimeline() {
    const d = videoPlayer.duration;
    const t = videoPlayer.currentTime;
    const pct = isFinite(d) && d > 0 ? (t / d) * 100 : 0;
    P.fill.style.width = `${pct}%`;
    P.head.style.left = `${pct}%`;
    P.time.textContent = `${formatTime(t)} / ${formatTime(d)}`;
    P.seek.setAttribute('aria-valuenow', pct.toFixed(0));
    P.seek.setAttribute('aria-valuetext', formatTime(t));

    if (videoPlayer.buffered.length && isFinite(d) && d > 0) {
        P.buffer.style.width = `${(videoPlayer.buffered.end(videoPlayer.buffered.length - 1) / d) * 100}%`;
    }
}

function seekFromEvent(e) {
    const rect = P.seek.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return { ratio, x: ratio * rect.width };
}

function wakeControls() {
    playerEl.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (!videoPlayer.paused && P.qualityMenu.hidden) playerEl.classList.add('idle');
    }, 3000);
}

function saveProgress(force = false) {
    if (!currentMovieData || !isFinite(videoPlayer.duration) || videoPlayer.duration <= 0) return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    const key = getWatchKey();
    if (key) writeJSON(key, {
        time: videoPlayer.currentTime,
        percent: (videoPlayer.currentTime / videoPlayer.duration) * 100
    });
}

async function playNextEpisode() {
    if (!currentMovieData?.isSeries) return;
    saveProgress(true);
    videoPlayer.pause();
    playerMessage('<div class="spinner"></div><p class="player-msg">Hledám další díl…</p>');
    await stepEpisode(1);
    if (playerEl.hidden) return;
    if (activeStreams.length) {
        startStreaming(activeStreams[0]);
    } else {
        playerMessage(`<p class="player-msg">Díl ${episodeTag()} jsme na Přehraj.to nenašli.</p><button class="btn" id="pTryOther">Zpět na detail</button>`, true);
        $('pTryOther').addEventListener('click', () => closePlayer());
    }
}

// --- Události videa ---
videoPlayer.addEventListener('play', () => { updatePlayButton(); wakeControls(); });
videoPlayer.addEventListener('pause', () => { updatePlayButton(); wakeControls(); saveProgress(true); });
videoPlayer.addEventListener('playing', () => playerMessage(''));
videoPlayer.addEventListener('waiting', () => playerMessage('<div class="spinner"></div>'));
videoPlayer.addEventListener('timeupdate', () => { updateTimeline(); saveProgress(); });
videoPlayer.addEventListener('progress', updateTimeline);
videoPlayer.addEventListener('durationchange', updateTimeline);
videoPlayer.addEventListener('volumechange', updateMuteButton);
videoPlayer.addEventListener('ended', () => {
    saveProgress(true);
    if (currentMovieData?.isSeries) {
        playerMessage(`<p class="player-msg">Díl skončil.</p><button class="btn btn-primary" id="pEndedNext">Přehrát další díl</button>`, true);
        $('pEndedNext').addEventListener('click', playNextEpisode);
    }
});
videoPlayer.addEventListener('error', () => {
    if (playerEl.hidden || !videoPlayer.getAttribute('src')) return;
    playerMessage('<p class="player-msg">Tento soubor se v prohlížeči nepodařilo přehrát. Zkus jiný zdroj, ideálně s jiným formátem nebo kvalitou.</p><button class="btn" id="pTryOther">Vybrat jiný zdroj</button>', true);
    $('pTryOther').addEventListener('click', () => closePlayer());
});
// Na dotyku první klepnutí jen ukáže ovládání, myší klik rovnou pozastaví
let wasIdleOnPointer = false;
videoPlayer.addEventListener('pointerdown', (e) => {
    wasIdleOnPointer = e.pointerType !== 'mouse' && playerEl.classList.contains('idle');
});
videoPlayer.addEventListener('click', () => {
    if (wasIdleOnPointer) { wakeControls(); return; }
    togglePlay();
});
videoPlayer.addEventListener('dblclick', toggleFullscreen);

// --- Ovládací prvky ---
P.play.addEventListener('click', togglePlay);
P.back.addEventListener('click', () => skip(-10));
P.fwd.addEventListener('click', () => skip(10));
P.close.addEventListener('click', () => closePlayer());
P.next.addEventListener('click', playNextEpisode);
P.mute.addEventListener('click', () => {
    if (videoPlayer.muted || videoPlayer.volume === 0) {
        videoPlayer.muted = false;
        if (videoPlayer.volume === 0) videoPlayer.volume = 0.5;
    } else videoPlayer.muted = true;
});
P.volume.addEventListener('input', () => {
    videoPlayer.volume = +P.volume.value;
    videoPlayer.muted = +P.volume.value === 0;
    writeJSON('volume', videoPlayer.volume);
});
P.subs.addEventListener('click', () => {
    const track = videoPlayer.textTracks[0];
    if (!track) return;
    const on = track.mode !== 'showing';
    track.mode = on ? 'showing' : 'disabled';
    P.subs.setAttribute('aria-pressed', String(on));
});
P.quality.addEventListener('click', () => {
    const open = P.qualityMenu.hidden;
    P.qualityMenu.hidden = !open;
    P.quality.setAttribute('aria-expanded', String(open));
    wakeControls();
});
P.full.addEventListener('click', toggleFullscreen);

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (playerEl.requestFullscreen) playerEl.requestFullscreen().catch(() => {});
    else if (videoPlayer.webkitEnterFullscreen) videoPlayer.webkitEnterFullscreen(); // iPhone
}

// Posuvník – klik i tažení
let seeking = false;
P.seek.addEventListener('pointerdown', (e) => {
    if (!isFinite(videoPlayer.duration)) return;
    seeking = true;
    P.seek.setPointerCapture(e.pointerId);
    videoPlayer.currentTime = seekFromEvent(e).ratio * videoPlayer.duration;
});
P.seek.addEventListener('pointermove', (e) => {
    if (!isFinite(videoPlayer.duration)) return;
    const { ratio, x } = seekFromEvent(e);
    P.tip.hidden = false;
    P.tip.style.left = `${x}px`;
    P.tip.textContent = formatTime(ratio * videoPlayer.duration);
    if (seeking) videoPlayer.currentTime = ratio * videoPlayer.duration;
    wakeControls();
});
P.seek.addEventListener('pointerup', () => { seeking = false; });
P.seek.addEventListener('pointerleave', () => { if (!seeking) P.tip.hidden = true; });
P.seek.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); skip(-5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); skip(5); }
});

playerEl.addEventListener('pointermove', wakeControls);
playerEl.addEventListener('touchstart', wakeControls, { passive: true });

// Klávesové zkratky v přehrávači
document.addEventListener('keydown', (e) => {
    if (playerEl.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    const onButton = tag === 'BUTTON' || tag === 'INPUT';
    switch (e.key) {
        case ' ':
        case 'k':
            if (onButton && e.key === ' ') return; // mezerník na tlačítku ho stiskne
            e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': if (tag !== 'INPUT') { e.preventDefault(); skip(-10); } break;
        case 'ArrowRight': if (tag !== 'INPUT') { e.preventDefault(); skip(10); } break;
        case 'ArrowUp': e.preventDefault(); videoPlayer.volume = Math.min(1, videoPlayer.volume + 0.1); videoPlayer.muted = false; break;
        case 'ArrowDown': e.preventDefault(); videoPlayer.volume = Math.max(0, videoPlayer.volume - 0.1); break;
        case 'f': toggleFullscreen(); break;
        case 'm': videoPlayer.muted = !videoPlayer.muted; break;
        case 'c': if (!P.subs.hidden) P.subs.click(); break;
        case 'n': if (!P.next.hidden) playNextEpisode(); break;
        case 'Escape':
            if (!P.qualityMenu.hidden) { P.qualityMenu.hidden = true; P.quality.setAttribute('aria-expanded', 'false'); }
            else if (!document.fullscreenElement) closePlayer();
            break;
        default: return;
    }
    wakeControls();
});

// Uložení pozice při zavření záložky
window.addEventListener('pagehide', () => { if (!playerEl.hidden) saveProgress(true); });

// =====================================================
// Pozice sledování, historie, oblíbené
// (stejné klíče jako dřív – stará historie zůstane)
// =====================================================
function getWatchKey() {
    if (!currentMovieData) return '';
    return currentMovieData.isSeries
        ? `progress_${currentMovieData.title}_${episodeTag()}`
        : `progress_${currentMovieData.title}`;
}

function getWatchProgress() {
    const key = getWatchKey();
    return key ? readJSON(key, null) : null;
}

function getWatchProgressForCard(title, isSeries) {
    let key = `progress_${title}`;
    if (isSeries) {
        const lastEp = readJSON(`last_ep_${title}`, null);
        if (lastEp) key = `progress_${title}_${episodeTag(lastEp.season, lastEp.episode)}`;
    }
    return readJSON(key, null);
}

function loadLibrary() {
    const favorites = readJSON('favorites', []);
    const history = readJSON('watch_history', []);

    $('historySection').hidden = history.length === 0;
    $('favoritesSection').hidden = favorites.length === 0;
    $('homeIntro').hidden = history.length > 0 || favorites.length > 0;

    if (history.length) renderGrid(history, $('historyGrid'));
    if (favorites.length) renderGrid(favorites, $('favoritesGrid'));
}

// Do knihovny ukládáme jen to, co je potřeba pro kartu a detail
function libraryEntry(m) {
    const { title, originalTitle, year, poster, csfd_url, csfdLink, imdbLink, isSeries, genres, rating, runtime, description, actors, id, source } = m;
    return { title, originalTitle, year, poster, csfd_url, csfdLink, imdbLink, isSeries, genres, rating, runtime, description, actors, id, source };
}

function addToHistory(movie) {
    const history = readJSON('watch_history', []).filter(h => h.title !== movie.title);
    history.unshift(libraryEntry(movie));
    writeJSON('watch_history', history.slice(0, 20));
}

function isMovieInFavorites(title) {
    return readJSON('favorites', []).some(f => f.title === title);
}

function toggleFavoriteCurrent() {
    if (!currentMovieData) return;
    const favorites = readJSON('favorites', []);
    const idx = favorites.findIndex(f => f.title === currentMovieData.title);
    const added = idx === -1;

    if (added) favorites.unshift(libraryEntry(currentMovieData));
    else favorites.splice(idx, 1);
    writeJSON('favorites', favorites);

    const btn = $('favBtn');
    if (btn) {
        btn.setAttribute('aria-pressed', String(added));
        btn.querySelector('span').textContent = added ? 'V oblíbených' : 'Přidat do oblíbených';
    }
    toast(added ? 'Přidáno do oblíbených' : 'Odebráno z oblíbených', 2000);
}

// =====================================================
// Start
// =====================================================
(function init() {
    const vol = readJSON('volume', null);
    if (typeof vol === 'number') videoPlayer.volume = Math.max(0, Math.min(1, vol));
    updatePlayButton();
    updateMuteButton();

    const hashQuery = location.hash.match(/^#hledat=(.+)$/);
    if (hashQuery) {
        history.replaceState({ view: 'results', q: decodeURIComponent(hashQuery[1]) }, '', location.href);
        search(decodeURIComponent(hashQuery[1]), false);
    } else {
        history.replaceState({ view: 'home' }, '', location.pathname);
        showMainPage(false);
    }
})();
