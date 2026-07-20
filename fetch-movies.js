const fs = require('fs');
const path = require('path');

// ==========================================
// DEIN API-KEY IST HIERBEREITS HINTERLEGT
// ==========================================
const API_KEY = "f8ad9f5d1827f009612603f7bd11e603";

const TARGET_FILE = path.join(__dirname, 'movies.json');
let allMedia = [];

// Hilfsfunktion für allgemeine Requests
async function fetchFromTMDB(endpoint, queryParams, page = 1) {
    const pageParam = page ? `&page=${page}` : '';
    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${API_KEY}&language=de-DE${pageParam}&${queryParams}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Fehler: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`Fehler beim Abrufen von ${endpoint}:`, error);
        return null;
    }
}

// Holt Trailer & Mitwirkende für ein spezifisches Medium
async function fetchAdditionalDetails(type, id) {
    // KORREKTUR: Wir entfernen &language=de-DE aus der Haupt-URL für Videos und nutzen stattdessen
    // include_video_language=de,en ohne feste Sprachbarriere, damit TMDB uns die volle Liste schickt.
    const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${API_KEY}&append_to_response=videos,credits&include_video_language=de,en`;

    try {
        const response = await fetch(url);
        if (!response.ok) return { youtubeIdDe: "", youtubeIdEn: "", director: "Unbekannt" };
        const data = await response.json();

        let youtubeIdDe = "";
        let youtubeIdEn = "";

        if (data.videos && data.videos.results) {
            // Sortierung: Wir priorisieren echte "Trailer" vor "Teaser"
            const videos = data.videos.results.filter(v => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"));

            // 1. Suche nach dem deutschen Trailer
            // TMDB markiert deutsche Trailer entweder explizit mit 'de' oder packt sie in den de-DE Kontext
            const deTrailer = videos.find(v => v.iso_639_1 === "de");
            if (deTrailer) {
                youtubeIdDe = deTrailer.key;
            }

            // 2. Suche nach dem englischen Trailer
            const enTrailer = videos.find(v => v.iso_639_1 === "en");
            if (enTrailer) {
                youtubeIdEn = enTrailer.key;
            }

            // Fallback-Logik:
            // Wenn kein explizit deutscher Trailer gefunden wurde, aber ein englischer existiert,
            // nutzen wir den englischen als primären Standard-Trailer (damit youtubeIdDe nicht leer bleibt)
            if (!youtubeIdDe && youtubeIdEn) {
                youtubeIdDe = youtubeIdEn;
            }

            // Falls gar nichts matcht, nehmen wir einfach das erste verfügbare Video
            if (!youtubeIdDe && videos.length > 0) {
                youtubeIdDe = videos[0].key;
            }
        }

        // Regisseur / Schöpfer auslesen (bleibt gleich)
        let director = "Unbekannt";
        if (type === 'movie' && data.credits && data.credits.crew) {
            const dirObj = data.credits.crew.find(person => person.job === 'Director');
            if (dirObj) director = dirObj.name;
        } else if (type === 'tv' && data.created_by && data.created_by.length > 0) {
            director = data.created_by.map(c => c.name).join(', ');
        }

        return {
            youtubeIdDe: youtubeIdDe || "",
            youtubeIdEn: youtubeIdEn || "",
            director
        };
    } catch (e) {
        return { youtubeIdDe: "", youtubeIdEn: "", director: "Unbekannt" };
    }
}

const { createClient } = require('@supabase/supabase-js');

// ==========================================
// SUPABASE ZUGANGSDATEN
// ==========================================
const SUPABASE_URL = 'https://cpuvameaqyylazwtasaq.supabase.co'; // Findest du unter Project Settings -> API
const SUPABASE_KEY = 'sb_publishable_DaYiei6f2p4uC5RZPI17ig_YvZySnOD';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function startImport() {
    console.log("🎬 Starte erweiterten TMDB-Datenimport (Fokus auf Klassiker & Blockbuster)...");

    // =========================================================================
    // BLOCK 1: GLOBALE TOP-FILME (Hauptsächlich neuere Blockbuster)
    // =========================================================================
    const globalMovieFilters = "sort_by=vote_count.desc&vote_count.gte=800&release_date.lte=2025-12-31&with_original_language=en|de|fr|es";

    console.log("⏳ Lade die bekanntesten globalen Blockbuster herunter...");
    for (let page = 1; page <= 30; page++) {
        const data = await fetchFromTMDB('discover/movie', globalMovieFilters, page);
        if (data && data.results) {
            for (const item of data.results) {
                if (item.title && item.release_date) {
                    const year = new Date(item.release_date).getFullYear();
                    if (!isNaN(year) && year <= 2025) {
                        const details = await fetchAdditionalDetails('movie', item.id);
                        allMedia.push({
                            title: item.title,
                            year: year,
                            youtubeIdDe: details.youtubeIdDe,
                            youtubeIdEn: details.youtubeIdEn,
                            director: details.director,
                            startAt: 0
                        });
                    }
                }
            }
        }
        console.log(`   -> Globale Filme: Seite ${page}/30 verarbeitet...`);
    }

    // =========================================================================
    // BLOCK 2: RETRO-KLASSIKER (Explizit vor dem Jahr 2000)
    // =========================================================================
    const retroMovieFilters = "sort_by=vote_count.desc&vote_count.gte=400&release_date.gte=1950-01-01&release_date.lte=1999-12-31&with_original_language=en|de|fr|es";

    console.log("⏳ Lade gezielt Klassiker von vor 2000 herunter...");
    for (let page = 1; page <= 25; page++) {
        const data = await fetchFromTMDB('discover/movie', retroMovieFilters, page);
        if (data && data.results) {
            for (const item of data.results) {
                if (item.title && item.release_date) {
                    const year = new Date(item.release_date).getFullYear();
                    const details = await fetchAdditionalDetails('movie', item.id);
                    allMedia.push({
                        title: item.title,
                        year: year,
                        youtubeIdDe: details.youtubeIdDe,
                        youtubeIdEn: details.youtubeIdEn,
                        director: details.director,
                        startAt: 0
                    });
                }
            }
        }
        console.log(`   -> Retro-Klassiker: Seite ${page}/25 verarbeitet...`);
    }

    // =========================================================================
    // BLOCK 3: BEKANNTESTE SERIEN
    // =========================================================================
    const tvFilters = "sort_by=vote_count.desc&vote_count.gte=150&first_air_date.lte=2025-12-31&with_original_language=en|de";

    console.log("⏳ Lade die bekanntesten Serien herunter...");
    for (let page = 1; page <= 15; page++) {
        const data = await fetchFromTMDB('discover/tv', tvFilters, page);
        if (data && data.results) {
            for (const item of data.results) {
                if (item.name && item.first_air_date) {
                    const year = new Date(item.first_air_date).getFullYear();
                    if (!isNaN(year) && year <= 2025) {
                        const details = await fetchAdditionalDetails('tv', item.id);
                        allMedia.push({
                            title: item.name,
                            year: year,
                            youtubeIdDe: details.youtubeIdDe,
                            youtubeIdEn: details.youtubeIdEn,
                            director: details.director,
                            startAt: 0
                        });
                    }
                }
            }
        }
        console.log(`   -> Serien: Seite ${page}/15 verarbeitet...`);
    }

    // Doppelte Einträge filtern
    const uniqueMedia = Array.from(new Set(allMedia.map(m => JSON.stringify(m)))).map(s => JSON.parse(s));

    console.log(`\n⏳ Bereite Upload von ${uniqueMedia.length} Einträgen zu Supabase vor...`);

    const rowsToInsert = uniqueMedia.map(item => ({
        title: item.title,
        year: item.year,
        youtube_id_de: item.youtubeIdDe || "",
        youtube_id_en: item.youtubeIdEn || "",
        director: item.director,
        start_at: item.startAt || 0
    }));

    try {
        const chunkSize = 100;
        for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
            const chunk = rowsToInsert.slice(i, i + chunkSize);

            const { error } = await supabase
                .from('media')
                .insert(chunk);

            if (error) throw error;
            console.log(`   -> ${i + chunk.length}/${rowsToInsert.length} Einträge hochgeladen.`);
        }

        console.log("\n✅ Fertig! Alle Daten wurden erfolgreich live in deine Supabase-Datenbank übertragen!");

    } catch (err) {
        console.error("❌ Fehler beim Supabase-Upload:", err.message);
    }
}

if (API_KEY === "DEIN_TMDB_API_KEY_HIER_EINSETZEN") {
    console.error("❌ Bitte trage zuerst deinen echten TMDB API-Key ein!");
} else {
    startImport();
}