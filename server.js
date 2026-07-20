//let movieDatabase = [];
//let gameDatabase = [];

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let movieDatabase = [];
let gameDatabase = [];

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cpuvameaqyylazwtasaq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_DaYiei6f2p4uC5RZPI17ig_YvZySnOD';

// For admin/service-like operations that must not depend on user cookies.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || SUPABASE_KEY;
const supabaseAdminOrService = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


app.use(express.static(path.join(__dirname, 'public')));

// WICHTIG: Erlaubt dem Server, JSON-Daten von Formularen zu lesen
app.use(express.json());

function normalizeMediaItem(row) {
    // DE/EN sind die einzig unterstützten Trailer-IDs.
    // (Generische youtubeId/youtube_id Fallbacks bewusst entfernt.)
    const de = row.youtube_id_de || row.youtubeIdDe || '';
    const en = row.youtube_id_en || row.youtubeIdEn || '';

    return {
        title: row.title || 'Unbekannter Titel',
        year: Number(row.year) || 0,
        youtubeIdDe: de || '',
        youtubeIdEn: en || '',
        director: row.director || 'Unbekannt',
        startAt: Number(row.start_at || row.startAt || 0),
        startAtDe: Number(row.start_at_de || row.startAtDe || row.start_at || row.startAt || 0),
        startAtEn: Number(row.start_at_en || row.startAtEn || row.start_at || row.startAt || 0)
    };
}


function getPreferredTrailerId(item, preference = 'any') {
    const selectedPreference = String(preference || 'any').toLowerCase();
    const deTrailer = item.youtubeIdDe || item.youtube_id_de || '';
    const enTrailer = item.youtubeIdEn || item.youtube_id_en || '';

    if (selectedPreference === 'de') {
        return deTrailer;
    }

    if (selectedPreference === 'en') {
        return enTrailer;
    }

    // any
    return deTrailer || enTrailer;
}


function getPreferredTrailerStartAt(item, preference = 'any') {
    const selectedPreference = String(preference || 'any').toLowerCase();
    const deStartAt = Number(item.startAtDe || item.start_at_de || 0);
    const enStartAt = Number(item.startAtEn || item.start_at_en || 0);
    const genericStartAt = Number(item.startAt || item.start_at || 0);

    if (selectedPreference === 'de') {
        return deStartAt || genericStartAt;
    }

    if (selectedPreference === 'en') {
        return enStartAt || genericStartAt;
    }

    return genericStartAt;
}

function loadLocalJsonFallback(fileName) {
    try {
        const rawData = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
        return JSON.parse(rawData);
    } catch (error) {
        console.warn(`Fallback-Datei ${fileName} konnte nicht geladen werden.`, error.message);
        return [];
    }
}

function selectAdminItems(items = [], options = {}) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const searchRaw = options.search ?? '';
    const search = String(searchRaw).trim().toLowerCase();
    const limit = Math.max(1, Number(options.limit) || 50);
    const offset = Math.max(0, Number(options.offset) || 0);

    const filteredItems = !search
        ? normalizedItems
        : normalizedItems.filter(item => {
            // Suche ist aktuell “Titel-getrieben”. Damit Admin-Suche zuverlässig bleibt,
            // ignorieren wir dabei problematische Felder/Typen und matchen robust nur title.
            const title = String(item?.title ?? '').trim().toLowerCase();
            if (!title) return false;
            return title.includes(search);
        });

    // Alphabetische Ausgabe nach Titel (A–Z), mit Deutsch/ Umlaute via localeCompare('de')
    // => wichtig: Sortierung muss VOR Pagination passieren.
    filteredItems.sort((a, b) => {
        const titleA = String(a?.title ?? '').trim();
        const titleB = String(b?.title ?? '').trim();
        return titleA.localeCompare(titleB, 'de', { sensitivity: 'base' });
    });

    const total = filteredItems.length;
    const pagedItems = filteredItems.slice(offset, offset + limit).map(item => ({
        ...item,
        youtubeIdDe: item.youtubeIdDe || '',
        youtubeIdEn: item.youtubeIdEn || '',
        startAt: item.startAt || 0,
        startAtDe: item.startAtDe || item.startAt || 0,
        startAtEn: item.startAtEn || item.startAt || 0,
        director: item.director || 'Unbekannt'
    }));

    return {
        items: pagedItems,
        total,
        hasMore: offset + pagedItems.length < total
    };
}

async function loadMovieDatabaseFromSupabase() {
    // Sicheres Laden aller Rows: wir paginieren per range.
    // Hintergrund: Bei dir wurden im Standard-Load nur ~1000 geliefert,
    // obwohl range 1000..1999 weitere 302 liefert.

    const pageSize = 1000;
    let offset = 0;
    const all = [];

    while (true) {
        const { data, error } = await supabase
            .from('media')
            .select('*')
            .range(offset, offset + pageSize - 1);

        if (error) throw error;

        const rows = Array.isArray(data) ? data : [];
        all.push(...rows);

        console.log(`[Supabase][range load] offset=${offset} got=${rows.length}`);

        if (rows.length < pageSize) break;
        offset += pageSize;
    }

    // Optionaler Diagnoselog (count)
    try {
        const { count, error: countError } = await supabase
            .from('media')
            .select('id', { count: 'exact', head: true });

        if (countError) {
            console.warn('[Supabase][count] error:', countError.message || countError);
        } else {
            console.log(`[Supabase][count] exact=${count}`);
        }
    } catch (e) {
        console.warn('[Supabase][count] failed:', e.message || e);
    }

    return all.map(normalizeMediaItem);
}



async function initializeDataSources() {
    try {
        movieDatabase = await loadMovieDatabaseFromSupabase();
        if (!movieDatabase.length) {
            console.warn('[Data] Supabase hatte 0 Einträge -> Fallback auf movies.json');
            movieDatabase = loadLocalJsonFallback('movies.json');
        }

        // Diagnose: Trailer-Felder-Vollständigkeit (wichtig für “ignoriere Serien”) 
        const sample = movieDatabase.find(x => x && String(x.title || '').toLowerCase().includes('')) || movieDatabase[0];
        const emptyTrailerCount = movieDatabase.filter(x => {
            const any = ( x.youtubeIdDe || x.youtubeIdEn || '').toString().trim();
            return !any;
        }).length;

        console.log(`[Data] movieDatabase geladen: ${movieDatabase.length} Einträge`);
        console.log(`[Data] ohne irgendeine YouTube-ID: ${emptyTrailerCount}`);
        if (sample) {
            console.log('[Data] Sample:', {
                title: sample.title,
                year: sample.year,
                youtubeIdDe: sample.youtubeIdDe,
                youtubeIdEn: sample.youtubeIdEn,
                //youtubeId: sample.youtubeId
            });
        }
    } catch (error) {
        console.error('Fehler beim Laden der Datenbank. Fallback auf movies.json wird verwendet.', error);
        movieDatabase = loadLocalJsonFallback('movies.json');
    }

    gameDatabase = loadLocalJsonFallback('games.json');
}

function applyAdminUpdateToItem(item, payload = {}) {
    if (!item) return null;

    item.title = payload.title?.trim() || item.title || 'Unbekannter Titel';
    item.year = parseInt(payload.year, 10) || item.year || 0;
    //item.youtubeId = (payload.youtubeId || '').trim();
    item.youtubeIdDe = (payload.youtubeIdDe || '').trim();
    item.youtubeIdEn = (payload.youtubeIdEn || '').trim();
    item.startAt = parseInt(payload.startAt, 10) || 0;
    item.startAtDe = parseInt(payload.startAtDe, 10) || item.startAt || 0;
    item.startAtEn = parseInt(payload.startAtEn, 10) || item.startAt || 0;
    item.director = payload.director?.trim() || item.director || 'Unbekannt';

    return item;
}

async function persistMovieUpdateToDatabase(title, year, youtubeIdDe, youtubeIdEn, startAt, startAtDe, startAtEn, director) {
    const { error } = await supabase
        .from('media')
        .update({
            youtube_id_de: (youtubeIdDe || '').trim(),
            youtube_id_en: (youtubeIdEn || '').trim(),
            start_at: parseInt(startAt, 10) || 0,
            start_at_de: parseInt(startAtDe, 10) || parseInt(startAt, 10) || 0,
            start_at_en: parseInt(startAtEn, 10) || parseInt(startAt, 10) || 0,
            director: director || 'Unbekannt'
        })
        .eq('title', title)
        .eq('year', parseInt(year, 10));

    if (error) {
        throw error;
    }
}

const TMDB_API_KEY = process.env.TMDB_API_KEY || "f8ad9f5d1827f009612603f7bd11e603";

async function tmdbFetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMDB HTTP Fehler: ${response.status}`);
    }
    return response.json();
}

async function tmdbFetchAdditionalDetails(type, id) {
    const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${encodeURIComponent(TMDB_API_KEY)}&append_to_response=videos,credits&include_video_language=de,en`;

    try {
        const data = await tmdbFetchJson(url);

        let youtubeIdDe = "";
        let youtubeIdEn = "";

        if (data.videos && data.videos.results) {
            const videos = data.videos.results.filter(v => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"));

            const deTrailer = videos.find(v => v.iso_639_1 === "de");
            if (deTrailer) youtubeIdDe = deTrailer.key;

            const enTrailer = videos.find(v => v.iso_639_1 === "en");
            if (enTrailer) youtubeIdEn = enTrailer.key;

            if (!youtubeIdDe && youtubeIdEn) {
                youtubeIdDe = youtubeIdEn;
            }

            if (!youtubeIdDe && videos.length > 0) {
                youtubeIdDe = videos[0].key;
            }
        }

        let director = "Unbekannt";
        if (type === 'movie' && data.credits && data.credits.crew) {
            const dirObj = data.credits.crew.find(person => person.job === 'Director');
            if (dirObj) director = dirObj.name;
        } else if (type === 'tv' && data.created_by && data.created_by.length > 0) {
            director = data.created_by.map(c => c.name).join(', ');
        }

        return { youtubeIdDe, youtubeIdEn, director };
    } catch (e) {
        return { youtubeIdDe: "", youtubeIdEn: "", director: "Unbekannt" };
    }
}

async function tmdbSearchBest(type, query, year) {
    const endpoint = `https://api.themoviedb.org/3/search/${type}?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=de-DE&include_adult=false&query=${encodeURIComponent(query)}`;
    const url = year ? `${endpoint}&year=${encodeURIComponent(String(year))}` : endpoint;

    const data = await tmdbFetchJson(url);
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) return null;

    const scored = results.map(r => {
        const rYear = type === 'movie' ? (r.release_date ? new Date(r.release_date).getFullYear() : 0) : (r.first_air_date ? new Date(r.first_air_date).getFullYear() : 0);
        const title = type === 'movie' ? (r.title || '') : (r.name || '');
        const yearScore = year ? (rYear === Number(year) ? 100 : (rYear ? 10 / Math.abs(rYear - Number(year)) : 0)) : 1;
        const titleScore = title ? (title.toLowerCase().includes(String(query).toLowerCase()) ? 50 : 0) : 0;
        return { r, score: yearScore + titleScore };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.r || null;
}

async function adminImportFromTmdb({ mode, query, year }) {
    if (String(mode) !== 'movies') {
        return { inserted: false, reason: 'Nur mode=movies unterstützt.' };
    }

    const titleQuery = String(query || '').trim();
    const parsedYear = year ? parseInt(year, 10) : null;
    if (!titleQuery) return { inserted: false, reason: 'query fehlt' };

    // 1) Supabase check (nur title+year; wenn year nicht da ist -> kein zuverlässiger Check)
    if (parsedYear) {
        const { data: existingRows, error: existingError } = await supabase
            .from('media')
            .select('title,year,youtube_id_de,youtube_id_en,director,start_at,start_at_de,start_at_en')
            .eq('title', titleQuery)
            .eq('year', parsedYear);

        if (existingError) throw existingError;
        if (Array.isArray(existingRows) && existingRows.length > 0) {
            return { inserted: false, reason: 'already exists', item: normalizeMediaItem(existingRows[0]) };
        }
    }

    // 2) TMDB search: erst movie, dann tv (beides deckt Filme+Serien ab)
    let best = null;
    let bestType = null;

    try {
        best = await tmdbSearchBest('movie', titleQuery, parsedYear);
        if (best) bestType = 'movie';
    } catch (e) {
        // ignore, try tv
    }

    if (!best) {
        best = await tmdbSearchBest('tv', titleQuery, parsedYear);
        if (best) bestType = 'tv';
    }

    if (!best || !best.id) {
        return { inserted: false, reason: 'not found' };
    }

    const resolvedTitle = bestType === 'movie' ? (best.title || titleQuery) : (best.name || titleQuery);
    const resolvedYear = bestType === 'movie'
        ? (best.release_date ? new Date(best.release_date).getFullYear() : (parsedYear || 0))
        : (best.first_air_date ? new Date(best.first_air_date).getFullYear() : (parsedYear || 0));

    const details = await tmdbFetchAdditionalDetails(bestType, best.id);

    // 3) Insert in Supabase
    const { error: insertError, data: insertedRows } = await supabase
        .from('media')
        .insert({
            title: resolvedTitle,
            year: resolvedYear || 0,
            youtube_id_de: details.youtubeIdDe || '',
            youtube_id_en: details.youtubeIdEn || '',
            director: details.director || 'Unbekannt',
            start_at: 0,
            start_at_de: 0,
            start_at_en: 0
        })
        .select('*');

    if (insertError) throw insertError;

    const insertedItem = Array.isArray(insertedRows) && insertedRows[0] ? normalizeMediaItem(insertedRows[0]) : null;

    return { inserted: true, item: insertedItem };
}

// ADMIN-API: TMDB Preview (ohne DB Insert)
app.post('/api/admin/tmdb-preview', async (req, res) => {
    try {
        const { mode, query, year } = req.body || {};

        if (String(mode) !== 'movies') {
            return res.json({
                ok: false,
                reason: 'Nur mode=movies unterstützt.',
                preview: null
            });
        }

        const titleQuery = String(query || '').trim();
        const parsedYear = year ? parseInt(year, 10) : null;

        if (!titleQuery) {
            return res.json({
                ok: false,
                reason: 'query fehlt',
                preview: null
            });
        }

        // Best match: erst movie, dann tv
        let best = null;
        let bestType = null;

        try {
            best = await tmdbSearchBest('movie', titleQuery, parsedYear);
            if (best) bestType = 'movie';
        } catch (e) {
            // ignore, try tv
        }

        if (!best) {
            best = await tmdbSearchBest('tv', titleQuery, parsedYear);
            if (best) bestType = 'tv';
        }

        if (!best || !best.id) {
            return res.json({
                ok: false,
                reason: 'not found',
                preview: null
            });
        }

        const resolvedTitle = bestType === 'movie' ? (best.title || titleQuery) : (best.name || titleQuery);
        const resolvedYear = bestType === 'movie'
            ? (best.release_date ? new Date(best.release_date).getFullYear() : (parsedYear || 0))
            : (best.first_air_date ? new Date(best.first_air_date).getFullYear() : (parsedYear || 0));

        const details = await tmdbFetchAdditionalDetails(bestType, best.id);

        // Optional: bereits vorhanden prüfen (nur wenn year vorhanden ist)
        let alreadyExists = false;
        if (parsedYear) {
            const { data: existingRows, error: existingError } = await supabase
                .from('media')
                .select('title,year')
                .eq('title', resolvedTitle)
                .eq('year', parseInt(resolvedYear, 10));

            if (existingError) {
                // Preview soll nicht fehlschlagen nur wegen Read-Error
            } else {
                alreadyExists = Array.isArray(existingRows) && existingRows.length > 0;
            }
        }

        const youtubeIdDe = details.youtubeIdDe || '';
        const youtubeIdEn = details.youtubeIdEn || '';

        return res.json({
            ok: true,
            preview: {
                matchType: bestType,
                resolvedTitle,
                resolvedYear: resolvedYear || 0,
                director: details.director || 'Unbekannt',
                youtubeIdDe,
                youtubeIdEn,
                hasTrailerDe: Boolean(String(youtubeIdDe).trim()),
hasTrailerEn: Boolean(String(youtubeIdEn).trim()),
                alreadyExists
            }
        });

    } catch (error) {
        console.error('TMDB Preview Fehler:', error);
        res.status(500).json({ ok: false, reason: 'preview fehlgeschlagen', preview: null });
    }
});

// ADMIN-API: Externe Suche (TMDB) -> wenn nicht vorhanden: Import in DB
app.post('/api/admin/import-from-tmdb', async (req, res) => {
    try {
        const { mode, query, year } = req.body || {};
        const result = await adminImportFromTmdb({ mode, query, year });
        res.json(result);
    } catch (error) {
        console.error('TMDB Import Fehler:', error);
        res.status(500).json({ inserted: false, error: 'Import fehlgeschlagen' });
    }
});


// ADMIN-API: Einträge paginiert holen, damit das Dashboard schnell lädt
app.get('/api/admin/items', (req, res) => {
    const mode = req.query.mode || 'movies';
    const currentDb = (mode === 'games') ? gameDatabase : movieDatabase;
    const limit = Math.max(1, Number(req.query.limit) || 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const search = String(req.query.search || '').trim();

    const result = selectAdminItems(currentDb, { limit, offset, search });

    // Diagnose: hilft bei der Abgrenzung “Match-Problem” vs “Pagination/Anzeige”-Problem
    // - totalMatches: Anzahl aller Treffer (vor offset/limit)
    // - returned: Anzahl der Treffer, die gerade ausgeliefert/angezeigt werden
    if (offset === 0 && (String(search).trim().length > 0 || limit >= 50)) {
        const first = result.items && result.items[0] ? result.items[0] : null;
        console.log(
            `[AdminItems][Search] mode=${mode} search=${JSON.stringify(search)} dbSize=${currentDb.length} ` +
            `totalMatches=${result.total} returned=${result.items.length} ` +
            `hasMore=${result.hasMore} ` +
            (first ? `first=${JSON.stringify({title:first.title, year:first.year})}` : '')
        );
    }

    res.json({
        items: result.items,
        total: result.total,
        hasMore: result.hasMore,
        limit,
        offset
    });
});

// ADMIN-API: Nächsten Film ohne YouTube-ID heraussuchen
app.get('/api/admin/next-empty', (req, res) => {
    const mode = req.query.mode || 'movies'; // Standard ist movies
    const currentDb = (mode === 'games') ? gameDatabase : movieDatabase;

    // Nur DE/EN-spezifische Trailer-IDs zählen.
    const nextItem = currentDb.find(m => {
        const de = (m.youtubeIdDe || '').toString().trim();
        const en = (m.youtubeIdEn || '').toString().trim();
        return !de && !en;
    });

    if (!nextItem) {
        return res.json({ message: "Alle Einträge in dieser Liste sind vollständig! 🎉", finished: true });
    }

    // Fortschritt: wie viele Einträge haben mindestens eine Trailer-ID (DE oder EN)
    const filledCount = currentDb.filter(m => {
        const de = (m.youtubeIdDe || '').toString().trim();
        const en = (m.youtubeIdEn || '').toString().trim();
        return !!de || !!en;
    }).length;

    res.json({
        title: nextItem.title,
        year: nextItem.year,
        progress: `${filledCount} / ${currentDb.length}`,
        finished: false
    });
});


// ADMIN-API: Daten speichern und die entsprechende Datenquelle updaten
app.post('/api/admin/update', async (req, res) => {
    const { title, year, youtubeIdDe, youtubeIdEn, startAt, startAtDe, startAtEn, director, mode, mediaId } = req.body;



    const isGames = (mode === 'games');
    const currentDb = isGames ? gameDatabase : movieDatabase;
    const fileName = isGames ? 'games.json' : 'movies.json';

    // WICHTIG: Update zielgenau per eindeutiger ID (Supabase: media.id)
    // Preferiere mediaId aus der Admin-UI (damit wir nie falsche Zeile via title+year treffen).
    const item = (mediaId ? currentDb.find(m => String(m.id) === String(mediaId)) : null)
        || currentDb.find(m => m.id && m.title === title && m.year === parseInt(year, 10))
        || currentDb.find(m => m.title === title && m.year === parseInt(year, 10));


    if (!item) return res.status(404).json({ error: "Eintrag nicht gefunden!" });

    applyAdminUpdateToItem(item, { title, year, youtubeIdDe, youtubeIdEn, startAt, startAtDe, startAtEn, director });



    try {
        if (isGames) {
            fs.writeFileSync(path.join(__dirname, fileName), JSON.stringify(currentDb, null, 2), 'utf8');
        } else {

            // persistMovieUpdateToDatabase aktualisiert aktuell per title+year.
            // Das ist weiterhin ok als Fallback; mediaId wird in der Item-Auswahl verwendet.
            await persistMovieUpdateToDatabase(title, year, item.youtubeIdDe, item.youtubeIdEn, item.startAt, item.startAtDe, item.startAtEn, item.director);
        }


        console.log(`[Admin - ${mode.toUpperCase()}] '${title}' erfolgreich geupdatet.`);
        res.json({ success: true, item });
    } catch (error) {
        console.error(`Fehler beim Speichern der ${fileName}:`, error);
        res.status(500).json({ error: "Speicherfehler!" });
    }
});

// -------- Filmster Player Persistence (Anonymous Auth) --------



const rooms = {};


function createInitialTimeline() {
    return [
        { title: "The Godfather", year: 1972 },
        { title: "Dune", year: 2021 }
    ].sort((a, b) => a.year - b.year);
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {

    // 1. RAUM ERSTELLEN
    socket.on('createRoom', (playerName) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            host: socket.id,
            players: [{
                id: socket.id,
                name: playerName,
                score: 0,
                coins: 0,
                isHost: true,
                timeline: createInitialTimeline()
            }],
            gameStarted: false,
            playlist: movieDatabase
                .filter(m => m.youtubeId && m.youtubeId.trim() !== "")
                .sort(() => Math.random() - 0.5),
            currentRound: 0,
            activePlayerIndex: 0,
            mode: "movies",
            trailerLanguage: "any"
        };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    });

    // 2. RAUM BEITRETEN
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('errorMsg', 'Raum nicht gefunden!');
        if (room.gameStarted) return socket.emit('errorMsg', 'Spiel läuft bereits!');

        rooms[roomCode].players.push({
            id: socket.id,
            name: playerName,
            score: 0,
            coins: 0,
            isHost: false,
            timeline: createInitialTimeline()
        });

        socket.join(roomCode);
        io.to(roomCode).emit('playerJoined', room.players);
        socket.emit('joinSuccess', roomCode);
    });

    // 3. SPIEL STARTEN
    // Event für Spiel-Ablauf-Wechsel
    socket.on('updateGameType', ({ roomCode, type }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        room.gameType = type;
        io.to(roomCode).emit('gameTypeUpdated', type);
    });

    // 3. SPIEL STARTEN (KUGELSICHER)
    // 3. SPIEL STARTEN (Vom Host ausgelöst)
    socket.on('startGame', (data) => {
        // Falls der Client ein Objekt sendet, entpacken wir es, ansonsten nutzen wir es als roomCode (Fallback)
        const roomCode = (data && data.roomCode) ? data.roomCode : data;

        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        // Einstellungen aus dem Objekt im Raum speichern (oder Standardwerte nutzen)
        room.gameStarted = true;
        room.mode = (data && data.mode) ? data.mode : "movies";
        room.gameType = (data && data.type) ? data.type : "classic";
        room.winLimit = (data && data.winLimit) ? parseInt(data.winLimit) : 10;

        // Die richtige Datenbank wählen (Spiele oder Filme)
        const chosenDatabase = (room.mode === "games") ? gameDatabase : movieDatabase;

        // Playlist erstellen: Nur Einträge mit gültiger YouTube-ID, passend zur bevorzugten Trailer-Sprache
        const resolvedItems = chosenDatabase
            .map(item => ({
                ...item,
                youtubeId: getPreferredTrailerId(item, room.trailerLanguage),
                startAt: getPreferredTrailerStartAt(item, room.trailerLanguage)
            }))
            .filter(m => m.youtubeId && m.youtubeId.trim() !== "");

        if (resolvedItems.length === 0) {
            console.log("Fehler: Keine gültigen Einträge in der gewählten Datenbank gefunden!");
            return;
        }

        // Playlist zufällig mischen
        room.playlist = [...resolvedItems].sort(() => Math.random() - 0.5);
        room.currentRound = 0;
        room.submittedGuesses = []; // Für den Simultanmodus zurücksetzen
        room.timeExtensions = {};
        room.purchasedExtraTime = {};

        // Timelines aller Spieler mit der ersten Karte befüllen
        const firstMovie = room.playlist[room.currentRound];
        room.players.forEach(p => {
            p.timeline = [{ ...firstMovie }];
            p.score = 0;
            p.coins = 0;
        });

        // Nächsten Film vorbereiten (Runde 1 im Spiel wird Index 1 der Playlist sein)
        room.currentRound = 1;
        const nextMovie = room.playlist[room.currentRound];

        // Aktiven Spieler bestimmen (für den klassischen Modus)
        room.activePlayerIndex = 0;
        const activePlayer = room.players[room.activePlayerIndex];

        // Event an alle Clients senden, dass das Spiel startet
        io.to(roomCode).emit('gameStarted', {
            round: room.currentRound,
            activePlayerId: activePlayer.id,
            youtubeId: nextMovie.youtubeId,
            startAt: nextMovie.startAt || 0,
            players: room.players,
            gameType: room.gameType,
            totalRounds: room.playlist.length,
            winLimit: room.winLimit // Sendet das Limit ans Frontend
        });
    });

    // Event für Spielmodus-Wechsel (hast du schon)
    socket.on('updateGameMode', ({ roomCode, mode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        room.mode = mode;
        io.to(roomCode).emit('gameModeUpdated', mode);
    });

    // NEU: Event für die Änderung der Clip-Dauer ⏱️
    socket.on('updateClipDuration', ({ roomCode, duration }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        room.clipDuration = duration; // Auf dem Server speichern
        io.to(roomCode).emit('clipDurationUpdated', duration);
    });

    socket.on('updateWinLimit', ({ roomCode, limit }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        room.winLimit = limit; // Auf dem Server speichern
        io.to(roomCode).emit('winLimitUpdated', limit);
    });

    socket.on('updateTrailerLanguage', ({ roomCode, preference }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        room.trailerLanguage = preference || 'any';
        room.playlist = (room.playlist || []).map(item => ({
            ...item,
            youtubeId: getPreferredTrailerId(item, room.trailerLanguage),
            startAt: getPreferredTrailerStartAt(item, room.trailerLanguage)
        })).filter(item => item.youtubeId && item.youtubeId.trim() !== "");

        io.to(roomCode).emit('trailerLanguageUpdated', room.trailerLanguage);
    });

    socket.on('syncPlay', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        // Optional: Hier prüfen, ob der Sender wirklich der aktive Spieler ist
        socket.to(roomCode).emit('onSyncPlay');
    });

    // SYNC: Video pausieren für alle im Raum
    socket.on('syncPause', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        socket.to(roomCode).emit('onSyncPause');
    });

    // NEU: Curtain-Lock kaufen (alle anderen bleiben blind)
    socket.on('buyCurtainLock', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (room.gameType !== 'simultaneous') {
            return socket.emit('errorMsg', 'Vorhang sperren ist nur im Simultanmodus verfügbar.');
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const COST = 8;
        if (player.coins < COST) {
            return socket.emit('errorMsg', `Du hast nicht genug Coins (${COST}) für Vorhang sperren.`);
        }

        if (room.curtainLock && room.curtainLock.active && room.curtainLock.round === room.currentRound) {
            return socket.emit('errorMsg', 'Vorhang ist diese Runde bereits gesperrt.');
        }

        player.coins -= COST;

        room.curtainLock = {
            active: true,
            round: room.currentRound,
            byPlayerId: socket.id
        };

        io.to(roomCode).emit('curtainLockActivated', {
            byPlayerId: socket.id,
            players: room.players
        });
    });

    // Extra-Zeit kaufen (bestehender Simultanmodus-Mechanismus)
    socket.on('buyExtraTime', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (room.gameType !== 'simultaneous') {
            return socket.emit('errorMsg', 'Extra-Zeit ist nur im Simultanmodus verfügbar.');
        }

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        if (player.coins < 4) {
            return socket.emit('errorMsg', 'Du hast nicht genug Coins für 5 Extra-Sekunden.');
        }

        const currentRoundExtensions = room.purchasedExtraTime[room.currentRound] || new Set();
        if (currentRoundExtensions.has(socket.id)) {
            return socket.emit('errorMsg', 'Du hast bereits 5 Extra-Sekunden für diese Runde gekauft.');
        }

        player.coins -= 4;
        if (!room.purchasedExtraTime[room.currentRound]) {
            room.purchasedExtraTime[room.currentRound] = new Set();
        }
        room.purchasedExtraTime[room.currentRound].add(socket.id);
        room.timeExtensions[room.currentRound] = (room.timeExtensions[room.currentRound] || 0) + 5;

        io.to(roomCode).emit('timeExtensionGranted', {
            playerId: player.id,
            playerName: player.name,
            extraSeconds: 5,
            players: room.players,
            totalExtraSeconds: room.timeExtensions[room.currentRound]
        });
    });


    // 4. TIPP AUSWERTEN (WASSERDICHTE LOGIK FÜR JAHRGÄNGE 🛠️)
    // 4. TIPP AUSWERTEN (DIE WEICHE FÜR BEIDE MODI)
    socket.on('submitGuess', ({ roomCode, guessedIndex }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const currentItem = room.playlist[room.currentRound];

        if (room.gameType === "simultaneous") {
            // --- 🚀 SIMULTAN-MODUS LOGIK ---
            const existing = room.submittedGuesses.find(entry => entry.id === socket.id);
            if (existing) {
                existing.guessedIndex = guessedIndex;
                existing.timestamp = Date.now();
            } else {
                room.submittedGuesses.push({ id: socket.id, guessedIndex, timestamp: Date.now() });
            }


            const totalPlayers = room.players.length;
            const totalGuesses = room.submittedGuesses.length;

            if (totalGuesses >= totalPlayers) {
                const results = room.submittedGuesses.map(entry => {
                    const p = room.players.find(player => player.id === entry.id);
                    const pGuess = entry.guessedIndex;

                    const leftYear = pGuess >= 0 ? p.timeline[pGuess].year : -Infinity;
                    const rightYear = (pGuess + 1) < p.timeline.length ? p.timeline[pGuess + 1].year : Infinity;

                    const isCorrect = (currentItem.year >= leftYear && currentItem.year <= rightYear);

                    if (isCorrect) {
                        p.timeline.splice(pGuess + 1, 0, { ...currentItem });
                        p.score++;
                    }

                    return {
                        id: p.id,
                        name: p.name,
                        isCorrect,
                        updatedTimeline: p.timeline,
                        guessedIndex: pGuess
                    };
                });

                const correctResults = results.filter(r => r.isCorrect);
                correctResults.forEach((result, index) => {
                    const coinsEarned = Math.max(1, correctResults.length - index);
                    const player = room.players.find(p => p.id === result.id);
                    if (player) {
                        player.coins = (player.coins || 0) + coinsEarned;
                    }
                    result.coinsEarned = coinsEarned;
                });

                const incorrectResults = results.filter(r => !r.isCorrect);
                incorrectResults.forEach(result => {
                    result.coinsEarned = 0;
                });

                // 1. ZUERST: Runde auflösen, damit alle Clients die neue Karte sehen
                io.to(roomCode).emit('simultaneousRoundResolved', {
                    title: currentItem.title,
                    year: currentItem.year,
                    director: currentItem.director,
                    players: room.players,
                    results: results,
                    winLimit: room.winLimit
                });

                // 2. DANACH: Kurz warten (z.B. 1,5 Sekunden), damit die Animation durchlaufen kann, dann auf Sieg prüfen
                setTimeout(() => {
                    const winner = room.players.find(p => (p.timeline.length - 1) >= room.winLimit);
                    if (winner) {
                        io.to(roomCode).emit('gameWon', {
                            winnerName: winner.name,
                            timeline: winner.timeline
                        });
                        room.gameStarted = false;
                    }
                }, 1500); // 1500 Millisekunden Verzögerung (kannst du an deine CSS-Animation anpassen)
            } else {
                io.to(roomCode).emit('playerSubmittedStatus', room.submittedGuesses.map(entry => entry.id));
            }

        } else {
            // --- 🎬 KLASSISCHER MODUS LOGIK ---
            if (room.activePlayerIndex >= room.players.length) {
                room.activePlayerIndex = 0;
            }

            const activePlayer = room.players[room.activePlayerIndex];
            const playerTimeline = activePlayer.timeline;

            const leftYear = guessedIndex >= 0 ? playerTimeline[guessedIndex].year : -Infinity;
            const rightYear = (guessedIndex + 1) < playerTimeline.length ? playerTimeline[guessedIndex + 1].year : Infinity;

            const isCorrect = (currentItem.year >= leftYear && currentItem.year <= rightYear);

            if (isCorrect) {
                activePlayer.timeline.splice(guessedIndex + 1, 0, { ...currentItem });
                activePlayer.score++;
            }

            // 1. ZUERST: Das Runden-Ergebnis senden, damit die Karte in die Timeline rutscht
            io.to(roomCode).emit('roundResolved', {
                isCorrect,
                title: currentItem.title,
                year: currentItem.year,
                director: currentItem.director,
                players: room.players,
                playerName: activePlayer.name,
                activePlayerId: activePlayer.id,
                updatedTimeline: playerTimeline
            });

            // 2. DANACH: Mit einer kleinen Verzögerung prüfen, ob das Spiel vorbei ist
            setTimeout(() => {
                if ((activePlayer.timeline.length - 1) >= room.winLimit) {
                    io.to(roomCode).emit('gameWon', {
                        winnerName: activePlayer.name,
                        timeline: activePlayer.timeline
                    });
                    room.gameStarted = false;
                }
            }, 1500); // Gibt dem Client Zeit für die Einrast-Animation
        }
    });

    // 5. NÄCHSTE RUNDE
    socket.on('requestNextRound', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        // Curtain-Lock für die ablaufende Runde deaktivieren
        if (room.curtainLock && room.curtainLock.active && room.curtainLock.round === room.currentRound - 1) {
            room.curtainLock.active = false;
            const byPlayerId = room.curtainLock.byPlayerId;
            io.to(roomCode).emit('curtainLockDeactivated', { byPlayerId });
        }

        room.currentRound++;


        // Sind wir am Ende der Playlist angekommen?
        if (room.currentRound >= room.playlist.length) {
            io.to(roomCode).emit('gameOver', room.players);
            delete rooms[roomCode];
            return;
        }

        // Simultan-Tipps für die neue Runde zurücksetzen!
        room.submittedGuesses = [];

        // Curtain-Lock zurücksetzen (gilt pro kompletter Runde)
        if (room.curtainLock && room.curtainLock.active) {
            room.curtainLock.active = false;
            const byPlayerId = room.curtainLock.byPlayerId;
            io.to(roomCode).emit('curtainLockDeactivated', { byPlayerId });
        }

        room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;

        const nextMovie = room.playlist[room.currentRound];
        const activePlayer = room.players[room.activePlayerIndex];

        io.to(roomCode).emit('nextRoundStarted', {
            round: room.currentRound, // Die Runde entspricht unserem Index (startet bei 1)
            activePlayerId: activePlayer.id,
            youtubeId: nextMovie.youtubeId,
            startAt: nextMovie.startAt || 0,
            players: room.players,
            gameType: room.gameType, // Wichtig für den Client!
            winLimit: room.winLimit
        });
    });
});

const PORT = process.env.PORT || 3000;

module.exports = {
    getPreferredTrailerId,
    getPreferredTrailerStartAt,
    applyAdminUpdateToItem,
    selectAdminItems
};

if (require.main === module) {
    initializeDataSources().then(() => {
        server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
    }).catch((error) => {
        console.error('Fehler beim Starten des Servers:', error);
        process.exit(1);
    });
}